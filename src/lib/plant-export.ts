/**
 * Plant equipment export — PDF / Excel / CSV.
 *
 * Builds a per-equipment breakdown grouped by the three sections
 * (Assembly / Wiring / Cold comm). Recurses into component_types →
 * components → checklist items. Each item row contributes a "Mark"
 * value used by COUNTIF totals at the bottom.
 */
import * as XLSX from "xlsx-js-style";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { supabase } from "@/integrations/supabase/client";
import { equipmentProgress, calcProgress, itemsFromGroup, liveChecklistItems } from "@/lib/progress";
import { fetchEquipmentDetail } from "@/routes/p.$projectId.lines.$lineNumber.equipment.$kind.$equipmentId";

export type PlantExportFormat = "pdf" | "xlsx" | "csv";

export interface PlantExportOptions {
  projectId: string;
  lineNumber: string;
  kind: string;            // kiln | shs
  plantLabel: string;      // "Kiln" / "SHS"
  equipmentIds: string[];  // selected equipment ids (subset of all)
  allEquipmentCount: number; // total available — used to decide if we show plant totals
  format: PlantExportFormat;
  sections?: Section[];    // which sections to include; defaults to all three
}

const ALL_SECTIONS: Section[] = ["assembly", "wiring", "cold_comm"];
function sectionsOf(opts: PlantExportOptions): Section[] {
  const s = opts.sections && opts.sections.length > 0 ? opts.sections : ALL_SECTIONS;
  // preserve canonical order
  return ALL_SECTIONS.filter((k) => s.includes(k));
}

type Section = "assembly" | "wiring" | "cold_comm";

const SECTION_META: Record<Section, { label: string; color: string; pdfRgb: [number, number, number] }> = {
  assembly:  { label: "Assembly",          color: "F59E0B", pdfRgb: [245, 158, 11] },   // amber
  wiring:    { label: "Wiring",            color: "8B5CF6", pdfRgb: [139,  92, 246] },  // violet
  cold_comm: { label: "Cold commissioning",color: "06B6D4", pdfRgb: [  6, 182, 212] },  // cyan
};

/* ---------- Row model ---------- */

interface BodyRow {
  kind: "type" | "item";
  indent: number;        // visual indent level (0 = type, 1 = root item, 2+ = subtask depth)
  label: string;
  done?: boolean;
  flagged?: boolean;
  note?: string;
  photoCount?: number;
  photoPaths?: { bucket: string; path: string }[];
  typeStats?: { done: number; total: number; flagged: number; photos: number; files: number };
}

interface SectionNote { title: string; body: string }

interface SectionBlock {
  section: Section;
  mode: "checklist" | "manual";
  pct: number;
  rows: BodyRow[];          // empty if manual mode
  manualPct?: number | null;
  manualNotes?: string | null;
  totalItems: number;
  doneItems: number;
  flaggedItems: number;
  notes: SectionNote[];     // equipment_notes scoped to this section
}

interface EquipmentBlock {
  id: string;
  name: string;
  overall: number;
  sections: { assembly: SectionBlock; wiring: SectionBlock; cold_comm: SectionBlock };
  photoPaths: { bucket: string; path: string }[];    // equipment-level photos
}

/* ---------- Building blocks ---------- */

function noteFromItem(it: any): string {
  return (it?.note ?? "").trim();
}

function itemPhotoPaths(it: any): { bucket: string; path: string }[] {
  return ((it?.item_photos ?? []) as any[])
    .filter((p) => p?.storage_path)
    .map((p) => ({ bucket: "photos", path: p.storage_path as string }));
}

