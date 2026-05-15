## Goal

Make the Android installed app behave offline as close to online as possible:

- When opened online, it downloads **all app data** and **all files/photos** into local phone storage.
- Offline pages should work even if you never opened those pages online.
- Offline edits should appear immediately in the app, not only after reconnect.
- Offline changes should stay queued and sync automatically when the phone reconnects.

Important limitation: no web app can guarantee storage forever if Android/browser storage is manually cleared or the OS evicts site data under extreme storage pressure. I will request persistent storage where supported and keep everything in IndexedDB/Cache Storage to make eviction much less likely.

## What is broken now

1. **The sync banner disappearing does not mean every page can render offline.**
   The app stores flat table snapshots, but many pages use nested data queries. The current service worker only handles simple offline reads, so pages with embedded/nested selects still need the exact response to have been cached by visiting that page online.

2. **Offline edits are queued but not applied locally.**
   The service worker saves failed writes in an outbox, but it does not update the local snapshot or the screen state. So the edit is saved for later upload, but the offline UI continues showing old data.

3. **Offline inserts do not return realistic rows.**
   Many app flows expect `.insert(...).select().single()` to return the created row ID. Offline, the current queued response only returns `{ queued: true }`, so components cannot render the new item immediately.

4. **Files added offline need a local blob store.**
   Existing online media can be cached, but a newly selected offline photo/file must be saved locally first, then uploaded later.

## Implementation plan

### 1. Upgrade local storage into the source of truth while offline

Create a stronger IndexedDB layer for:

- Table snapshots
- Pending database operations
- Pending file uploads
- Locally added file/photo blobs
- Sync metadata: last full sync, sync status, error state, pending count

This local store will be used by the service worker and client UI.

### 2. Warm up everything on app open

Update the warm-up process so every online app start:

- Requests persistent local storage on Android using `navigator.storage.persist()` where available.
- Downloads every readable table in pages/chunks, not just default limited reads.
- Stores full table snapshots in IndexedDB.
- Collects every referenced `photos` and `files` storage path.
- Downloads every file/photo through signed URLs so the service worker caches them locally.
- Tracks a clear status: `Syncing`, `Ready offline`, `Offline`, `Pending changes`, or `Sync failed`.

The “ready” status should only show after data and media warm-up completes.

### 3. Make offline reads reconstruct real page data

Improve the service worker’s offline read engine so it can answer the query shapes the app actually uses:

- `.single()` / `.maybeSingle()` responses
- count/head queries
- `eq`, `neq`, `is`, `in`, range/limit/offset/order
- common `.or(...)` patterns used by notes/folders
- embedded/nested selects used by dashboards and detail pages

Specifically, reconstruct nested data from flat snapshots for:

- Projects → lines → equipment groups → components → checklist items
- Project dashboard line progress data
- Line overview equipment/groups/components/checklists
- Equipment detail groups/types/components/checklists/photos/files
- Equipment settings with setting photos/files
- PA folders/notes/attachments
- Common folders/notes/attachments

This removes the “only pages I opened online work” behavior.

### 4. Make offline writes update local data immediately

Update the service worker mutation handler so when offline:

- `insert` creates local rows with UUIDs/default timestamps and appends them to the snapshot.
- `update` patches matching rows in the snapshot immediately.
- `delete` removes rows locally, or applies soft-delete fields where the app uses `deleted_at`.
- It returns Supabase-compatible JSON for `.select().single()` calls.
- It queues the exact network operation for replay on reconnect.

This makes offline changes visible immediately after you make them.

### 5. Make the most-used screens optimistic-safe

Adjust key components so they do not rely only on server refetch after a write:

- Checklist add/edit/toggle/delete/reorder
- Equipment settings add/edit/delete/reorder
- Equipment notes add/edit/delete/update
- PA folders/notes/attachments
- Common folders/notes/attachments
- Equipment/line/project list mutations

When a user changes something offline, the UI should update immediately from local state and local snapshot.

### 6. Support offline-added photos and files

For Android offline media:

- Save selected photo/file blobs into IndexedDB immediately.
- Add the matching attachment/photo/file database row locally.
- Show the local blob in the UI while offline.
- Queue the upload and database insert for reconnect.
- On reconnect, upload the blob to the existing private `photos` or `files` storage bucket and keep the same storage path.

### 7. Sync queued changes safely on reconnect

Improve queue replay:

- Replay database writes in original order.
- Upload local file blobs before rows that reference them where needed.
- Keep failed retryable operations in the queue.
- Drop unrecoverable 4xx failures only after marking sync as failed/needs attention.
- Run a full warm-up again after successful flush so the local snapshot matches the server.

### 8. Improve offline status messaging

Update the header badge/banner so it tells the truth:

- `Syncing data X/Y`
- `Syncing files X/Y`
- `Ready offline`
- `Offline · X pending`
- `Sync failed · tap/reopen online`

This will make it clear when the phone is actually ready to go offline.

## Validation plan

After implementation, verify these flows:

1. Open app online, wait for `Ready offline`.
2. Turn Android/network offline.
3. Open routes that were never visited online.
4. Add checklist items offline and see them immediately.
5. Toggle checklist items offline and see progress update.
6. Add/edit notes/settings offline and see them immediately.
7. Add a photo/file offline and see it locally.
8. Reconnect and confirm pending changes upload and remain visible.

## Expected result

After a successful online sync, the installed Android app should feel offline-first: pages, items, notes, settings, photos, and files should be available locally, and edits should appear immediately while offline, then sync when online again.