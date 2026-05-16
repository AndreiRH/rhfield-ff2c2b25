## Goal

Make the project-wide AI Search page work offline (search, collect, export) by maintaining a local cache of all project data and replacing the LLM step with a rule-based query parser when offline (or always, with online LLM as an optional enhancer).

## Approach

- **Local cache (IndexedDB via Dexie)**: mirror searchable rows + every photo/file as a Blob, scoped per project.
- **Offline query parser**: deterministic keyword + filter logic, no network. Same result shape as the existing online server function so the UI is unchanged.
- **Sync strategy**: auto-sync on app open and after every successful write while online; manual "Sync now" button on the AI Search page with progress + last-sync timestamp.
- **Online behavior**: prefer the existing LLM server function for natural-language parsing; fall back to the offline parser if the call fails or `navigator.onLine === false`.
- **Exports**: already client-side (CSV/XLSX/PDF) → already work offline once data is cached. Attachments embed from local Blobs when present (e.g., images inline in PDF), otherwise show file names.

## Technical Plan

### 1. Dependencies
- Add `dexie` (IndexedDB wrapper, ~25KB).

### 2. Local DB layer — `src/lib/offlineCache.ts`
Dexie schema, one DB instance shared across projects, tables keyed by `[projectId+id]`:
- `equipment_settings`, `checklist_items`, `equipment_notes`, `pa_notes`, `common_folder_notes`
- `plant_equipment`, `equipment_groups`, `component_types`, `components`, `lines` (lookup tables for joining names/locations offline)
- `attachments` — `{ projectId, bucket, storage_path, blob, mime, size, cached_at }`
- `sync_state` — `{ projectId, last_full_sync_at, in_progress }`

Helpers: `cacheProject(projectId)`, `cacheAttachment(bucket, path)`, `getCached(projectId)`, `clearProject(projectId)`.

### 3. Sync service — `src/lib/offlineSync.ts`
- `syncProject(projectId, { onProgress })`: fetch all rows for the project's lines/equipment via existing Supabase client, upsert into Dexie. Then for every referenced photo/file (`photo_path`, `file_path`, `storage_path` across the cached tables, plus `item_photos`/`item_files`/`setting_photos`/`setting_files`/`equipment_photos`/`pa_attachments`/`common_files`/`common_folder_attachments`), download via `supabase.storage.from(bucket).download(path)` and store the Blob. Skip already-cached paths (idempotent).
- Hook `useAutoSync(projectId)`: triggers on mount and on `online` event; throttled so back-to-back writes coalesce (5s debounce).
- Wire a lightweight post-write hook: after the app's existing mutations succeed and `navigator.onLine`, kick `syncProject` in background (no await). Implement once at the React Query mutation layer (global `onSuccess` on `QueryClient`'s mutation cache).

### 4. Offline query engine — `src/lib/offlineSearch.ts`
- Input: same shape the existing `runAiSearch` server fn accepts (sources, keywords, equipmentKinds, lineNumbers, equipmentNameLike, componentTypeLike, doneFilter, includeAttachments).
- Parser `parseQueryOffline(question, scope)`: extracts keywords (split, lowercase, strip stopwords), recognizes simple patterns ("flow", "temperature", "done", "not done", "line 3", "kiln", etc.) into the same plan structure.
- Executor: runs filters over Dexie tables and joins to lookup tables for `line_number`, `equipment_name`, `component_type`, `component_name`. Returns the same normalized row shape the page already renders.
- Attachments: resolves Blob from cache; produces an `objectUrl` for the table thumbnails and a `localBlob` for export embedding.

### 5. Server fn fallback — `src/lib/aiSearch.functions.ts`
- No schema change. Keep using `runAiSearch` online for NL parsing.
- On the client, wrap the call with `safeRunSearch(...)`: if `!navigator.onLine` or the RPC throws, run `offlineSearch` instead. Show a small "Offline mode — showing cached results" banner.

### 6. UI — `src/routes/p.$projectId.search.tsx`
- Add: connection status indicator (Online / Offline), last-sync timestamp, "Sync now" button with progress bar, cache size estimate (via `navigator.storage.estimate()`).
- Add filter controls (source, line, kind, done) so offline users can refine without relying on NL.
- Result table: use cached object URLs for `StoragePhoto` when offline; otherwise existing signed URLs.
- Exports: when offline, embed images from cached Blobs in PDF; CSV/XLSX include cached attachment file names + relative paths (no signed URLs).

### 7. Settings affordance
- New "Offline data" section on the search page: cache size, last sync, "Refresh cache", "Clear cached files".

## Out of scope
- No offline LLM (Approach B was not selected).
- No service worker / PWA install (only data + attachment caching).
- No offline writes/sync conflict resolution — the app is read-only when offline for search purposes. Existing mutation pages remain online-only.
- No changes to RLS, DB schema, or auth.

## Files

Created:
- `src/lib/offlineCache.ts`
- `src/lib/offlineSync.ts`
- `src/lib/offlineSearch.ts`
- `src/components/search/OfflineStatus.tsx`

Edited:
- `src/routes/p.$projectId.search.tsx` — wire offline fallback, status UI, filter controls, cached-attachment rendering, export paths.
- `package.json` / `bun.lock` — add `dexie`.
- `src/router.tsx` or root route — register global mutation cache `onSuccess` hook that triggers background sync of the active project.

No DB migrations. No new secrets. No edge functions.
