import { format } from "date-fns";
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
}

export interface ExportLine {
  id: string;
  number: number;
  name?: string | null;
}

export type ExportFormat = "pdf" | "xlsx" | "csv" | "ics";

interface BuildOptions {
  activities: ExportActivity[];
  lines?: ExportLine[]; // when present, includes Line column
  projectName: string;
  scopeLabel: string; // e.g. "Global" or "Line 01"
}

function lineLabel(lineId: string | undefined, lines?: ExportLine[]) {
  if (!lineId || !lines) return "";
  const l = lines.find((x) => x.id === lineId);
  if (!l) return "";
  const num = String(l.number).padStart(2, "0");
  return l.name ? `Line ${num} – ${l.name}` : `Line ${num}`;
}

function followsLabel(
  followsId: string | null | undefined,
  activities: ExportActivity[],
) {
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
  const rows = opts.activities.map((a) => [
    ...(includeLine ? [lineLabel(a.line_id, opts.lines)] : []),
    a.name,
    a.start_date,
    a.end_date,
    a.duration_days ?? "",
    followsLabel(a.follows_activity_id, opts.activities),
    a.offset_days ?? "",
    a.is_shared ? "Yes" : "No",
  ]);
  return { headers, rows };
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

export function exportCsv(opts: BuildOptions) {
  const { headers, rows } = buildRows(opts);
  const escape = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [headers, ...rows].map((r) => r.map(escape).join(",")).join("\n");
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
  doc.text(`${opts.projectName} — ${opts.scopeLabel} calendar`, 40, 36);
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
  // d is YYYY-MM-DD → ICS DATE value
  return d.replace(/-/g, "");
}
function icsEscape(s: string) {
  return s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, "\\n");
}

export function exportIcs(opts: BuildOptions) {
  const includeLine = !!opts.lines;
  const stamp = format(new Date(), "yyyyMMdd'T'HHmmss");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Lovable//Calendar Export//EN",
    "CALSCALE:GREGORIAN",
  ];
  for (const a of opts.activities) {
    // DTEND in VEVENT (DATE) is exclusive — add 1 day to end_date
    const end = new Date(`${a.end_date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    const dtend = format(end, "yyyyMMdd");
    const summary = includeLine
      ? `${lineLabel(a.line_id, opts.lines)} — ${a.name}`
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
    new Blob([lines.join("\r\n")], { type: "text/calendar;charset=utf-8" }),
    `${fileBase(opts)}.ics`,
  );
}

export function runExport(format: ExportFormat, opts: BuildOptions) {
  switch (format) {
    case "csv":
      return exportCsv(opts);
    case "xlsx":
      return exportXlsx(opts);
    case "pdf":
      return exportPdf(opts);
    case "ics":
      return exportIcs(opts);
  }
}
