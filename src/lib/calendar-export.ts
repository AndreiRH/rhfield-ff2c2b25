import { format, differenceInCalendarDays, eachMonthOfInterval, endOfMonth, parseISO } from "date-fns";
import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export interface ExportActivity {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  duration_days?: number | null;
  offset_days?: number | null;
  follows_activity_id?: string | null;
  color?: string;
  line_id?: string;
  is_shared?: boolean;
  sort_order?: number | null;
}

export interface ExportLine {
  id: string;
  number: number;
  name?: string | null;
}

export type ExportFormat = "pdf" | "xlsx" | "csv" | "ics" | "calendar-pdf";

interface BuildOptions {
  activities: ExportActivity[];
  lines?: ExportLine[];
  projectName: string;
  scopeLabel: string;
}

export interface CalendarRange {
  start: Date;
  end: Date;
}

function sortForExport(opts: BuildOptions): ExportActivity[] {
  const lineOrder = new Map<string, number>();
  (opts.lines ?? []).forEach((l, i) => lineOrder.set(l.id, l.number ?? i));
  return [...opts.activities].sort((a, b) => {
    const la = a.line_id ? lineOrder.get(a.line_id) ?? 9999 : 0;
    const lb = b.line_id ? lineOrder.get(b.line_id) ?? 9999 : 0;
    if (la !== lb) return la - lb;
    const sa = a.sort_order ?? 0;
    const sb = b.sort_order ?? 0;
    if (sa !== sb) return sa - sb;
    return a.start_date.localeCompare(b.start_date);
  });
}

function lineLabel(lineId: string | undefined, lines?: ExportLine[]) {
  if (!lineId || !lines) return "";
  const l = lines.find((x) => x.id === lineId);
  if (!l) return "";
  const num = String(l.number).padStart(2, "0");
  return l.name ? `Line ${num} - ${l.name}` : `Line ${num}`;
}

function followsLabel(followsId: string | null | undefined, activities: ExportActivity[]) {
  if (!followsId) return "";
  return activities.find((a) => a.id === followsId)?.name ?? "";
}

function buildRows(opts: BuildOptions) {
  const includeLine = !!opts.lines;
  const headers = [
    ...(includeLine ? ["Line"] : []),
    "Activity",
    "Start",
    "End",
    "Duration (days)",
    "Follows",
    "Offset (days)",
    "Shared",
  ];
  const sorted = sortForExport(opts);
  const rows = sorted.map((a) => [
    ...(includeLine ? [lineLabel(a.line_id, opts.lines)] : []),
    a.name,
    a.start_date,
    a.end_date,
    a.duration_days ?? "",
    followsLabel(a.follows_activity_id, opts.activities),
    a.offset_days ?? "",
    a.is_shared ? "Yes" : "No",
  ]);
  return { headers, rows, sorted };
}

export function fileBase(opts: BuildOptions) {
  const date = format(new Date(), "yyyy-MM-dd");
  const safe = (s: string) => s.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${safe(opts.projectName)}-${safe(opts.scopeLabel)}-calendar-${date}`;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const BOM = "\uFEFF";

export function exportCsv(opts: BuildOptions) {
  const { headers, rows } = buildRows(opts);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = BOM + [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
  download(new Blob([csv], { type: "text/csv;charset=utf-8" }), `${fileBase(opts)}.csv`);
}

export function exportXlsx(opts: BuildOptions) {
  const { headers, rows } = buildRows(opts);
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Calendar");
  XLSX.writeFile(wb, `${fileBase(opts)}.xlsx`);
}

export function exportPdf(opts: BuildOptions) {
  const { headers, rows } = buildRows(opts);
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(14);
  doc.text(`${opts.projectName} - ${opts.scopeLabel} calendar`, 40, 36);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Exported ${format(new Date(), "PPpp")}`, 40, 52);
  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((c) => String(c ?? ""))),
    startY: 64,
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 30, 30] },
  });
  doc.save(`${fileBase(opts)}.pdf`);
}

function icsDate(d: string) {
  return d.replace(/-/g, "");
}
function icsEscape(s: string) {
  return s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
}

