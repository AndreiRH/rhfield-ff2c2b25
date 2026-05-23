## Calendar-view export in PDF, Excel, CSV, and ICS

Extend the existing "Calendar view" export so it isn't PDF-only. The date-range dialog stays the same (current view vs. custom dates); after picking the range the user also picks a format.

### UI changes (`src/components/calendar/ExportMenu.tsx`)

- Keep the single "Calendar view…" menu item.
- The existing dialog gains a second control: format radio group — **PDF**, **Excel (.xlsx)**, **CSV**, **Calendar feed (.ics)**.
- "Export" button calls `runExport(chosenFormat, opts, range)`.

### Library changes (`src/lib/calendar-export.ts`)

Add three new functions and route them through `runExport`:

- `exportCalendarXlsx(opts, range)` — gantt-style spreadsheet.
- `exportCalendarCsv(opts, range)` — same grid, plain text.
- `exportCalendarIcs(opts, range)` — same as existing `exportIcs` but only events overlapping `range`.

Spreadsheet/CSV layout (one row per activity, grouped by line and ordered by planner sort):

```
| Line | Activity | Start | End | Days | 2026 | 2026 | ... (year row)
|      |          |       |     |      | Jan  | Jan  | ... (month row)
|      |          |       |     |      | 1    | 2    | ... (day row)
|      |          |       |     |      | T    | F    | ... (weekday letters)
| L01  | Heating  | ...   | ... | 5    |  X   |  X   | ... (span cells)
```

XLSX specifics (using `xlsx` package):
- Freeze top 4 header rows and the 5 left columns.
- Fill each span cell with the activity color (`s.fill.fgColor.rgb = "RRGGBB"`); contrast-aware white/black "X" or activity name initial.
- Weekend day columns get a light gray fill on header + empty cells.
- Set narrow column width (~3) for day columns, normal width for left columns.
- One workbook sheet, named "Calendar".

CSV specifics:
- Same row/column shape, BOM + UTF-8.
- Span cells contain the activity name (truncated to the column count for that activity); empty otherwise.
- No coloring (CSV has no styling).

ICS specifics:
- Same VEVENT format as the existing list-export, but only activities where `end_date >= range.start && start_date <= range.end`.

### Format guardrail

If the chosen range × line count would produce more than ~5,000 day columns or rows, show a small inline warning in the dialog ("Range is very wide; the spreadsheet may be slow to open") but still allow export.

### Files touched

- `src/lib/calendar-export.ts` — add `exportCalendarXlsx`, `exportCalendarCsv`, `exportCalendarIcs`; extend `runExport` switch.
- `src/components/calendar/ExportMenu.tsx` — add format radio inside the calendar-view dialog; route to selected format.

### Out of scope

- A separate sheet per line.
- Conditional formatting / Excel formulas.
- Pixel-matching the on-screen gantt in Excel (cells are uniform width).
