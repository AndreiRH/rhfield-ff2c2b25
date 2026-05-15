import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";
import { CHAPTER_LABELS, calcProgress, equipmentProgress, itemsFromGroup } from "@/lib/progress";

export type ExportProgress = {
  phase: "tables" | "media" | "packaging" | "done";
  message: string;
  current?: number;
  total?: number;
};

type Opts = {
  includeMedia: boolean;
  onProgress?: (p: ExportProgress) => void;
  signal?: AbortSignal;
};

// --- CSV helpers ----------------------------------------------------------
function csvCell(v: any): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
function toCsv(rows: any[], cols?: string[]): string {
  if (rows.length === 0) return (cols ?? []).join(",") + "\n";
  const headers = cols ?? Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const head = headers.join(",");
  const body = rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")).join("\n");
  return head + "\n" + body + "\n";
}

function safe(s: string | null | undefined): string {
  return (s ?? "").replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
}

async function fetchAll<T = any>(table: string, projectFilter?: { col: string; ids: string[] }): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    let q = supabase.from(table as any).select("*").range(from, from + PAGE - 1);
    if (projectFilter && projectFilter.ids.length > 0) {
      q = q.in(projectFilter.col, projectFilter.ids);
    }
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...(data as T[]));
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function downloadBlob(bucket: "photos" | "files", path: string): Promise<Blob | null> {
  try {
    const { data, error } = await supabase.storage.from(bucket).download(path);
    if (error) return null;
    return data ?? null;
  } catch {
    return null;
  }
}

async function withConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T, idx: number) => Promise<void>,
  signal?: AbortSignal,
) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      if (signal?.aborted) throw new Error("Export cancelled");
      const idx = i++;
      await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
}

