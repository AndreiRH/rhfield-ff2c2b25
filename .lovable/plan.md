## Goal

Make the **Assembly** section behave and look exactly like Wiring and Cold Commissioning: a single `ComponentTypesTree` (with component types as containers, items underneath, plus the per-row notes/photos/files/shared toggle system) followed by the section `NotesList`. No more "Manual %" mode and no flat checklist.

## Changes

### 1. Equipment page route (`src/routes/p.$projectId.lines.$lineNumber.equipment.$kind.$equipmentId.tsx`)

- In `renderSection`, replace the `MechanicalView` branch for `"assembly"` with the same JSX used by wiring/cold (ComponentTypesTree + NotesList), passing `data.assembly` and an assembly-flavored `emptyHint` (e.g. "No assembly categories yet. Add types like 'Frames', 'Drives', 'Mechanical groups'…"), and `section="assembly"` on the NotesList.
- Delete the `MechanicalView` function and the now-unused imports it pulled in (`FlatChecklist`, `Card`/`CardContent`, `Input`, `Button`, `useState` if not used elsewhere in the file, and the `pe.mech_mode` / `pe.mech_manual_pct` selection in the loader).
- Drop `mech_mode`, `mech_manual_pct`, `mech_notes` from the `plant_equipment` select.

### 2. Progress calculation (`src/lib/progress.ts`)

- In `equipmentProgress`, always compute `mech` from `calcProgress(itemsFromGroup(assemblyGroup)).pct` (same shape as wiring/cold). Remove the `pe.mech_mode === "checklist"` branch and the manual-% fallback.

### 3. Out of scope

- No database migration. The `mech_mode` / `mech_manual_pct` / `mech_notes` columns and any existing data stay in place (harmless once unused). Existing assembly groups, components, types, and items keep working — they already feed the same `equipment_groups` tree the other sections use.
- No changes to `ComponentTypesTree`, `TypeNotesEditor`, `ChecklistTree`, settings, calendar, export, or AI search.
- The `assembly_mode_*` localStorage keys become dead — leaving them in storage is fine; no cleanup needed.

## Result

Tapping the Assembly tab opens the exact same UI as Wiring: a Component Types tree with the per-row action bar (notes, add item, photos, files, Local/Shared) and the section notes list below — no Man %/Items toggle, no manual percent input.
