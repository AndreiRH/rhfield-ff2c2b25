import { offlineDB } from "./offlineCache";
import type { SearchResult, SearchResponse } from "./aiSearch.functions";

type Plan = SearchResponse["plan"];

const STOPWORDS = new Set([
  "the","a","an","of","in","on","for","to","from","and","or","with","is","are",
  "all","every","any","show","me","please","what","which","that","this","get",
  "find","list","across","by","at","do","done","not","i","want","need",
]);

const SOURCE_HINTS: Record<string, Plan["sources"][number][]> = {
  setting: ["settings"],
  settings: ["settings"],
  config: ["settings"],
  parameter: ["settings"],
  parameters: ["settings"],
  check: ["checklist_items"],
  checks: ["checklist_items"],
  checklist: ["checklist_items"],
  item: ["checklist_items"],
  items: ["checklist_items"],
  task: ["checklist_items"],
  tasks: ["checklist_items"],
  sensor: ["checklist_items"],
  sensors: ["checklist_items"],
  status: ["checklist_items"],
  note: ["equipment_notes", "pa_notes", "common_notes"],
  notes: ["equipment_notes", "pa_notes", "common_notes"],
  pa: ["pa_notes"],
  common: ["common_notes"],
  photo: ["checklist_items", "equipment_notes", "settings"],
  photos: ["checklist_items", "equipment_notes", "settings"],
  file: ["checklist_items", "equipment_notes", "settings"],
  files: ["checklist_items", "equipment_notes", "settings"],
  attachment: ["checklist_items", "equipment_notes", "settings"],
  attachments: ["checklist_items", "equipment_notes", "settings"],
};

export function parseQueryOffline(question: string): Plan {
  const lower = question.toLowerCase();
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  const sources = new Set<Plan["sources"][number]>();
  const keywords: string[] = [];
  const equipmentKinds: ("kiln" | "shs")[] = [];
  const lineNumbers: number[] = [];
  let doneFilter: Plan["doneFilter"] = "any";

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (SOURCE_HINTS[t]) SOURCE_HINTS[t].forEach((s) => sources.add(s));
    if (t === "kiln" || t === "kilns") equipmentKinds.push("kiln");
    if (t === "shs") equipmentKinds.push("shs");
    if (t === "line" && tokens[i + 1] && /^\d+$/.test(tokens[i + 1])) {
      lineNumbers.push(Number(tokens[i + 1]));
    }
    if (t === "done" && tokens[i - 1] !== "not") doneFilter = "done";
    if (t === "not" && tokens[i + 1] === "done") doneFilter = "not_done";
    if (t === "undone" || t === "pending" || t === "open") doneFilter = "not_done";
    if (t.length > 2 && !STOPWORDS.has(t) && !/^\d+$/.test(t) && !SOURCE_HINTS[t]) {
      if (!keywords.includes(t)) keywords.push(t);
    }
  }

  if (sources.size === 0) {
    ["settings", "checklist_items", "equipment_notes", "pa_notes", "common_notes"].forEach(
      (s) => sources.add(s as any),
    );
  }

  return {
    sources: Array.from(sources),
    keywords: keywords.slice(0, 8),
    equipmentKinds: equipmentKinds.length ? Array.from(new Set(equipmentKinds)) : undefined,
    lineNumbers: lineNumbers.length ? Array.from(new Set(lineNumbers)) : undefined,
    doneFilter,
  };
}

function matchKeywords(keywords: string[], ...fields: (string | null | undefined)[]) {
  if (!keywords.length) return true;
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return keywords.every((k) => hay.includes(k));
}

