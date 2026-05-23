## Three fixes to the calendar export

### 1. Garbled characters ("â€“")

Cause: the en-dash in labels like `Line 01 – Line 1` is UTF-8 bytes, but Excel opens CSV as Windows-1252 unless the file starts with a UTF-8 BOM.

Fix in `src/lib/calendar-export.ts`:
- Prepend `\uFEFF` to the CSV string before wrapping in the Blob.
- Also prepend BOM to the `.ics` blob (some Outlook builds misread non-ASCII without it).
- XLSX/PDF already handle Unicode internally — no change needed there.

### 2. Random row order in CSV/XLSX/PDF/ICS

Cause: the global page fetches activities with only `.order("start_date")`, losing per-line planner order, and `buildRows` then iterates whatever order it received.

Fix:
- In `src/routes/p.$projectId.calendar.tsx`, change the `exportActivities` query to also select `sort_order` and order by `sort_order` then `start_date` (matches the per-line planner).
- In `src/lib/calendar-export.ts`, before building rows, sort activities by:
  1. Line number (resolved from `lines` prop when present, otherwise leave as-is)
  2. existing array order within the line (stable sort)
- Apply the same sort to the ICS event loop.

Result: Line 01 activities first (in planner order), then Line 02, etc., never interleaved.

### 3. New "Calendar view (PDF)" export with date-range prompt

Add a fifth menu item **"Calendar view (PDF)"** to `ExportMenu` that produces a visual gantt page (month/year header, day grid, colored bars with activity names) rather than a table.

Flow:
- Clicking the item opens a small dialog asking:
  - Radio: **Current view** (default) vs **Custom date range**
  - When "Custom" is picked: two date inputs (start, end).
- "Current view" uses the date range currently visible in the gantt scroll container; "Custom" uses the picked dates.
- Generates a landscape PDF with `jsPDF` using vector drawing:
  - Top band: year row + month row spanning the chosen range.
  - Left column: `Line 01`, `Line 02`, … (or single line on the per-line page).
  - Body: one row per line, colored rectangles per activity (clipped to range), activity name drawn inside the bar when it fits, otherwise to the right.
  - Footer with project name + export timestamp.

### Wiring the "current view" range

- `CombinedGantt` (global page) and the per-line `ActivityPlanner` both own the horizontal scroll container. Expose the visible date range up to the page via a ref callback:
  - New prop `onVisibleRangeChange?: (range: { start: Date; end: Date }) => void` updated on scroll/resize.
  - Page stores the latest range in state and passes `getCurrentRange={() => range}` to `ExportMenu`.
- For the per-line calendar page, do the equivalent in `ActivityPlanner` (smallest possible surface — just publish the range, no other changes).

### New files / edits

- `src/lib/calendar-export.ts` — BOM, sort helper, new `exportCalendarPdf(opts, range)` function, extend `runExport` to accept `"calendar-pdf"` plus a `range` arg.
- `src/components/calendar/ExportMenu.tsx` — add the new menu item, add a shadcn `Dialog` for the range prompt, accept `getCurrentRange` prop.
- `src/routes/p.$projectId.calendar.tsx` — fetch `sort_order`, track visible range from `CombinedGantt`, pass `getCurrentRange`.
- `src/routes/p.$projectId.lines.$lineNumber.calendar.tsx` — track visible range from `ActivityPlanner`, pass `getCurrentRange`.
- `src/components/ActivityPlanner.tsx` — emit visible range via new optional callback (no behavior change otherwise).

### Out of scope

- Exact pixel match to the on-screen gantt (fonts/spacing in jsPDF will differ slightly).
- Rendering follows-arrows between bars in the PDF.
- Multi-page wrapping when the chosen range is extremely wide — will fit-to-page by scaling day width; if the user wants pagination, that's a follow-up.
