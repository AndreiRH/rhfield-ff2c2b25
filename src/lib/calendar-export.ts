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

export type ExportFormat = "pdf" | "xlsx" | "csv" | "ics";

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

// ---------- Color helpers ----------

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

// ---------- ICS ----------

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
  const out = [
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
    out.push(
      "BEGIN:VEVENT",
      `UID:${a.id}@lovable-calendar`,
      `DTSTAMP:${stamp}Z`,
      `DTSTART;VALUE=DATE:${icsDate(a.start_date)}`,
      `DTEND;VALUE=DATE:${dtend}`,
      `SUMMARY:${icsEscape(summary)}`,
      "END:VEVENT",
    );
  }
  out.push("END:VCALENDAR");
  download(
    new Blob([BOM + out.join("\r\n")], { type: "text/calendar;charset=utf-8" }),
    `${fileBase(opts)}.ics`,
  );
}

// ---------- Calendar gantt helpers ----------

function buildCalendarDays(range: CalendarRange): Date[] {
  const totalDays = Math.max(1, differenceInCalendarDays(range.end, range.start) + 1);
  const out: Date[] = [];
  for (let i = 0; i < totalDays; i++) {
    const d = new Date(range.start);
    d.setDate(d.getDate() + i);
    out.push(d);
  }
  return out;
}

function groupByLine(opts: BuildOptions) {
  const sorted = sortForExport(opts);
  const lines = opts.lines ?? [];
  const byLine = new Map<string, ExportActivity[]>();
  for (const a of sorted) {
    const key = a.line_id ?? "_";
    if (!byLine.has(key)) byLine.set(key, []);
    byLine.get(key)!.push(a);
  }
  const ordered: { line?: ExportLine; activities: ExportActivity[] }[] = [];
  if (lines.length > 0) {
    for (const l of lines) {
      ordered.push({ line: l, activities: byLine.get(l.id) ?? [] });
    }
  } else {
    ordered.push({ activities: sorted });
  }
  return ordered;
}

// ---------- Combined PDF ----------

export function exportPdf(opts: BuildOptions, range: CalendarRange) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const marginX = 32;
  const marginTop = 32;

  const drawTitle = (subtitle: string) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(20);
    doc.text(`${opts.projectName} - ${opts.scopeLabel}`, marginX, marginTop);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(110);
    doc.text(subtitle, marginX, marginTop + 14);
  };

  // ===== Section 1: Calendar view =====
  const rangeLabel = `${format(range.start, "PP")} - ${format(range.end, "PP")}`;
  drawTitle(`Calendar view - ${rangeLabel}`);
  const ganttEndY = drawGantt(doc, opts, range, {
    marginX,
    top: marginTop + 28,
    pageH,
    pageW,
  });

  // ===== Section 2: Activity list (all activities) =====
  const { headers, rows } = buildRows(opts);
  let listTop = ganttEndY + 24;
  if (listTop > pageH - 80) {
    doc.addPage();
    listTop = marginTop;
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(`Activities - Exported ${format(new Date(), "PPpp")}`, marginX, listTop);

  autoTable(doc, {
    head: [headers],
    body: rows.map((r) => r.map((c) => String(c ?? ""))),
    startY: listTop + 14,
    margin: { left: marginX, right: marginX },
    styles: { fontSize: 8, cellPadding: 5, font: "helvetica", textColor: 40, lineColor: 220, lineWidth: 0.3 },
    headStyles: { fillColor: [40, 44, 60], textColor: 255, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [248, 249, 252] },
  });

  doc.save(`${fileBase(opts)}.pdf`);
}

