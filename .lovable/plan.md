## Add Export button to calendar pages

Add an Export button in the top-right corner of both calendar pages:
- `/p/$projectId/calendar` (global/all-lines calendar)
- `/p/$projectId/lines/$lineNumber/calendar` (per-line calendar)

### Export formats offered
- **PDF** — printable timeline snapshot of the calendar view (landscape, current zoom/date range).
- **XLSX** — structured workbook: one row per activity with line, activity name, start, end, duration, offset, follows, shared flag. For the global calendar, includes a `Line` column.
- **CSV** — same columns as XLSX, single sheet, for spreadsheet/data tools.
- **ICS (suggested addition)** — calendar feed users can import into Google Calendar / Outlook / Apple Calendar, with one VEVENT per activity. Useful for ops teams that already live in their calendar app.

### UI
- Reusable `<ExportMenu />` component (shadcn `DropdownMenu` + `Button` with download icon) placed in the page header's top-right.
- Menu items: PDF, Excel (.xlsx), CSV, Calendar (.ics).
- File name: `{projectName}-calendar[-line{N}]-{YYYY-MM-DD}.{ext}`.

### Implementation
- New `src/components/calendar/ExportMenu.tsx` taking `{ scope: "project" | "line", projectId, lineNumber?, activities, projectName }`.
- New `src/lib/calendar-export.ts` with pure functions: `toCsv()`, `toXlsx()` (using `xlsx` package), `toIcs()`, `toPdf()` (using `jspdf` + `jspdf-autotable` for a table-style export — keeps it dependency-light vs. rasterizing the timeline).
- Wire `<ExportMenu />` into both calendar route files, fed by the activity data they already load.
- Add `xlsx`, `jspdf`, `jspdf-autotable` as dependencies.

### Out of scope
- Pixel-perfect screenshot of the gantt timeline (would require html2canvas; can add later if PDF table view isn't enough).
- Server-side export / scheduled exports.