export async function runOfflineSearch(
  projectId: string,
  question: string,
  scope: { lineId?: string },
): Promise<SearchResponse> {
  const plan = parseQueryOffline(question);

  const allLines = (await offlineDB.lines.where("projectId").equals(projectId).toArray())
    .map((r) => r.data);
  const lines = allLines.filter((l) => {
    if (scope.lineId && l.id !== scope.lineId) return false;
    if (plan.lineNumbers?.length && !plan.lineNumbers.includes(l.number)) return false;
    return true;
  });
  const lineIds = new Set(lines.map((l) => l.id));
  const lineNumberById = new Map(lines.map((l) => [l.id, l.number] as const));

  const allEquipment = (await offlineDB.plant_equipment.where("projectId").equals(projectId).toArray())
    .map((r) => r.data)
    .filter((e) => !e.deleted_at && lineIds.has(e.line_id));
  const equipment = allEquipment.filter((e) => {
    if (plan.equipmentKinds?.length && !plan.equipmentKinds.includes(e.kind)) return false;
    return true;
  });
  const equipmentById = new Map(equipment.map((e) => [e.id, e] as const));
  const eqIds = new Set(equipment.map((e) => e.id));

  const groups = (await offlineDB.equipment_groups.where("projectId").equals(projectId).toArray())
    .map((r) => r.data)
    .filter((g) => !g.deleted_at && g.plant_equipment_id && eqIds.has(g.plant_equipment_id));
  const groupToEq = new Map<string, string>();
  groups.forEach((g) => groupToEq.set(g.id, g.plant_equipment_id));

  const types = (await offlineDB.component_types.where("projectId").equals(projectId).toArray())
    .map((r) => r.data)
    .filter((t) => !t.deleted_at && groupToEq.has(t.equipment_group_id));
  const typeInfo = new Map<string, { name: string; equipmentId: string }>();
  types.forEach((t) =>
    typeInfo.set(t.id, { name: t.name, equipmentId: groupToEq.get(t.equipment_group_id)! }),
  );

  const components = (await offlineDB.components.where("projectId").equals(projectId).toArray())
    .map((r) => r.data)
    .filter((c) => !c.deleted_at);
  const compInfo = new Map<string, { name: string; equipmentId: string; typeName: string | null }>();
  for (const c of components) {
    if (c.component_type_id && typeInfo.has(c.component_type_id)) {
      const t = typeInfo.get(c.component_type_id)!;
      compInfo.set(c.id, { name: c.name, equipmentId: t.equipmentId, typeName: t.name });
    } else if (c.equipment_id && groupToEq.has(c.equipment_id)) {
      compInfo.set(c.id, {
        name: c.name,
        equipmentId: groupToEq.get(c.equipment_id)!,
        typeName: null,
      });
    }
  }

  // Attachments lookups
  const settingPhotosByS = new Map<string, string[]>();
  const settingFilesByS = new Map<string, { storage_path: string; file_name: string | null }[]>();
  (await offlineDB.setting_photos.where("projectId").equals(projectId).toArray())
    .map((r) => r.data)
    .forEach((p) => {
      const arr = settingPhotosByS.get(p.equipment_setting_id) ?? [];
      arr.push(p.storage_path);
      settingPhotosByS.set(p.equipment_setting_id, arr);
    });
  (await offlineDB.setting_files.where("projectId").equals(projectId).toArray())
    .map((r) => r.data)
    .forEach((f) => {
      const arr = settingFilesByS.get(f.equipment_setting_id) ?? [];
      arr.push({ storage_path: f.storage_path, file_name: f.file_name });
      settingFilesByS.set(f.equipment_setting_id, arr);
    });

  const itemPhotosByI = new Map<string, string[]>();
  const itemFilesByI = new Map<string, { storage_path: string; file_name: string | null }[]>();
  (await offlineDB.item_photos.where("projectId").equals(projectId).toArray())
    .map((r) => r.data)
    .forEach((p) => {
      const arr = itemPhotosByI.get(p.item_id) ?? [];
      arr.push(p.storage_path);
      itemPhotosByI.set(p.item_id, arr);
    });
  (await offlineDB.item_files.where("projectId").equals(projectId).toArray())
    .map((r) => r.data)
    .forEach((f) => {
      const arr = itemFilesByI.get(f.item_id) ?? [];
      arr.push({ storage_path: f.storage_path, file_name: f.file_name });
      itemFilesByI.set(f.item_id, arr);
    });

  const results: SearchResult[] = [];

  if (plan.sources.includes("settings")) {
    const rows = (await offlineDB.equipment_settings.where("projectId").equals(projectId).toArray())
      .map((r) => r.data)
      .filter((s) => !s.deleted_at && eqIds.has(s.plant_equipment_id))
      .filter((s) => matchKeywords(plan.keywords, s.title, s.body));
    for (const s of rows) {
      const eq = equipmentById.get(s.plant_equipment_id);
      results.push({
        id: s.id,
        source: "settings",
        title: s.title ?? "",
        body: s.body ?? "",
        done: null,
        line_number: eq ? lineNumberById.get(eq.line_id) ?? null : null,
        plant_kind: eq?.kind ?? null,
        equipment_name: eq?.name ?? null,
        component_type: null,
        component_name: null,
        attachments: [
          ...(s.photo_path ? [{ kind: "photo" as const, storage_path: s.photo_path, file_name: null }] : []),
          ...(s.file_path ? [{ kind: "file" as const, storage_path: s.file_path, file_name: s.file_name }] : []),
          ...(settingPhotosByS.get(s.id) ?? []).map((p) => ({ kind: "photo" as const, storage_path: p, file_name: null })),
          ...(settingFilesByS.get(s.id) ?? []).map((f) => ({ kind: "file" as const, ...f })),
        ],
        updated_at: s.updated_at,
      });
    }
  }

  if (plan.sources.includes("checklist_items")) {
    const rows = (await offlineDB.checklist_items.where("projectId").equals(projectId).toArray())
      .map((r) => r.data)
      .filter((i) => !i.deleted_at)
      .filter((i) => {
        if (plan.doneFilter === "done" && !i.done) return false;
        if (plan.doneFilter === "not_done" && i.done) return false;
        return matchKeywords(plan.keywords, i.label, i.note);
      });
    for (const i of rows) {
      let eqId: string | null = null;
      let compName: string | null = null;
      let typeName: string | null = null;
      if (i.component_id && compInfo.has(i.component_id)) {
        const c = compInfo.get(i.component_id)!;
        eqId = c.equipmentId; compName = c.name; typeName = c.typeName;
      } else if (i.component_type_id && typeInfo.has(i.component_type_id)) {
        const t = typeInfo.get(i.component_type_id)!;
        eqId = t.equipmentId; typeName = t.name;
      }
      if (!eqId) continue;
      const eq = equipmentById.get(eqId);
      results.push({
        id: i.id,
        source: "checklist_items",
        title: i.label ?? "",
        body: i.note ?? "",
        done: i.done,
        line_number: eq ? lineNumberById.get(eq.line_id) ?? null : null,
        plant_kind: eq?.kind ?? null,
        equipment_name: eq?.name ?? null,
        component_type: typeName,
        component_name: compName,
        attachments: [
          ...(itemPhotosByI.get(i.id) ?? []).map((p) => ({ kind: "photo" as const, storage_path: p, file_name: null })),
          ...(itemFilesByI.get(i.id) ?? []).map((f) => ({ kind: "file" as const, ...f })),
        ],
        updated_at: i.updated_at,
      });
    }
  }

  if (plan.sources.includes("equipment_notes")) {
    const rows = (await offlineDB.equipment_notes.where("projectId").equals(projectId).toArray())
      .map((r) => r.data)
      .filter((n) => eqIds.has(n.equipment_id))
      .filter((n) => matchKeywords(plan.keywords, n.title, n.body));
    for (const n of rows) {
      const eq = equipmentById.get(n.equipment_id);
      const attachments: SearchResult["attachments"] = [];
      if (n.photo_path) attachments.push({ kind: "photo", storage_path: n.photo_path, file_name: null });
      if (n.file_path) attachments.push({ kind: "file", storage_path: n.file_path, file_name: n.file_name });
      results.push({
        id: n.id,
        source: "equipment_notes",
        title: n.title ?? "",
        body: n.body ?? "",
        done: null,
        line_number: eq ? lineNumberById.get(eq.line_id) ?? null : null,
        plant_kind: eq?.kind ?? null,
        equipment_name: eq?.name ?? null,
        component_type: null,
        component_name: null,
        attachments,
        updated_at: n.updated_at,
      });
    }
  }

  if (plan.sources.includes("pa_notes")) {
    const rows = (await offlineDB.pa_notes.where("projectId").equals(projectId).toArray())
      .map((r) => r.data)
      .filter((n) => lineIds.has(n.line_id))
      .filter((n) => matchKeywords(plan.keywords, n.title, n.body));
    for (const n of rows) {
      const attachments: SearchResult["attachments"] = [];
      if (n.photo_path) attachments.push({ kind: "photo", storage_path: n.photo_path, file_name: null });
      if (n.file_path) attachments.push({ kind: "file", storage_path: n.file_path, file_name: n.file_name });
      results.push({
        id: n.id,
        source: "pa_notes",
        title: n.title ?? "",
        body: n.body ?? "",
        done: null,
        line_number: lineNumberById.get(n.line_id) ?? null,
        plant_kind: n.kind ?? null,
        equipment_name: "PA",
        component_type: null,
        component_name: null,
        attachments,
        updated_at: n.updated_at,
      });
    }
  }

  if (plan.sources.includes("common_notes")) {
    const rows = (await offlineDB.common_folder_notes.where("projectId").equals(projectId).toArray())
      .map((r) => r.data)
      .filter((n) => matchKeywords(plan.keywords, n.title, n.body));
    for (const n of rows) {
      const attachments: SearchResult["attachments"] = [];
      if (n.photo_path) attachments.push({ kind: "photo", storage_path: n.photo_path, file_name: null });
      if (n.file_path) attachments.push({ kind: "file", storage_path: n.file_path, file_name: n.file_name });
      results.push({
        id: n.id,
        source: "common_notes",
        title: n.title ?? "",
        body: n.body ?? "",
        done: null,
        line_number: null,
        plant_kind: null,
        equipment_name: "Common",
        component_type: null,
        component_name: null,
        attachments,
        updated_at: n.updated_at,
      });
    }
  }

  const truncated = results.length > 500;
  if (truncated) results.length = 500;
  return { plan, results, truncated };
}
