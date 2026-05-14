## Goal

Let an admin upload one of the ZIPs produced by the existing export feature and recreate it as a **brand-new project** (new IDs everywhere, original project untouched). Skip any row that would collide.

## Where it lives

- New page: `/p/import` (admin only), reachable from a new **"Import project from ZIP"** button on the projects list page (`src/routes/index.tsx` or wherever the project list renders).
- Logic: `src/lib/importProject.ts` (mirrors `exportProject.ts`).
- UI: `src/components/ImportProjectDialog.tsx` — file picker, new project name field, progress modal, summary at the end.

## What gets restored

From `tables/*.csv` in the ZIP, in dependency order, with a fresh UUID generated for every row and a map kept from `oldId → newId`:

1. `projects` → create one new row using the user-provided name (ignore the old project row, just take its id for remapping).
2. `lines` → remap `project_id`.
3. `plant_equipment` → remap `line_id`. **Important:** the DB trigger `create_default_groups_for_pe` auto-inserts 3 equipment_groups per PE. The importer must delete those auto-rows for each newly inserted PE before inserting the real `equipment_groups` from the ZIP, otherwise we get duplicates.
4. `equipment_groups` → remap `line_id`, `plant_equipment_id`. New `template_id` per row (don't reuse — would link unrelated projects via the propagate triggers).
5. `component_types` → remap `equipment_group_id`, fresh `template_id`.
6. `components` → remap `equipment_id`, `component_type_id`, fresh `template_id`.
7. `checklist_items` → remap `component_id`, `parent_item_id` (two passes: parents first, children second), fresh `template_id`.
8. `equipment_notes`, `equipment_photos` → remap `equipment_id`.
9. `pa_folders` → remap `line_id`.
10. `pa_attachments` → remap `folder_id`.
11. `pa_notes` → remap `line_id`, `folder_id`.
12. `milestones` → remap `line_id`.
13. `common_notes`, `common_files` → remap `project_id`.
14. `item_photos`, `item_files` → remap `item_id` (checklist item).

Audit fields (`created_by`, `uploaded_by`, `completed_by`) are set to the current user. `created_at` / `uploaded_at` are preserved from the CSV when present.

## Storage (photos & files)

For every row that has a `storage_path`, the importer:
1. Reads the file from the ZIP at `photos/<path>` or `files/<path>`.
2. Uploads it to the same bucket under a NEW path: `<newProjectId>/<originalSubpath>` (so it doesn't collide with the source project).
3. Writes the new path into the DB row.

If the file is missing from the ZIP (older export, or "include media" was off), the row is still inserted with `storage_path` left pointing to a clearly-invalid placeholder and counted in the "missing media" report at the end. Nothing crashes.

## "Skip existing" rule

Since we always create a brand-new project with brand-new UUIDs, true row collisions can't happen. The "skip existing" choice is honored at the **project level**: if the user enters a project name that already exists, the dialog warns and offers to append a suffix or cancel.

## Concurrency, limits, safety

- Inserts batched in chunks of 500 with `supabase.from(...).insert(rows)`.
- Storage uploads run through `withConcurrency(6)` (same helper as the exporter, extracted to `src/lib/concurrency.ts` if not already shared).
- Hard cap: refuse ZIPs > 500 MB uncompressed (configurable).
- Wrapped in a single try/catch with a "Rollback" button that deletes the just-created project (cascade is not configured, so rollback iterates the maps in reverse). A confirmation modal warns: *"Import is not transactional. If something fails halfway, click Rollback to remove partial data."*
- Admin-only: gated by `has_role('admin')` in the UI; RLS already enforces it server-side.

## Out of scope (explicit)

- Merging into an existing project.
- Updating/overwriting rows.
- Restoring `profiles`, `user_roles`, or auth users (the ZIP doesn't contain them; imported `created_by` falls back to the importer's user).
- Restoring soft-deleted rows (rows with `deleted_at` set are skipped).
- Restoring data from ZIPs produced by older versions with a different schema (we'll add a `manifest.json` to future exports for forward-compat, but won't backfill).

## Files to add / edit

- **add** `src/lib/importProject.ts` — ZIP read, CSV parse (papaparse, already in tree if not, add it), id remap, ordered inserts, storage uploads, rollback.
- **add** `src/components/ImportProjectDialog.tsx` — file picker + new-project-name input + progress + final summary ("Imported 4 lines, 12 equipment, 287 checklist items, 45 photos, 3 missing files").
- **add** `src/routes/p.import.tsx` OR add the dialog button directly to the projects index — pick whichever matches existing nav patterns (will check during implementation).
- **edit** `src/lib/exportProject.ts` — write a small `manifest.json` (schema version, exported_at, source project id) so future imports can validate compatibility. Backwards-compatible: importer treats missing manifest as v1.
- **edit (maybe)** `package.json` — add `papaparse` if not already present.

## Risks I want you to know about

1. **Triggers fight the import.** `create_default_groups_for_pe` and the various `propagate_*` / `replicate_*` triggers will fire during inserts. Mitigations: (a) delete the auto-created equipment_groups right after each PE insert, (b) generate fresh `template_id`s so propagate doesn't cross-write into the source project. I've planned for both.
2. **Not transactional.** Supabase JS can't wrap multi-table inserts in one DB transaction. The Rollback button is the safety net.
3. **Big ZIPs are slow client-side.** A 300 MB ZIP with thousands of photos can take several minutes and uses browser memory. The dialog shows live progress and lets the user cancel.

Ready to build this on approval.