function buildSectionRows(group: any): BodyRow[] {
  const rows: BodyRow[] = [];

  // Mirror the in-app ComponentTypesTree exactly: only component_types
  // (sorted by sort_order), and items rendered as a parent_item_id tree.
  // The legacy direct components on the group, and components nested under
  // types, are NOT rendered in the UI — including them here was the source
  // of the "ghost" rows the user reported.
  const types = ((group?.component_types ?? []) as any[])
    .filter((t) => !t.deleted_at)
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  for (const t of types) {
    const liveItems = liveChecklistItems((t.checklist_items ?? []) as any[]);
    const doneCount = liveItems.filter((i: any) => i.done).length;
    const flaggedCount = liveItems.filter((i: any) => i.flagged).length;
    const typePhotos = ((t.component_type_photos ?? []) as any[]).length;
    const typeFiles = ((t.component_type_files ?? []) as any[]).length;

    rows.push({
      kind: "type",
      indent: 0,
      label: t.name ?? "(unnamed type)",
      typeStats: { done: doneCount, total: liveItems.length, flagged: flaggedCount, photos: typePhotos, files: typeFiles },
    });

    // Build the parent → children map and walk it depth-first.
    const childrenByParent = new Map<string | null, any[]>();
    for (const it of liveItems) {
      const pid = (it.parent_item_id ?? null) as string | null;
      if (!childrenByParent.has(pid)) childrenByParent.set(pid, []);
      childrenByParent.get(pid)!.push(it);
    }
    for (const arr of childrenByParent.values()) {
      arr.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    }

    const walk = (parentId: string | null, depth: number) => {
      const kids = childrenByParent.get(parentId) ?? [];
      for (const it of kids) {
        rows.push({
          kind: "item",
          indent: 1 + depth, // root items at indent 1, subtasks deeper
          label: it.label ?? "(no label)",
          done: !!it.done,
          flagged: !!it.flagged,
          note: noteFromItem(it),
          photoCount: ((it.item_photos ?? []) as any[]).length,
          photoPaths: itemPhotoPaths(it),
        });
        walk(it.id, depth + 1);
      }
    };
    walk(null, 0);
  }

  return rows;
}

async function buildEquipmentBlock(opts: PlantExportOptions, equipmentId: string): Promise<EquipmentBlock> {
  const detail = await fetchEquipmentDetail(opts.projectId, opts.lineNumber, opts.kind, equipmentId);
  const pe = detail.peWithGroups;
  const { overall } = equipmentProgress(pe);

  // Equipment-level notes split by section, plus equipment photos.
  const [{ data: notesRaw }, { data: photos }] = await Promise.all([
    supabase.from("equipment_notes")
      .select("title, body, section")
      .eq("equipment_id", equipmentId)
      .order("sort_order"),
    supabase.from("equipment_photos")
      .select("storage_path")
      .eq("equipment_id", equipmentId)
      .order("uploaded_at"),
  ]);

  const notesBySection: Record<Section, SectionNote[]> = { assembly: [], wiring: [], cold_comm: [] };
  for (const n of (notesRaw ?? []) as any[]) {
    const sec = (n.section ?? "assembly") as Section;
    if (!notesBySection[sec]) continue;
    const title = (n.title ?? "").trim();
    const body = (n.body ?? "").trim();
    if (!title && !body) continue;
    notesBySection[sec].push({ title, body });
  }

  const buildSection = (
    group: any,
    section: Section,
    forcedMode?: "checklist" | "manual",
    manualPct?: number | null,
  ): SectionBlock => {
    const isAssembly = section === "assembly";
    const mode: "checklist" | "manual" =
      forcedMode ?? (isAssembly && pe.mech_mode === "manual" ? "manual" : "checklist");
    const rows = mode === "checklist" ? buildSectionRows(group) : [];
    const items = mode === "checklist" ? liveChecklistItems(itemsFromGroup(group)) : [];
    const doneItems = items.filter((i: any) => i.done).length;
    const flaggedItems = items.filter((i: any) => i.flagged).length;
    const pct = mode === "manual"
      ? Math.max(0, Math.min(100, manualPct ?? 0))
      : calcProgress(items).pct;
    return {
      section,
      mode,
      pct,
      rows,
      manualPct: mode === "manual" ? manualPct ?? 0 : null,
      manualNotes: mode === "manual" ? (pe.mech_notes ?? null) : null,
      totalItems: items.length,
      doneItems,
      flaggedItems,
      notes: notesBySection[section],
    };
  };

  return {
    id: equipmentId,
    name: pe.name,
    overall,
    sections: {
      assembly:  buildSection(detail.assembly,  "assembly",
                              pe.mech_mode === "manual" ? "manual" : "checklist",
                              pe.mech_manual_pct),
      wiring:    buildSection(detail.wiring,    "wiring"),
      cold_comm: buildSection(detail.cold,      "cold_comm"),
    },
    photoPaths: ((photos ?? []) as any[]).map((p) => ({ bucket: "photos", path: p.storage_path })),
  };
}

/* ---------- Mark column helpers ---------- */

function markFor(row: BodyRow): string {
  if (row.kind !== "item") return "";
  const parts: string[] = [];
  if (row.done) parts.push("✓");
  if (row.flagged) parts.push("⚑");
  return parts.join("");
}

/* ---------- Excel ---------- */

const HEADERS = ["Item", "Status", "Mark", "Note", "Photos"];