export async function exportProject(projectId: string, opts: Opts): Promise<void> {
  const { onProgress, signal, includeMedia } = opts;
  const report = (p: ExportProgress) => onProgress?.(p);

  report({ phase: "tables", message: "Loading project…" });

  const { data: project, error: pErr } = await supabase
    .from("projects").select("*").eq("id", projectId).single();
  if (pErr) throw pErr;

  const lines = await fetchAll<any>("lines", { col: "project_id", ids: [projectId] });
  const lineIds = lines.map((l) => l.id);

  if (lineIds.length === 0) {
    throw new Error("This project has no production lines yet — nothing to export.");
  }

  report({ phase: "tables", message: "Loading equipment & checklists…" });

  const [
    plantEquipment, equipmentGroups, componentTypes, components,
    checklistItems, itemPhotos, itemFiles,
    equipmentNotes, equipmentPhotos,
    paFolders, paAttachments, paNotes,
    milestones, commonNotes, commonFiles,
  ] = await Promise.all([
    fetchAll<any>("plant_equipment", { col: "line_id", ids: lineIds }),
    fetchAll<any>("equipment_groups", { col: "line_id", ids: lineIds }),
    fetchAll<any>("component_types"),
    fetchAll<any>("components"),
    fetchAll<any>("checklist_items"),
    fetchAll<any>("item_photos"),
    fetchAll<any>("item_files"),
    fetchAll<any>("equipment_notes"),
    fetchAll<any>("equipment_photos"),
    fetchAll<any>("pa_folders", { col: "line_id", ids: lineIds }),
    fetchAll<any>("pa_attachments"),
    fetchAll<any>("pa_notes", { col: "line_id", ids: lineIds }),
    fetchAll<any>("milestones", { col: "line_id", ids: lineIds }),
    fetchAll<any>("common_notes", { col: "project_id", ids: [projectId] }),
    fetchAll<any>("common_files", { col: "project_id", ids: [projectId] }),
  ]);

  // Restrict child rows to project scope (those tables don't carry line/project ids directly)
  const egIds = new Set(equipmentGroups.map((g) => g.id));
  const ctScoped = componentTypes.filter((c) => egIds.has(c.equipment_group_id));
  const ctIds = new Set(ctScoped.map((c) => c.id));
  const compScoped = components.filter((c) => egIds.has(c.equipment_id) || ctIds.has(c.component_type_id));
  const compIds = new Set(compScoped.map((c) => c.id));
  const ciScoped = checklistItems.filter((i) => compIds.has(i.component_id));
  const ciIds = new Set(ciScoped.map((i) => i.id));
  const ipScoped = itemPhotos.filter((p) => ciIds.has(p.item_id));
  const ifScoped = itemFiles.filter((p) => ciIds.has(p.item_id));
  const peIds = new Set(plantEquipment.map((p) => p.id));
  const enScoped = equipmentNotes.filter((n) => peIds.has(n.equipment_id));
  const epScoped = equipmentPhotos.filter((p) => peIds.has(p.equipment_id));
  const folderIds = new Set(paFolders.map((f) => f.id));
  const paAttScoped = paAttachments.filter((a) => folderIds.has(a.folder_id));

  // Build lookup maps
  const lineById = new Map(lines.map((l) => [l.id, l]));
  const peById = new Map(plantEquipment.map((p) => [p.id, p]));
  const egById = new Map(equipmentGroups.map((g) => [g.id, g]));
  const ctById = new Map(ctScoped.map((c) => [c.id, c]));
  const compById = new Map(compScoped.map((c) => [c.id, c]));
  const ciById = new Map(ciScoped.map((i) => [i.id, i]));

  const photosByItem = new Map<string, any[]>();
  ipScoped.forEach((p) => {
    const arr = photosByItem.get(p.item_id) ?? [];
    arr.push(p); photosByItem.set(p.item_id, arr);
  });
  const filesByItem = new Map<string, any[]>();
  ifScoped.forEach((p) => {
    const arr = filesByItem.get(p.item_id) ?? [];
    arr.push(p); filesByItem.set(p.item_id, arr);
  });

  // ---- Build the flattened "checklist_full.csv" -------------------------
  report({ phase: "tables", message: "Building summary sheets…" });

  const flatRows = ciScoped
    .filter((i) => !i.deleted_at)
    .map((i) => {
      const comp = compById.get(i.component_id);
      const ctype = comp?.component_type_id ? ctById.get(comp.component_type_id) : null;
      const eg = comp ? egById.get(comp.equipment_id ?? ctype?.equipment_group_id) : null;
      const pe = eg?.plant_equipment_id ? peById.get(eg.plant_equipment_id) : null;
      const line = eg ? lineById.get(eg.line_id) : null;
      const photoPaths = (photosByItem.get(i.id) ?? []).map((p) => p.storage_path).join(" | ");
      const filePaths = (filesByItem.get(i.id) ?? []).map((p) => `${p.file_name}::${p.storage_path}`).join(" | ");

      return {
        Line: line ? `${line.number} – ${line.name ?? ""}`.trim() : "",
        Plant: pe ? (eg?.kind === "kiln" ? "Kiln" : eg?.kind === "shs" ? "SHS" : eg?.kind ?? "") : (eg?.kind === "extra_work" ? `Extra: ${eg.name}` : ""),
        Equipment: pe?.name ?? eg?.name ?? "",
        Chapter: CHAPTER_LABELS[eg?.chapter ?? ""] ?? eg?.chapter ?? "",
        "Component type": ctype?.name ?? "",
        Component: comp?.name ?? "",
        Task: i.label,
        Done: i.done ? "yes" : "no",
        "Completed at": i.completed_at ?? "",
        Note: i.note ?? "",
        Photos: photoPaths,
        Files: filePaths,
      };
    });

  // Progress sheets
  const progByLine: any[] = [];
  const progByEquip: any[] = [];
  for (const line of lines) {
    const peForLine = plantEquipment.filter((p) => p.line_id === line.id && !p.deleted_at);
    let mechSum = 0, wirSum = 0, coldSum = 0;
    for (const pe of peForLine) {
      // Attach groups+items so equipmentProgress works
      const groups = equipmentGroups.filter((g) => g.plant_equipment_id === pe.id && !g.deleted_at).map((g) => {
        const directComps = compScoped.filter((c) => c.equipment_id === g.id && !c.deleted_at).map((c) => ({
          ...c, checklist_items: ciScoped.filter((i) => i.component_id === c.id),
        }));
        const types = ctScoped.filter((t) => t.equipment_group_id === g.id && !t.deleted_at).map((t) => ({
          ...t,
          components: compScoped.filter((c) => c.component_type_id === t.id && !c.deleted_at).map((c) => ({
            ...c, checklist_items: ciScoped.filter((i) => i.component_id === c.id),
          })),
        }));
        return { ...g, components: directComps, component_types: types };
      });
      const p = equipmentProgress({ ...pe, equipment_groups: groups });
      mechSum += p.mech; wirSum += p.wiring; coldSum += p.cold;
      progByEquip.push({
        Line: line.number,
        Plant: pe.kind,
        Equipment: pe.name,
        "Assembly %": p.mech,
        "Wiring %": p.wiring,
        "Cold comm. %": p.cold,
        "Overall %": p.overall,
      });
    }
    const n = peForLine.length || 1;
    progByLine.push({
      Line: line.number,
      Name: line.name,
      "Assembly %": Math.round(mechSum / n),
      "Wiring %": Math.round(wirSum / n),
      "Cold comm. %": Math.round(coldSum / n),
      "Equipment count": peForLine.length,
    });
  }

  // ---- Assemble the ZIP ------------------------------------------------
  const zip = new JSZip();
  const root = zip.folder(`${safe(project.name)}-${new Date().toISOString().slice(0, 10)}`)!;

  root.file(
    "README.txt",
    [
      `Export of project "${project.name}"`,
      `Generated: ${new Date().toISOString()}`,
      ``,
      `summary/checklist_full.csv  – every checklist task, fully labeled`,
      `summary/progress_by_line.csv – % per chapter per line`,
      `summary/progress_by_equipment.csv – % per equipment`,
      `tables/*.csv – raw export of every database table`,
      `photos/ – every uploaded image, organised by source`,
      `files/  – every uploaded file, organised by source`,
      ``,
      `Open the CSV files in Excel, Numbers or Google Sheets.`,
    ].join("\n"),
  );

  const summary = root.folder("summary")!;
  summary.file("checklist_full.csv", toCsv(flatRows));
  summary.file("progress_by_line.csv", toCsv(progByLine));
  summary.file("progress_by_equipment.csv", toCsv(progByEquip));

  const tables = root.folder("tables")!;
  tables.file("project.csv", toCsv([project]));
  tables.file("lines.csv", toCsv(lines));
  tables.file("plant_equipment.csv", toCsv(plantEquipment));
  tables.file("equipment_groups.csv", toCsv(equipmentGroups));
  tables.file("component_types.csv", toCsv(ctScoped));
  tables.file("components.csv", toCsv(compScoped));
  tables.file("checklist_items.csv", toCsv(ciScoped));
  tables.file("item_photos.csv", toCsv(ipScoped));
  tables.file("item_files.csv", toCsv(ifScoped));
  tables.file("equipment_notes.csv", toCsv(enScoped));
  tables.file("equipment_photos.csv", toCsv(epScoped));
  tables.file("pa_folders.csv", toCsv(paFolders));
  tables.file("pa_attachments.csv", toCsv(paAttScoped));
  tables.file("pa_notes.csv", toCsv(paNotes));
  tables.file("milestones.csv", toCsv(milestones));
  tables.file("common_notes.csv", toCsv(commonNotes));
  tables.file("common_files.csv", toCsv(commonFiles));

  // ---- Media downloads --------------------------------------------------
  if (includeMedia) {
    type Job = { bucket: "photos" | "files"; path: string; outPath: string };
    const jobs: Job[] = [];

    for (const p of ipScoped) {
      const item = ciById.get(p.item_id);
      const label = safe(item?.label ?? p.item_id);
      const fname = p.storage_path.split("/").pop() ?? `${p.id}.jpg`;
      jobs.push({ bucket: "photos", path: p.storage_path, outPath: `photos/checklist/${label}/${fname}` });
    }
    for (const p of ifScoped) {
      const item = ciById.get(p.item_id);
      const label = safe(item?.label ?? p.item_id);
      const fname = p.storage_path.split("/").pop() ?? `${p.id}`;
      jobs.push({ bucket: "files", path: p.storage_path, outPath: `files/checklist/${label}/${fname}` });
    }
    for (const p of epScoped) {
      const pe = peById.get(p.equipment_id);
      const label = safe(pe?.name ?? p.equipment_id);
      const fname = p.storage_path.split("/").pop() ?? `${p.id}.jpg`;
      jobs.push({ bucket: "photos", path: p.storage_path, outPath: `photos/equipment/${label}/${fname}` });
    }
    for (const n of enScoped) {
      const pe = peById.get(n.equipment_id);
      const label = safe(pe?.name ?? n.equipment_id);
      if (n.photo_path) {
        const fname = n.photo_path.split("/").pop() ?? `${n.id}.jpg`;
        jobs.push({ bucket: "photos", path: n.photo_path, outPath: `photos/equipment-notes/${label}/${fname}` });
      }
      if (n.file_path) {
        const fname = n.file_path.split("/").pop() ?? `${n.id}`;
        jobs.push({ bucket: "files", path: n.file_path, outPath: `files/equipment-notes/${label}/${fname}` });
      }
    }
    const folderById = new Map(paFolders.map((f) => [f.id, f]));
    for (const a of paAttScoped) {
      const f = folderById.get(a.folder_id);
      const line = f ? lineById.get(f.line_id) : null;
      const label = `${line ? `line${line.number}-` : ""}${safe(f?.kind)}-${safe(f?.name)}`;
      const fname = a.storage_path.split("/").pop() ?? `${a.id}`;
      const dir = a.kind === "photo" ? "photos/pa" : "files/pa";
      jobs.push({ bucket: a.kind === "photo" ? "photos" : "files", path: a.storage_path, outPath: `${dir}/${label}/${fname}` });
    }
    for (const n of paNotes) {
      const f = n.folder_id ? folderById.get(n.folder_id) : null;
      const line = f ? lineById.get(f.line_id) : (n.line_id ? lineById.get(n.line_id) : null);
      const label = `${line ? `line${line.number}-` : ""}${safe(f?.name ?? n.kind)}-notes`;
      if (n.photo_path) {
        const fname = n.photo_path.split("/").pop() ?? `${n.id}.jpg`;
        jobs.push({ bucket: "photos", path: n.photo_path, outPath: `photos/pa-notes/${label}/${fname}` });
      }
      if (n.file_path) {
        const fname = n.file_path.split("/").pop() ?? `${n.id}`;
        jobs.push({ bucket: "files", path: n.file_path, outPath: `files/pa-notes/${label}/${fname}` });
      }
    }
    for (const cf of commonFiles) {
      const fname = cf.storage_path.split("/").pop() ?? `${cf.id}`;
      jobs.push({ bucket: "files", path: cf.storage_path, outPath: `files/common/${fname}` });
    }

    let done = 0;
    report({ phase: "media", message: "Downloading photos & files…", current: 0, total: jobs.length });
    await withConcurrency(
      jobs,
      6,
      async (job) => {
        const blob = await downloadBlob(job.bucket, job.path);
        if (blob) root.file(job.outPath, blob);
        done++;
        report({ phase: "media", message: "Downloading photos & files…", current: done, total: jobs.length });
      },
      signal,
    );
  }

  report({ phase: "packaging", message: "Compressing archive…" });
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safe(project.name)}-${new Date().toISOString().slice(0, 10)}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);

  report({ phase: "done", message: "Export ready." });
}
