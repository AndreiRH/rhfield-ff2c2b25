/**
 * Mandatory confirmation before deleting a shared (non-local) photo, file,
 * or note. Returns true when the user confirms, false to abort.
 *
 * Use for any entity whose deletion would propagate to other lines / contexts
 * (item_photos / item_files with is_shared=true, notes with is_shared=true,
 * any common_folder_* item, etc.). Local items skip this — call with
 * `shared=false` (or just don't call) to keep the existing flow.
 */
export function confirmSharedDelete(shared: boolean): boolean {
  if (!shared) return true;
  if (typeof window === "undefined") return true;
  return window.confirm(
    "Delete shared item?\n\n" +
    "This item is shared and not local.\n" +
    "Deleting it will remove it from all places where it is shared, not just here.\n\n" +
    "Do you want to continue?",
  );
}
