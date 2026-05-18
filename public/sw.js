// Kill-switch service worker.
//
// Offline/PWA caching has been disabled. Devices that previously registered
// an older RHfield service worker will fetch this file on their next visit
// (browsers byte-check /sw.js on navigation). This worker takes control,
// deletes every Cache Storage entry, unregisters itself, and reloads any
// open windows so the user is no longer served from stale caches.
//
// Keep this file in place for at least a few release cycles before removing.

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    try { await self.clients.claim(); } catch {}
    try {
      const names = await caches.keys();
      await Promise.all(names.map((n) => caches.delete(n)));
    } catch {}
    try {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await Promise.all(clients.map((c) => {
        try {
          const url = new URL(c.url);
          url.searchParams.set("sw-cleanup", Date.now().toString());
          return c.navigate(url.toString());
        } catch {
          return Promise.resolve();
        }
      }));
    } catch {}
    try { await self.registration.unregister(); } catch {}
  })());
});

// Pass through everything — never serve from cache.
self.addEventListener("fetch", () => {});
