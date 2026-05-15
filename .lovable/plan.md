
# Proactive full-data prefetch (everything cached, always)

## Current state — to answer your question directly

**No.** Right now caching is reactive: only what you actually open online ends up in the cache. If you've never visited Project B → Line 4 → Heater settings, that screen is unavailable offline.

## What we'll change

Add a **warm-up sync** that runs every time the app opens online (and on reconnect). It walks the entire database you have access to and pulls everything into the local cache before you go offline.

### 1. One server function: `prefetchEverything()` (new `src/lib/prefetch.functions.ts`)

A single `createServerFn` (auth-protected) that returns the full snapshot in one round-trip:

- All rows from: `projects`, `lines`, `plant_equipment`, `equipment_groups`, `component_types`, `components`, `checklist_items`, `equipment_settings`, `equipment_notes`, `equipment_photos`, `item_photos`, `item_files`, `component_photos`, `component_files`, `setting_photos`, `setting_files`, `setting_logs`, `pa_folders`, `pa_notes`, `pa_attachments`, `milestones`, `common_notes`, `common_files`, `common_folders`, `common_folder_notes`, `common_folder_attachments`, `profiles`, `user_roles`.
- Plus a flat list of every storage path referenced (`{ bucket, path }[]`) so the client can pre-fetch the binaries.

At ~2k rows total today this is one fast request (well under 1s). Even at 10× growth it stays a single payload.

### 2. Client-side warm-up runner (new `src/lib/warm-up.ts`)

On app boot (and on `online` / `visibilitychange` to visible):
1. Call `prefetchEverything()` and store the snapshot in IndexedDB (`rhfield-snapshot`) keyed by table — same shape Supabase returns.
2. Seed each Supabase REST query URL we know the app uses with that data, so the existing service-worker SWR cache has hits for the very first request from any screen.
3. For every storage path returned, request a long-lived signed URL (12h) in batched calls (`createSignedUrls`) and `fetch()` each so the SW puts the binary in the `rhfield-blobs` cache. Throttle to ~6 concurrent. Skip ones already cached.
4. Update header indicator: "Syncing X / Y…" while running, then clears.

### 3. Read path — instant hits from the snapshot

Two complementary mechanisms keep things instant offline:

- **HTTP cache (already built)**: the SW serves cached `*.supabase.co/rest/v1/...` responses instantly. After warm-up, every list query the app sends has a hit.
- **Snapshot fallback (new)**: if a screen issues a query the warm-up didn't pre-seed (e.g. a new filter combo), a small wrapper queries the IndexedDB snapshot locally and returns matching rows. This guarantees coverage even for routes/queries we didn't visit.

### 4. Photos / files — always available

Because step 2.3 fetches every storage object through the SW, opening any equipment / note / attachment offline shows the real image or downloads the real file from cache. Signed URLs are refreshed on every warm-up so they never expire while online.

### 5. Header indicator updates

Extends the existing offline badge:
- "Syncing 423 / 1,200" with a progress bar while warm-up runs
- "Up to date · 2 min ago" when done
- Existing offline / queued-edits states unchanged

### 6. Storage budget guard

Before running, check `navigator.storage.estimate()`. If quota is tight (<50 MB free), skip binary prefetch for that run and toast a warning. Text snapshot always runs — it's tiny.

## Files touched

- **new** `src/lib/prefetch.functions.ts` — server function that returns the full snapshot
- **new** `src/lib/warm-up.ts` — client runner: persists snapshot, fetches binaries, reports progress
- **new** `src/lib/snapshot-store.ts` — tiny IndexedDB wrapper for the snapshot
- `src/routes/__root.tsx` — kick off warm-up after auth is ready
- `src/components/AppHeader.tsx` — sync progress in the existing badge
- `src/lib/offline.ts` — expose progress state alongside online/pending

## Trade-offs (worth knowing)

- **Bandwidth**: every app open re-pulls all metadata (~tens of KB) and any new/changed photos. Existing photos already in cache are skipped via a HEAD/cache check.
- **First install**: warm-up may take a few seconds depending on how many photos exist. The app is usable during that time; offline-completeness is reached when the badge says "Up to date".
- **Deletes**: rows deleted on the server stay in the local snapshot until the next successful warm-up overwrites it. No phantom data once you're back online.
- **Multi-tenant scaling**: this approach assumes "all data fits on the device". With your current dataset (~2k rows, single project) that's fine for years. If you ever onboard 100+ projects with thousands of photos each, we'd revisit with a per-project opt-in.

## What I will NOT do

- No CRDT / conflict UI (still last-write-wins, same as today)
- No background download while the app is closed (browsers don't reliably allow it for PWAs)
- No changes to existing screens' data-fetching code — they keep using the Supabase client as today; the SW + snapshot transparently serve them
