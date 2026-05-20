## Goal

Give each component type (in Wiring and Commissioning) the same per-row action system that checklist items have: notes, photos, files, "Add item", paste, and a Local/Shared switch — minus the done checkbox, since types are containers, not checklist items.

## What changes for you

The blue "+" Add-item button at the top of each component type goes away. In its place, when a type is expanded, a thin action bar appears below the header — visually identical to the items' bar — with these buttons (same icons, same sizes, same positions):

- **Note** — opens the same multi-note editor used on items (title + body + per-note photos/files, share toggle per note).
- **Add item** — shaped exactly like the "Subtask" button on items; adds a checklist item directly under this type.
- **Photo** — adds one or more photos to the type itself (gallery, reorder, per-photo share toggle).
- **File** — adds one or more files to the type itself (per-file share toggle).
- **Paste** — appears only when an item is on the clipboard.
- **Local / Shared switch** on the right — toggles whether the type and its attachments propagate to the equivalent type on the other production lines.

The type header keeps the aggregate counters (items done, notes, photos, files), now also counting the type's own notes/photos/files.

Types still cannot be marked done — they are containers.

## Technical plan

### Database

New tables, mirroring the `item_*` shape and RLS (admin/engineer write, full team read):

- `component_type_notes` — `component_type_id`, `title`, `body`, `sort_order`, `is_shared`, `origin_line_id`, `created_by`. Per-note attachments reuse the existing polymorphic `note_photos` / `note_files` with `parent_kind = 'component_type_note'`.
- `component_type_photos` — `component_type_id`, `storage_path`, `sort_order`, `is_shared`, `template_id`, `origin_id`, `origin_line_id`, `uploaded_by`.
- `component_type_files` — same plus `file_name`.

Add `local_line_id uuid` (nullable) on `component_types` so the Local/Shared switch matches the items pattern.

No data migration needed — new attachment surfaces.

### Components

- New `TypeNotesEditor` (copy of `ItemNotesEditor`, reads/writes `component_type_notes`, uses `NoteAttachments` with `parent_kind="component_type_note"`).
- `TypeSection` in `ComponentTypesTree.tsx`:
  - Remove the existing blue "+" Add-item button.
  - When expanded, render the same action-bar markup `TreeNode` uses (`ActionBtn` + `PhotoPicker` + file input + clipboard paste + Local/Shared toggle), wired to the new tables and reusing `confirmUnshareToOriginLine` / `confirmSharedDelete`.
  - Mount `<ChecklistTree … hideRootAdd />` so "Add item" lives only in the new bar.
  - Include the type's own notes/photos/files in the header counters.
- Propagation for the new tables follows the existing sibling-via-`template_id` pattern, so a Shared photo/file/note on a type appears on the matching type in every line.

### Out of scope

- Reordering attachments across types.
- Bulk import.
- Changing how component types themselves propagate (still per-line via `template_id`; only their attachments and the new `local_line_id` flag are added).
