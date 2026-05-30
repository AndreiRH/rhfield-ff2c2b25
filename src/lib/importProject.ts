import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";

export type ImportProgress = {
  phase: "reading" | "remapping" | "inserting" | "media" | "done";
  message: string;
  current?: number;
  total?: number;
};

export type ImportSummary = {
  newProjectId: string;
  counts: Record<string, number>;
  mediaUploaded: number;
  mediaMissing: number;
};

type Opts = {
  zipFile: File;
  newProjectName: string;
  onProgress?: (p: ImportProgress) => void;
  signal?: AbortSignal;
};

// --- minimal CSV parser (matches our exporter's quoting rules) ----------
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      cell += c; i++; continue;
    }
    if (c === '"') { inQuotes = true; i++; continue; }
    if (c === ",") { row.push(cell); cell = ""; i++; continue; }
    if (c === "\r") { i++; continue; }
    if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; continue; }
    cell += c; i++;
  }
  if (cell.length > 0 || row.length > 0) { row.push(cell); rows.push(row); }
  if (rows.length === 0) return [];
  const headers = rows[0];
  return rows.slice(1)
    .filter((r) => r.length > 0 && !(r.length === 1 && r[0] === ""))
    .map((r) => Object.fromEntries(headers.map((h, idx) => [h, r[idx] ?? ""])));
}

// Coerce CSV string cells to JS values that match column types.
function coerce(row: Record<string, string>, schema: Record<string, "uuid" | "int" | "bool" | "json" | "text" | "ts" | "date">): any {
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    const t = schema[k] ?? "text";
    if (v === "" || v === null) { out[k] = null; continue; }
    if (t === "int") out[k] = parseInt(v, 10);
    else if (t === "bool") out[k] = v === "true" || v === "t" || v === "yes" || v === "1";
    else if (t === "json") { try { out[k] = JSON.parse(v); } catch { out[k] = v; } }
    else out[k] = v;
  }
  return out;
}

const newId = () => (crypto as any).randomUUID() as string;

const asBool = (value: string | null | undefined, fallback = false) => {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["true", "t", "yes", "1"].includes(normalized)) return true;
  if (["false", "f", "no", "0"].includes(normalized)) return false;
  return fallback;
};

