// Progressier removed — kept as kill-switch to unregister any old SW on devices that loaded it before.
self.addEventListener("install", (e) => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  const names = await caches.keys();
  await Promise.all(names.map((n) => caches.delete(n)));
  await self.registration.unregister();
  const clients = await self.clients.matchAll({ type: "window" });
  clients.forEach((c) => c.navigate(c.url));
})()));
