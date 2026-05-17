I checked both deployments directly: preview and published are serving the same current asset bundle and the same `sw.js`, so publishing did work. The remaining problem is most likely the installed/mobile PWA still being controlled by an older service worker or cached app shell.

Plan to fix it:

1. Add explicit app update detection in the root service-worker registration
   - Detect when a new service worker is installed and waiting.
   - Send it `rhfield-skip-waiting` automatically so users do not stay on the old app shell.
   - Reload the app once after `controllerchange`, guarded by a session flag to avoid reload loops.

2. Make the service worker version move forward
   - Bump `public/sw.js` from `v15` to `v16` so every installed client sees this as a real update.
   - This also forces old shell/data asset caches to be replaced cleanly.

3. Prevent warmed offline routes from pinning an old shell while online
   - Keep instant offline startup behavior.
   - When the app is online, prefer a short fresh navigation fetch before returning a cached warmed route, so published updates replace the old shell faster.

4. Keep preview behavior unchanged
   - The preview iframe will still unregister service workers, because service workers in preview can interfere with live editing.

After this, publish once more, then installed/mobile users should only need to fully close and reopen the PWA once for the update handoff to happen.