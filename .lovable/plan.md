I found the likely real causes and will fix them in the offline layer rather than asking you to reinstall.

## Plan

1. **Make every existing photo/file download to the phone reliably**
   - Change warm-up so it fetches all storage objects directly by stable bucket/path, not only through temporary signed URLs.
   - Add retry/concurrency handling and progress counts for photos/files.
   - Make the service worker also recognize `/storage/v1/render/image/...` and synthetic signed URLs, so offline images resolve from local IndexedDB instead of showing broken tiles.
   - Store downloaded media permanently in the local blob store as `photos/path` or `files/path`.

2. **Make newly added offline photos/files immediately available offline**
   - Keep uploaded blobs in IndexedDB before/while the upload is queued.
   - Ensure offline-created attachment rows stay in the snapshot and are not overwritten by a later server pull until the queue is fully clean.

3. **Fix nested offline edits for equipment pages**
   - Stop relying on server-generated IDs during offline nested creation.
   - Generate client-side UUIDs before inserts for equipment, equipment groups, component types, components, checklist items, and media rows so child records point to stable parent IDs.
   - Fix offline POST responses for `.select("id").single()` so copied/pasted or multi-step nested inserts get the generated local ID back immediately.
   - Keep replay order parent-first and do not warm-up/overwrite local data while queued or failed child writes remain.

4. **Fix local snapshot embedding for equipment details**
   - Ensure Assembly/Wiring/Cold groups, component types, components, checklist items, photos, and files are reconstructed correctly from IndexedDB while offline.
   - Correct component nesting rules so components under a component type and components under an equipment group both survive offline and reconnect.

5. **Clean up the sync cloud UI**
   - Remove any remaining rotating arrows/spinner indicators.
   - Online: show only a full cloud icon.
   - Offline: show only the cut cloud icon, no “Offline” word.
   - Resize and center the sync popover on mobile so it fits the screen; keep it compact on desktop.

6. **Validation**
   - Verify storage URL parsing covers signed, authenticated/public, render/image, and local synthetic URLs.
   - Verify an offline flow: create equipment → open it → add component type → component → checklist item → photo/file → reconnect, and confirm nested rows remain visible instead of disappearing.
   - Verify the cloud icon and popover behavior on mobile width.

## Technical details

- Main files to update: `public/sw.js`, `src/lib/warm-up.ts`, `src/components/SyncCloud.tsx`, and the nested insert call sites in equipment/component/checklist UI.
- No reinstall should be required after the fix; you should only need to reload once online so the updated offline worker activates and downloads media.