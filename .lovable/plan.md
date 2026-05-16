I found two likely root causes behind what you are seeing:

1. **Offline photos show broken image icons** because signed storage URLs can include `/render/image/...`, but the service worker only understands `/object/...`, so it cannot map the offline image URL back to the locally cached photo bytes.
2. **Child records disappear after reconnect** because offline-created parent IDs are local, but nested writes can still replay out of order or get dropped on 4xx. Also, the equipment detail page auto-creates the default Assembly/Wiring/Cold groups; if that happens offline, child component types/components/items depend on those queued groups surviving correctly.

Plan to fix it properly:

1. **Make offline photo/file serving robust**
   - Update the service worker storage URL parser to recognize all storage URL shapes used by the app, including signed image render URLs.
   - Make offline signed URL responses return URLs that the service worker can always resolve from IndexedDB.
   - When warm-up downloads photos/files, store them by stable `bucket/path`, not by temporary signed URL.
   - Ensure existing components that use `createSignedUrl()` display cached photos offline instead of broken tiles.

2. **Stop silent loss of offline nested edits**
   - Change outbox replay so rejected 4xx writes are **not silently deleted**.
   - Keep failed queued changes visible/pending and expose the failure in the sync status instead of overwriting local data with incomplete server data.
   - Replay dependent writes safely in queue order, so equipment → groups → component types/components → checklist items/photos/files survive reconnect.
   - Sanitize queued POST/PATCH bodies against real table columns so synthetic local-only fields like `updated_at` are not sent to tables that do not have them.

3. **Protect local edits during online resync**
   - Only run the full warm-up pull after the outbox is clean.
   - If any replay is stalled or rejected, keep the local snapshot as the source of truth so your offline-created sublayers stay visible while the queue is resolved.
   - Add better internal failure reporting so the app does not appear to “sync successfully” when some child rows failed.

4. **Replace the rotating arrows with a cloud status control**
   - In the header, show one small cloud icon:
     - Online: normal uncut cloud.
     - Offline: cut/offline cloud.
     - Pending/syncing: subtle low-attention cloud state.
   - Clicking the cloud while online opens a small semi-transparent popover.
   - The popover shows current sync phase and counts, e.g. `Data 12/24`, `Pages 300/694`, `Photos/files 18/60`, pending edits, and any replay failures.
   - Clicking outside closes the popover.

5. **Validation after implementation**
   - Verify the service worker routes storage GETs for signed URLs to local cached blobs.
   - Verify offline-created equipment plus groups/component types/components/items remain in the local snapshot until they are safely replayed.
   - Verify the new header cloud UI matches your requested behavior and no orange/rotating-arrows indicator remains.