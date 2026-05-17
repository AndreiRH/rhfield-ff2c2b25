// RHfield service worker — true offline-first.
//
// Layers:
//  1. App shell + assets: cache-first, network-revalidate.
//  2. Supabase REST GETs: stale-while-revalidate; offline → reconstruct
//     from the local IndexedDB snapshot, including embedded selects,
//     .single(), count/head, eq/neq/in/is/lt/gt/range/order/limit/or().
//  3. Supabase REST mutations (POST/PATCH/DELETE): apply optimistically
//     to the snapshot AND queue the original request for replay. Online,
//     pass through and patch the snapshot on success too.
//  4. Supabase Storage uploads: save the uploaded blob in IndexedDB
//     keyed by `<bucket>/<path>`. If offline, also queue the upload.
//  5. Supabase Storage signed-URL POST (createSignedUrl/createSignedUrls):
//     if offline, return a synthetic body so the client builds a URL the
//     SW can answer from the local blob store.
//  6. Supabase Storage GETs: serve from the local blob store first, then
//     HTTP cache, then network.
//
// All replays are triggered on `online`, on `visibilitychange`, and via
// Background Sync (`rhfield-flush`).

const VER = "v13";

// A stored blob is only servable as media if it has a real media MIME.
// Anything else (multipart/form-data, application/octet-stream, empty) is
// treated as corruption and ignored — the SW will fall through to network.
function isServableMediaType(t) {
  if (!t || typeof t !== "string") return false;
  return /^(image|video|audio)\//i.test(t) || t === "application/pdf";
}
function isValidStoredBlob(stored) {
  return !!(stored && stored.blob && stored.blob.size > 0 && isServableMediaType(stored.type || stored.blob.type));
}
const CACHE_SHELL  = `rhfield-shell-${VER}`;
const CACHE_ASSETS = `rhfield-assets-${VER}`;
const CACHE_DATA   = `rhfield-data-${VER}`;
const CACHE_BLOBS  = `rhfield-blobs-${VER}`;
const ALL_CACHES = [CACHE_SHELL, CACHE_ASSETS, CACHE_DATA, CACHE_BLOBS];

const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

