## Goal

Use the uploaded green tunnel-kiln icon as the installable app icon, and rename the PWA from "BlueW1" to "RHfield".

## Steps

1. **Generate polished icon artwork** from the uploaded reference using `imagegen--edit_image`:
   - Clean, crisp version of the green rounded-square with the grey kiln symbol centered
   - Slightly tighter symbol, cleaner edges, solid green (#1f9d3a-ish, matching upload)
   - Save as `public/icon-512.png` (512×512), then create a 192×192 variant `public/icon-192.png`
   - Also save an `apple-touch-icon` friendly version (same 512 art works)

2. **Update `public/manifest.webmanifest`**:
   - `name`: "RHfield"
   - `short_name`: "RHfield"
   - `background_color` and `theme_color`: green to match the icon (so the splash matches)
   - Keep both icon entries (192 + 512) and the maskable 512 entry

3. **Update `src/routes/__root.tsx` head metadata**:
   - `apple-mobile-web-app-title`: "RHfield"
   - `theme-color` meta: new green
   - `<title>`, `og:title`, `twitter:title`: "RHfield"
   - Keep `description` as is (or update if user wants)

4. **No service worker / registration changes** — existing `/sw.js` keeps working, content updates auto-deliver as before.

## Note for the user

Manifest fields (`name`, icons, `theme_color`) are frozen at install time on Android. Since you're reinstalling after this change, the new icon and name will apply cleanly. Old installs would keep the previous icon until uninstalled.