function drawGantt(
  doc: jsPDF,
  opts: BuildOptions,
  range: CalendarRange,
  layout: { marginX: number; top: number; pageH: number; pageW: number },
) {
  const sorted = sortForExport(opts);
  const lines = opts.lines ?? (() => {
    const id = sorted[0]?.line_id ?? "_";
    return [{ id, number: 1, name: opts.scopeLabel }] as ExportLine[];
  })();

  const { marginX, pageH, pageW } = layout;
  const totalDays = Math.max(1, differenceInCalendarDays(range.end, range.start) + 1);
  const labelW = 80;
  const gridLeft = marginX + labelW;
  const gridRight = pageW - marginX;
  const gridW = gridRight - gridLeft;
  const dayW = gridW / totalDays;
  const headerYearH = 14;
  const headerMonthH = 14;
  const headerWeekdayH = dayW >= 6 ? 10 : 0;
  const headerDayH = 12;
  const headerH = headerYearH + headerMonthH + headerWeekdayH + headerDayH;
  const rowH = 18;
  const barH = 12;
  const dayToX = (d: Date) =>
    gridLeft + differenceInCalendarDays(d, range.start) * dayW;

  const days: Date[] = buildCalendarDays(range);

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
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(210);
    doc.setLineWidth(0.4);
    doc.setFillColor(244, 245, 248);
    doc.rect(gridLeft, top, gridW, headerH, "F");

    // Label column header
    doc.setFillColor(40, 44, 60);
    doc.rect(marginX, top, labelW, headerH, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Line", marginX + 6, top + headerH / 2 + 3);
    doc.setFont("helvetica", "normal");

    // Years
    doc.setTextColor(40);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    for (const [year, { s, e }] of yearMap.entries()) {
      const x = dayToX(s);
      const w = (differenceInCalendarDays(e, s) + 1) * dayW;
      doc.rect(x, top, w, headerYearH, "S");
      doc.text(String(year), x + w / 2, top + 10, { align: "center" });
    }
    // Months
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    for (const m of months) {
      const ms = m < range.start ? range.start : m;
      const me = endOfMonth(m) > range.end ? range.end : endOfMonth(m);
      const x = dayToX(ms);
      const w = (differenceInCalendarDays(me, ms) + 1) * dayW;
      doc.rect(x, top + headerYearH, w, headerMonthH, "S");
      if (w > 14) doc.text(format(m, "MMM"), x + w / 2, top + headerYearH + 10, { align: "center" });
    }
    const wdTop = top + headerYearH + headerMonthH;
    const dayTop = wdTop + headerWeekdayH;
    if (headerWeekdayH > 0) {
      const letters = ["S", "M", "T", "W", "T", "F", "S"];
      doc.setFontSize(6);
      for (const d of days) {
        const dow = d.getDay();
        const x = dayToX(d);
        if (dow === 0 || dow === 6) {
          doc.setFillColor(228, 232, 240);
          doc.rect(x, wdTop, dayW, headerWeekdayH, "F");
          doc.setTextColor(70, 90, 140);
        } else {
          doc.setTextColor(120);
        }
        if (dayW >= 5) doc.text(letters[dow], x + dayW / 2, wdTop + 7, { align: "center" });
      }
    }
    if (dayW >= 8) {
      doc.setFontSize(6);
      for (const d of days) {
        const dow = d.getDay();
        const x = dayToX(d);
        if (dow === 0 || dow === 6) {
          doc.setFillColor(234, 238, 246);
          doc.rect(x, dayTop, dayW, headerDayH, "F");
          doc.setTextColor(70);
        } else {
          doc.setTextColor(110);
        }
        doc.text(String(d.getDate()), x + dayW / 2, dayTop + 8, { align: "center" });
      }
    }
    doc.setDrawColor(210);
    doc.setLineWidth(0.4);
    doc.rect(gridLeft, top, gridW, headerH, "S");
  };

  drawHeader(layout.top);
  let y = layout.top + headerH;
  const firstRowY = y;

  for (const l of lines) {
    const pack = linePacks.get(l.id) ?? { lanes: 1, placed: [] as Placed[] };
    const lineRowH = pack.lanes * rowH;

    if (y + lineRowH > pageH - 28) {
      doc.addPage();
      drawHeader(layout.top);
      y = layout.top + headerH;
    }

    // Label
    doc.setFillColor(250, 250, 252);
    doc.rect(marginX, y, labelW, lineRowH, "F");
    doc.setDrawColor(220);
    doc.rect(marginX, y, labelW, lineRowH, "S");
    doc.setTextColor(40);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(`Line ${String(l.number).padStart(2, "0")}`, marginX + 6, y + 11);
    if (l.name) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7);
      doc.setTextColor(110);
      const sub = doc.splitTextToSize(l.name, labelW - 12)[0];
      doc.text(String(sub), marginX + 6, y + 22);
    }

    // Grid body background
    doc.setFillColor(255, 255, 255);
    doc.rect(gridLeft, y, gridW, lineRowH, "F");

    // Weekend shading
    for (const d of days) {
      const dow = d.getDay();
      if (dow !== 0 && dow !== 6) continue;
      doc.setFillColor(243, 246, 251);
      doc.rect(dayToX(d), y, dayW, lineRowH, "F");
    }

    // Month separators
    doc.setDrawColor(220);
    doc.setLineWidth(0.3);
    for (const m of months) {
      const x = dayToX(m < range.start ? range.start : m);
      doc.line(x, y, x, y + lineRowH);
    }

    // Weekly Monday lines
    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    for (const d of days) {
      if (d.getDay() !== 1) continue;
      const x = dayToX(d);
      doc.line(x, y, x, y + lineRowH);
    }

    doc.setDrawColor(225);
    doc.setLineWidth(0.4);
    doc.rect(gridLeft, y, gridW, lineRowH, "S");

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
      const textColor = relLuminance([r, g, b]) > 0.5 ? 20 : 245;
      doc.setTextColor(textColor);
      doc.setFontSize(6.5);
      const maxTextW = bw - 4;
      if (maxTextW > 10) {
        const lines2 = doc.splitTextToSize(a.name, maxTextW);
        doc.text(String(lines2[0]), bx + 3, by + barH / 2 + 2);
      } else {
        doc.setTextColor(60);
        doc.text(a.name, bx + bw + 2, by + barH / 2 + 2);
      }
    }

    y += lineRowH;
  }

  // Header-to-body weekly lines
  doc.setDrawColor(180);
  doc.setLineWidth(0.2);
  const wkTop = layout.top + headerYearH + headerMonthH;
  for (const d of days) {
    if (d.getDay() !== 1) continue;
    const x = dayToX(d);
    doc.line(x, wkTop, x, firstRowY);
  }
  return y;
}