// ============================================================
// Outbox (queued writes)
// ============================================================
const OUTBOX_DB = "rhfield-outbox";
const OUTBOX_STORE = "queue";
function openOutbox() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(OUTBOX_DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore(OUTBOX_STORE, { keyPath: "id", autoIncrement: true });
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function outboxAdd(item) {
  const db = await openOutbox();
  return new Promise((res, rej) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).add(item);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function outboxAll() {
  const db = await openOutbox();
  return new Promise((res, rej) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const r = tx.objectStore(OUTBOX_STORE).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}
async function outboxDelete(id) {
  const db = await openOutbox();
  return new Promise((res, rej) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    tx.objectStore(OUTBOX_STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function outboxCount() {
  const items = await outboxAll();
  return items.filter((it) => !it?.failed).length;
}
async function outboxStats() {
  const items = await outboxAll();
  let pending = 0, failed = 0;
  for (const it of items) { if (it?.failed) failed++; else pending++; }
  return { pending, failed };
}
async function outboxUpdate(id, patch) {
  const db = await openOutbox();
  await new Promise((res, rej) => {
    const tx = db.transaction(OUTBOX_STORE, "readwrite");
    const store = tx.objectStore(OUTBOX_STORE);
    const g = store.get(id);
    g.onsuccess = () => {
      const cur = g.result;
      if (cur) { Object.assign(cur, patch); store.put(cur); }
    };
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ============================================================
// Snapshot store (mirrors src/lib/snapshot-store.ts, v2)
// ============================================================
const SNAP_DB = "rhfield-snapshot";
const SNAP_VER = 2;
const SNAP_TABLES = "tables";
const SNAP_BLOBS  = "blobs";   // key = "<bucket>/<path>", value = { blob, type, savedAt }
const SNAP_META   = "meta";    // key = string, value = anything

function openSnap() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(SNAP_DB, SNAP_VER);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains(SNAP_TABLES)) db.createObjectStore(SNAP_TABLES);
      if (!db.objectStoreNames.contains(SNAP_BLOBS))  db.createObjectStore(SNAP_BLOBS);
      if (!db.objectStoreNames.contains(SNAP_META))   db.createObjectStore(SNAP_META);
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function snapGet(store, key) {
  try {
    const db = await openSnap();
    return await new Promise((res, rej) => {
      const tx = db.transaction(store, "readonly");
      const r = tx.objectStore(store).get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => rej(r.error);
    });
  } catch { return null; }
}
async function snapPut(store, key, value) {
  const db = await openSnap();
  await new Promise((res, rej) => {
    const tx = db.transaction(store, "readwrite");
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function readTable(name) {
  const v = await snapGet(SNAP_TABLES, name);
  return Array.isArray(v) ? v : [];
}
async function writeTable(name, rows) {
  await snapPut(SNAP_TABLES, name, rows);
}
async function mergeRows(table, incoming) {
  const rows = Array.isArray(incoming) ? incoming : [incoming];
  const current = await readTable(table);
  const byId = new Map(current.map((r) => [r?.id, r]));
  for (const row of rows) {
    if (row?.id == null) current.push(row);
    else if (byId.has(row.id)) Object.assign(byId.get(row.id), row);
    else { current.push(row); byId.set(row.id, row); }
  }
  await writeTable(table, current);
}
async function getBlob(key) {
  return await snapGet(SNAP_BLOBS, key);
}
async function putBlob(key, blob) {
  await snapPut(SNAP_BLOBS, key, { blob, type: blob.type || "application/octet-stream", savedAt: Date.now() });
}
async function delBlob(key) {
  const db = await openSnap();
  await new Promise((res, rej) => {
    const tx = db.transaction(SNAP_BLOBS, "readwrite");
    tx.objectStore(SNAP_BLOBS).delete(key);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ============================================================
// Broadcast
// ============================================================
async function broadcast(msg) {
  const cs = await self.clients.matchAll({ includeUncontrolled: true });
  cs.forEach((c) => c.postMessage(msg));
}
async function broadcastQueueCount() {
  try {
    const s = await outboxStats();
    await broadcast({ type: "rhfield-queue", count: s.pending, failed: s.failed });
  } catch {}
}
async function broadcastDataChanged() {
  try { await broadcast({ type: "rhfield-data-changed" }); } catch {}
}
let latestAuthHeader = null;
function rememberAuth(req) {
  try {
    const auth = req.headers.get("authorization");
    if (auth) latestAuthHeader = auth;
  } catch {}
}

function sameOriginAssetUrls(html, baseUrl) {
  const out = new Set();
  const patterns = [
    /(?:src|href)=["']([^"']+)["']/g,
    /import\(["']([^"']+)["']\)/g,
    /__vitePreload\(\(\)\s*=>\s*import\(["']([^"']+)["']\)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(html))) {
      try {
        const u = new URL(m[1], baseUrl);
        if (u.origin === self.location.origin && !u.hash) out.add(u.href);
      } catch {}
    }
  }
  return [...out];
}

async function fetchWithTimeout(input, ms = 2500, init = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), ms);
  try {
    const req = input instanceof Request ? new Request(input, { signal: ctrl.signal }) : input;
    return await fetch(req, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(to);
  }
}

async function cacheAssetAndImports(assetUrl, assets, seen = new Set()) {
  if (seen.has(assetUrl)) return;
  seen.add(assetUrl);
  try {
    let res = await assets.match(assetUrl);
    if (!res) {
      res = await fetchWithTimeout(assetUrl, 5000, { credentials: "include" });
      if (res && res.ok && res.type === "basic") await assets.put(assetUrl, res.clone());
    }
    const ct = res?.headers?.get("Content-Type") || "";
    if (res && (ct.includes("javascript") || new URL(assetUrl).pathname.endsWith(".js"))) {
      const text = await res.clone().text().catch(() => "");
      await Promise.all(sameOriginAssetUrls(text, assetUrl).map((u) => cacheAssetAndImports(u, assets, seen)));
    }
  } catch {}
}

async function cacheRoutesForOffline(routes, port) {
  const shell = await caches.open(CACHE_SHELL);
  const assets = await caches.open(CACHE_ASSETS);
  const list = routes || [];
  // Figure out which routes still need warming.
  const todo = [];
  for (const route of list) {
    try {
      const u = new URL(route, self.location.origin);
      const hit = await shell.match(u.href);
      if (!hit) todo.push(u.href);
    } catch {}
  }

  // For a SPA, every route returns the same index.html shell, so fetch the
  // root once and reuse its bytes for each missing route. Falls back to a
  // per-route fetch only if the root fetch fails.
  let rootShellBytes = null;
  let rootShellHeaders = null;
  if (todo.length) {
    try {
      const rootRes = await fetch(new URL("/", self.location.origin).href, {
        credentials: "include", cache: "no-store",
      });
      if (rootRes && rootRes.ok) {
        rootShellBytes = await rootRes.clone().arrayBuffer();
        rootShellHeaders = {};
        rootRes.headers.forEach((v, k) => { rootShellHeaders[k] = v; });
        // Refresh asset chunks referenced by the shell.
        try {
          const html = new TextDecoder().decode(rootShellBytes);
          const urls = sameOriginAssetUrls(html, new URL("/", self.location.origin).href);
          await Promise.all(urls.map(async (assetUrl) => {
            try {
              const cached = await assets.match(assetUrl);
              if (!cached) {
                const ar = await fetch(assetUrl, { credentials: "include" });
                if (ar && ar.ok && ar.type === "basic") await assets.put(assetUrl, ar.clone());
              }
            } catch {}
          }));
        } catch {}
      }
    } catch {}
  }

  let done = 0;
  // Already-cached routes count as done immediately.
  const skipped = list.length - todo.length;
  done = skipped;
  try { port?.postMessage({ type: "progress", done, total: list.length }); } catch {}

  for (const href of todo) {
    try {
      if (rootShellBytes) {
        const res = new Response(rootShellBytes.slice(0), { status: 200, headers: rootShellHeaders });
        await shell.put(href, res);
      } else {
        const res = await fetch(href, { credentials: "include", cache: "no-store" });
        if (res && res.ok) await shell.put(href, res.clone());
      }
    } catch {}
    done++;
    try { port?.postMessage({ type: "progress", done, total: list.length }); } catch {}
  }
  try { port?.postMessage({ type: "done", done, total: list.length }); } catch {}
}

// ============================================================
// Install / activate
// ============================================================
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(CACHE_SHELL);
    // Per-item add so one failure (missing icon, etc.) doesn't abort install.
    await Promise.all(SHELL.map(async (u) => {
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (r && r.ok) await shell.put(u, r.clone());
      } catch {}
    }));
    try {
      const rootUrl = new URL("/", self.location.origin).href;
      const root = await fetch(rootUrl, { cache: "no-store" });
      if (root && root.ok) {
        await shell.put(rootUrl, root.clone());
        await shell.put("/", root.clone());
        // Also cache /login since first-launch navigations often land there.
        try {
          const loginUrl = new URL("/login", self.location.origin).href;
          const loginRes = await fetch(loginUrl, { cache: "no-store" });
          if (loginRes && loginRes.ok) await shell.put(loginUrl, loginRes.clone());
        } catch {}
        const html = await root.text().catch(() => "");
        const assets = await caches.open(CACHE_ASSETS);
        await Promise.all(sameOriginAssetUrls(html, rootUrl).map(async (assetUrl) => {
          try {
            const res = await fetch(assetUrl, { cache: "no-store" });
            if (res && res.ok && res.type === "basic") await assets.put(assetUrl, res.clone());
          } catch {}
        }));
      }
    } catch {}
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !ALL_CACHES.includes(n)).map((n) => caches.delete(n)));

    // v11: sweep corrupted blobs persisted by earlier SW versions
    // (multipart/form-data, application/octet-stream, zero-byte, etc.).
    try {
      const db = await openSnap();
      await new Promise((res, rej) => {
        const tx = db.transaction(SNAP_BLOBS, "readwrite");
        const store = tx.objectStore(SNAP_BLOBS);
        const req = store.openCursor();
        req.onsuccess = (ev) => {
          const cursor = ev.target.result;
          if (!cursor) return;
          if (!isValidStoredBlob(cursor.value)) cursor.delete();
          cursor.continue();
        };
        tx.oncomplete = () => res();
        tx.onerror = () => rej(tx.error);
      });
    } catch {}

    // Also purge the blob HTTP cache — it may hold corrupted responses
    // keyed by signed URLs that would never be re-matched/evicted.
    try { await caches.delete(CACHE_BLOBS); } catch {}

    await self.clients.claim();
    broadcastQueueCount();
  })());
});

// ============================================================
// URL classification
// ============================================================
function isSupabaseRest(url)    { return /\.supabase\.co\/rest\/v1\//.test(url.href); }
function isSupabaseStorage(url) { return /\.supabase\.co\/storage\/v1\//.test(url.href); }
function isLocalSyntheticStorage(url) { return url.origin === self.location.origin && /^\/object\/(?:sign|authenticated|public)\//.test(url.pathname); }
function isSupabaseAuth(url)    { return /\.supabase\.co\/auth\/v1\//.test(url.href); }
function isSupabaseRealtime(url){ return /\.supabase\.co\/realtime\/v1\//.test(url.href); }

// ============================================================
// PostgREST embed/relationship map (1:N children)
// child table is stored flat; FK column on child references parent.id
// ============================================================
const REL = {
  projects: {
    lines: { table: "lines", fk: "project_id" },
  },
  lines: {
    plant_equipment: { table: "plant_equipment", fk: "line_id" },
    equipment_groups: { table: "equipment_groups", fk: "line_id" },
    milestones: { table: "milestones", fk: "line_id" },
    pa_folders: { table: "pa_folders", fk: "line_id" },
    pa_notes: { table: "pa_notes", fk: "line_id" },
  },
  plant_equipment: {
    equipment_groups: { table: "equipment_groups", fk: "plant_equipment_id" },
    equipment_settings: { table: "equipment_settings", fk: "plant_equipment_id" },
    equipment_notes: { table: "equipment_notes", fk: "equipment_id" },
    equipment_photos: { table: "equipment_photos", fk: "equipment_id" },
    setting_logs: { table: "setting_logs", fk: "plant_equipment_id" },
  },
  equipment_groups: {
    components: { table: "components", fk: "equipment_id" },
    component_types: { table: "component_types", fk: "equipment_group_id" },
  },
  component_types: {
    components: { table: "components", fk: "component_type_id" },
  },
  components: {
    checklist_items: { table: "checklist_items", fk: "component_id" },
    component_photos: { table: "component_photos", fk: "component_id" },
    component_files: { table: "component_files", fk: "component_id" },
  },
  checklist_items: {
    item_photos: { table: "item_photos", fk: "item_id" },
    item_files: { table: "item_files", fk: "item_id" },
  },
  equipment_settings: {
    setting_photos: { table: "setting_photos", fk: "equipment_setting_id" },
    setting_files: { table: "setting_files", fk: "equipment_setting_id" },
  },
  pa_folders: {
    pa_attachments: { table: "pa_attachments", fk: "folder_id" },
    pa_notes: { table: "pa_notes", fk: "folder_id" },
  },
  common_folders: {
    common_folder_attachments: { table: "common_folder_attachments", fk: "folder_id" },
    common_folder_notes: { table: "common_folder_notes", fk: "folder_id" },
  },
};

// ============================================================
// Embed select parser:  "id, name, lines(id, plant_equipment(id))"
// returns { columns: ["id","name","*"], embeds: [{name, select}] }
// ============================================================
function parseSelect(sel) {
  if (!sel || sel === "*") return { columns: null, embeds: [] }; // null = all
  const tokens = splitTopLevel(sel, ",");
  const columns = [];
  const embeds = [];
  for (let t of tokens) {
    t = t.trim();
    if (!t) continue;
    const open = t.indexOf("(");
    if (open >= 0 && t.endsWith(")")) {
      const name = t.slice(0, open).trim();
      const inner = t.slice(open + 1, -1);
      embeds.push({ name, select: inner });
    } else {
      columns.push(t);
    }
  }
  return { columns: columns.length ? columns : null, embeds };
}
function splitTopLevel(s, sep) {
  const out = [];
  let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === sep && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

// ============================================================
// Filter parsing & application
// ============================================================
function cast(v) {
  if (v === "null") return null;
  if (v === "true") return true;
  if (v === "false") return false;
  const n = Number(v);
  return Number.isFinite(n) && /^-?\d+(\.\d+)?$/.test(v) ? n : v;
}
function applyOp(row, col, op, value) {
  const v = row?.[col];
  switch (op) {
    case "eq":  return String(v) === value;
    case "neq": return String(v) !== value;
    case "is":
      if (value === "null")     return v == null;
      if (value === "not.null") return v != null;
      if (value === "true")     return v === true;
      if (value === "false")    return v === false;
      return false;
    case "in": {
      const inner = value.replace(/^\(|\)$/g, "");
      const set = new Set(inner.split(",").map((x) => x.replace(/^"|"$/g, "")));
      return set.has(String(v));
    }
    case "gt":  return v >  cast(value);
    case "gte": return v >= cast(value);
    case "lt":  return v <  cast(value);
    case "lte": return v <= cast(value);
    case "like":
    case "ilike": {
      const pat = value.replace(/%/g, ".*").replace(/_/g, ".");
      const re = new RegExp("^" + pat + "$", op === "ilike" ? "i" : "");
      return typeof v === "string" && re.test(v);
    }
    case "not": {
      // value = "<op>.<rest>"
      const dot = value.indexOf(".");
      if (dot < 0) return true;
      return !applyOp(row, col, value.slice(0, dot), value.slice(dot + 1));
    }
    default: return true;
  }
}
function applyFilter(rows, col, value) {
  // value = "<op>.<rest>"
  const dot = value.indexOf(".");
  if (dot < 0) return rows;
  const op = value.slice(0, dot);
  const rest = value.slice(dot + 1);
  return rows.filter((r) => applyOp(r, col, op, rest));
}
// or=(col.op.val,and(...),col.op.val)  — returns predicate
function parseOr(expr) {
  // strip leading/trailing parens if wrapping the whole expr
  if (expr.startsWith("(") && balancedEnd(expr) === expr.length - 1) expr = expr.slice(1, -1);
  const parts = splitTopLevel(expr, ",");
  const preds = parts.map(parseClause).filter(Boolean);
  return (row) => preds.some((p) => p(row));
}
function parseAnd(expr) {
  if (expr.startsWith("(") && balancedEnd(expr) === expr.length - 1) expr = expr.slice(1, -1);
  const parts = splitTopLevel(expr, ",");
  const preds = parts.map(parseClause).filter(Boolean);
  return (row) => preds.every((p) => p(row));
}
function parseClause(c) {
  c = c.trim();
  if (!c) return null;
  if (c.startsWith("and(")) return parseAnd(c.slice(3));
  if (c.startsWith("or("))  return parseOr(c.slice(2));
  // <col>.<op>.<rest>
  const firstDot = c.indexOf(".");
  if (firstDot < 0) return null;
  const col = c.slice(0, firstDot);
  const after = c.slice(firstDot + 1);
  const secondDot = after.indexOf(".");
  if (secondDot < 0) return null;
  const op = after.slice(0, secondDot);
  let val = after.slice(secondDot + 1);
  // If op is "in", value may be "(a,b,c)" with commas — stop split at matching close paren.
  // (splitTopLevel respects depth so "in.(a,b)" stays whole already)
  return (row) => applyOp(row, col, op, val);
}
function balancedEnd(s) {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

// ============================================================
// Reconstruct embedded children from snapshot
// ============================================================
async function expandEmbeds(table, rows, embeds) {
  if (!embeds.length) return rows;
  const childCache = {};
  for (const emb of embeds) {
    const rel = REL[table]?.[emb.name];
    if (!rel) continue; // unknown relation → leave undefined
    const childRows = childCache[rel.table] || (childCache[rel.table] = await readTable(rel.table));
    const inner = parseSelect(emb.select);
    // Pre-expand inner embeds for all child rows (we'll filter per parent below)
    // For perf, just attach matched children per parent and recurse on those.
    for (const parent of rows) {
      const matches = childRows.filter((c) => c?.[rel.fk] === parent.id);
      const projected = await expandEmbeds(rel.table, matches.map((m) => projectRow(m, inner.columns)), inner.embeds);
      parent[emb.name] = projected;
    }
  }
  if (table === "equipment_groups" && embeds.some((e) => e.name === "component_types")) {
    const componentEmbeds = embeds.find((e) => e.name === "component_types")?.select ?? "id";
    const typeInner = parseSelect(componentEmbeds);
    const componentSelect = typeInner.embeds.find((e) => e.name === "components")?.select;
    if (componentSelect) {
      const compInner = parseSelect(componentSelect);
      const components = childCache.components || (childCache.components = await readTable("components"));
      for (const parent of rows) {
        const direct = components.filter((c) => c?.equipment_id === parent.id && !c?.component_type_id);
        parent.components = await expandEmbeds("components", direct.map((m) => projectRow(m, compInner.columns)), compInner.embeds);
      }
    }
  }
  return rows;
}
function projectRow(row, columns) {
  if (!columns) return { ...row };
  const out = {};
  for (const c of columns) {
    if (c === "*") Object.assign(out, row);
    else out[c] = row[c];
  }
  return out;
}

// ============================================================
// Read response from snapshot
// ============================================================
async function snapshotResponse(url, req) {
  const m = url.pathname.match(/\/rest\/v1\/([^/?]+)/);
  if (!m) return null;
  const table = decodeURIComponent(m[1]);
  let rows = await readTable(table);
  if (!rows) return null;

  // Parse params.
  let selectStr = "*";
  let limit = null, offset = null;
  let rangeFrom = null, rangeTo = null;
  const orderBy = [];
  const orPreds = [];
  const filters = []; // [{col, value}]
  let countMode = null; // "exact" | "planned" | "estimated"

  for (const [k, v] of url.searchParams) {
    if (k === "select") { selectStr = v; continue; }
    if (k === "limit")  { limit = parseInt(v, 10); continue; }
    if (k === "offset") { offset = parseInt(v, 10); continue; }
    if (k === "order") {
      for (const part of splitTopLevel(v, ",")) {
        const [col, ...mods] = part.split(".");
        orderBy.push({ col, asc: !mods.includes("desc"), nullsFirst: mods.includes("nullsfirst") });
      }
      continue;
    }
    if (k === "or") { orPreds.push(parseOr(v)); continue; }
    if (k === "and") { orPreds.push(parseAnd(v)); continue; }
    filters.push({ col: k, value: v });
  }

  // Range header support
  const rangeHeader = req?.headers?.get("Range");
  if (rangeHeader) {
    const rm = /^items?=(\d+)-(\d+)$/.exec(rangeHeader);
    if (rm) { rangeFrom = +rm[1]; rangeTo = +rm[2]; }
  }
  // Prefer: count=exact
  const prefer = req?.headers?.get("Prefer") || "";
  const cm = /count=(exact|planned|estimated)/.exec(prefer);
  if (cm) countMode = cm[1];

  // Apply filters
  for (const { col, value } of filters) rows = applyFilter(rows, col, value);
  for (const p of orPreds) rows = rows.filter(p);

  // Order
  if (orderBy.length) {
    rows = rows.slice().sort((a, b) => {
      for (const { col, asc } of orderBy) {
        const av = a?.[col], bv = b?.[col];
        if (av === bv) continue;
        if (av == null) return asc ? -1 : 1;
        if (bv == null) return asc ?  1 : -1;
        return (av < bv ? -1 : 1) * (asc ? 1 : -1);
      }
      return 0;
    });
  }

  const totalCount = rows.length;

  if (rangeFrom != null) rows = rows.slice(rangeFrom, rangeTo + 1);
  else {
    if (offset) rows = rows.slice(offset);
    if (limit != null) rows = rows.slice(0, limit);
  }

  // Project columns + embeds
  const sel = parseSelect(selectStr);
  let result = rows.map((r) => projectRow(r, sel.columns));
  result = await expandEmbeds(table, result, sel.embeds);

  // Handle Accept: application/vnd.pgrst.object+json (single)
  const accept = req?.headers?.get("Accept") || "";
  const wantsObject = accept.includes("application/vnd.pgrst.object+json");

  // Head/count: empty body, set Content-Range
  const headers = { "Content-Type": "application/json", "X-RHfield-Snapshot": "1" };
  if (countMode) {
    const upper = result.length === 0 ? -1 : (rangeFrom != null ? rangeFrom : 0) + result.length - 1;
    headers["Content-Range"] = `${rangeFrom != null ? rangeFrom : 0}-${upper}/${totalCount}`;
  }

  if (req?.method === "HEAD" || prefer.includes("head=true")) {
    return new Response("", { status: 200, headers });
  }

  let body;
  if (wantsObject) {
    if (result.length === 0) {
      return new Response(JSON.stringify({
        code: "PGRST116", message: "No rows", details: "Results contain 0 rows"
      }), { status: 406, headers });
    }
    body = JSON.stringify(result[0]);
  } else {
    body = JSON.stringify(result);
  }
  return new Response(body, { status: 200, headers });
}

// ============================================================
// Apply mutation to local snapshot
// ============================================================
// Locally-augmented defaults. These are written into the IndexedDB snapshot
// so offline queries look complete (timestamps, sort_order, bool defaults),
// but most of them must NOT be sent back to PostgREST — the columns may not
// exist (e.g. `updated_at` is absent on `components`, `equipment_groups`,
// `*_photos`, `*_files`, `milestones`, ...) and the server would reject the
// whole row with a 400, silently losing the queued write.
function uuid() {
  if (self.crypto?.randomUUID) return self.crypto.randomUUID();
  const b = self.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
function withLocalDefaults(table, row) {
  const r = { ...row };
  if (r.id == null) r.id = uuid();
  if (["plant_equipment", "equipment_groups", "component_types", "components", "checklist_items", "equipment_settings", "pa_folders"].includes(table) && r.template_id == null) {
    r.template_id = uuid();
  }
  const now = new Date().toISOString();
  if (!("created_at" in r)) r.created_at = now;
  if (!("updated_at" in r)) r.updated_at = now;
  if (table === "checklist_items") {
    if (r.done == null) r.done = false;
    if (r.note_shared == null) r.note_shared = false;
    if (r.sort_order == null) r.sort_order = 0;
  }
  if (table === "equipment_notes" || table === "pa_notes") {
    if (r.is_shared == null) r.is_shared = false;
  }
  if (table === "equipment_settings" || table === "common_folder_notes") {
    if (r.title == null) r.title = "Setting";
  }
  return r;
}
// Build what we actually send to the server: original payload plus an `id`
// (so children can FK to the parent before flush). Server fills the rest.
function serverBody(originalRow, localRow) {
  const out = { ...originalRow };
  if (out.id == null && localRow?.id != null) out.id = localRow.id;
  if (out.template_id == null && localRow?.template_id != null) out.template_id = localRow.template_id;
  return out;
}
async function appendReplicas(table, rows) {
  if (!rows.length) return;
  const current = await readTable(table);
  const byId = new Set(current.map((r) => r?.id));
  await writeTable(table, current.concat(rows.filter((r) => !byId.has(r.id))));
}
function cloneForParent(row, parentPatch) {
  const { id: _id, created_at: _created_at, updated_at: _updated_at, ...rest } = row;
  return withLocalDefaults("", { ...rest, ...parentPatch, id: uuid(), created_at: new Date().toISOString() });
}
async function replicateInsertLocally(table, inserted) {
  if (!inserted.length) return;
  if (table === "plant_equipment") {
    const lines = await readTable("lines");
    for (const row of inserted) {
      const sourceLine = lines.find((l) => l.id === row.line_id);
      const siblings = lines.filter((l) => l.project_id === sourceLine?.project_id && l.id !== row.line_id);
      await appendReplicas("plant_equipment", siblings.map((l) => cloneForParent(row, { line_id: l.id })));
    }
  } else if (table === "equipment_groups") {
    const lines = await readTable("lines");
    const plant = await readTable("plant_equipment");
    for (const row of inserted) {
      const sourceLine = lines.find((l) => l.id === row.line_id);
      const sourcePe = row.plant_equipment_id ? plant.find((p) => p.id === row.plant_equipment_id) : null;
      const siblings = lines.filter((l) => l.project_id === sourceLine?.project_id && l.id !== row.line_id);
      const replicas = siblings.map((l) => {
        const sibPe = sourcePe ? plant.find((p) => p.line_id === l.id && p.template_id === sourcePe.template_id) : null;
        return cloneForParent(row, { line_id: l.id, plant_equipment_id: sibPe?.id ?? null });
      }).filter((r) => !row.plant_equipment_id || r.plant_equipment_id);
      await appendReplicas("equipment_groups", replicas);
    }
  } else if (table === "component_types") {
    const groups = await readTable("equipment_groups");
    for (const row of inserted) {
      const sourceGroup = groups.find((g) => g.id === row.equipment_group_id);
      const siblings = groups.filter((g) => g.template_id === sourceGroup?.template_id && g.id !== row.equipment_group_id);
      await appendReplicas("component_types", siblings.map((g) => cloneForParent(row, { equipment_group_id: g.id })));
    }
  } else if (table === "components") {
    const groups = await readTable("equipment_groups");
    const types = await readTable("component_types");
    for (const row of inserted) {
      if (row.component_type_id) {
        const sourceType = types.find((t) => t.id === row.component_type_id);
        const siblings = types.filter((t) => t.template_id === sourceType?.template_id && t.id !== row.component_type_id);
        await appendReplicas("components", siblings.map((t) => cloneForParent(row, { component_type_id: t.id, equipment_id: null })));
      } else if (row.equipment_id) {
        const sourceGroup = groups.find((g) => g.id === row.equipment_id);
        const siblings = groups.filter((g) => g.template_id === sourceGroup?.template_id && g.id !== row.equipment_id);
        await appendReplicas("components", siblings.map((g) => cloneForParent(row, { equipment_id: g.id, component_type_id: null })));
      }
    }
  } else if (table === "checklist_items") {
    const comps = await readTable("components");
    const items = await readTable("checklist_items");
    for (const row of inserted) {
      const sourceComp = comps.find((c) => c.id === row.component_id);
      const siblings = comps.filter((c) => c.template_id === sourceComp?.template_id && c.id !== row.component_id);
      const replicas = siblings.map((c) => {
        let parent_item_id = null;
        if (row.parent_item_id) {
          const sourceParent = items.find((i) => i.id === row.parent_item_id);
          const siblingParent = items.find((i) => i.component_id === c.id && i.template_id === sourceParent?.template_id);
          if (!siblingParent) return null;
          parent_item_id = siblingParent.id;
        }
        return cloneForParent(row, { component_id: c.id, parent_item_id });
      }).filter(Boolean);
      await appendReplicas("checklist_items", replicas);
    }
  } else if (table === "pa_folders") {
    const lines = await readTable("lines");
    for (const row of inserted) {
      const sourceLine = lines.find((l) => l.id === row.line_id);
      const siblings = lines.filter((l) => l.project_id === sourceLine?.project_id && l.id !== row.line_id);
      await appendReplicas("pa_folders", siblings.map((l) => cloneForParent(row, { line_id: l.id })));
    }
  }
}
async function propagateUpdateLocally(table, matched, patch) {
  if (!matched.length || !["plant_equipment", "equipment_groups", "component_types", "components", "checklist_items", "pa_folders"].includes(table)) return;
  const current = await readTable(table);
  const templates = new Set(matched.map((r) => r.template_id).filter(Boolean));
  if (!templates.size) return;
  const sourceIds = new Set(matched.map((r) => r.id));
  const allowedByTable = {
    plant_equipment: ["name", "sort_order", "deleted_at", "mech_mode"],
    equipment_groups: ["name", "sort_order", "deleted_at"],
    component_types: ["name", "sort_order", "deleted_at"],
    components: ["name", "sort_order", "deleted_at", "note", "note_shared"],
    checklist_items: ["label", "sort_order", "deleted_at", "note", "note_shared"],
    pa_folders: ["name", "sort_order"],
  };
  const sharePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => allowedByTable[table]?.includes(key)));
  const noteShareActive = (table === "components" || table === "checklist_items") && (patch.note_shared || matched.some((r) => r.note_shared));
  if ((table === "components" || table === "checklist_items") && !noteShareActive) {
    delete sharePatch.note;
    delete sharePatch.note_shared;
  }
  if (noteShareActive && !("note" in sharePatch) && matched[0] && "note" in matched[0]) sharePatch.note = matched[0].note;
  if (Object.keys(sharePatch).length === 0) return;
  await writeTable(table, current.map((r) => templates.has(r.template_id) && !sourceIds.has(r.id) ? { ...r, ...sharePatch, updated_at: new Date().toISOString() } : r));
}
async function applyInsert(table, body) {
  const rows = Array.isArray(body) ? body : [body];
  const filled = rows.map((r) => withLocalDefaults(table, r));
  const current = await readTable(table);
  await writeTable(table, current.concat(filled));
  await replicateInsertLocally(table, filled);
  return filled;
}
function getFiltersFromUrl(url) {
  const out = [];
  for (const [k, v] of url.searchParams) {
    if (k === "select" || k === "limit" || k === "offset" || k === "order" || k === "or" || k === "and") continue;
    out.push({ col: k, value: v });
  }
  return out;
}
async function applyUpdate(table, url, patch) {
  const rows = await readTable(table);
  const filters = getFiltersFromUrl(url);
  const matched = [];
  const next = rows.map((r) => {
    let keep = true;
    for (const { col, value } of filters) {
      const dot = value.indexOf(".");
      if (dot < 0) continue;
      if (!applyOp(r, col, value.slice(0, dot), value.slice(dot + 1))) { keep = false; break; }
    }
    if (!keep) return r;
    const merged = { ...r, ...patch, updated_at: new Date().toISOString() };
    matched.push(merged);
    return merged;
  });
  await writeTable(table, next);
  await propagateUpdateLocally(table, matched, patch);
  return matched;
}
async function applyDelete(table, url) {
  const rows = await readTable(table);
  const filters = getFiltersFromUrl(url);
  if (filters.length === 0) return [];
  const remaining = [];
  const removed = [];
  for (const r of rows) {
    let allMatch = true;
    for (const { col, value } of filters) {
      const dot = value.indexOf(".");
      if (dot < 0) continue;
      if (!applyOp(r, col, value.slice(0, dot), value.slice(dot + 1))) { allMatch = false; break; }
    }
    if (allMatch) removed.push(r); else remaining.push(r);
  }
  await writeTable(table, remaining);
  return removed;
}

// ============================================================
// Storage path extraction
// ============================================================
function storagePathFromUrl(url) {
  // Possible shapes:
  //   /storage/v1/object/<bucket>/<path>            (upload PUT/POST, direct)
  //   /storage/v1/object/sign/<bucket>/<path>       (signed-URL GET)
  //   /storage/v1/object/authenticated/<bucket>/<path>
  //   /storage/v1/object/public/<bucket>/<path>
  //   /storage/v1/render/image/sign/<bucket>/<path> (image transform signed URL)
  //   /object/sign/<bucket>/<path>                  (local synthetic signed URL)
  let m = url.pathname.match(/\/storage\/v1\/object\/(?:sign\/|authenticated\/|public\/)?([^/]+)\/(.+)$/);
  if (!m) m = url.pathname.match(/\/storage\/v1\/render\/image\/(?:sign\/|authenticated\/|public\/)?([^/]+)\/(.+)$/);
  if (!m) m = url.pathname.match(/\/object\/(?:sign\/|authenticated\/|public\/)?([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2]) };
}

// ============================================================
// Outbox replay
// ============================================================
async function flushQueue() {
  const items = await outboxAll();
  // Process in insertion order (parents first → children second) so FK refs to
  // local UUIDs resolve once the parent has been created server-side.
  items.sort((a, b) => (a.id || 0) - (b.id || 0));
  let progressed = false;
  let failures = 0;
  let stalled = false;
  let authExpired = false;
  const failureSamples = [];
  for (const item of items) {
    if (item.failed) continue; // skip already-failed; user must Retry/Discard
    try {
      // If we've seen a fresher auth header since this item was queued, use it.
      const headers = { ...(item.headers || {}) };
      if (latestAuthHeader && headers.authorization && headers.authorization !== latestAuthHeader) {
        headers.authorization = latestAuthHeader;
      }
      const res = await fetch(item.url, {
        method: item.method,
        headers,
        body: item.body || undefined,
      });
      if (res.ok) { await outboxDelete(item.id); progressed = true; continue; }

      // 401 → likely JWT expired. Ask the client to refresh the session and
      // bail out of this flush; the client will re-trigger flush once it has
      // a fresh token. Only do this once per item — second 401 falls through
      // to the failed path so we don't loop forever.
      if (res.status === 401 && !item.authRetried) {
        let body401 = "";
        try { body401 = (await res.clone().text()).slice(0, 300); } catch {}
        await outboxUpdate(item.id, { authRetried: true, lastStatus: 401, lastError: body401 });
        authExpired = true;
        stalled = true;
        break;
      }

      // 4xx → server rejected. Do NOT delete — mark as failed so the row stays
      // in the local snapshot and the user/dev can investigate. Previously we
      // dropped these silently, which is what caused offline child rows
      // (components, items, photos, files…) to vanish on reconnect.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        failures++;
        let snippet = "";
        try { snippet = (await res.clone().text()).slice(0, 500); } catch {}
        if (failureSamples.length < 5) {
          failureSamples.push({ url: item.url, method: item.method, status: res.status, body: snippet });
        }
        await outboxUpdate(item.id, {
          failed: true,
          lastStatus: res.status,
          lastError: snippet,
          failedAt: Date.now(),
        });
        continue;
      }
      stalled = true;
      break;
    } catch { stalled = true; break; } // still offline
  }
  broadcastQueueCount();
  if (progressed) broadcastDataChanged();
  if (authExpired) {
    try { await broadcast({ type: "rhfield-auth-expired" }); } catch {}
  }
  try {
    const s = await outboxStats();
    await broadcast({
      type: "rhfield-flush-complete",
      remaining: s.pending,
      failedCount: s.failed,
      failures,
      failureSamples,
      stalled,
    });
  } catch {}
  return { failures, stalled };
}
async function retryFailedOutbox() {
  const items = await outboxAll();
  for (const it of items) {
    if (it?.failed) {
      await outboxUpdate(it.id, { failed: false, authRetried: false, lastStatus: null, lastError: null, failedAt: null });
    }
  }
  await flushQueue();
}
async function discardFailedOutbox() {
  const items = await outboxAll();
  for (const it of items) {
    if (it?.failed) await outboxDelete(it.id);
  }
  broadcastQueueCount();
  broadcastDataChanged();
}
async function queueRequest(req, bodyOverride = null) {
  const headers = {};
  req.headers.forEach((v, k) => {
    if (bodyOverride != null && k.toLowerCase() === "content-length") return;
    headers[k] = v;
  });
  let body = null;
  try {
    if (bodyOverride != null) {
      body = bodyOverride;
      headers["content-type"] = headers["content-type"] || "application/json";
    } else if (req.method !== "GET" && req.method !== "HEAD") {
      body = await req.clone().arrayBuffer();
    }
  } catch {}
  await outboxAdd({
    url: req.url, method: req.method, headers, body,
    createdAt: Date.now(), attempts: 0,
  });
  broadcastQueueCount();
}

// ============================================================
// Background sync + messages
// ============================================================
self.addEventListener("sync", (e) => {
  if (e.tag === "rhfield-flush") e.waitUntil(flushQueue());
});
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "rhfield-flush")     e.waitUntil(flushQueue());
  if (d.type === "rhfield-queue?")    e.waitUntil(broadcastQueueCount());
  if (d.type === "rhfield-cache-routes") e.waitUntil(cacheRoutesForOffline(d.routes || [], e.ports?.[0]));
  if (d.type === "rhfield-skip-waiting") self.skipWaiting();
  if (d.type === "rhfield-outbox-retry-failed") e.waitUntil(retryFailedOutbox());
  if (d.type === "rhfield-outbox-discard-failed") e.waitUntil(discardFailedOutbox());
  if (d.type === "rhfield-get-blob") {
    const port = e.ports?.[0];
    e.waitUntil((async () => {
      let blob = null;
      try {
        const stored = await getBlob(`${d.bucket}/${d.path}`);
        if (isValidStoredBlob(stored)) blob = stored.blob;
      } catch {}
      try { port?.postMessage({ blob }); } catch {}
    })());
  }
});

// ============================================================
// Fetch handler
// ============================================================
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);
  rememberAuth(req);

  // Pass-through auth/realtime — must hit network always.
  if (isSupabaseAuth(url) || isSupabaseRealtime(url)) return;

  // ---------------- Supabase REST ----------------
  if (isSupabaseRest(url)) {
    const tableMatch = url.pathname.match(/\/rest\/v1\/([^/?]+)/);
    const table = tableMatch ? decodeURIComponent(tableMatch[1]) : null;

    // Mutations
    if (req.method === "POST" || req.method === "PATCH" || req.method === "DELETE") {
      // Skip RPC calls (we can't simulate them locally).
      const isRpc = url.pathname.includes("/rest/v1/rpc/");
      event.respondWith((async () => {
        // Read body once; we may need it for both network and snapshot.
        let bodyText = "";
        let bodyJson = null;
        try {
          if (req.method !== "DELETE") {
            bodyText = await req.clone().text();
            if (bodyText) { try { bodyJson = JSON.parse(bodyText); } catch {} }
          }
        } catch {}

        // Try network first.
        let netRes = null;
        try { netRes = await fetch(req.clone()); } catch {}

        if (netRes && netRes.ok) {
          // Online success → mirror change into snapshot (best-effort).
          if (table && !isRpc) {
            try {
              if (req.method === "POST" && bodyJson) {
                // Use the server response when available (it has real IDs/timestamps).
                let serverRows = null;
                try {
                  const cloneRes = netRes.clone();
                  const ct = cloneRes.headers.get("Content-Type") || "";
                  if (ct.includes("application/json")) {
                    const txt = await cloneRes.text();
                    if (txt) {
                      const parsed = JSON.parse(txt);
                      serverRows = Array.isArray(parsed) ? parsed : [parsed];
                    }
                  }
                } catch {}
                const originalRows = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
                const inserted = serverRows && serverRows.length
                  ? serverRows.map((row, i) => withLocalDefaults(table, { ...(originalRows[i] || {}), ...row }))
                  : originalRows.map((r) => withLocalDefaults(table, r));
                await mergeRows(table, inserted);
              } else if (req.method === "PATCH" && bodyJson) {
                await applyUpdate(table, url, bodyJson);
              } else if (req.method === "DELETE") {
                await applyDelete(table, url);
              }
              broadcastDataChanged();
            } catch {}
          }
          return netRes;
        }

        // Offline (or server failure): apply optimistically + queue.
        if (table && !isRpc) {
          let resultRows = [];
          try {
            if (req.method === "POST" && bodyJson)  resultRows = await applyInsert(table, bodyJson);
            if (req.method === "PATCH" && bodyJson) resultRows = await applyUpdate(table, url, bodyJson);
            if (req.method === "DELETE")            resultRows = await applyDelete(table, url);
            broadcastDataChanged();
          } catch {}

          // For POST replay, send the ORIGINAL client payload + the locally-
          // generated id (so children can FK to it). Do NOT send the synthetic
          // created_at/updated_at/etc. from withLocalDefaults — many tables
          // don't have those columns and PostgREST would 400 the whole row.
          let queuedBody = null;
          if (req.method === "POST" && bodyJson) {
            if (Array.isArray(bodyJson)) {
              queuedBody = JSON.stringify(bodyJson.map((orig, i) => serverBody(orig, resultRows[i])));
            } else {
              queuedBody = JSON.stringify(serverBody(bodyJson, resultRows[0]));
            }
          }
          await queueRequest(req, queuedBody);

          // Build a Supabase-compatible response.
          const accept = req.headers.get("Accept") || "";
          const prefer = req.headers.get("Prefer") || "";
          const wantsObject = accept.includes("application/vnd.pgrst.object+json");
          const returnsRep = prefer.includes("return=representation");
          let body = "";
          if (returnsRep || wantsObject) {
            body = wantsObject
              ? JSON.stringify(resultRows[0] ?? null)
              : JSON.stringify(resultRows);
          }
          return new Response(body, {
            status: returnsRep || wantsObject ? 200 : 201,
            headers: { "Content-Type": "application/json", "X-RHfield-Queued": "1" },
          });
        }

        // Unknown route: queue & 202.
        await queueRequest(req);
        return new Response(JSON.stringify({ queued: true }), {
          status: 202, headers: { "Content-Type": "application/json", "X-RHfield-Queued": "1" },
        });
      })());
      return;
    }

    // GET/HEAD reads: stale-while-revalidate + snapshot fallback.
    if (req.method === "GET" || req.method === "HEAD") {
      event.respondWith((async () => {
        const cache = await caches.open(CACHE_DATA);
        const cached = req.method === "GET" ? await cache.match(req) : null;
        const network = fetch(req).then(async (res) => {
          if (res && res.ok && req.method === "GET") {
            cache.put(req, res.clone()).catch(() => {});
          }
          return res;
        }).catch(() => null);

        const fresh = await network;
        if (fresh) return fresh;
        // Offline → reconstruct from snapshot first so locally queued edits are visible,
        // even when an older exact response is already in the HTTP cache.
        const snap = await snapshotResponse(url, req);
        if (snap) return snap;
        if (cached) return cached;
        return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
      })());
      return;
    }
    return;
  }

  // ---------------- Supabase Storage ----------------
  if (isSupabaseStorage(url) || isLocalSyntheticStorage(url)) {
    // createSignedUrl(s) — POST /storage/v1/object/sign/<bucket>[/<path>]
    if (isSupabaseStorage(url) && req.method === "POST" && /\/storage\/v1\/object\/sign\//.test(url.pathname)) {
      event.respondWith((async () => {
        let netRes = null;
        try { netRes = await fetch(req.clone()); } catch {}
        if (netRes && netRes.ok) return netRes;
        // Offline: synthesize.
        // Single-path: /storage/v1/object/sign/<bucket>/<path>  body={expiresIn}
        // Multi-path:  /storage/v1/object/sign/<bucket>          body={expiresIn,paths:[...]}
        const m = url.pathname.match(/\/storage\/v1\/object\/sign\/([^/]+)(?:\/(.+))?$/);
        if (!m) return new Response("offline", { status: 503 });
        const bucket = m[1];
        const singlePath = m[2] ? decodeURIComponent(m[2].split("?")[0]) : null;
        let parsed = null;
        try { parsed = JSON.parse(await req.clone().text() || "{}"); } catch {}
        if (singlePath) {
          return new Response(JSON.stringify({
            signedURL: `/object/sign/${bucket}/${singlePath}?token=local`,
          }), { status: 200, headers: { "Content-Type": "application/json", "X-RHfield-Snapshot": "1" } });
        }
        const paths = Array.isArray(parsed?.paths) ? parsed.paths : [];
        const out = paths.map((p) => ({
          path: p, signedURL: `/object/sign/${bucket}/${p}?token=local`, error: null,
        }));
        return new Response(JSON.stringify(out), {
          status: 200, headers: { "Content-Type": "application/json", "X-RHfield-Snapshot": "1" },
        });
      })());
      return;
    }

    // Storage uploads: POST/PUT /storage/v1/object/<bucket>/<path>
    if (isSupabaseStorage(url) && (req.method === "POST" || req.method === "PUT") && /\/storage\/v1\/object\/[^/]+\/.+/.test(url.pathname)
        && !/\/storage\/v1\/object\/sign\//.test(url.pathname)) {
      event.respondWith((async () => {
        const info = storagePathFromUrl(url);
        // Capture the upload body as a Blob so we can store it locally
        // and (if needed) re-send it later from the queue.
        const cloneForBlob = req.clone();
        const cloneForQueue = req.clone();
        let blob = null;
        try { blob = await cloneForBlob.blob(); } catch {}

        // Attempt network.
        let netRes = null;
        try { netRes = await fetch(req); } catch {}

        // Only persist locally when the network upload succeeded AND the body
        // is a real media blob. Avoids storing multipart/form-data or
        // application/octet-stream bytes as if they were the image itself.
        if (info && blob && netRes && netRes.ok && isServableMediaType(blob.type)) {
          try { await putBlob(`${info.bucket}/${info.path}`, blob); } catch {}
        }

        if (netRes && netRes.ok) return netRes;

        // Offline / failed → queue and synthesize success.
        await queueRequest(cloneForQueue);
        const synthetic = info
          ? { Key: `${info.bucket}/${info.path}`, Id: `local-${Date.now()}` }
          : { queued: true };
        return new Response(JSON.stringify(synthetic), {
          status: 200, headers: { "Content-Type": "application/json", "X-RHfield-Queued": "1" },
        });
      })());
      return;
    }

    // Storage REMOVE: DELETE /storage/v1/object/<bucket>  body={prefixes:[...]}
    if (isSupabaseStorage(url) && req.method === "DELETE") {
      event.respondWith((async () => {
        let body = null;
        try { body = JSON.parse(await req.clone().text() || "null"); } catch {}
        const m = url.pathname.match(/\/storage\/v1\/object\/([^/]+)\/?$/);
        const bucket = m ? m[1] : null;
        if (bucket && body?.prefixes) {
          for (const p of body.prefixes) {
            try { await delBlob(`${bucket}/${p}`); } catch {}
          }
        }
        let netRes = null;
        try { netRes = await fetch(req.clone()); } catch {}
        if (netRes && netRes.ok) return netRes;
        await queueRequest(req);
        return new Response(JSON.stringify({ message: "queued" }), {
          status: 200, headers: { "Content-Type": "application/json", "X-RHfield-Queued": "1" },
        });
      })());
      return;
    }

    // Storage GET (signed URL or otherwise): network-first when online,
    // fall back to local blob/cache when offline or network fails.
    if (req.method === "GET") {
      event.respondWith((async () => {
        const info = storagePathFromUrl(url);

        const serveStored = async () => {
          if (!info) return null;
          const stored = await getBlob(`${info.bucket}/${info.path}`);
          if (!isValidStoredBlob(stored)) return null;
          return new Response(stored.blob, {
            status: 200,
            headers: {
              "Content-Type": stored.type || stored.blob.type || "application/octet-stream",
              "X-RHfield-LocalBlob": "1",
              "Cache-Control": "no-cache",
            },
          });
        };

        // When online, try the network first so a fresh/correct image
        // replaces any stale or corrupted local copy.
        if (self.navigator && self.navigator.onLine !== false) {
          try {
            const res = await fetch(req);
            if (res && res.ok) {
              const cache = await caches.open(CACHE_BLOBS);
              cache.put(req, res.clone()).catch(() => {});
              if (info) {
                try {
                  const b = await res.clone().blob();
                  if (isServableMediaType(b.type) && b.size > 0) {
                    await putBlob(`${info.bucket}/${info.path}`, b);
                  }
                } catch {}
              }
              return res;
            }
            // Non-OK network response: try local fallbacks before returning it.
            const local = await serveStored();
            if (local) return local;
            const cache = await caches.open(CACHE_BLOBS);
            const cached = await cache.match(req);
            if (cached) {
              const ct = cached.headers.get("Content-Type") || "";
              if (!isServableMediaType(ct)) {
                cache.delete(req).catch(() => {});
              } else {
                return cached;
              }
            }
            return res;
          } catch {
            // fall through to offline path
          }
        }

        // Offline (or network threw): prefer local blob, then HTTP cache,
        // then a last-ditch authenticated direct fetch.
        const local = await serveStored();
        if (local) return local;
        const cache = await caches.open(CACHE_BLOBS);
        const cached = await cache.match(req);
        if (cached) {
          const ct = cached.headers.get("Content-Type") || "";
          if (!isServableMediaType(ct)) {
            cache.delete(req).catch(() => {});
          } else {
            return cached;
          }
        }
        if (info && latestAuthHeader && isSupabaseStorage(url)) {
          try {
            const direct = new URL(`/storage/v1/object/authenticated/${encodeURIComponent(info.bucket)}/${info.path.split("/").map(encodeURIComponent).join("/")}`, url.origin);
            const res = await fetch(direct.href, { headers: { authorization: latestAuthHeader }, cache: "no-store" });
            if (res && res.ok) {
              const b = await res.clone().blob();
              if (isServableMediaType(b.type) && b.size > 0) {
                await putBlob(`${info.bucket}/${info.path}`, b);
              }
              return new Response(b, { status: 200, headers: { "Content-Type": b.type || "application/octet-stream", "X-RHfield-LocalBlob": "1" } });
            }
          } catch {}
        }
        return new Response("", { status: 504 });
      })());
      return;
    }

    return;
  }

  // ---------------- App shell + assets ----------------
  if (req.method !== "GET") return;
  const sameOrigin = url.origin === self.location.origin;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_SHELL);
      const cachedShell = async () =>
        (await cache.match(req, { ignoreSearch: true })) ||
        (await cache.match("/")) ||
        (await cache.match(new URL("/", self.location.origin).href));
      // Offline → serve cached shell immediately, don't wait for fetch to time out.
      if (self.navigator && self.navigator.onLine === false) {
        const hit = await cachedShell();
        if (hit) return hit;
      }
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) {
          cache.put("/", fresh.clone()).catch(() => {});
        }
        return fresh;
      } catch {
        const hit = await cachedShell();
        return hit || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  if (!sameOrigin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_ASSETS);
    const cached = await cache.match(req);
    const network = fetch(req).then((res) => {
      if (res && res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => cached);
    return cached || network;
  })());
});
