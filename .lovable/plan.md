## Problem

The import RPC fails with:
> insert or update on table "components" violates foreign key constraint "components_equipment_id_fkey"

### Root cause

In `src/lib/importProject.ts`, the id-remap maps (`peMap`, `egMap`, `ctMap`, `compMap`, `ciMap`) are built from **every** row in the CSV — including soft-deleted ones. But the payload only inserts non-deleted rows.

So a `component` whose `equipment_id` points to a soft-deleted `equipment_group` passes the filter (`egMap.has(...)` is true), gets remapped to a fresh UUID, and then references an `equipment_group` that was never inserted → FK violation. The same leak can happen for component_types under deleted EGs, components under deleted CTs, and checklist_items under deleted components.

## Fix

Filter children against the **live** parent set (not the full id map).

In `src/lib/importProject.ts`:

1. Build a `liveEgIds = new Set(liveEg.map(r => r.id))` after computing `liveEg`. Same for `livePe`, `liveCt`, `liveComp`.
2. Replace the membership checks:
   - `equipment_groups`: filter by `livePeIds.has(r.plant_equipment_id)` when `plant_equipment_id` is set (orphan EGs are allowed since `plant_equipment_id` is nullable).
   - `component_types`: filter by `liveEgIds.has(r.equipment_group_id)` (already in code via `egMap`, change to `liveEgIds`).
   - `components`: keep only rows where `(equipment_id && liveEgIds.has(equipment_id)) || (component_type_id && liveCtIds.has(component_type_id))`.
   - `checklist_items`: filter by `liveCompIds.has(r.component_id)`.
   - `equipment_notes` / `equipment_photos`: filter by `livePeIds.has(r.equipment_id)`.
3. Also defensively null out `parent_item_id` for checklist items if the parent is missing from `ciMap` (already partly handled with `?? null`, just confirm).

No DB changes needed — the `import_project_bulk` RPC and triggers are correct.

## Validation

After the fix, re-export the existing `BlueW1` project and import it as a new project; the dialog should reach "Uploading photos & files…" and finish without the FK error.