function xlsxBorder() {
  return {
    top: { style: "thin", color: { rgb: "D1D5DB" } },
    bottom: { style: "thin", color: { rgb: "D1D5DB" } },
    left: { style: "thin", color: { rgb: "D1D5DB" } },
    right: { style: "thin", color: { rgb: "D1D5DB" } },
  };
}

async function exportXlsx(opts: PlantExportOptions, blocks: EquipmentBlock[]) {
  const aoa: any[][] = [];
  const merges: XLSX.Range[] = [];
  // Track row index of the "Mark" column for totals formula
  const markRows: number[] = []; // 0-indexed row numbers where item rows live
  let r = 0;

  // Title row
  aoa.push([{ v: `${opts.plantLabel} — Line ${opts.lineNumber}`, t: "s",
              s: { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } },
                   fill: { fgColor: { rgb: "111827" } },
                   alignment: { horizontal: "left", vertical: "center" } } },
            "", "", "", ""]);
  merges.push({ s: { r, c: 0 }, e: { r, c: HEADERS.length - 1 } });
  r++;
  aoa.push([{ v: `Exported ${new Date().toLocaleString()}`, t: "s",
              s: { font: { italic: true, color: { rgb: "6B7280" } } } },
            "", "", "", ""]);
  merges.push({ s: { r, c: 0 }, e: { r, c: HEADERS.length - 1 } });
  r++;
  aoa.push(["", "", "", "", ""]);
  r++;

  const activeSections = sectionsOf(opts);
  const headerSummary = (eq: EquipmentBlock) =>
    activeSections.map((k) => `${SECTION_META[k].label[0]} ${eq.sections[k].pct}%`).join("   ");

  for (const eq of blocks) {
    // Equipment header
    aoa.push([{
      v: `${eq.name}   —   Overall ${eq.overall}%   ·   ${headerSummary(eq)}`,
      t: "s",
      s: {
        font: { bold: true, sz: 13, color: { rgb: "FFFFFF" } },
        fill: { fgColor: { rgb: "1F2937" } },
        alignment: { horizontal: "left", vertical: "center" },
        border: xlsxBorder(),
      },
    }, "", "", "", ""]);
    merges.push({ s: { r, c: 0 }, e: { r, c: HEADERS.length - 1 } });
    r++;

    // Column headers row (only here so each equipment is self-contained)
    aoa.push(HEADERS.map((h) => ({
      v: h, t: "s",
      s: { font: { bold: true, color: { rgb: "FFFFFF" } },
           fill: { fgColor: { rgb: "374151" } },
           alignment: { horizontal: "center" },
           border: xlsxBorder() },
    })));
    r++;

    for (const sec of activeSections.map((k) => eq.sections[k])) {
      const meta = SECTION_META[sec.section];
      // Section header
      aoa.push([{
        v: sec.mode === "manual"
          ? `${meta.label}  (manual ${sec.pct}%)`
          : `${meta.label}  —  ${sec.pct}%   (${sec.doneItems}/${sec.totalItems} done · ${sec.flaggedItems} flagged)`,
        t: "s",
        s: {
          font: { bold: true, color: { rgb: "FFFFFF" } },
          fill: { fgColor: { rgb: meta.color } },
          alignment: { horizontal: "left", vertical: "center" },
          border: xlsxBorder(),
        },
      }, "", "", "", ""]);
      merges.push({ s: { r, c: 0 }, e: { r, c: HEADERS.length - 1 } });
      r++;

      if (sec.mode === "manual") {
        aoa.push([
          { v: "Assembly tracked manually (no checklist).", t: "s",
            s: { font: { italic: true }, alignment: { wrapText: true }, border: xlsxBorder() } },
          { v: `${sec.pct}%`, t: "s",
            s: { font: { bold: true }, alignment: { horizontal: "center" }, border: xlsxBorder() } },
          { v: "", s: { border: xlsxBorder() } },
          { v: sec.manualNotes ?? "", t: "s", s: { alignment: { wrapText: true }, border: xlsxBorder() } },
          { v: "", s: { border: xlsxBorder() } },
        ]);
        r++;
        continue;
      }

      if (sec.rows.length === 0) {
        aoa.push([
          { v: "(no checklist items)", t: "s",
            s: { font: { italic: true, color: { rgb: "9CA3AF" } }, border: xlsxBorder() } },
          { v: "", s: { border: xlsxBorder() } },
          { v: "", s: { border: xlsxBorder() } },
          { v: "", s: { border: xlsxBorder() } },
          { v: "", s: { border: xlsxBorder() } },
        ]);
        r++;
        continue;
      }

      for (const row of sec.rows) {
        if (row.kind === "type") {
          const stats = row.typeStats;
          const tail = stats
            ? `   —   ${stats.done}/${stats.total} done${stats.flagged ? ` · ${stats.flagged} flagged` : ""}${stats.photos ? ` · ${stats.photos} 📷` : ""}${stats.files ? ` · ${stats.files} 📎` : ""}`
            : "";
          aoa.push([{
            v: `${row.label}${tail}`, t: "s",
            s: { font: { bold: true, color: { rgb: "111827" } },
                 fill: { fgColor: { rgb: "F3F4F6" } },
                 border: xlsxBorder() },
          }, "", "", "", ""]);
          merges.push({ s: { r, c: 0 }, e: { r, c: HEADERS.length - 1 } });
          r++;
        } else {
          markRows.push(r);
          const status = row.done ? "Done" : row.flagged ? "Flagged" : "Open";
          const statusColor = row.done ? "10B981" : row.flagged ? "EF4444" : "9CA3AF";
          // indent 1 = root item, 2+ = subtask. Use 4 spaces per depth level.
          const depth = Math.max(1, row.indent ?? 1);
          const pad = "    ".repeat(depth);
          const bullet = depth > 1 ? "↳ " : "• ";
          aoa.push([
            { v: `${pad}${bullet}${row.label}`, t: "s",
              s: { alignment: { wrapText: true, vertical: "top" }, border: xlsxBorder() } },
            { v: status, t: "s",
              s: { font: { bold: true, color: { rgb: "FFFFFF" } },
                   fill: { fgColor: { rgb: statusColor } },
                   alignment: { horizontal: "center" },
                   border: xlsxBorder() } },
            { v: markFor(row), t: "s",
              s: { font: { bold: true }, alignment: { horizontal: "center" }, border: xlsxBorder() } },
            { v: row.note ?? "", t: "s",
              s: { alignment: { wrapText: true, vertical: "top" }, border: xlsxBorder() } },
            { v: (row.photoCount ?? 0) > 0 ? `${row.photoCount} photo${row.photoCount === 1 ? "" : "s"}` : "", t: "s",
              s: { alignment: { horizontal: "center", vertical: "top" }, border: xlsxBorder() } },
          ]);
          r++;
        }
      }

      // Section-scoped notes (equipment_notes filtered by section)
      if (sec.notes.length > 0) {
        aoa.push([{
          v: `Notes — ${SECTION_META[sec.section].label}`, t: "s",
          s: { font: { bold: true, italic: true, color: { rgb: "374151" } },
               fill: { fgColor: { rgb: "E5E7EB" } }, border: xlsxBorder() },
        }, "", "", "", ""]);
        merges.push({ s: { r, c: 0 }, e: { r, c: HEADERS.length - 1 } });
        r++;
        for (const n of sec.notes) {
          aoa.push([
            { v: `    📝 ${n.title || "Note"}`, t: "s", s: { border: xlsxBorder() } },
            { v: "", s: { border: xlsxBorder() } },
            { v: "", s: { border: xlsxBorder() } },
            { v: n.body, t: "s", s: { alignment: { wrapText: true, vertical: "top" }, border: xlsxBorder() } },
            { v: "", s: { border: xlsxBorder() } },
          ]);
          r++;
        }
      }
    }

    // Equipment-level photos summary (kept once per equipment)
    if (eq.photoPaths.length > 0) {
      aoa.push([
        { v: "Equipment photos", t: "s",
          s: { font: { bold: true, italic: true, color: { rgb: "374151" } },
               fill: { fgColor: { rgb: "E5E7EB" } }, border: xlsxBorder() } },
        { v: "", s: { border: xlsxBorder() } },
        { v: "", s: { border: xlsxBorder() } },
        { v: "", s: { border: xlsxBorder() } },
        { v: `${eq.photoPaths.length} photo${eq.photoPaths.length === 1 ? "" : "s"}`, t: "s",
          s: { alignment: { horizontal: "center" }, border: xlsxBorder() } },
      ]);
      r++;
    }

    // Spacer
    aoa.push(["", "", "", "", ""]);
    r++;
  }

  // ---- Totals at bottom ----
  if (markRows.length > 0) {
    aoa.push([{
      v: "TOTALS",
      t: "s",
      s: { font: { bold: true, color: { rgb: "FFFFFF" } },
           fill: { fgColor: { rgb: "111827" } },
           alignment: { horizontal: "left" } },
    }, "", "", "", ""]);
    merges.push({ s: { r, c: 0 }, e: { r, c: HEADERS.length - 1 } });
    r++;

    const total = markRows.length;
    // SUM of COUNTIF per cell — handles non-contiguous rows and is Excel-safe
    // (SEARCH / SUMPRODUCT array tricks over discrete refs aren't valid syntax).
    const refs = markRows.map((rr) => `C${rr + 1}`);
    const checkedFormula = "SUM(" + refs.map((c) => `COUNTIF(${c},"*✓*")`).join(",") + ")";
    const flaggedFormula = "SUM(" + refs.map((c) => `COUNTIF(${c},"*⚑*")`).join(",") + ")";

    aoa.push([
      { v: "Checked", t: "s", s: { font: { bold: true }, border: xlsxBorder() } },
      { v: "", s: { border: xlsxBorder() } },
      { f: `${checkedFormula}&"/${total}"`, t: "s",
        s: { font: { bold: true, color: { rgb: "10B981" } },
             alignment: { horizontal: "center" }, border: xlsxBorder() } },
      { v: "Use the Mark column (C) to recount with COUNTIF if you edit.", t: "s",
        s: { font: { italic: true, color: { rgb: "6B7280" } }, border: xlsxBorder() } },
      { v: "", s: { border: xlsxBorder() } },
    ]);
    r++;
    aoa.push([
      { v: "Flagged", t: "s", s: { font: { bold: true }, border: xlsxBorder() } },
      { v: "", s: { border: xlsxBorder() } },
      { f: `${flaggedFormula}&"/${total}"`, t: "s",
        s: { font: { bold: true, color: { rgb: "EF4444" } },
             alignment: { horizontal: "center" }, border: xlsxBorder() } },
      { v: "", s: { border: xlsxBorder() } },
      { v: "", s: { border: xlsxBorder() } },
    ]);
    r++;

    // Plant-wide section averages if every equipment included
    if (blocks.length === opts.allEquipmentCount && blocks.length > 1) {
      const avg = (key: Section) => Math.round(blocks.reduce((s, b) => s + b.sections[key].pct, 0) / blocks.length);
      const parts = activeSections.map((k) => `${SECTION_META[k].label} ${avg(k)}%`);
      const overall = Math.round(activeSections.reduce((s, k) => s + avg(k), 0) / Math.max(activeSections.length, 1));
      aoa.push([{
        v: `PLANT AVERAGE — Overall ${overall}%   ·   ${parts.join("   ·   ")}`,
        t: "s",
        s: { font: { bold: true, color: { rgb: "FFFFFF" } },
             fill: { fgColor: { rgb: "1F2937" } },
             alignment: { horizontal: "left" }, border: xlsxBorder() },
      }, "", "", "", ""]);
      merges.push({ s: { r, c: 0 }, e: { r, c: HEADERS.length - 1 } });
      r++;
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  (ws as any)["!merges"] = merges;
  (ws as any)["!cols"] = [{ wch: 60 }, { wch: 10 }, { wch: 8 }, { wch: 40 }, { wch: 10 }];
  (ws as any)["!freeze"] = { xSplit: 0, ySplit: 3 };

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts.plantLabel);
  XLSX.writeFile(wb, fileName(opts, "xlsx"));
}