export function exportIcs(opts: BuildOptions) {
  const includeLine = !!opts.lines;
  const stamp = format(new Date(), "yyyyMMdd'T'HHmmss");
  const sorted = sortForExport(opts);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lovable//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const a of sorted) {
    const end = new Date(`${a.end_date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const dtend = format(end, "yyyyMMdd");
    const summary = includeLine
      ? `${lineLabel(a.line_id, opts.lines)} - ${a.name}`
      : a.name;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${a.id}@lovable-calendar`,
      `DTSTAMP:${stamp}Z`,
      `DTSTART;VALUE=DATE:${icsDate(a.start_date)}`,
      `DTEND;VALUE=DATE:${dtend}`,
      `SUMMARY:${icsEscape(summary)}`,
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  download(
    new Blob([BOM + lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }),
    `${fileBase(opts)}.ics`,
  );
}

// ---------- Visual calendar PDF (gantt-style) ----------

function hexToRgb(hex?: string): [number, number, number] {
  if (!hex) return [99, 102, 241];
  const m = hex.replace("#", "");
  const full = m.length === 3 ? m.split("").map((c) => c + c).join("") : m;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return [99, 102, 241];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relLuminance([r, g, b]: [number, number, number]) {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function exportCalendarPdf(opts: BuildOptions, range: CalendarRange) {
  const sorted = sortForExport(opts);
  const lines = opts.lines ?? (() => {
    // single line case: synthesize one bucket from scopeLabel
    const id = sorted[0]?.line_id ?? "_";
    return [{ id, number: 1, name: opts.scopeLabel }] as ExportLine[];
  })();

  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 28;
  const marginTop = 28;

  // Title
  doc.setFontSize(13);
  doc.setTextColor(20);
  doc.text(`${opts.projectName} - ${opts.scopeLabel} calendar`, marginX, marginTop);
  doc.setFontSize(8);
  doc.setTextColor(120);
  const rangeLabel = `${format(range.start, "PP")} - ${format(range.end, "PP")}`;
  doc.text(`${rangeLabel}  -  Exported ${format(new Date(), "PPpp")}`, marginX, marginTop + 12);

  // Layout
  const totalDays = Math.max(1, differenceInCalendarDays(range.end, range.start) + 1);
  const labelW = 70;
  const headerYearH = 14;
  const headerMonthH = 14;
  const headerWeekdayH = dayW >= 6 ? 9 : 0;
  const headerDayH = 12;
  const headerH = headerYearH + headerMonthH + headerWeekdayH + headerDayH;
  const rowH = 18;
  const barH = 12;

  const gridLeft = marginX + labelW;
  const gridTop = marginTop + 30;
  const gridRight = pageW - marginX;
  const gridW = gridRight - gridLeft;
  const dayToX = (d: Date) =>
    gridLeft + differenceInCalendarDays(d, range.start) * dayW;

  // Precompute days
  const days: Date[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(range.start);
    d.setDate(d.getDate() + i);
    days.push(d);
  }

  // Per-line lane packing + row layout (compute first so we know body height)
  type Placed = ExportActivity & { lane: number };
  const linePacks = new Map<string, { lanes: number; placed: Placed[] }>();
  for (const l of lines) {
    const acts = sorted.filter((a) => a.line_id === l.id);
    const laneEnds: string[] = [];
    const placed: Placed[] = [];
    for (const a of acts) {
      let lane = laneEnds.findIndex((e) => e < a.start_date);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(a.end_date);
      } else laneEnds[lane] = a.end_date;
      placed.push({ ...a, lane });
    }
    linePacks.set(l.id, { lanes: Math.max(1, laneEnds.length), placed });
  }

  const months = eachMonthOfInterval({ start: range.start, end: range.end });
  const yearMap = new Map<number, { s: Date; e: Date }>();
  for (const m of months) {
    const y = m.getFullYear();
    const ms = m < range.start ? range.start : m;
    const me = endOfMonth(m) > range.end ? range.end : endOfMonth(m);
    if (!yearMap.has(y)) yearMap.set(y, { s: ms, e: me });
    else yearMap.get(y)!.e = me;
  }

  const drawHeader = (top: number) => {
    doc.setDrawColor(200);
    doc.setLineWidth(0.5);
    doc.setFillColor(245, 245, 247);
    doc.rect(gridLeft, top, gridW, headerH, "F");

    // Years
    doc.setTextColor(40);
    doc.setFontSize(8);
    for (const [year, { s, e }] of yearMap.entries()) {
      const x = dayToX(s);
      const w = (differenceInCalendarDays(e, s) + 1) * dayW;
      doc.rect(x, top, w, headerYearH, "S");
      doc.text(String(year), x + w / 2, top + 10, { align: "center" });
    }
    // Months
    doc.setFontSize(7);
    for (const m of months) {
      const ms = m < range.start ? range.start : m;
      const me = endOfMonth(m) > range.end ? range.end : endOfMonth(m);
      const x = dayToX(ms);
      const w = (differenceInCalendarDays(me, ms) + 1) * dayW;
      doc.rect(x, top + headerYearH, w, headerMonthH, "S");
      if (w > 14) doc.text(format(m, "MMM"), x + w / 2, top + headerYearH + 10, { align: "center" });
    }
    // Weekday letters band
    const wdTop = top + headerYearH + headerMonthH;
    const dayTop = wdTop + headerWeekdayH;
    if (headerWeekdayH > 0) {
      const letters = ["S", "M", "T", "W", "T", "F", "S"];
      doc.setFontSize(5.5);
      for (const d of days) {
        const dow = d.getDay();
        const x = dayToX(d);
        if (dow === 0 || dow === 6) {
          doc.setFillColor(232, 234, 240);
          doc.rect(x, wdTop, dayW, headerWeekdayH, "F");
          doc.setTextColor(80, 95, 140);
        } else {
          doc.setTextColor(120);
        }
        if (dayW >= 5) doc.text(letters[dow], x + dayW / 2, wdTop + 6.5, { align: "center" });
      }
    }
    // Day numbers
    if (dayW >= 8) {
      doc.setFontSize(5.5);
      for (const d of days) {
        const dow = d.getDay();
        const x = dayToX(d);
        if (dow === 0 || dow === 6) {
          doc.setFillColor(238, 240, 246);
          doc.rect(x, dayTop, dayW, headerDayH, "F");
          doc.setTextColor(80);
        } else {
          doc.setTextColor(110);
        }
        doc.text(String(d.getDate()), x + dayW / 2, dayTop + 8, { align: "center" });
      }
    } else {
      doc.setFontSize(5.5);
      doc.setTextColor(110);
      for (const m of months) {
        const ms = m < range.start ? range.start : m;
        const x = dayToX(ms);
        doc.text("1", x + 2, dayTop + 8);
      }
    }
  };

  drawHeader(gridTop);

  // Rows
  let y = gridTop + headerH;
  const rowStartY = y;
  doc.setFontSize(7);
  for (const l of lines) {
    const pack = linePacks.get(l.id) ?? { lanes: 1, placed: [] as Placed[] };
    const lineRowH = pack.lanes * rowH;

    if (y + lineRowH > pageH - 24) {
      // Overflow: new page with re-drawn headers
      doc.addPage();
      drawHeader(marginTop);
      y = marginTop + headerH;
    }

    // Label background
    doc.setFillColor(252, 252, 253);
    doc.rect(marginX, y, labelW, lineRowH, "F");
    doc.setDrawColor(220);
    doc.rect(marginX, y, labelW, lineRowH, "S");
    doc.setTextColor(60);
    doc.setFontSize(8);
    doc.text(`Line ${String(l.number).padStart(2, "0")}`, marginX + 4, y + 11);

    // Grid background per line
    doc.setFillColor(255, 255, 255);
    doc.rect(gridLeft, y, gridW, lineRowH, "F");

    // Weekend column shading inside body row
    for (const d of days) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) continue;
      doc.setFillColor(243, 245, 250);
      doc.rect(dayToX(d), y, dayW, lineRowH, "F");
    }

    // Month separators
    doc.setDrawColor(220);
    doc.setLineWidth(0.3);
    for (const m of months) {
      const x = dayToX(m < range.start ? range.start : m);
      doc.line(x, y, x, y + lineRowH);
    }

    // Weekly (Monday) vertical lines
    doc.setDrawColor(190);
    doc.setLineWidth(0.2);
    for (const d of days) {
      if (d.getDay() !== 1) continue;
      const x = dayToX(d);
      doc.line(x, y, x, y + lineRowH);
    }

    // Row border
    doc.setDrawColor(235);
    doc.setLineWidth(0.4);
    doc.rect(gridLeft, y, gridW, lineRowH, "S");

    // Bars
    for (const a of pack.placed) {
      const s = parseISO(a.start_date);
      const e = parseISO(a.end_date);
      if (e < range.start || s > range.end) continue;
      const cs = s < range.start ? range.start : s;
      const ce = e > range.end ? range.end : e;
      const bx = dayToX(cs);
      const bw = Math.max(2, (differenceInCalendarDays(ce, cs) + 1) * dayW);
      const by = y + a.lane * rowH + (rowH - barH) / 2;
      const [r, g, b] = hexToRgb(a.color);
      doc.setFillColor(r, g, b);
      doc.setDrawColor(Math.max(0, r - 40), Math.max(0, g - 40), Math.max(0, b - 40));
      doc.setLineWidth(0.3);
      doc.roundedRect(bx, by, bw, barH, 2, 2, "FD");

      const text = a.name;
      const textColor = relLuminance([r, g, b]) > 0.5 ? 20 : 245;
      doc.setTextColor(textColor);
      doc.setFontSize(6.5);
      const maxTextW = bw - 4;
      if (maxTextW > 10) {
        const lines2 = doc.splitTextToSize(text, maxTextW);
        doc.text(String(lines2[0]), bx + 3, by + barH / 2 + 2);
      } else {
        doc.setTextColor(60);
        doc.text(text, bx + bw + 2, by + barH / 2 + 2);
      }
    }

    y += lineRowH;
  }

  // Weekly Monday lines through the header day band to tie header to body
  doc.setDrawColor(180);
  doc.setLineWidth(0.2);
  const wkTop = gridTop + headerYearH + headerMonthH;
  for (const d of days) {
    if (d.getDay() !== 1) continue;
    const x = dayToX(d);
    doc.line(x, wkTop, x, rowStartY);
  }

  doc.save(`${fileBase(opts)}-view.pdf`);
}

export function runExport(fmt: ExportFormat, opts: BuildOptions, range?: CalendarRange) {
  switch (fmt) {
    case "csv":
      return exportCsv(opts);
    case "xlsx":
      return exportXlsx(opts);
    case "pdf":
      return exportPdf(opts);
    case "ics":
      return exportIcs(opts);
    case "calendar-pdf":
      if (!range) throw new Error("Calendar PDF export requires a date range");
      return exportCalendarPdf(opts, range);
  }
}