// ---------- Combined Excel ----------

export async function exportXlsx(opts: BuildOptions, range: CalendarRange) {
  const XLSXStyle = (await import("xlsx-js-style")).default;
  const wb = XLSXStyle.utils.book_new();

  // ===== Sheet 1: Activities (full list) =====
  const { headers, rows } = buildRows(opts);
  const listAoa: (string | number)[][] = [headers, ...rows.map((r) => r.map((c) => (c ?? "") as string | number))];
  const wsList = XLSXStyle.utils.aoa_to_sheet(listAoa);

  const borderThin = { style: "thin", color: { rgb: "DDDDDD" } };
  const fullBorder = { top: borderThin, bottom: borderThin, left: borderThin, right: borderThin };
  const headFill = { patternType: "solid", fgColor: { rgb: "282C3C" } };
  const altFill = { patternType: "solid", fgColor: { rgb: "F8F9FC" } };

  for (let c = 0; c < headers.length; c++) {
    const ref = XLSXStyle.utils.encode_cell({ r: 0, c });
    const cell = wsList[ref] ?? { v: headers[c], t: "s" };
    cell.s = {
      font: { sz: 10, bold: true, color: { rgb: "FFFFFF" } },
      fill: headFill,
      alignment: { vertical: "center", horizontal: "left" },
      border: fullBorder,
    };
    wsList[ref] = cell;
  }
  for (let r = 1; r <= rows.length; r++) {
    for (let c = 0; c < headers.length; c++) {
      const ref = XLSXStyle.utils.encode_cell({ r, c });
      const cell = wsList[ref] ?? { v: "", t: "s" };
      cell.s = {
        font: { sz: 9 },
        fill: r % 2 === 0 ? altFill : { patternType: "solid", fgColor: { rgb: "FFFFFF" } },
        alignment: { vertical: "center" },
        border: fullBorder,
      };
      wsList[ref] = cell;
    }
  }
  wsList["!cols"] = headers.map((h) => ({
    wch: h === "Activity" || h === "Follows" || h === "Line" ? 26 : 14,
  }));
  (wsList as Record<string, unknown>)["!sheetView"] = [{ state: "frozen", ySplit: 1 }];
  XLSXStyle.utils.book_append_sheet(wb, wsList, "Activities");

  // ===== Sheet 2: Calendar (gantt grid for range) =====
  const days = buildCalendarDays(range);
  const grouped = groupByLine(opts);
  const LEFT = ["Line", "Activity", "Start", "End", "Days"];
  const leftCols = LEFT.length;

  const aoa: (string | number | null)[][] = [];
  aoa.push([...LEFT.map(() => ""), ...days.map((d) => d.getFullYear())]);
  aoa.push([...LEFT.map(() => ""), ...days.map((d) => format(d, "MMM"))]);
  aoa.push([...LEFT.map(() => ""), ...days.map((d) => d.getDate())]);
  aoa.push([...LEFT, ...days.map((d) => ["S", "M", "T", "W", "T", "F", "S"][d.getDay()])]);

  const flat: { line?: ExportLine; activity: ExportActivity }[] = [];
  for (const g of grouped) for (const a of g.activities) flat.push({ line: g.line, activity: a });

  for (const { line, activity } of flat) {
    const lineLabelText = line
      ? `Line ${String(line.number).padStart(2, "0")}${line.name ? ` - ${line.name}` : ""}`
      : "";
    const dataRow: (string | number | null)[] = [
      lineLabelText,
      activity.name,
      activity.start_date,
      activity.end_date,
      activity.duration_days ?? "",
    ];
    const s = parseISO(activity.start_date);
    const e = parseISO(activity.end_date);
    const inRange = !(e < range.start || s > range.end);
    if (!inRange) {
      for (let i = 0; i < days.length; i++) dataRow.push(null);
    } else {
      const cs = s < range.start ? range.start : s;
      const ce = e > range.end ? range.end : e;
      const startIdx = differenceInCalendarDays(cs, range.start);
      const endIdx = differenceInCalendarDays(ce, range.start);
      for (let i = 0; i < days.length; i++) {
        dataRow.push(i >= startIdx && i <= endIdx ? "" : null);
      }
    }
    aoa.push(dataRow);
  }

  const ws = XLSXStyle.utils.aoa_to_sheet(aoa);
  const weekendFill = { patternType: "solid", fgColor: { rgb: "E8EAF0" } };
  const ganttHeadFill = { patternType: "solid", fgColor: { rgb: "F4F4F7" } };
  const labelHeadFill = { patternType: "solid", fgColor: { rgb: "282C3C" } };

  const cellRef = (r: number, c: number) => XLSXStyle.utils.encode_cell({ r, c });

  for (let c = 0; c < leftCols + days.length; c++) {
    for (let r = 0; r < 4; r++) {
      const ref = cellRef(r, c);
      const cell = ws[ref] ?? { v: "", t: "s" };
      const isDayCol = c >= leftCols;
      const isWeekend = isDayCol && (days[c - leftCols].getDay() === 0 || days[c - leftCols].getDay() === 6);
      const isLabelHeader = !isDayCol && r === 3;
      cell.s = {
        font: isLabelHeader
          ? { sz: 9, bold: true, color: { rgb: "FFFFFF" } }
          : { sz: 9, bold: r === 0, color: { rgb: "333333" } },
        alignment: { horizontal: isLabelHeader ? "left" : "center", vertical: "center" },
        fill: isLabelHeader ? labelHeadFill : isWeekend ? weekendFill : ganttHeadFill,
        border: fullBorder,
      };
      ws[ref] = cell;
    }
  }

  for (let i = 0; i < flat.length; i++) {
    const r = 4 + i;
    const { activity } = flat[i];
    const colorHex = (activity.color ?? "#6366F1").replace("#", "").toUpperCase().padEnd(6, "0").slice(0, 6);
    const [rr, gg, bb] = hexToRgb(`#${colorHex}`);
    const textRgb = relLuminance([rr, gg, bb]) > 0.5 ? "1A1A1A" : "FFFFFF";
    const altRowFill = i % 2 === 1 ? altFill : { patternType: "solid", fgColor: { rgb: "FFFFFF" } };

    for (let c = 0; c < leftCols; c++) {
      const ref = cellRef(r, c);
      const cell = ws[ref] ?? { v: "", t: "s" };
      cell.s = { font: { sz: 9 }, alignment: { vertical: "center" }, fill: altRowFill, border: fullBorder };
      ws[ref] = cell;
    }
    for (let c = leftCols; c < leftCols + days.length; c++) {
      const day = days[c - leftCols];
      const isWeekend = day.getDay() === 0 || day.getDay() === 6;
      const ref = cellRef(r, c);
      const cell = ws[ref] ?? { v: null, t: "z" };
      const filled = cell.v === "";
      cell.v = "";
      cell.t = "s";
      cell.s = filled
        ? {
            fill: { patternType: "solid", fgColor: { rgb: colorHex } },
            font: { sz: 8, color: { rgb: textRgb } },
            alignment: { horizontal: "center", vertical: "center" },
            border: fullBorder,
          }
        : {
            fill: isWeekend ? weekendFill : altRowFill,
            border: fullBorder,
          };
      ws[ref] = cell;
    }
  }

  ws["!cols"] = [
    { wch: 18 },
    { wch: 28 },
    { wch: 11 },
    { wch: 11 },
    { wch: 6 },
    ...days.map(() => ({ wch: 3 })),
  ];
  (ws as Record<string, unknown>)["!sheetView"] = [
    { state: "frozen", xSplit: leftCols, ySplit: 4 },
  ];
  ws["!ref"] = XLSXStyle.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: 3 + flat.length, c: leftCols + days.length - 1 },
  });

  XLSXStyle.utils.book_append_sheet(wb, ws, "Calendar");
  XLSXStyle.writeFile(wb, `${fileBase(opts)}.xlsx`);
}