/* ---------- CSV ---------- */

function csvCell(v: string | number | undefined | null) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function exportCsv(opts: PlantExportOptions, blocks: EquipmentBlock[]) {
  const lines: string[] = [];
  lines.push([opts.plantLabel + " — Line " + opts.lineNumber, "", "", "", ""].map(csvCell).join(","));
  lines.push(["Exported " + new Date().toLocaleString(), "", "", "", ""].map(csvCell).join(","));
  lines.push("");

  let totalItems = 0, totalDone = 0, totalFlagged = 0;
  const activeSections = sectionsOf(opts);

  for (const eq of blocks) {
    const summary = activeSections.map((k) => `${SECTION_META[k].label[0]} ${eq.sections[k].pct}%`).join(" · ");
    lines.push([`### ${eq.name} — Overall ${eq.overall}% (${summary})`].map(csvCell).join(","));
    lines.push(HEADERS.map(csvCell).join(","));
    for (const sec of activeSections.map((k) => eq.sections[k])) {
      const meta = SECTION_META[sec.section];
      lines.push([`## ${meta.label}`, "", "", "", `${sec.pct}%`].map(csvCell).join(","));
      if (sec.mode === "manual") {
        lines.push([`Manual tracking`, `${sec.pct}%`, "", sec.manualNotes ?? "", ""].map(csvCell).join(","));
        continue;
      }
      totalItems += sec.totalItems;
      totalDone += sec.doneItems;
      totalFlagged += sec.flaggedItems;
      for (const row of sec.rows) {
        if (row.kind === "type") {
          const stats = row.typeStats;
          const tail = stats ? `  (${stats.done}/${stats.total}${stats.flagged ? ` · ${stats.flagged} flagged` : ""})` : "";
          lines.push([`# ${row.label}${tail}`, "", "", "", ""].map(csvCell).join(","));
        } else {
          const status = row.done ? "Done" : row.flagged ? "Flagged" : "Open";
          const depth = Math.max(1, row.indent ?? 1);
          const pad = "  ".repeat(depth + 1);
          const bullet = depth > 1 ? "↳ " : "• ";
          lines.push([
            `${pad}${bullet}${row.label}`,
            status,
            markFor(row),
            row.note ?? "",
            (row.photoCount ?? 0) > 0 ? `${row.photoCount} photo(s)` : "",
          ].map(csvCell).join(","));
        }
      }
      if (sec.notes.length > 0) {
        lines.push([`-- Notes — ${meta.label} --`, "", "", "", ""].map(csvCell).join(","));
        for (const n of sec.notes) {
          lines.push([`    📝 ${n.title || "Note"}`, "", "", n.body, ""].map(csvCell).join(","));
        }
      }
    }
    if (eq.photoPaths.length > 0) {
      lines.push([`Equipment photos`, "", "", "", `${eq.photoPaths.length} photo(s)`].map(csvCell).join(","));
    }
    lines.push("");
  }

  lines.push(["TOTALS", "", "", "", ""].map(csvCell).join(","));
  lines.push(["Checked", "", `${totalDone}/${totalItems}`, "", ""].map(csvCell).join(","));
  lines.push(["Flagged", "", `${totalFlagged}/${totalItems}`, "", ""].map(csvCell).join(","));

  if (blocks.length === opts.allEquipmentCount && blocks.length > 1) {
    const avg = (k: Section) => Math.round(blocks.reduce((s, b) => s + b.sections[k].pct, 0) / blocks.length);
    const parts = activeSections.map((k) => `${SECTION_META[k].label} ${avg(k)}%`);
    const overall = Math.round(activeSections.reduce((s, k) => s + avg(k), 0) / Math.max(activeSections.length, 1));
    lines.push([`PLANT AVERAGE — Overall ${overall}% · ${parts.join(" · ")}`, "", "", "", ""].map(csvCell).join(","));
  }

  const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  downloadBlob(blob, fileName(opts, "csv"));
}

