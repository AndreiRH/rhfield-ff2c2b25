This is a sizeable change touching the database and most note-related screens. Confirming scope before I start.

## What changes for you

1. Every checklist item and subtask can now have **multiple notes** (instead of a single note field), each with its own title and body.
2. **Every note across the app** (item notes, subtask notes, equipment notes, calendar notes, common folder notes, production-area notes) can hold **multiple photos and multiple files** instead of one each.
3. Existing single notes and their existing photo/file stay intact — they get migrated into the new structure automatically.
4. The shared/local toggle stays per-note (and per-attachment where it already exists).

## Technical plan

### Schema
- New table `item_notes` (id, item_id, title, body, sort_order, is_shared/origin_line_id, created_by, timestamps). Backfill from existing `checklist_items.note` where non-empty. Keep the old column for now to avoid breaking reads, stop writing to it from the UI.
- New attachment tables:
  - `note_photos` (note_id → item_notes/equipment_notes/calendar_notes/common_folder_notes/pa_notes via a single polymorphic shape: `parent_kind` + `parent_id`, storage_path, sort_order, is_shared).
  - `note_files` (same shape, with file_name).
- Backfill: for every existing note row that has `photo_path` / `file_path`, insert one row into `note_photos` / `note_files`. Leave the legacy columns for one release for safety.
- RLS mirrors the parent table's policies (admin/engineer write, all team read).

### UI
- New `NoteAttachments` component: gallery of photos + list of files, with add/remove/reorder and shared toggle per item, reused everywhere.
- `ChecklistTree`: item and subtask "Note" button opens a list of notes (add / edit / delete / reorder), each note embeds `NoteAttachments`. The current note counter becomes the count of notes.
- `NotesList` (equipment) and the other note screens (`CalendarNotes`, `CommonFolderNotes`, `pa_notes` views): replace single photo/file UI with `NoteAttachments`.

### Out of scope unless you say otherwise
- Changing how notes are shared across production lines (keeps current behavior).
- Rich text / formatting inside notes.
- Bulk import of attachments.

Reply "go" and I'll start with the migration, then wire up the UI.