const asInt = (value: string | null | undefined, fallback: number) => {
  const parsed = parseInt(value ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const durationFromDates = (startDate: string | null | undefined, endDate: string | null | undefined) => {
  if (!startDate || !endDate) return 1;
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const end = new Date(`${endDate}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 1;
  return Math.max(1, Math.round((end - start) / 86_400_000) + 1);
};

async function readCsv(zip: JSZip, name: string): Promise<Record<string, string>[]> {
  // tables live at <root>/tables/<name>.csv
  const matches = Object.keys(zip.files).filter((p) => p.endsWith(`/tables/${name}.csv`) || p === `tables/${name}.csv`);
  if (matches.length === 0) return [];
  const txt = await zip.files[matches[0]].async("string");
  return parseCsv(txt);
}

async function insertRows(table: string, rows: any[], chunkSize = 250) {
  for (let index = 0; index < rows.length; index += chunkSize) {
    const { error } = await (supabase.from(table as never) as any).insert(rows.slice(index, index + chunkSize));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

export async function importProjectFromZip(opts: Opts): Promise<ImportSummary> {
  const { zipFile, newProjectName, onProgress, signal } = opts;
  const report = (p: ImportProgress) => onProgress?.(p);
  const counts: Record<string, number> = {};

  report({ phase: "reading", message: "Reading ZIP..." });
  const zip = await JSZip.loadAsync(zipFile);

  // Detect zip root prefix (everything inside one folder named like project-YYYY-MM-DD)
  const firstFile = Object.keys(zip.files).find((n) => n.includes("/tables/"));
  const root = firstFile ? firstFile.split("/tables/")[0] + "/" : "";

  // Load all CSVs
  const [
    projectRows, lineRows, peRows, egRows, ctRows, compRows, ciRows,
    ipRows, ifRows, itemNoteRows, enRows, epRows, componentPhotoRows, componentFileRows,
    componentTypeNoteRows, componentTypePhotoRows, componentTypeFileRows, notePhotoRows, noteFileRows,
    paFolderRows, paAttRows, paNoteRows,
    msRows, cnRows, cfRows,
  ] = await Promise.all([
    readCsv(zip, "project"),
    readCsv(zip, "lines"),
    readCsv(zip, "plant_equipment"),
    readCsv(zip, "equipment_groups"),
    readCsv(zip, "component_types"),
    readCsv(zip, "components"),
    readCsv(zip, "checklist_items"),
    readCsv(zip, "item_photos"),
    readCsv(zip, "item_files"),
    readCsv(zip, "item_notes"),
    readCsv(zip, "equipment_notes"),
    readCsv(zip, "equipment_photos"),
    readCsv(zip, "component_photos"),
    readCsv(zip, "component_files"),
    readCsv(zip, "component_type_notes"),
    readCsv(zip, "component_type_photos"),
    readCsv(zip, "component_type_files"),
    readCsv(zip, "note_photos"),
    readCsv(zip, "note_files"),
    readCsv(zip, "pa_folders"),
    readCsv(zip, "pa_attachments"),
    readCsv(zip, "pa_notes"),
    readCsv(zip, "line_activities"),
    readCsv(zip, "common_notes"),
    readCsv(zip, "common_files"),
  ]);

  if (projectRows.length === 0 || lineRows.length === 0) {
    throw new Error("This ZIP does not look like a valid project export (missing project or lines).");
  }

  report({ phase: "remapping", message: "Generating fresh IDs..." });

  // Build id maps
  const projMap = new Map<string, string>();
  const newProjectId = newId();
  projMap.set(projectRows[0].id, newProjectId);

  const lineMap = new Map<string, string>();
  lineRows.forEach((r) => lineMap.set(r.id, newId()));

  const peMap = new Map<string, string>();
  peRows.forEach((r) => peMap.set(r.id, newId()));

  const egMap = new Map<string, string>();
  egRows.forEach((r) => egMap.set(r.id, newId()));

  const ctMap = new Map<string, string>();
  ctRows.forEach((r) => ctMap.set(r.id, newId()));

  const compMap = new Map<string, string>();
  compRows.forEach((r) => compMap.set(r.id, newId()));

  const ciMap = new Map<string, string>();
  ciRows.forEach((r) => ciMap.set(r.id, newId()));

  const itemNoteMap = new Map<string, string>();
  itemNoteRows.forEach((r) => itemNoteMap.set(r.id, newId()));

  const equipmentNoteMap = new Map<string, string>();
  enRows.forEach((r) => equipmentNoteMap.set(r.id, newId()));

  const componentPhotoMap = new Map<string, string>();
  componentPhotoRows.forEach((r) => componentPhotoMap.set(r.id, newId()));

  const componentFileMap = new Map<string, string>();
  componentFileRows.forEach((r) => componentFileMap.set(r.id, newId()));

  const componentTypeNoteMap = new Map<string, string>();
  componentTypeNoteRows.forEach((r) => componentTypeNoteMap.set(r.id, newId()));

  const componentTypePhotoMap = new Map<string, string>();
  componentTypePhotoRows.forEach((r) => componentTypePhotoMap.set(r.id, newId()));

  const componentTypeFileMap = new Map<string, string>();
  componentTypeFileRows.forEach((r) => componentTypeFileMap.set(r.id, newId()));

  const folderMap = new Map<string, string>();
  paFolderRows.forEach((r) => folderMap.set(r.id, newId()));

  const paNoteMap = new Map<string, string>();
  paNoteRows.forEach((r) => paNoteMap.set(r.id, newId()));

  const lineActivityMap = new Map<string, string>();
  msRows.forEach((r) => lineActivityMap.set(r.id, newId()));

  const lineActivitySharedGroupMap = new Map<string, string>();
  msRows.forEach((r) => {
    if (r.shared_group_id && !lineActivitySharedGroupMap.has(r.shared_group_id)) {
      lineActivitySharedGroupMap.set(r.shared_group_id, newId());
    }
  });

  const { data: userData } = await supabase.auth.getUser();
  const importerId = userData.user?.id ?? null;

  // ---- Build payload rows ---------------------------------------------
  const project = {
    id: newProjectId,
    name: newProjectName,
    created_by: importerId,
    created_at: new Date().toISOString(),
  };

  const lines = lineRows.map((r) => ({
    id: lineMap.get(r.id),
    project_id: newProjectId,
    number: parseInt(r.number, 10),
    name: r.name,
    hot_planned_start: r.hot_planned_start || null,
    hot_planned_end: r.hot_planned_end || null,
    created_at: r.created_at || new Date().toISOString(),
  }));

  // Skip soft-deleted items. IMPORTANT: filter children against these live
  // sets (not the *Map maps, which include deleted parent IDs) - otherwise
  // children of soft-deleted parents leak through and cause FK violations.
  const livePe = peRows.filter((r) => !r.deleted_at);
  const livePeIds = new Set(livePe.map((r) => r.id));
  const plant_equipment = livePe.map((r) => ({
    id: peMap.get(r.id),
    line_id: lineMap.get(r.line_id),
    kind: r.kind,
    name: r.name,
    sort_order: parseInt(r.sort_order || "0", 10),
    template_id: r.template_id || null,
    mech_mode: r.mech_mode || "manual",
    mech_manual_pct: r.mech_manual_pct ? parseInt(r.mech_manual_pct, 10) : null,
    mech_notes: r.mech_notes || null,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: r.updated_at || new Date().toISOString(),
  }));

  const liveEg = egRows.filter((r) => !r.deleted_at && lineMap.has(r.line_id) && (!r.plant_equipment_id || livePeIds.has(r.plant_equipment_id)));
  const liveEgIds = new Set(liveEg.map((r) => r.id));
  const equipment_groups = liveEg.map((r) => ({
    id: egMap.get(r.id),
    line_id: lineMap.get(r.line_id),
    plant_equipment_id: r.plant_equipment_id ? peMap.get(r.plant_equipment_id) : null,
    chapter: r.chapter,
    kind: r.kind,
    name: r.name,
    sort_order: parseInt(r.sort_order || "0", 10),
    template_id: r.template_id || null,
    created_at: r.created_at || new Date().toISOString(),
  }));

  const liveCt = ctRows.filter((r) => !r.deleted_at && liveEgIds.has(r.equipment_group_id));
  const liveCtIds = new Set(liveCt.map((r) => r.id));
  const component_types = liveCt.map((r) => ({
    id: ctMap.get(r.id),
    equipment_group_id: egMap.get(r.equipment_group_id),
    name: r.name,
    sort_order: parseInt(r.sort_order || "0", 10),
    template_id: r.template_id || null,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: r.updated_at || new Date().toISOString(),
  }));

  const liveComp = compRows.filter((r) => !r.deleted_at && (
    (r.equipment_id && liveEgIds.has(r.equipment_id)) ||
    (r.component_type_id && liveCtIds.has(r.component_type_id))
  ));
  const liveCompIds = new Set(liveComp.map((r) => r.id));
  const components = liveComp.map((r) => ({
    id: compMap.get(r.id),
    equipment_id: r.equipment_id && liveEgIds.has(r.equipment_id) ? egMap.get(r.equipment_id) : null,
    component_type_id: r.component_type_id && liveCtIds.has(r.component_type_id) ? ctMap.get(r.component_type_id) : null,
    name: r.name,
    note: r.note || null,
    note_shared: r.note_shared === "true",
    sort_order: parseInt(r.sort_order || "0", 10),
    template_id: r.template_id || null,
    created_at: r.created_at || new Date().toISOString(),
  }));

  const attachedCi = ciRows.filter((r) => !r.deleted_at && (
    (r.component_id && liveCompIds.has(r.component_id)) ||
    (r.component_type_id && liveCtIds.has(r.component_type_id))
  ));
  const attachedCiIds = new Set(attachedCi.map((r) => r.id));
  const liveCi = attachedCi.filter((r) => !r.parent_item_id || attachedCiIds.has(r.parent_item_id));
  const liveCiIds = new Set(liveCi.map((r) => r.id));
  const checklist_items = liveCi.map((r) => ({
    id: ciMap.get(r.id),
    component_id: r.component_id && liveCompIds.has(r.component_id) ? compMap.get(r.component_id) : null,
    component_type_id: r.component_type_id && liveCtIds.has(r.component_type_id) ? ctMap.get(r.component_type_id) : null,
    parent_item_id: r.parent_item_id ? ciMap.get(r.parent_item_id) ?? null : null,
    label: r.label,
    done: r.done === "true",
    note: r.note || null,
    note_shared: r.note_shared === "true",
    local_line_id: r.local_line_id && lineMap.has(r.local_line_id) ? lineMap.get(r.local_line_id) : null,
    origin_line_id: r.origin_line_id && lineMap.has(r.origin_line_id) ? lineMap.get(r.origin_line_id) : null,
    sort_order: parseInt(r.sort_order || "0", 10),
    template_id: r.template_id || null,
    completed_at: r.completed_at || null,
    completed_by: r.completed_by ? importerId : null,
    flagged: r.flagged === "true",
    flagged_at: r.flagged_at || null,
    flag_priority: r.flag_priority || null,
    flag_wait_days: r.flag_wait_days ? parseInt(r.flag_wait_days, 10) : null,
    flag_due_date: r.flag_due_date || null,
    flag_reason: r.flag_reason || null,
    flag_status: r.flag_status || null,
    flag_resolved_at: r.flag_resolved_at || null,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: r.updated_at || new Date().toISOString(),
  }));

  // Media row maps - keep original storage_path in payload so the trigger
  // sees it; we'll re-upload to NEW path then update each row.
  type MediaJob = { table: string; oldPath: string; oldFileName?: string | null; newPath: string; bucket: "photos" | "files"; rowId: string; field: string };
  const mediaJobs: MediaJob[] = [];

  const remapStoragePath = (oldPath: string) => {
    // old storage paths often look like "<old-line-id>/..." or "<old-pe-id>/..."
    // Easiest safe scheme: prefix with new project id so we never collide.
    return `${newProjectId}/${oldPath}`;
  };

  const item_photos = ipRows.filter((r) => liveCiIds.has(r.item_id)).map((r) => {
    const id = newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "item_photos", oldPath: r.storage_path, newPath, bucket: "photos", rowId: id, field: "storage_path" });
    return {
      id,
      item_id: ciMap.get(r.item_id),
      storage_path: newPath,
      sort_order: parseInt(r.sort_order || "0", 10),
      is_shared: r.is_shared === "true",
      origin_id: null,
      origin_line_id: r.origin_line_id && lineMap.has(r.origin_line_id) ? lineMap.get(r.origin_line_id) : null,
      template_id: r.template_id || null,
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const item_files = ifRows.filter((r) => liveCiIds.has(r.item_id)).map((r) => {
    const id = newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "item_files", oldPath: r.storage_path, oldFileName: r.file_name, newPath, bucket: "files", rowId: id, field: "storage_path" });
    return {
      id,
      item_id: ciMap.get(r.item_id),
      storage_path: newPath,
      file_name: r.file_name,
      sort_order: parseInt(r.sort_order || "0", 10),
      is_shared: r.is_shared === "true",
      origin_id: null,
      origin_line_id: r.origin_line_id && lineMap.has(r.origin_line_id) ? lineMap.get(r.origin_line_id) : null,
      template_id: r.template_id || null,
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const item_notes = itemNoteRows.filter((r) => liveCiIds.has(r.item_id)).map((r) => ({
    id: itemNoteMap.get(r.id),
    item_id: ciMap.get(r.item_id),
    title: r.title || "Note",
    body: r.body || "",
    sort_order: parseInt(r.sort_order || "0", 10),
    is_shared: r.is_shared === "true",
    origin_line_id: r.origin_line_id && lineMap.has(r.origin_line_id) ? lineMap.get(r.origin_line_id) : null,
    created_by: importerId,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: r.updated_at || new Date().toISOString(),
  }));

  const equipment_notes = enRows.filter((r) => livePeIds.has(r.equipment_id)).map((r) => {
    const id = equipmentNoteMap.get(r.id) ?? newId();
    const photoPath = r.photo_path ? remapStoragePath(r.photo_path) : null;
    const filePath = r.file_path ? remapStoragePath(r.file_path) : null;
    if (r.photo_path) mediaJobs.push({ table: "equipment_notes", oldPath: r.photo_path, newPath: photoPath!, bucket: "photos", rowId: id, field: "photo_path" });
    if (r.file_path) mediaJobs.push({ table: "equipment_notes", oldPath: r.file_path, oldFileName: r.file_name, newPath: filePath!, bucket: "files", rowId: id, field: "file_path" });
    return {
      id,
      equipment_id: peMap.get(r.equipment_id),
      title: r.title || "Note",
      body: r.body || "",
      position_x: parseInt(r.position_x || "0", 10),
      position_y: parseInt(r.position_y || "0", 10),
      sort_order: parseInt(r.sort_order || "0", 10),
      is_shared: r.is_shared === "true",
      section: r.section || "general",
      photo_path: photoPath,
      file_path: filePath,
      file_name: r.file_name || null,
      created_by: importerId,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || new Date().toISOString(),
    };
  });

  const equipment_photos = epRows.filter((r) => livePeIds.has(r.equipment_id)).map((r) => {
    const id = newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "equipment_photos", oldPath: r.storage_path, newPath, bucket: "photos", rowId: id, field: "storage_path" });
    return {
      id,
      equipment_id: peMap.get(r.equipment_id),
      storage_path: newPath,
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const component_photos = componentPhotoRows.filter((r) => liveCompIds.has(r.component_id)).map((r) => {
    const id = componentPhotoMap.get(r.id) ?? newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "component_photos", oldPath: r.storage_path, newPath, bucket: "photos", rowId: id, field: "storage_path" });
    return {
      id,
      component_id: compMap.get(r.component_id),
      storage_path: newPath,
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const component_files = componentFileRows.filter((r) => liveCompIds.has(r.component_id)).map((r) => {
    const id = componentFileMap.get(r.id) ?? newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "component_files", oldPath: r.storage_path, oldFileName: r.file_name, newPath, bucket: "files", rowId: id, field: "storage_path" });
    return {
      id,
      component_id: compMap.get(r.component_id),
      storage_path: newPath,
      file_name: r.file_name || "file",
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const component_type_notes = componentTypeNoteRows.filter((r) => liveCtIds.has(r.component_type_id)).map((r) => ({
    id: componentTypeNoteMap.get(r.id),
    component_type_id: ctMap.get(r.component_type_id),
    title: r.title || "Note",
    body: r.body || "",
    sort_order: parseInt(r.sort_order || "0", 10),
    is_shared: r.is_shared === "true",
    origin_line_id: r.origin_line_id && lineMap.has(r.origin_line_id) ? lineMap.get(r.origin_line_id) : null,
    created_by: importerId,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: r.updated_at || new Date().toISOString(),
  }));

  const component_type_photos = componentTypePhotoRows.filter((r) => liveCtIds.has(r.component_type_id)).map((r) => {
    const id = componentTypePhotoMap.get(r.id) ?? newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "component_type_photos", oldPath: r.storage_path, newPath, bucket: "photos", rowId: id, field: "storage_path" });
    return {
      id,
      component_type_id: ctMap.get(r.component_type_id),
      storage_path: newPath,
      sort_order: parseInt(r.sort_order || "0", 10),
      is_shared: r.is_shared === "true",
      origin_id: r.origin_id && componentTypePhotoMap.has(r.origin_id) ? componentTypePhotoMap.get(r.origin_id) : null,
      origin_line_id: r.origin_line_id && lineMap.has(r.origin_line_id) ? lineMap.get(r.origin_line_id) : null,
      template_id: r.template_id || null,
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const component_type_files = componentTypeFileRows.filter((r) => liveCtIds.has(r.component_type_id)).map((r) => {
    const id = componentTypeFileMap.get(r.id) ?? newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "component_type_files", oldPath: r.storage_path, oldFileName: r.file_name, newPath, bucket: "files", rowId: id, field: "storage_path" });
    return {
      id,
      component_type_id: ctMap.get(r.component_type_id),
      storage_path: newPath,
      file_name: r.file_name || "file",
      sort_order: parseInt(r.sort_order || "0", 10),
      is_shared: r.is_shared === "true",
      origin_id: r.origin_id && componentTypeFileMap.has(r.origin_id) ? componentTypeFileMap.get(r.origin_id) : null,
      origin_line_id: r.origin_line_id && lineMap.has(r.origin_line_id) ? lineMap.get(r.origin_line_id) : null,
      template_id: r.template_id || null,
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const pa_folders = paFolderRows.filter((r) => lineMap.has(r.line_id)).map((r) => ({
    id: folderMap.get(r.id),
    line_id: lineMap.get(r.line_id),
    kind: r.kind,
    name: r.name || "New folder",
    sort_order: parseInt(r.sort_order || "0", 10),
    created_by: importerId,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: r.updated_at || new Date().toISOString(),
  }));

  const pa_attachments = paAttRows.filter((r) => folderMap.has(r.folder_id)).map((r) => {
    const id = newId();
    const bucket: "photos" | "files" = r.kind === "photo" ? "photos" : "files";
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "pa_attachments", oldPath: r.storage_path, oldFileName: r.file_name, newPath, bucket, rowId: id, field: "storage_path" });
    return {
      id,
      folder_id: folderMap.get(r.folder_id),
      kind: r.kind,
      storage_path: newPath,
      file_name: r.file_name || null,
      sort_order: parseInt(r.sort_order || "0", 10),
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const pa_notes = paNoteRows.filter((r) => lineMap.has(r.line_id)).map((r) => {
    const id = paNoteMap.get(r.id) ?? newId();
    const photoPath = r.photo_path ? remapStoragePath(r.photo_path) : null;
    const filePath = r.file_path ? remapStoragePath(r.file_path) : null;
    if (r.photo_path) mediaJobs.push({ table: "pa_notes", oldPath: r.photo_path, newPath: photoPath!, bucket: "photos", rowId: id, field: "photo_path" });
    if (r.file_path) mediaJobs.push({ table: "pa_notes", oldPath: r.file_path, oldFileName: r.file_name, newPath: filePath!, bucket: "files", rowId: id, field: "file_path" });
    return {
      id,
      line_id: lineMap.get(r.line_id),
      folder_id: r.folder_id ? folderMap.get(r.folder_id) ?? null : null,
      kind: r.kind,
      title: r.title || "Note",
      body: r.body || "",
      sort_order: parseInt(r.sort_order || "0", 10),
      is_shared: asBool(r.is_shared),
      photo_path: photoPath,
      file_path: filePath,
      file_name: r.file_name || null,
      created_by: importerId,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || new Date().toISOString(),
    };
  });

  const mapNoteParent = (parentKind: string, parentId: string) => {
    if (parentKind === "item_note") return itemNoteMap.get(parentId) ?? null;
    if (parentKind === "equipment_note") return equipmentNoteMap.get(parentId) ?? null;
    if (parentKind === "component_type_note") return componentTypeNoteMap.get(parentId) ?? null;
    if (parentKind === "pa_note") return paNoteMap.get(parentId) ?? null;
    return null;
  };

  const note_photos = notePhotoRows.map((r) => {
    const parentId = mapNoteParent(r.parent_kind, r.parent_id);
    if (!parentId) return null;
    const id = newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "note_photos", oldPath: r.storage_path, newPath, bucket: "photos", rowId: id, field: "storage_path" });
    return {
      id,
      parent_kind: r.parent_kind,
      parent_id: parentId,
      storage_path: newPath,
      sort_order: parseInt(r.sort_order || "0", 10),
      is_shared: r.is_shared === "true",
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  }).filter(Boolean);

  const note_files = noteFileRows.map((r) => {
    const parentId = mapNoteParent(r.parent_kind, r.parent_id);
    if (!parentId) return null;
    const id = newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "note_files", oldPath: r.storage_path, oldFileName: r.file_name, newPath, bucket: "files", rowId: id, field: "storage_path" });
    return {
      id,
      parent_kind: r.parent_kind,
      parent_id: parentId,
      storage_path: newPath,
      file_name: r.file_name || "file",
      sort_order: parseInt(r.sort_order || "0", 10),
      is_shared: r.is_shared === "true",
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  }).filter(Boolean);

  const line_activities = msRows.filter((r) => lineMap.has(r.line_id)).map((r) => {
    const startDate = r.start_date || r.date;
    if (!startDate) return null;
    const endDate = r.end_date || r.date || startDate;
    const durationDays = asInt(r.duration_days, durationFromDates(startDate, endDate));
    return {
      id: lineActivityMap.get(r.id) ?? newId(),
      line_id: lineMap.get(r.line_id),
      name: r.name || r.label || "Activity",
      start_date: startDate,
      end_date: endDate,
      color: r.color || "#3b82f6",
      is_shared: asBool(r.is_shared),
      shared_group_id: r.shared_group_id ? lineActivitySharedGroupMap.get(r.shared_group_id) ?? null : null,
      origin_line_id: r.origin_line_id && lineMap.has(r.origin_line_id) ? lineMap.get(r.origin_line_id) : null,
      created_by: importerId,
      created_at: r.created_at || new Date().toISOString(),
      show_on_global: asBool(r.show_on_global, true),
      sort_order: asInt(r.sort_order, 0),
      duration_days: Math.max(1, durationDays),
      follows_activity_id: r.follows_activity_id && lineActivityMap.has(r.follows_activity_id) ? lineActivityMap.get(r.follows_activity_id) : null,
      offset_days: asInt(r.offset_days, 0),
    };
  }).filter(Boolean);

  const common_notes = cnRows.map((r) => ({
    id: newId(),
    project_id: newProjectId,
    body: r.body || "",
    updated_by: importerId,
    updated_at: r.updated_at || new Date().toISOString(),
  }));

  const common_files = cfRows.map((r) => {
    const id = newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "common_files", oldPath: r.storage_path, oldFileName: r.name, newPath, bucket: "files", rowId: id, field: "storage_path" });
    return {
      id,
      project_id: newProjectId,
      name: r.name,
      storage_path: newPath,
      size_bytes: r.size_bytes ? parseInt(r.size_bytes, 10) : null,
      mime_type: r.mime_type || null,
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  // ---- Insert via RPC --------------------------------------------------
  report({ phase: "inserting", message: "Saving everything to the database..." });

  const payload = {
    projects: [project],
    lines, plant_equipment, equipment_groups,
    component_types, components, checklist_items,
    item_photos, item_files,
    equipment_notes, equipment_photos,
    pa_folders, pa_attachments, pa_notes,
    line_activities, common_notes, common_files,
  };

  counts.lines = lines.length;
  counts.plant_equipment = plant_equipment.length;
  counts.equipment_groups = equipment_groups.length;
  counts.component_types = component_types.length;
  counts.components = components.length;
  counts.checklist_items = checklist_items.length;
  counts.item_notes = item_notes.length;
  counts.equipment_notes = equipment_notes.length;
  counts.component_photos = component_photos.length;
  counts.component_files = component_files.length;
  counts.component_type_notes = component_type_notes.length;
  counts.component_type_photos = component_type_photos.length;
  counts.component_type_files = component_type_files.length;
  counts.note_photos = note_photos.length;
  counts.note_files = note_files.length;
  counts.pa_folders = pa_folders.length;
  counts.pa_notes = pa_notes.length;
  counts.line_activities = line_activities.length;

  const { error: rpcErr } = await supabase.rpc("import_project_bulk", { payload: payload as any });
  if (rpcErr) {
    console.error("import_project_bulk failed:", rpcErr);
    const detail = [rpcErr.message, rpcErr.details, rpcErr.hint].filter(Boolean).join(" ");
    throw new Error(`Database insert failed${detail ? `: ${detail}` : "."}`);
  }

  await insertRows("item_notes", item_notes);
  await insertRows("component_photos", component_photos);
  await insertRows("component_files", component_files);
  await insertRows("component_type_notes", component_type_notes);
  await insertRows("component_type_photos", component_type_photos);
  await insertRows("component_type_files", component_type_files);
  await insertRows("note_photos", note_photos);
  await insertRows("note_files", note_files);

  // ---- Upload media ----------------------------------------------------
  let mediaUploaded = 0;
  let mediaMissing = 0;

  if (mediaJobs.length > 0) {
    report({ phase: "media", message: "Uploading photos & files...", current: 0, total: mediaJobs.length });

    // Try multiple plausible locations inside the ZIP for each oldPath.
    // Prefer the storage-path basename (current export format), but fall back
    // to the original file_name and a sanitized variant of it (legacy export).
    const sanitize = (s: string) => s.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80);
    const findInZip = (oldPath: string, oldFileName: string | null | undefined, bucket: "photos" | "files"): JSZip.JSZipObject | null => {
      const candidates = new Set<string>();
      const baseFromPath = oldPath.split("/").pop();
      if (baseFromPath) candidates.add(baseFromPath);
      if (oldFileName) {
        candidates.add(oldFileName);
        candidates.add(sanitize(oldFileName));
      }
      const prefix = bucket === "photos" ? "photos/" : "files/";
      for (const k of Object.keys(zip.files)) {
        if (zip.files[k].dir) continue;
        const rel = root && k.startsWith(root) ? k.slice(root.length) : k;
        if (!rel.startsWith(prefix)) continue;
        const relBase = rel.split("/").pop() ?? "";
        for (const c of candidates) {
          if (relBase === c) return zip.files[k];
        }
      }
      return null;
    };

    let i = 0;
    const workers = Array.from({ length: 4 }, async () => {
      while (i < mediaJobs.length) {
        if (signal?.aborted) throw new Error("Import cancelled");
        const idx = i++;
        const job = mediaJobs[idx];
        const entry = findInZip(job.oldPath, job.oldFileName, job.bucket);
        if (!entry) {
          mediaMissing++;
        } else {
          const blob = await entry.async("blob");
          const { error: upErr } = await supabase.storage.from(job.bucket).upload(job.newPath, blob, { upsert: true });
          if (upErr) {
            mediaMissing++;
          } else {
            mediaUploaded++;
          }
        }
        report({ phase: "media", message: "Uploading photos & files...", current: idx + 1, total: mediaJobs.length });
      }
    });
    await Promise.all(workers);
  }

  report({ phase: "done", message: "Import complete." });

  return { newProjectId, counts, mediaUploaded, mediaMissing };
}

export async function rollbackImport(projectId: string) {
  const { error } = await supabase.rpc("delete_project_cascade", { p_project_id: projectId });
  if (error) throw error;
}
