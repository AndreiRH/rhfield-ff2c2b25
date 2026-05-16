## Goal

Add a project-wide **AI Search** page where you type a question in plain language ("all flow settings from kilns on line 3", "status of temperature sensors across all components in line 2"), and the app finds matching records from across the project, shows them in a results table, then lets you export to **CSV, XLSX, or PDF**.

## How it will work for you

1. Open the project → click **AI Search** in the project header.
2. Pick a scope: whole project / a line / a specific equipment (defaults to whole project).
3. Type a question. Examples:
   - "All settings with 'flow' in the title from every kiln on line 3"
   - "Every checklist item labelled 'temperature sensor' across all components, show which are done"
   - "All photos and files from any equipment item named like 'burner control'"
   - "Equipment notes mentioning 'vibration' on SHS units"
4. Results appear in an on-screen sortable table with one row per match (with line, equipment, location columns so you can see where each result came from). Photos/files show as thumbnails with a link.
5. Click **Export** → choose **CSV / XLSX / PDF**. File downloads from `/mnt/documents`-style flow (browser download).

## Searchable data

Confirmed sources:
- Equipment settings (title + body + photos + files)
- Checklist items (label, done status, notes, photos, files) — including items under component types
- Equipment notes (title + body + attachments)
- PA notes & folders (title, body, attachments)
- Component photos & component files
- Common project notes/folders (whole-project level)

Each result row includes location breadcrumbs: `Project → Line N → Plant (Kiln/SHS) → Equipment → (Component type → Component) → Item`.

## Technical design

### New route
`src/routes/p.$projectId.search.tsx` — project-scoped AI search page, linked from `AppHeader` when inside a project.

### Server function: NL → structured query
`src/lib/aiSearch.functions.ts` with `createServerFn` + `requireSupabaseAuth`:

1. Takes `{ projectId, scope, question }`.
2. Calls Lovable AI Gateway (`google/gemini-3-flash-preview`) using AI SDK **structured output** (`Output.object` with Zod) to translate the question into a typed query plan:
   ```ts
   {
     sources: ("settings"|"checklist_items"|"equipment_notes"|"pa_notes"|"common_notes"|"photos"|"files")[],
     keywords: string[],              // e.g. ["flow", "débit"]
     equipmentKinds?: ("kiln"|"shs")[],
     lineNumbers?: number[],
     equipmentNameLike?: string,
     componentTypeLike?: string,
     doneFilter?: "any"|"done"|"not_done",
     includeAttachments: boolean
   }
   ```
3. Runs the plan as a small set of `supabase` queries scoped to the project (RLS still applies — read-only).
4. Returns a flat list of normalized result rows:
   ```ts
   {
     id, source, title, body, done?,
     line_number, plant_kind, equipment_name,
     component_type?, component_name?,
     attachments: [{ kind: "photo"|"file", storage_path, file_name? }],
     updated_at
   }
   ```

### UI
- Search bar + scope selector + example chips.
- Results table (TanStack Query, `useSuspenseQuery`) with column toggles.
- Thumbnails via existing `StoragePhoto` component; file links open via Supabase storage signed URLs (same pattern as elsewhere).
- **Export** dropdown:
  - **CSV** — built client-side from the current result rows.
  - **XLSX** — built client-side using `xlsx` (SheetJS) — small dep, no native modules.
  - **PDF** — built client-side with `jspdf` + `jspdf-autotable` (table-style report with project name, question, timestamp, rows).
- Attachments in CSV/XLSX become a comma-separated list of file names + signed URLs; PDF lists them as text under each row.

### Secrets
Needs `LOVABLE_API_KEY` for the AI Gateway. Lovable Cloud auto-provisions it — no action from you. If missing, I'll trigger the enable flow.

### What I won't change
- No DB schema changes.
- No edits to existing checklist/settings pages, RLS, or auth.
- Desktop layout of other pages stays as-is.

## Out of scope (can add later if you want)

- Saving named searches.
- Scheduling exports.
- AI-generated summaries on top of results (easy add — one extra AI call producing a short narrative paragraph above the table).
- Editing data from the results table.

If you approve, I'll implement: header link, route, server function, UI, and the 3 export formats.