/* ---------- PDF ---------- */

async function fetchPhotoDataUrl(path: string, maxPx = 96): Promise<string | null> {
  try {
    const { data } = await supabase.storage.from("photos").createSignedUrl(path, 600);
    if (!data?.signedUrl) return null;
    const res = await fetch(data.signedUrl);
    if (!res.ok) return null;
    const blob = await res.blob();
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.crossOrigin = "anonymous";
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = URL.createObjectURL(blob);
    });
    const ratio = Math.min(maxPx / img.naturalWidth, maxPx / img.naturalHeight, 1);
    const w = Math.max(1, Math.round(img.naturalWidth * ratio));
    const h = Math.max(1, Math.round(img.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, w, h);
    return canvas.toDataURL("image/jpeg", 0.7);
  } catch {
    return null;
  }
}

async function exportPdf(opts: PlantExportOptions, blocks: EquipmentBlock[]) {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 36;

  // Title
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(`${opts.plantLabel} — Line ${opts.lineNumber}`, margin, margin + 6);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Exported ${new Date().toLocaleString()}`, margin, margin + 22);
  doc.setTextColor(0);
  let cursorY = margin + 38;

  // Pre-fetch first-photo previews for all item rows in parallel (cap to 3 per item).
  const photoJobs: { path: string; resolve: (dataUrl: string | null) => void }[] = [];
  const photoCache = new Map<string, Promise<string | null>>();
  const photo = (path: string) => {
    if (!photoCache.has(path)) photoCache.set(path, fetchPhotoDataUrl(path, 80));
    return photoCache.get(path)!;
  };

  let totalItems = 0, totalDone = 0, totalFlagged = 0;

  const activeSections = sectionsOf(opts);

  for (const eq of blocks) {
    if (cursorY > doc.internal.pageSize.getHeight() - 100) { doc.addPage(); cursorY = margin; }
    // Equipment header
    doc.setFillColor(31, 41, 55);
    doc.rect(margin, cursorY, pageW - margin * 2, 22, "F");
    doc.setTextColor(255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    const summary = activeSections.map((k) => `${SECTION_META[k].label[0]} ${eq.sections[k].pct}%`).join("   ");
    doc.text(`${eq.name}   —   Overall ${eq.overall}%   ·   ${summary}`,
             margin + 6, cursorY + 15);
    doc.setTextColor(0);
    cursorY += 28;

    for (const sec of activeSections.map((k) => eq.sections[k])) {
      const meta = SECTION_META[sec.section];
      const [rr, gg, bb] = meta.pdfRgb;

      const rows: any[] = [];
      if (sec.mode === "manual") {
        rows.push([
          { content: `Manual tracking — ${sec.pct}%`, styles: { fontStyle: "italic" } },
          "", "",
          { content: sec.manualNotes ?? "", styles: { fontStyle: "italic" } },
          "",
        ]);
      } else {
        totalItems += sec.totalItems;
        totalDone += sec.doneItems;
        totalFlagged += sec.flaggedItems;
        for (const row of sec.rows) {
          if (row.kind === "type") {
            const stats = row.typeStats;
            const tail = stats
              ? `   —   ${stats.done}/${stats.total} done${stats.flagged ? ` · ${stats.flagged} flagged` : ""}${stats.photos ? ` · ${stats.photos}📷` : ""}${stats.files ? ` · ${stats.files}📎` : ""}`
              : "";
            rows.push([{
              content: `${row.label}${tail}`,
              colSpan: 5,
              styles: { fontStyle: "bold", fillColor: [243, 244, 246], textColor: [17, 24, 39] },
            }]);
          } else {
            const status = row.done ? "Done" : row.flagged ? "Flagged" : "Open";
            const statusColor: [number, number, number] = row.done ? [16, 185, 129] : row.flagged ? [239, 68, 68] : [156, 163, 175];
            const depth = Math.max(1, row.indent ?? 1);
            const pad = "    ".repeat(depth);
            const bullet = depth > 1 ? "↳ " : "• ";
            const subStyle = depth > 1 ? { textColor: [75, 85, 99] as [number, number, number] } : {};
            rows.push([
              { content: `${pad}${bullet}${row.label}`, styles: subStyle },
              { content: status, styles: { fillColor: statusColor, textColor: [255, 255, 255], fontStyle: "bold", halign: "center" } },
              { content: markFor(row), styles: { halign: "center", fontStyle: "bold" } },
              row.note ?? "",
              { content: "", _photoPaths: (row.photoPaths ?? []).slice(0, 2) },
            ]);
          }
        }
        if (sec.rows.length === 0) {
          rows.push([{ content: "(no checklist items)", colSpan: 5, styles: { fontStyle: "italic", textColor: [156, 163, 175] } }]);
        }
      }

      // Section-scoped notes appended at the bottom of the section table
      for (const n of sec.notes) {
        rows.push([{
          content: `📝 ${n.title || "Note"}${n.body ? `\n${n.body}` : ""}`,
          colSpan: 5,
          styles: { fontStyle: "italic", fillColor: [229, 231, 235], textColor: [55, 65, 81] },
        }]);
      }

      // Section banner
      autoTable(doc, {
        startY: cursorY,
        margin: { left: margin, right: margin },
        head: [[{
          content: sec.mode === "manual"
            ? `${meta.label}  (manual ${sec.pct}%)`
            : `${meta.label}  —  ${sec.pct}%   (${sec.doneItems}/${sec.totalItems} done · ${sec.flaggedItems} flagged)`,
          colSpan: 5,
          styles: { fillColor: [rr, gg, bb], textColor: [255, 255, 255], halign: "left", fontStyle: "bold" },
        }],
        ["Item", "Status", "Mark", "Note", "Photos"].map((h) => ({
          content: h, styles: { fillColor: [55, 65, 81], textColor: [255, 255, 255], halign: "center", fontStyle: "bold" },
        })) as any],
        body: rows,
        styles: { fontSize: 8, cellPadding: 3, valign: "top", lineColor: [209, 213, 219], lineWidth: 0.4 },
        columnStyles: {
          0: { cellWidth: "auto" },
          1: { cellWidth: 50 },
          2: { cellWidth: 32 },
          3: { cellWidth: 140 },
          4: { cellWidth: 70 },
        },
      });
      cursorY = (doc as any).lastAutoTable.finalY + 6;
    }

    cursorY += 6;
  }

  // Totals
  if (cursorY > doc.internal.pageSize.getHeight() - 80) { doc.addPage(); cursorY = margin; }
  doc.setFillColor(17, 24, 39);
  doc.rect(margin, cursorY, pageW - margin * 2, 18, "F");
  doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(10);
  doc.text("TOTALS", margin + 6, cursorY + 12);
  doc.setTextColor(0);
  cursorY += 24;
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Checked:  ${totalDone}/${totalItems}`, margin + 6, cursorY); cursorY += 14;
  doc.text(`Flagged:  ${totalFlagged}/${totalItems}`, margin + 6, cursorY); cursorY += 14;
  if (blocks.length === opts.allEquipmentCount && blocks.length > 1) {
    const avg = (k: Section) => Math.round(blocks.reduce((s, b) => s + b.sections[k].pct, 0) / blocks.length);
    const parts = activeSections.map((k) => `${SECTION_META[k].label} ${avg(k)}%`);
    const overall = Math.round(activeSections.reduce((s, k) => s + avg(k), 0) / Math.max(activeSections.length, 1));
    doc.setFont("helvetica", "bold");
    doc.text(`PLANT AVERAGE — Overall ${overall}%   ·   ${parts.join("   ·   ")}`, margin + 6, cursorY);
  }

  // Second pass: embed photo previews. Easier approach — append a final
  // "Attachments" mini-gallery per equipment so jspdf-autotable doesn't fight us.
  const photoPages = blocks.filter((b) => {
    const itemsWithPhotos = activeSections
      .flatMap((k) => b.sections[k].rows.filter((r) => r.kind === "item" && (r.photoPaths?.length ?? 0) > 0));
    return itemsWithPhotos.length > 0 || b.photoPaths.length > 0;
  });

  for (const eq of photoPages) {
    doc.addPage();
    let y = margin;
    doc.setFont("helvetica", "bold"); doc.setFontSize(13);
    doc.text(`${eq.name} — Photo previews`, margin, y); y += 18;
    doc.setFont("helvetica", "normal"); doc.setFontSize(9);

    const allPhotoRefs: { label: string; paths: { bucket: string; path: string }[] }[] = [];
    for (const sec of activeSections.map((k) => eq.sections[k])) {
      for (const row of sec.rows) {
        if (row.kind === "item" && (row.photoPaths?.length ?? 0) > 0) {
          allPhotoRefs.push({ label: `${SECTION_META[sec.section].label} · ${row.label}`, paths: row.photoPaths!.slice(0, 4) });
        }
      }
    }
    if (eq.photoPaths.length > 0) {
      allPhotoRefs.push({ label: "Equipment photos", paths: eq.photoPaths.slice(0, 6) });
    }

    for (const ref of allPhotoRefs) {
      if (y > doc.internal.pageSize.getHeight() - 90) { doc.addPage(); y = margin; }
      doc.setFont("helvetica", "bold"); doc.setFontSize(9);
      doc.text(ref.label, margin, y); y += 4;
      doc.setFont("helvetica", "normal");
      const thumbSize = 60;
      let x = margin;
      const rowY = y + 4;
      for (const p of ref.paths) {
        const dataUrl = await photo(p.path);
        if (!dataUrl) continue;
        if (x + thumbSize > pageW - margin) { x = margin; }
        try { doc.addImage(dataUrl, "JPEG", x, rowY, thumbSize, thumbSize); } catch {}
        x += thumbSize + 6;
      }
      y = rowY + thumbSize + 10;
    }
  }

  doc.save(fileName(opts, "pdf"));
}

/* ---------- Public entry ---------- */

function fileName(opts: PlantExportOptions, ext: string) {
  const ts = new Date().toISOString().slice(0, 10);
  return `${opts.plantLabel}_Line${opts.lineNumber}_${ts}.${ext}`.replace(/\s+/g, "_");
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function runPlantExport(opts: PlantExportOptions, onProgress?: (msg: string, current: number, total: number) => void) {
  const blocks: EquipmentBlock[] = [];
  for (let i = 0; i < opts.equipmentIds.length; i++) {
    const id = opts.equipmentIds[i];
    onProgress?.("Loading equipment…", i, opts.equipmentIds.length);
    blocks.push(await buildEquipmentBlock(opts, id));
  }
  onProgress?.("Building file…", opts.equipmentIds.length, opts.equipmentIds.length);
  if (opts.format === "xlsx") await exportXlsx(opts, blocks);
  else if (opts.format === "csv") exportCsv(opts, blocks);
  else await exportPdf(opts, blocks);
}
