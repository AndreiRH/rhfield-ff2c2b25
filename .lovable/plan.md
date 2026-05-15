
# Full offline support for RHfield

Goal: App opens and works offline after one online visit. You can browse cached projects/lines/equipment, edit notes, tick checklist items, and take photos while offline — all changes auto-sync when the connection returns.

## Honest scope note

True offline-with-edits in a multi-user app is a real feature, not a flag. There are inherent trade-offs you should know about:

- **Conflicts**: if you and a teammate edit the same item offline, last write wins (we won't build CRDT-style merging).
- **Server-side validation errors**: if a queued edit is rejected when replayed (e.g. permissions changed, item deleted), it is dropped and you'll see a toast — there's no manual conflict resolution UI in v1.
- **Photo uploads while offline**: the photo is stored locally in IndexedDB and uploaded on reconnect. Until then it shows on your device only.
- **No new sign-ins offline**: you must have logged in at least once online; the session token is reused offline.

If any of those are deal-breakers, tell me and we'll narrow scope.

---

## What changes

### 1. Service worker — full asset precache + smarter caching (`public/sw.js`)

Today the SW only precaches `/`, manifest, and icons. JS/CSS chunks are only cached once visited, so deep links offline often fail. New strategy:

- **At install**: fetch the build's asset manifest and precache the entire app shell (HTML, all JS chunks, CSS, fonts, icons).
- **HTML navigations**: network-first, fall back to cached `/` (unchanged).
- **Same-origin static assets**: cache-first (fast, already precached).
- **Supabase REST GETs** (`*.supabase.co/rest/v1/*`): stale-while-revalidate — instant from cache, refreshed in background.
- **Supabase Storage GETs** (signed URLs for photos/files): cache-first with long TTL, so previously-viewed photos stay available offline.
- **Supabase writes** (POST/PATCH/DELETE on `/rest/v1/*` and Storage uploads): if offline or fetch fails, hand off to the outbox queue (see §3) and return a synthetic 202 response.

To keep the precache list in sync with each build, we'll inject the asset list at build time via a small Vite plugin that writes `public/sw-manifest.json`, which the SW reads on install.

### 2. Client data layer — instant + revalidate everywhere

- Wrap every Supabase `.select()` call site that powers a screen so it reads from cache first, then revalidates. We'll do this with **TanStack Query** persistence (`@tanstack/query-persist-client-core` + IndexedDB persister) so query results survive reloads and offline cold-starts.
- Already-fetched routes will then render instantly offline from the persisted query cache.
- Add a small "Offline" badge in `AppHeader` that lights up when `navigator.onLine === false` and shows the pending-sync count.

### 3. Outbox / sync queue (`src/lib/outbox.ts`)

A single IndexedDB store (`rhfield-outbox`) holds pending mutations:

```text
{ id, kind: "rest" | "storage", method, url, headers, body|blob, createdAt, attempts }
```

Flow:
1. App-level Supabase wrapper tries the request.
2. On network failure (or `!navigator.onLine`), write the request to the outbox and optimistically update the local query cache so the UI reflects the change immediately.
3. A `flushOutbox()` runner triggers on:
   - `window.online` event
   - app focus (`visibilitychange`)
   - SW `sync` event (Background Sync API where supported — Chrome/Android)
4. Each entry replays in order; on success it's removed and the affected queries are invalidated. On terminal failure (4xx that isn't 408/429) it's dropped with a toast.

Photos go through the same outbox: the `File` blob is stored in IndexedDB until upload succeeds.

### 4. Manifest + install prompt (no change needed)

Existing `manifest.webmanifest` and SW registration in `__root.tsx` stay as-is. You'll need to **reinstall the app one more time** after this ships so the new SW + precache run on first online launch.

---

## Files touched

- `public/sw.js` — rewrite with precache + outbox handoff
- `vite.config.ts` — add small plugin to emit `public/sw-manifest.json` per build
- `src/lib/outbox.ts` — new (IndexedDB queue + flusher)
- `src/lib/supabase-offline.ts` — new (wrapper that routes mutations through outbox + optimistic cache updates)
- `src/router.tsx` — wire TanStack Query IndexedDB persister
- `src/components/AppHeader.tsx` — add offline/sync indicator
- A handful of existing call sites that do `supabase.from(...).insert/update/delete/upload` — swap to the offline-aware helper (mostly mechanical)

New deps: `idb` (tiny IndexedDB wrapper), `@tanstack/query-persist-client-core`, `@tanstack/query-async-storage-persister`.

---

## What I will NOT do (unless you ask)

- No CRDT / no per-field merge UI — last write wins.
- No background sync of *new* data you've never opened (we only cache what you've visited).
- No offline auth — you must be signed in before going offline.
- No edits to `progressier.js` or the icon files.

---

## Rollout

1. Ship the changes.
2. You open the app once online → SW precaches everything, query cache hydrates as you browse.
3. Go offline → app loads, cached screens work, edits queue up.
4. Back online → outbox auto-flushes, header indicator clears.

Reinstall the PWA once after this lands so the new service worker takes over cleanly.
