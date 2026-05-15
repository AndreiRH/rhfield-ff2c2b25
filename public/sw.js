// RHfield service worker — full offline support.
//
// Strategy:
//  - App shell (HTML navigations): network-first, fall back to cached "/".
//  - Same-origin static assets (JS/CSS/fonts/images): cache-first, then
//    revalidate in background. Once visited online, available offline.
//  - Supabase REST GETs: stale-while-revalidate.
//  - Supabase Storage GETs (signed URLs): cache-first, long TTL.
//  - Supabase writes (POST/PATCH/DELETE) and Storage uploads (POST/PUT):
//    if the network call fails or we're offline, the request is queued in
//    IndexedDB ("rhfield-outbox") and a synthetic 202 is returned. The
//    queue is replayed on `online` events and via Background Sync.

const CACHE_SHELL  = "rhfield-shell-v2";
const CACHE_ASSETS = "rhfield-assets-v2";
const CACHE_DATA   = "rhfield-data-v2";
const CACHE_BLOBS  = "rhfield-blobs-v2";
const ALL_CACHES   = [CACHE_SHELL, CACHE_ASSETS, CACHE_DATA, CACHE_BLOBS];

const SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

// ---------- minimal IndexedDB helper for the outbox ----------
const DB_NAME = "rhfield-outbox";
const STORE   = "queue";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
async function idbAdd(item) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).add(item);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}
async function idbAll() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => res(req.result || []);
    req.onerror   = () => rej(req.error);
  });
}
async function idbDelete(id) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}
async function idbCount() {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).count();
    req.onsuccess = () => res(req.result || 0);
    req.onerror   = () => rej(req.error);
  });
}

// ---------- broadcast helper ----------
async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(msg));
}
async function broadcastQueueCount() {
  try { await broadcast({ type: "rhfield-queue", count: await idbCount() }); } catch {}
}

// ---------- install / activate ----------
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_SHELL).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !ALL_CACHES.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
    broadcastQueueCount();
  })());
});

// ---------- request classification ----------
function isSupabaseRest(url)    { return /\.supabase\.co\/rest\/v1\//.test(url.href); }
function isSupabaseStorage(url) { return /\.supabase\.co\/storage\/v1\//.test(url.href); }
function isSupabaseAuth(url)    { return /\.supabase\.co\/auth\/v1\//.test(url.href); }
function isSupabaseRealtime(url){ return /\.supabase\.co\/realtime\/v1\//.test(url.href); }

// ---------- outbox queue ----------
async function queueRequest(req) {
  const headers = {};
  req.headers.forEach((v, k) => { headers[k] = v; });
  let body = null;
  try {
    if (req.method !== "GET" && req.method !== "HEAD") {
      // Clone body as ArrayBuffer (works for JSON, FormData, blobs, text alike).
      body = await req.clone().arrayBuffer();
    }
  } catch {}
  await idbAdd({
    url: req.url,
    method: req.method,
    headers,
    body,
    createdAt: Date.now(),
    attempts: 0,
  });
  broadcastQueueCount();
}

async function flushQueue() {
  const items = await idbAll();
  for (const item of items) {
    try {
      const res = await fetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body ? item.body : undefined,
      });
      if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429)) {
        // Success OR a client error we won't recover from — drop either way.
        await idbDelete(item.id);
      } else {
        // Server error / retryable — leave for next flush.
        break;
      }
    } catch {
      // Still offline — stop, try again later.
      break;
    }
  }
  broadcastQueueCount();
}

self.addEventListener("sync", (event) => {
  if (event.tag === "rhfield-flush") event.waitUntil(flushQueue());
});

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "rhfield-flush")     event.waitUntil(flushQueue());
  if (data.type === "rhfield-queue?")    event.waitUntil(broadcastQueueCount());
  if (data.type === "rhfield-skip-waiting") self.skipWaiting();
});

// ---------- fetch handler ----------
self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Don't intercept auth or realtime — they need real-time network behavior.
  if (isSupabaseAuth(url) || isSupabaseRealtime(url)) return;

  // Supabase writes (REST mutations + Storage uploads): try network, queue on failure.
  if ((isSupabaseRest(url) || isSupabaseStorage(url)) && req.method !== "GET" && req.method !== "HEAD") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req.clone());
        // Network reachable but server rejected — return real response, don't queue.
        return res;
      } catch {
        await queueRequest(req);
        return new Response(JSON.stringify({ queued: true }), {
          status: 202,
          headers: { "Content-Type": "application/json", "X-RHfield-Queued": "1" },
        });
      }
    })());
    return;
  }

  if (req.method !== "GET") return;

  // Supabase REST reads: stale-while-revalidate, with snapshot fallback when
  // both the network and the HTTP cache miss (covers screens you've never
  // opened online).
  if (isSupabaseRest(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_DATA);
      const cached = await cache.match(req);
      const network = fetch(req).then((res) => {
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      }).catch(() => null);
      if (cached) {
        // Don't await network — let it revalidate in the background.
        event.waitUntil(network);
        return cached;
      }
      const fresh = await network;
      if (fresh) return fresh;
      // No cache, no network → answer from the snapshot DB.
      return await snapshotResponse(url) ||
        new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
    })());
    return;
  }

  // Supabase Storage signed-URL GETs: cache-first (signed URLs change but content
  // for a given path+token is immutable; we accept a slightly fatter cache).
  if (isSupabaseStorage(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_BLOBS);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const res = await fetch(req);
        if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
        return res;
      } catch {
        return cached || new Response("", { status: 504 });
      }
    })());
    return;
  }

  const sameOrigin = url.origin === self.location.origin;

  // HTML navigations: network-first, fall back to cached shell.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const cache = await caches.open(CACHE_SHELL);
        cache.put("/", fresh.clone()).catch(() => {});
        return fresh;
      } catch {
        const cache = await caches.open(CACHE_SHELL);
        return (await cache.match(req)) || (await cache.match("/")) ||
          new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
      }
    })());
    return;
  }

  if (!sameOrigin) return;

  // Same-origin static assets: cache-first + background revalidate.
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
