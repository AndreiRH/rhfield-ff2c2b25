## What I found

I dug into `public/sw.js`, `src/lib/warm-up.ts`, `src/lib/offline.ts`, `src/components/AppHeader.tsx` and the database schema. Three independent problems, three independent fixes.

### 1. Sync indicator is too loud

`AppHeader.tsx` currently renders an orange pill with text like `Sync pages 412/694` every time the app warms up, which is on every login, every reconnect, every focus. The badge color (`bg-amber-500/15 text-amber-600`) reads as a warning.

**Fix:** Replace the pill with a small, low-contrast spinning arrow icon tucked next to the theme toggle in the header. No text, no colored background. Tooltip on hover still tells you what phase it's in and how many items remain. Keep the existing "Offline" pill (it should be loud, it's a real state). Pending-changes badge stays too, but recolored to muted/neutral instead of amber.

### 2. Warm-up re-downloads all 694 pages every time

`cacheRoutesForOffline` in `sw.js` does `fetch(..., cache: "no-store")` for every URL in the list, every run. But this is a SPA — the HTML served at `/p/abc/lines/1/equipment/kiln` is the same shell as every other route. There is nothing route-specific to re-download. The only reason to "warm" a route is to register the URL → shell-cache mapping so the SW can answer it offline.

**Fix:** Make route warm-up incremental.
- In `cacheRoutesForOffline`, check `shell.match(url)` first and skip if already cached. First sync caches all 694 (one-time cost). Subsequent syncs only fetch routes that don't yet exist in the shell — which means brand-new project/line/equipment entries the user added, typically 0–10 routes.
- Also fetch the root shell HTML only once per SW version and reuse it (`shell.put(url, rootShellResponse.clone())`) instead of doing a real network round-trip for every URL. This collapses 694 fetches to one.
- For the blob (file/photo) phase, the code already skips items with `hasBlob` — that part is fine, no change needed.
- Tables phase: still re-pull every table (this is what keeps the snapshot in sync with the server) but parallelism is already there, no change needed.

Net effect on a normal sync after the first one: warm-up finishes in a second or two instead of slogging through 694 HTML fetches.

### 3. Offline child rows disappear after reconnect

This is the real bug. The schema is mixed: some tables have an `updated_at` column (`plant_equipment`, `component_types`, `checklist_items`, `equipment_settings`, …) and many do not (`components`, `equipment_groups`, `item_photos`, `item_files`, `component_photos`, `component_files`, `setting_photos`, `setting_files`, `pa_attachments`, `common_files`, `common_folder_attachments`, `equipment_photos`, `milestones`, `setting_logs`, `profiles`, `user_roles`).

In `sw.js`, `withDefaults` unconditionally stamps both `created_at` and `updated_at` onto every offline insert, and `queueRequest` then queues that augmented body as the POST payload. When the outbox replays:
- Inserts into tables that have `updated_at` succeed → parent rows survive.
- Inserts into tables without `updated_at` (which is most of the child tables in your two examples — `components`, `checklist_items`, `equipment_groups`, `*_photos`, `*_files`) get a 400 from PostgREST ("column does not exist"). `flushQueue` treats any 4xx as unrecoverable, deletes the queue item, and the row is gone forever. Then `warmUp(true)` runs and overwrites the local snapshot with the server's state, so the rows also disappear from the offline view — exactly the symptom you described ("parents saved, children disappear").

**Fix:**
- Stop sending synthetic `created_at`/`updated_at` to the server. Keep the locally-generated `id` (we need it so children can FK to it), but strip server-managed defaults from the queued POST body. Locally, the snapshot can still hold a fake `updated_at` for ordering purposes — that's a presentation concern, not what we send back.
- Concretely: split `withDefaults` into `withLocalDefaults` (used when writing the local snapshot, fills in id/created_at/updated_at/sort_order/etc.) and `withServerSafeBody` (used to build the queued POST body, includes only fields the table actually accepts — `id` plus whatever the client originally sent).
- Harden `flushQueue` so that if a replay does fail with 4xx, we log/broadcast the failure rather than silently dropping it. That way the next bug like this surfaces immediately instead of looking like missing data.
- Also: only call `warmUp(true)` after `flushQueue` reports a clean flush (queue empty AND no failures). If anything failed, keep the local snapshot intact so the data is still visible offline and the user can see something is wrong via the (now visible) pending-changes count.

## Files to change

- `public/sw.js` — split `withDefaults`, change `queueRequest`/insert path to send server-safe body, skip already-cached routes in `cacheRoutesForOffline`, report failed replays.
- `src/lib/warm-up.ts` — no behavior change needed beyond what the SW does; the route list it generates is already fine.
- `src/lib/offline.ts` — gate the post-flush `warmUp(true)` on a clean flush.
- `src/components/AppHeader.tsx` — replace the amber sync pill with a small muted spinner icon, keep tooltip; recolor the pending-changes indicator to a neutral tone; leave the offline pill loud.

## Out of scope

- No database migrations.
- No changes to the auth or routing setup.
- No change to the blob/file caching strategy.

Approve and I'll implement.
