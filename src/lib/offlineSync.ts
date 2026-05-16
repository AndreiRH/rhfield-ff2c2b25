import { supabase } from "@/integrations/supabase/client";
import { offlineDB, attachmentKey, type CachedRow } from "./offlineCache";

type Progress = (info: { phase: string; done: number; total: number }) => void;

async function upsertRows(
  table: keyof typeof offlineDB & string,
  projectId: string,
  rows: any[],
) {
  if (!rows?.length) return;
  const t = (offlineDB as any)[table];
  await t.bulkPut(rows.map((r) => ({ id: r.id, projectId, data: r }) as CachedRow));
}

async function fetchAll<T>(
  table: string,
  select: string,
  filter: (q: any) => any,
): Promise<T[]> {
  const out: T[] = [];
  const PAGE = 1000;
  let from = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let q = (supabase as any).from(table).select(select).range(from, from + PAGE - 1);
    q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

export async function syncProject(projectId: string, onProgress?: Progress) {
  const state = (await offlineDB.sync_state.get(projectId)) ?? {
    projectId,
    last_full_sync_at: null,
    in_progress: false,
  };
  if (state.in_progress) return;
  await offlineDB.sync_state.put({ ...state, in_progress: true });

  try {
    onProgress?.({ phase: "lines", done: 0, total: 0 });
    const lines = await fetchAll<any>("lines", "*", (q) => q.eq("project_id", projectId));
    await upsertRows("lines", projectId, lines);
    const lineIds = lines.map((l) => l.id);

    onProgress?.({ phase: "equipment", done: 0, total: 0 });
    const equipment = lineIds.length
      ? await fetchAll<any>("plant_equipment", "*", (q) => q.in("line_id", lineIds))
      : [];
    await upsertRows("plant_equipment", projectId, equipment);
    const eqIds = equipment.map((e) => e.id);

    onProgress?.({ phase: "groups", done: 0, total: 0 });
    const groups = lineIds.length
      ? await fetchAll<any>("equipment_groups", "*", (q) => q.in("line_id", lineIds))
      : [];
    await upsertRows("equipment_groups", projectId, groups);
    const groupIds = groups.map((g) => g.id);

    onProgress?.({ phase: "component_types", done: 0, total: 0 });
    const types = groupIds.length
      ? await fetchAll<any>("component_types", "*", (q) => q.in("equipment_group_id", groupIds))
      : [];
    await upsertRows("component_types", projectId, types);
    const typeIds = types.map((t) => t.id);

    onProgress?.({ phase: "components", done: 0, total: 0 });
    const comps = await fetchAll<any>("components", "*", (q) => {
      if (groupIds.length && typeIds.length)
        return q.or(
          `equipment_id.in.(${groupIds.join(",")}),component_type_id.in.(${typeIds.join(",")})`,
        );
      if (groupIds.length) return q.in("equipment_id", groupIds);
      if (typeIds.length) return q.in("component_type_id", typeIds);
      return q.eq("id", "00000000-0000-0000-0000-000000000000");
    });
    await upsertRows("components", projectId, comps);
    const compIds = comps.map((c) => c.id);

    onProgress?.({ phase: "settings", done: 0, total: 0 });
    const settings = eqIds.length
      ? await fetchAll<any>("equipment_settings", "*", (q) => q.in("plant_equipment_id", eqIds))
      : [];
    await upsertRows("equipment_settings", projectId, settings);
    const settingIds = settings.map((s) => s.id);

    onProgress?.({ phase: "checklists", done: 0, total: 0 });
    const items = await fetchAll<any>("checklist_items", "*", (q) => {
      if (compIds.length && typeIds.length)
        return q.or(
          `component_id.in.(${compIds.join(",")}),component_type_id.in.(${typeIds.join(",")})`,
        );
      if (compIds.length) return q.in("component_id", compIds);
      if (typeIds.length) return q.in("component_type_id", typeIds);
      return q.eq("id", "00000000-0000-0000-0000-000000000000");
    });
    await upsertRows("checklist_items", projectId, items);
    const itemIds = items.map((i) => i.id);

    onProgress?.({ phase: "notes", done: 0, total: 0 });
    const [eqNotes, paNotes, commonNotes] = await Promise.all([
      eqIds.length
        ? fetchAll<any>("equipment_notes", "*", (q) => q.in("equipment_id", eqIds))
        : Promise.resolve([]),
      lineIds.length
        ? fetchAll<any>("pa_notes", "*", (q) => q.in("line_id", lineIds))
        : Promise.resolve([]),
      fetchAll<any>("common_folder_notes", "*", (q) => q.eq("project_id", projectId)),
    ]);
    await upsertRows("equipment_notes", projectId, eqNotes);
    await upsertRows("pa_notes", projectId, paNotes);
    await upsertRows("common_folder_notes", projectId, commonNotes);

    onProgress?.({ phase: "attachment_meta", done: 0, total: 0 });
    const [settingPhotos, settingFiles, itemPhotos, itemFiles] = await Promise.all([
      settingIds.length
        ? fetchAll<any>("setting_photos", "*", (q) => q.in("equipment_setting_id", settingIds))
        : Promise.resolve([]),
      settingIds.length
        ? fetchAll<any>("setting_files", "*", (q) => q.in("equipment_setting_id", settingIds))
        : Promise.resolve([]),
      itemIds.length
        ? fetchAll<any>("item_photos", "*", (q) => q.in("item_id", itemIds))
        : Promise.resolve([]),
      itemIds.length
        ? fetchAll<any>("item_files", "*", (q) => q.in("item_id", itemIds))
        : Promise.resolve([]),
    ]);
    await upsertRows("setting_photos", projectId, settingPhotos);
    await upsertRows("setting_files", projectId, settingFiles);
    await upsertRows("item_photos", projectId, itemPhotos);
    await upsertRows("item_files", projectId, itemFiles);

    // Collect every (bucket, path) to cache
    const targets: { bucket: "photos" | "files"; path: string }[] = [];
    const addPhoto = (p?: string | null) => p && targets.push({ bucket: "photos", path: p });
    const addFile = (p?: string | null) => p && targets.push({ bucket: "files", path: p });
    settingPhotos.forEach((r) => addPhoto(r.storage_path));
    settingFiles.forEach((r) => addFile(r.storage_path));
    itemPhotos.forEach((r) => addPhoto(r.storage_path));
    itemFiles.forEach((r) => addFile(r.storage_path));
    eqNotes.forEach((r) => { addPhoto(r.photo_path); addFile(r.file_path); });
    paNotes.forEach((r) => { addPhoto(r.photo_path); addFile(r.file_path); });
    commonNotes.forEach((r) => { addPhoto(r.photo_path); addFile(r.file_path); });
    settings.forEach((r) => { addPhoto(r.photo_path); addFile(r.file_path); });

    // Dedup
    const seen = new Set<string>();
    const dedup = targets.filter((t) => {
      const k = attachmentKey(t.bucket, t.path);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    onProgress?.({ phase: "attachments", done: 0, total: dedup.length });

    // Skip already-cached
    const existing = new Set(
      (await offlineDB.attachments.where("projectId").equals(projectId).primaryKeys()) as string[],
    );

    let done = 0;
    const CONCURRENCY = 4;
    let cursor = 0;
    async function worker() {
      while (cursor < dedup.length) {
        const i = cursor++;
        const { bucket, path } = dedup[i];
        const key = attachmentKey(bucket, path);
        done++;
        onProgress?.({ phase: "attachments", done, total: dedup.length });
        if (existing.has(key)) continue;
        try {
          const { data, error } = await supabase.storage.from(bucket).download(path);
          if (error || !data) continue;
          await offlineDB.attachments.put({
            key,
            projectId,
            bucket,
            storage_path: path,
            blob: data,
            mime: data.type || "application/octet-stream",
            size: data.size,
            cached_at: Date.now(),
          });
        } catch {
          // skip on error; will retry on next sync
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    await offlineDB.sync_state.put({
      projectId,
      last_full_sync_at: Date.now(),
      in_progress: false,
    });
  } catch (err) {
    await offlineDB.sync_state.put({
      ...(await offlineDB.sync_state.get(projectId))!,
      in_progress: false,
    });
    throw err;
  }
}

let lastSyncAt = 0;
let pending: NodeJS.Timeout | null = null;

export function scheduleBackgroundSync(projectId: string) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return;
  const now = Date.now();
  if (now - lastSyncAt < 5000) return;
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    lastSyncAt = Date.now();
    syncProject(projectId).catch(() => {});
  }, 1500);
}
