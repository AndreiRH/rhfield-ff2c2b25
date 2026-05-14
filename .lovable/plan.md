## Goal
A single "Export project" button on the project page that downloads a ZIP containing every piece of data for that project — checklists, notes, progress, photos, files — in a format you can open in Excel and a folder structure you can hand to a client.

## What's in the ZIP

```text
riedhammer-<project-name>-<YYYY-MM-DD>.zip
├── README.txt                       (what each file contains)
├── summary/
│   ├── checklist_full.csv           ← the "readable" master sheet
│   ├── progress_by_line.csv         ← % per chapter per line
│   └── progress_by_equipment.csv
├── tables/                          ← raw export, one CSV per table
│   ├── lines.csv
│   ├── plant_equipment.csv
│   ├── equipment_groups.csv
│   ├── component_types.csv
│   ├── components.csv
│   ├── checklist_items.csv
│   ├── equipment_notes.csv
│   ├── pa_folders.csv
│   ├── pa_attachments.csv
│   ├── pa_notes.csv
│   ├── milestones.csv
│   ├── common_notes.csv
│   └── common_files.csv
├── photos/                          ← all images, original filenames preserved
│   ├── checklist/<item-id>/...
│   ├── equipment/<equipment-id>/...
│   └── pa/<folder-name>/...
└── files/                           ← all uploaded files, same structure
    ├── checklist/...
    ├── pa/...
    └── common/...
```

The star of the export is **`summary/checklist_full.csv`** — one row per checklist item, fully flattened so a non-technical reader gets everything in one sheet:

| Line | Plant | Equipment | Chapter | Component type | Component | Task | Done | Completed at | Note | Photos | Files |
|------|-------|-----------|---------|----------------|-----------|------|------|--------------|------|--------|-------|

## How it works (technical section)

- New route `src/routes/p.$projectId.export.tsx` + a button on the project page (`p.$projectId.index.tsx`).
- Client-side build, no server function needed:
  - Query all project-scoped tables in parallel via the Supabase browser client (RLS already restricts to admin/engineer/pm).
  - Build CSVs in memory with a tiny CSV writer (proper escaping for commas, quotes, newlines).
  - Build the flattened "checklist_full.csv" by joining the in-memory data.
  - For every `storage_path` referenced, download the blob via `supabase.storage.from(...).download(path)` and add it to the ZIP under a human-readable folder path.
  - Use **JSZip** (small, browser-only, no native deps) to assemble the archive and trigger a download via a Blob URL.
- Progress UI: a modal showing "Exporting tables… Downloading photos (12 / 87)… Packaging…" with a cancel button. Photos/files are fetched in parallel with a concurrency cap of ~6 to avoid hammering storage.
- Size guard: if the total exceeds ~300 MB, warn the user and offer "Skip media" or "Continue".
- Permission: only visible to `canEdit` (admin/engineer); PM also gets it but read-only is fine since RLS allows them to read everything.

## Out of scope (can add later if you want)
- Scheduled automatic backups by email.
- Server-generated PDF report of the same content.
- Restore-from-ZIP (the export is one-way; ZIP is for archival/handover, not import).

## Dependencies
- Add `jszip` (~30 KB gzip, pure JS, no native bindings).

## Files to add / change
- **add** `src/lib/exportProject.ts` — query, CSV builders, ZIP assembly.
- **add** `src/components/ExportProjectButton.tsx` — button + progress modal.
- **edit** `src/routes/p.$projectId.index.tsx` — mount the button in the project header.

Shall I implement this?