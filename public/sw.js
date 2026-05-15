// Minimal service worker — required for Chrome's Android install prompt.
// Network-first pass-through, no caching, so previews/published builds stay fresh.
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  // Pass-through fetch handler (presence is what Chrome checks for installability).
  event.respondWith(fetch(event.request).catch(() => new Response("", { status: 504 })));
});