// ---------- Combined CSV ----------

export function exportCsv(opts: BuildOptions, range: CalendarRange) {
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const out: string[] = [];

  // Section 1: Activities
  out.push(`# ${opts.projectName} - ${opts.scopeLabel}`);
  out.push(`# Section: Activities (full list)`);
  out.push("");
  const { headers, rows } = buildRows(opts);
  out.push(headers.map(escape).join(","));
  for (const r of rows) out.push(r.map(escape).join(","));

  out.push("");
  out.push("");
  out.push(`# Section: Calendar view (${format(range.start, "yyyy-MM-dd")} to ${format(range.end, "yyyy-MM-dd")})`);
  out.push("");

  // Section 2: Calendar grid
  const days = buildCalendarDays(range);
  const grouped = groupByLine(opts);
  const LEFT = ["Line", "Activity", "Start", "End", "Days"];
  const pad = LEFT.map(() => "");
  out.push([...pad, ...days.map((d) => String(d.getFullYear()))].map(escape).join(","));
  out.push([...pad, ...days.map((d) => format(d, "MMM"))].map(escape).join(","));
  out.push([...pad, ...days.map((d) => String(d.getDate()))].map(escape).join(","));
  out.push([...LEFT, ...days.map((d) => ["S", "M", "T", "W", "T", "F", "S"][d.getDay()])].map(escape).join(","));

  for (const g of grouped) {
    for (const activity of g.activities) {
      const lineLabelText = g.line
        ? `Line ${String(g.line.number).padStart(2, "0")}${g.line.name ? ` - ${g.line.name}` : ""}`
        : "";
      const left = [
        lineLabelText,
        activity.name,
        activity.start_date,
        activity.end_date,
        activity.duration_days ?? "",
      ];
      const s = parseISO(activity.start_date);
      const e = parseISO(activity.end_date);
      const cells: string[] = [];
      if (e < range.start || s > range.end) {
        for (let i = 0; i < days.length; i++) cells.push("");
      } else {
        const cs = s < range.start ? range.start : s;
        const ce = e > range.end ? range.end : e;
        const startIdx = differenceInCalendarDays(cs, range.start);
        const endIdx = differenceInCalendarDays(ce, range.start);
        const span = endIdx - startIdx + 1;
        const text = activity.name;
        for (let i = 0; i < days.length; i++) {
          if (i < startIdx || i > endIdx) cells.push("");
          else if (span >= text.length) {
            const local = i - startIdx;
            cells.push(local < text.length ? text[local] : "");
          } else cells.push("X");
        }
      }
      out.push([...left, ...cells].map(escape).join(","));
    }
  }

  download(
    new Blob([BOM + out.join("\n")], { type: "text/csv;charset=utf-8" }),
    `${fileBase(opts)}.csv`,
  );
}

// ---------- Dispatcher ----------

export function runExport(fmt: ExportFormat, opts: BuildOptions, range?: CalendarRange) {
  switch (fmt) {
    case "ics":
      return exportIcs(opts);
    case "pdf":
      if (!range) throw new Error("PDF export requires a date range");
      return exportPdf(opts, range);
    case "xlsx":
      if (!range) throw new Error("Excel export requires a date range");
      return exportXlsx(opts, range);
    case "csv":
      if (!range) throw new Error("CSV export requires a date range");
      return exportCsv(opts, range);
  }
}
