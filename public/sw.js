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

const VER = "v6";
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
  const db = await openOutbox();
  return new Promise((res, rej) => {
    const tx = db.transaction(OUTBOX_STORE, "readonly");
    const r = tx.objectStore(OUTBOX_STORE).count();
    r.onsuccess = () => res(r.result || 0);
    r.onerror = () => rej(r.error);
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
  try { await broadcast({ type: "rhfield-queue", count: await outboxCount() }); } catch {}
}
async function broadcastDataChanged() {
  try { await broadcast({ type: "rhfield-data-changed" }); } catch {}
}

function sameOriginAssetUrls(html, baseUrl) {
  const out = new Set();
  const re = /(?:src|href)=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      const u = new URL(m[1], baseUrl);
      if (u.origin === self.location.origin && !u.hash) out.add(u.href);
    } catch {}
  }
  return [...out];
}

async function cacheRoutesForOffline(routes, port) {
  const shell = await caches.open(CACHE_SHELL);
  const assets = await caches.open(CACHE_ASSETS);
  let done = 0;
  for (const route of routes || []) {
    try {
      const u = new URL(route, self.location.origin);
      const res = await fetch(u.href, { credentials: "include", cache: "no-store" });
      if (res && res.ok) {
        await shell.put(u.href, res.clone());
        const text = await res.clone().text().catch(() => "");
        const urls = sameOriginAssetUrls(text, u.href);
        await Promise.all(urls.map(async (assetUrl) => {
          try {
            const cached = await assets.match(assetUrl);
            if (!cached) {
              const ar = await fetch(assetUrl, { credentials: "include" });
              if (ar && ar.ok && ar.type === "basic") await assets.put(assetUrl, ar.clone());
            }
          } catch {}
        }));
      }
    } catch {}
    done++;
    try { port?.postMessage({ type: "progress", done, total: routes.length }); } catch {}
  }
  try { port?.postMessage({ type: "done", done, total: routes?.length ?? 0 }); } catch {}
}

// ============================================================
// Install / activate
// ============================================================
self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(CACHE_SHELL);
    await shell.addAll(SHELL);
    try {
      const rootUrl = new URL("/", self.location.origin).href;
      const root = await fetch(rootUrl, { cache: "no-store" });
      if (root && root.ok) {
        await shell.put(rootUrl, root.clone());
        await shell.put("/", root.clone());
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
    await self.clients.claim();
    broadcastQueueCount();
  })());
});

// ============================================================
// URL classification
// ============================================================
function isSupabaseRest(url)    { return /\.supabase\.co\/rest\/v1\//.test(url.href); }
function isSupabaseStorage(url) { return /\.supabase\.co\/storage\/v1\//.test(url.href); }
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
const SCHEMA_DEFAULTS = {
  // tables that auto-set timestamp/uuid columns server-side; we mirror locally.
  // All tables share id (uuid). Many share created_at/updated_at.
};
function uuid() {
  if (self.crypto?.randomUUID) return self.crypto.randomUUID();
  // RFC4122-ish fallback
  const b = self.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}
function withDefaults(table, row) {
  const r = { ...row };
  if (r.id == null) r.id = uuid();
  const now = new Date().toISOString();
  if ("created_at" in r === false) r.created_at = now;
  if ("updated_at" in r === false) r.updated_at = now;
  // sensible bools
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
async function applyInsert(table, body) {
  const rows = Array.isArray(body) ? body : [body];
  const filled = rows.map((r) => withDefaults(table, r));
  const current = await readTable(table);
  await writeTable(table, current.concat(filled));
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
  const m = url.pathname.match(/\/storage\/v1\/object\/(?:sign\/|authenticated\/|public\/)?([^/]+)\/(.+)$/);
  if (!m) return null;
  return { bucket: decodeURIComponent(m[1]), path: decodeURIComponent(m[2].split("?")[0]) };
}

// ============================================================
// Outbox replay
// ============================================================
async function flushQueue() {
  const items = await outboxAll();
  let progressed = false;
  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body || undefined,
      });
      if (res.ok) { await outboxDelete(item.id); progressed = true; continue; }
      // Drop unrecoverable client errors (e.g. row already gone), keep server errors for retry.
      if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        await outboxDelete(item.id); progressed = true; continue;
      }
      break;
    } catch { break; } // still offline
  }
  broadcastQueueCount();
  if (progressed) broadcastDataChanged();
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
});

// ============================================================
// Fetch handler
// ============================================================
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

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
                const inserted = serverRows && serverRows.length
                  ? serverRows
                  : (Array.isArray(bodyJson) ? bodyJson : [bodyJson]).map((r) => withDefaults(table, r));
                const cur = await readTable(table);
                await writeTable(table, cur.concat(inserted));
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

          const queuedBody = req.method === "POST" && bodyJson
            ? JSON.stringify(Array.isArray(bodyJson) ? resultRows : (resultRows[0] ?? bodyJson))
            : null;
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
  if (isSupabaseStorage(url)) {
    // createSignedUrl(s) — POST /storage/v1/object/sign/<bucket>[/<path>]
    if (req.method === "POST" && /\/storage\/v1\/object\/sign\//.test(url.pathname)) {
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
    if ((req.method === "POST" || req.method === "PUT") && /\/storage\/v1\/object\/[^/]+\/.+/.test(url.pathname)
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

        if (info && blob) {
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
    if (req.method === "DELETE") {
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

    // Storage GET (signed URL or otherwise): blob-store first, then cache, then network.
    if (req.method === "GET") {
      event.respondWith((async () => {
        const info = storagePathFromUrl(url);
        if (info) {
          const stored = await getBlob(`${info.bucket}/${info.path}`);
          if (stored?.blob) {
            return new Response(stored.blob, {
              status: 200,
              headers: {
                "Content-Type": stored.type || "application/octet-stream",
                "X-RHfield-LocalBlob": "1",
                "Cache-Control": "no-cache",
              },
            });
          }
        }
        const cache = await caches.open(CACHE_BLOBS);
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok) {
            cache.put(req, res.clone()).catch(() => {});
            // Also persist the bytes into the local blob store so they
            // survive HTTP cache eviction.
            if (info) {
              try {
                const b = await res.clone().blob();
                await putBlob(`${info.bucket}/${info.path}`, b);
              } catch {}
            }
          }
          return res;
        } catch {
          return new Response("", { status: 504 });
        }
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
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_SHELL);
        cache.put("/", fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_SHELL);
        return (await cache.match(req)) || (await cache.match(req.url)) || (await cache.match("/")) || (await cache.match(new URL("/", self.location.origin).href)) ||
          new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
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
