import Dexie, { type Table } from "dexie";

export type CachedRow = { projectId: string; id: string; data: any };
export type CachedAttachment = {
  key: string; // `${bucket}::${storage_path}`
  projectId: string;
  bucket: "photos" | "files";
  storage_path: string;
  blob: Blob;
  mime: string;
  size: number;
  cached_at: number;
};
export type SyncState = {
  projectId: string;
  last_full_sync_at: number | null;
  in_progress: boolean;
};

class OfflineDB extends Dexie {
  lines!: Table<CachedRow, string>;
  plant_equipment!: Table<CachedRow, string>;
  equipment_groups!: Table<CachedRow, string>;
  component_types!: Table<CachedRow, string>;
  components!: Table<CachedRow, string>;
  equipment_settings!: Table<CachedRow, string>;
  checklist_items!: Table<CachedRow, string>;
  equipment_notes!: Table<CachedRow, string>;
  pa_notes!: Table<CachedRow, string>;
  common_folder_notes!: Table<CachedRow, string>;
  setting_photos!: Table<CachedRow, string>;
  setting_files!: Table<CachedRow, string>;
  item_photos!: Table<CachedRow, string>;
  item_files!: Table<CachedRow, string>;
  attachments!: Table<CachedAttachment, string>;
  sync_state!: Table<SyncState, string>;

  constructor() {
    super("ai_search_offline");
    this.version(1).stores({
      lines: "id, projectId",
      plant_equipment: "id, projectId",
      equipment_groups: "id, projectId",
      component_types: "id, projectId",
      components: "id, projectId",
      equipment_settings: "id, projectId",
      checklist_items: "id, projectId",
      equipment_notes: "id, projectId",
      pa_notes: "id, projectId",
      common_folder_notes: "id, projectId",
      setting_photos: "id, projectId",
      setting_files: "id, projectId",
      item_photos: "id, projectId",
      item_files: "id, projectId",
      attachments: "key, projectId",
      sync_state: "projectId",
    });
  }
}

export const offlineDB = new OfflineDB();

export function attachmentKey(bucket: string, path: string) {
  return `${bucket}::${path}`;
}

export async function getAttachmentBlob(
  bucket: "photos" | "files",
  path: string,
): Promise<Blob | null> {
  const row = await offlineDB.attachments.get(attachmentKey(bucket, path));
  return row?.blob ?? null;
}

export async function getCacheSize(projectId: string): Promise<{ rows: number; bytes: number }> {
  const atts = await offlineDB.attachments.where("projectId").equals(projectId).toArray();
  const bytes = atts.reduce((s, a) => s + (a.size || 0), 0);
  const rows = await Promise.all(
    [
      offlineDB.equipment_settings,
      offlineDB.checklist_items,
      offlineDB.equipment_notes,
      offlineDB.pa_notes,
      offlineDB.common_folder_notes,
    ].map((t) => t.where("projectId").equals(projectId).count()),
  );
  return { rows: rows.reduce((s, n) => s + n, 0), bytes };
}

export async function clearProjectCache(projectId: string) {
  const tables: Table<any, any>[] = [
    offlineDB.lines,
    offlineDB.plant_equipment,
    offlineDB.equipment_groups,
    offlineDB.component_types,
    offlineDB.components,
    offlineDB.equipment_settings,
    offlineDB.checklist_items,
    offlineDB.equipment_notes,
    offlineDB.pa_notes,
    offlineDB.common_folder_notes,
    offlineDB.setting_photos,
    offlineDB.setting_files,
    offlineDB.item_photos,
    offlineDB.item_files,
    offlineDB.attachments,
  ];
  await Promise.all(
    tables.map((t) => t.where("projectId").equals(projectId).delete()),
  );
  await offlineDB.sync_state.delete(projectId);
}
