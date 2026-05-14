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

async function readCsv(zip: JSZip, name: string): Promise<Record<string, string>[]> {
  // tables live at <root>/tables/<name>.csv
  const matches = Object.keys(zip.files).filter((p) => p.endsWith(`/tables/${name}.csv`) || p === `tables/${name}.csv`);
  if (matches.length === 0) return [];
  const txt = await zip.files[matches[0]].async("string");
  return parseCsv(txt);
}

export async function importProjectFromZip(opts: Opts): Promise<ImportSummary> {
  const { zipFile, newProjectName, onProgress, signal } = opts;
  const report = (p: ImportProgress) => onProgress?.(p);
  const counts: Record<string, number> = {};

  report({ phase: "reading", message: "Reading ZIP…" });
  const zip = await JSZip.loadAsync(zipFile);

  // Detect zip root prefix (everything inside one folder named like project-YYYY-MM-DD)
  const firstFile = Object.keys(zip.files).find((n) => n.includes("/tables/"));
  const root = firstFile ? firstFile.split("/tables/")[0] + "/" : "";

  // Load all CSVs
  const [
    projectRows, lineRows, peRows, egRows, ctRows, compRows, ciRows,
    ipRows, ifRows, enRows, epRows, paFolderRows, paAttRows, paNoteRows,
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
    readCsv(zip, "equipment_notes"),
    readCsv(zip, "equipment_photos"),
    readCsv(zip, "pa_folders"),
    readCsv(zip, "pa_attachments"),
    readCsv(zip, "pa_notes"),
    readCsv(zip, "milestones"),
    readCsv(zip, "common_notes"),
    readCsv(zip, "common_files"),
  ]);

  if (projectRows.length === 0 || lineRows.length === 0) {
    throw new Error("This ZIP does not look like a valid project export (missing project or lines).");
  }

  report({ phase: "remapping", message: "Generating fresh IDs…" });

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

  const folderMap = new Map<string, string>();
  paFolderRows.forEach((r) => folderMap.set(r.id, newId()));

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
  // sets (not the *Map maps, which include deleted parent IDs) — otherwise
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
    sort_order: parseInt(r.sort_order || "0", 10),
    template_id: r.template_id || null,
    created_at: r.created_at || new Date().toISOString(),
  }));

  const liveCi = ciRows.filter((r) => !r.deleted_at && liveCompIds.has(r.component_id));
  const checklist_items = liveCi.map((r) => ({
    id: ciMap.get(r.id),
    component_id: compMap.get(r.component_id),
    parent_item_id: r.parent_item_id ? ciMap.get(r.parent_item_id) ?? null : null,
    label: r.label,
    done: r.done === "true",
    note: r.note || null,
    sort_order: parseInt(r.sort_order || "0", 10),
    template_id: r.template_id || null,
    completed_at: r.completed_at || null,
    completed_by: r.completed_by ? importerId : null,
    created_at: r.created_at || new Date().toISOString(),
    updated_at: r.updated_at || new Date().toISOString(),
  }));

  // Media row maps — keep original storage_path in payload so the trigger
  // sees it; we'll re-upload to NEW path then update each row.
  type MediaJob = { table: string; oldPath: string; newPath: string; bucket: "photos" | "files"; rowId: string; field: string };
  const mediaJobs: MediaJob[] = [];

  const remapStoragePath = (oldPath: string) => {
    // old storage paths often look like "<old-line-id>/..." or "<old-pe-id>/..."
    // Easiest safe scheme: prefix with new project id so we never collide.
    return `${newProjectId}/${oldPath}`;
  };

  const item_photos = ipRows.filter((r) => ciMap.has(r.item_id)).map((r) => {
    const id = newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "item_photos", oldPath: r.storage_path, newPath, bucket: "photos", rowId: id, field: "storage_path" });
    return {
      id,
      item_id: ciMap.get(r.item_id),
      storage_path: newPath,
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const item_files = ifRows.filter((r) => ciMap.has(r.item_id)).map((r) => {
    const id = newId();
    const newPath = remapStoragePath(r.storage_path);
    if (r.storage_path) mediaJobs.push({ table: "item_files", oldPath: r.storage_path, newPath, bucket: "files", rowId: id, field: "storage_path" });
    return {
      id,
      item_id: ciMap.get(r.item_id),
      storage_path: newPath,
      file_name: r.file_name,
      uploaded_by: importerId,
      uploaded_at: r.uploaded_at || new Date().toISOString(),
    };
  });

  const equipment_notes = enRows.filter((r) => peMap.has(r.equipment_id)).map((r) => {
    const id = newId();
    const photoPath = r.photo_path ? remapStoragePath(r.photo_path) : null;
    const filePath = r.file_path ? remapStoragePath(r.file_path) : null;
    if (r.photo_path) mediaJobs.push({ table: "equipment_notes", oldPath: r.photo_path, newPath: photoPath!, bucket: "photos", rowId: id, field: "photo_path" });
    if (r.file_path) mediaJobs.push({ table: "equipment_notes", oldPath: r.file_path, newPath: filePath!, bucket: "files", rowId: id, field: "file_path" });
    return {
      id,
      equipment_id: peMap.get(r.equipment_id),
      title: r.title || "Note",
      body: r.body || "",
      position_x: parseInt(r.position_x || "0", 10),
      position_y: parseInt(r.position_y || "0", 10),
      sort_order: parseInt(r.sort_order || "0", 10),
      photo_path: photoPath,
      file_path: filePath,
      file_name: r.file_name || null,
      created_by: importerId,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || new Date().toISOString(),
    };
  });

  const equipment_photos = epRows.filter((r) => peMap.has(r.equipment_id)).map((r) => {
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
    if (r.storage_path) mediaJobs.push({ table: "pa_attachments", oldPath: r.storage_path, newPath, bucket, rowId: id, field: "storage_path" });
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
    const id = newId();
    const photoPath = r.photo_path ? remapStoragePath(r.photo_path) : null;
    const filePath = r.file_path ? remapStoragePath(r.file_path) : null;
    if (r.photo_path) mediaJobs.push({ table: "pa_notes", oldPath: r.photo_path, newPath: photoPath!, bucket: "photos", rowId: id, field: "photo_path" });
    if (r.file_path) mediaJobs.push({ table: "pa_notes", oldPath: r.file_path, newPath: filePath!, bucket: "files", rowId: id, field: "file_path" });
    return {
      id,
      line_id: lineMap.get(r.line_id),
      folder_id: r.folder_id ? folderMap.get(r.folder_id) ?? null : null,
      kind: r.kind,
      title: r.title || "Note",
      body: r.body || "",
      sort_order: parseInt(r.sort_order || "0", 10),
      photo_path: photoPath,
      file_path: filePath,
      file_name: r.file_name || null,
      created_by: importerId,
      created_at: r.created_at || new Date().toISOString(),
      updated_at: r.updated_at || new Date().toISOString(),
    };
  });

  const milestones = msRows.filter((r) => lineMap.has(r.line_id)).map((r) => ({
    id: newId(),
    line_id: lineMap.get(r.line_id),
    label: r.label,
    date: r.date,
    notes: r.notes || null,
    created_by: importerId,
    created_at: r.created_at || new Date().toISOString(),
  }));

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
    if (r.storage_path) mediaJobs.push({ table: "common_files", oldPath: r.storage_path, newPath, bucket: "files", rowId: id, field: "storage_path" });
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
  report({ phase: "inserting", message: "Saving everything to the database…" });

  const payload = {
    projects: [project],
    lines, plant_equipment, equipment_groups,
    component_types, components, checklist_items,
    item_photos, item_files,
    equipment_notes, equipment_photos,
    pa_folders, pa_attachments, pa_notes,
    milestones, common_notes, common_files,
  };

  counts.lines = lines.length;
  counts.plant_equipment = plant_equipment.length;
  counts.equipment_groups = equipment_groups.length;
  counts.component_types = component_types.length;
  counts.components = components.length;
  counts.checklist_items = checklist_items.length;
  counts.equipment_notes = equipment_notes.length;
  counts.pa_folders = pa_folders.length;
  counts.pa_notes = pa_notes.length;
  counts.milestones = milestones.length;

  const { error: rpcErr } = await supabase.rpc("import_project_bulk", { payload: payload as any });
  if (rpcErr) {
    throw new Error(`Database insert failed: ${rpcErr.message}`);
  }

  // ---- Upload media ----------------------------------------------------
  let mediaUploaded = 0;
  let mediaMissing = 0;

  if (mediaJobs.length > 0) {
    report({ phase: "media", message: "Uploading photos & files…", current: 0, total: mediaJobs.length });

    // Try multiple plausible locations inside the ZIP for each oldPath
    const findInZip = (oldPath: string, bucket: "photos" | "files"): JSZip.JSZipObject | null => {
      const fname = oldPath.split("/").pop()!;
      // Walk all files in the bucket-letter top folder
      const prefix = bucket === "photos" ? "photos/" : "files/";
      for (const k of Object.keys(zip.files)) {
        const rel = root && k.startsWith(root) ? k.slice(root.length) : k;
        if (rel.startsWith(prefix) && rel.endsWith("/" + fname)) return zip.files[k];
        if (rel.startsWith(prefix) && rel.endsWith(fname) && !zip.files[k].dir) return zip.files[k];
      }
      return null;
    };

    let i = 0;
    const workers = Array.from({ length: 4 }, async () => {
      while (i < mediaJobs.length) {
        if (signal?.aborted) throw new Error("Import cancelled");
        const idx = i++;
        const job = mediaJobs[idx];
        const entry = findInZip(job.oldPath, job.bucket);
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
        report({ phase: "media", message: "Uploading photos & files…", current: idx + 1, total: mediaJobs.length });
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
