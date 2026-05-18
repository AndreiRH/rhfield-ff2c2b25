import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { localUuid } from "@/lib/local-id";

// ─── Types ─────────────────────────────────────────────────────────────────
export type ItemNode = { label: string; subs: ItemNode[] };
export type ComponentClipNode = { name: string; items: ItemNode[] };
// Types can carry either nested components (legacy) or items directly
// (new flat hierarchy). Both shapes survive a roundtrip through localStorage.
export type TypeClipNode = { name: string; components: ComponentClipNode[]; items?: ItemNode[] };

export type SettingPhotoNode = { storage_path: string };
export type SettingFileNode = { storage_path: string; file_name: string };
export type SettingNode = {
  title: string;
  body: string;
  photos: SettingPhotoNode[];
  files: SettingFileNode[];
};

export type Clip = (
  | { kind: "item"; nodes: ItemNode[]; sourceLabel?: string }
  | { kind: "component"; nodes: ComponentClipNode[]; sourceLabel?: string }
  | { kind: "componentType"; nodes: TypeClipNode[]; sourceLabel?: string }
  | { kind: "setting"; nodes: SettingNode[]; sourceLabel?: string }
) & {
  /**
   * When set, the paste action has already happened once and the paste UI
   * should only stay visible at this location key. A new copy (via `set`)
   * clears this; `clear()` removes the clip entirely.
   */
  lockedAt?: string;
};

const KEY = "lov.clipboard.v1";
const EVT = "lov-clipboard-change";

// ─── Hook ──────────────────────────────────────────────────────────────────
export function useClipboard() {
  const [clip, setClip] = useState<Clip | null>(() => read());
  useEffect(() => {
    const sync = () => setClip(read());
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", (e) => { if (e.key === KEY) sync(); });
    return () => window.removeEventListener(EVT, sync);
  }, []);
  return {
    clip,
    set: (c: Clip) => { write({ ...c, lockedAt: undefined }); toast.success(`Copied ${labelOf(c)}`); },
    setSilent: (c: Clip) => { write({ ...c, lockedAt: undefined }); },
    /** Lock the existing clip to a single location (after the first paste). */
    lockTo: (locationKey: string) => {
      const current = read();
      if (!current) return;
      write({ ...current, lockedAt: locationKey });
    },
    clear: () => { write(null); },
  };
}

function read(): Clip | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    // Backwards-compat: old single-node shape → wrap in array.
    if (parsed && parsed.node && !parsed.nodes) {
      return { ...parsed, nodes: [parsed.node] };
    }
    return parsed;
  } catch { return null; }
}
function write(c: Clip | null) {
  if (typeof window === "undefined") return;
  if (c) localStorage.setItem(KEY, JSON.stringify(c));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}
function labelOf(c: Clip) {
  const n = c.nodes.length;
  const suffix = n > 1 ? ` (${n})` : "";
  if (c.kind === "item") return `subtask "${c.sourceLabel ?? c.nodes[0]?.label ?? ""}"${suffix}`;
  if (c.kind === "component") return `component "${c.sourceLabel ?? c.nodes[0]?.name ?? ""}"${suffix}`;
  if (c.kind === "componentType") return `type "${c.sourceLabel ?? c.nodes[0]?.name ?? ""}"${suffix}`;
  return `setting "${c.sourceLabel ?? c.nodes[0]?.title ?? ""}"${suffix}`;
}

// ─── Clip builders (from loaded data) ─────────────────────────────────────
export function buildItemClip(item: any, allItems: any[]): Clip {
  return { kind: "item", nodes: [itemToNode(item, allItems)], sourceLabel: item.label };
}
export function buildItemClipMany(items: { item: any; allItems: any[] }[]): Clip {
  const nodes = items.map(({ item, allItems }) => itemToNode(item, allItems));
  return { kind: "item", nodes, sourceLabel: items[0]?.item.label };
}
function itemToNode(item: any, all: any[]): ItemNode {
  const subs = all
    .filter((i) => i.parent_item_id === item.id && !i.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => itemToNode(s, all));
  return { label: item.label, subs };
}
export function buildComponentClip(component: any): Clip {
  return { kind: "component", nodes: [componentToNode(component)], sourceLabel: component.name };
}
export function buildComponentClipMany(components: any[]): Clip {
  return { kind: "component", nodes: components.map(componentToNode), sourceLabel: components[0]?.name };
}
function componentToNode(component: any): ComponentClipNode {
  const items = (component.checklist_items ?? [])
    .filter((i: any) => !i.deleted_at && !i.parent_item_id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((i: any) => itemToNode(i, component.checklist_items ?? []));
  return { name: component.name, items };
}
export function buildTypeClip(type: any): Clip {
  return { kind: "componentType", nodes: [typeToNode(type)], sourceLabel: type.name };
}
export function buildTypeClipMany(types: any[]): Clip {
  return { kind: "componentType", nodes: types.map(typeToNode), sourceLabel: types[0]?.name };
}
function typeToNode(type: any): TypeClipNode {
  const components = (type.components ?? [])
    .filter((c: any) => !c.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map(componentToNode);
  const items = (type.checklist_items ?? [])
    .filter((i: any) => !i.deleted_at && !i.parent_item_id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((i: any) => itemToNode(i, type.checklist_items ?? []));
  return { name: type.name, components, items };
}

// ─── Paste helpers ────────────────────────────────────────────────────────
export type ItemParentCols =
  | { component_id: string; component_type_id?: undefined }
  | { component_type_id: string; component_id?: undefined };

async function insertItemTree(node: ItemNode, ctx: ItemParentCols & { parent_item_id: string | null; sort_order: number }) {
  const id = localUuid();
  const { parent_item_id, sort_order, ...parentCols } = ctx;
  const { data, error } = await supabase.from("checklist_items").insert({
    id,
    ...parentCols,
    parent_item_id,
    label: node.label,
    sort_order,
  }).select("id").single();
  if (error || !data) { if (error) console.error("clipboard insert error:", error); throw new Error("Paste failed. Please try again."); }
  for (let i = 0; i < node.subs.length; i++) {
    await insertItemTree(node.subs[i], { ...parentCols, parent_item_id: data.id, sort_order: i } as ItemParentCols & { parent_item_id: string | null; sort_order: number });
  }
}
async function insertComponent(node: ComponentClipNode, parent: { equipment_id?: string; component_type_id?: string }, sort_order: number) {
  const id = localUuid();
  const { data, error } = await supabase.from("components").insert({
    id,
    ...parent,
    name: node.name,
    sort_order,
  }).select("id").single();
  if (error || !data) { if (error) console.error("clipboard insert error:", error); throw new Error("Paste failed. Please try again."); }
  for (let i = 0; i < node.items.length; i++) {
    await insertItemTree(node.items[i], { component_id: data.id, parent_item_id: null, sort_order: i });
  }
}
async function insertType(node: TypeClipNode, equipment_group_id: string, sort_order: number) {
  const id = localUuid();
  const { data, error } = await supabase.from("component_types").insert({
    id, equipment_group_id, name: node.name, sort_order,
  }).select("id").single();
  if (error || !data) { if (error) console.error("clipboard insert error:", error); throw new Error("Paste failed. Please try again."); }
  // New shape: items directly under the type.
  for (let i = 0; i < (node.items ?? []).length; i++) {
    await insertItemTree(node.items![i], { component_type_id: data.id, parent_item_id: null, sort_order: i });
  }
  // Legacy shape: nested components, for backward compatibility with old clips.
  for (let i = 0; i < node.components.length; i++) {
    await insertComponent(node.components[i], { component_type_id: data.id }, i);
  }
}

export async function pasteItem(clip: Extract<Clip, { kind: "item" }>, ctx: ItemParentCols & { parent_item_id: string | null; sort_order: number }) {
  for (let i = 0; i < clip.nodes.length; i++) {
    await insertItemTree(clip.nodes[i], { ...ctx, sort_order: ctx.sort_order + i });
  }
}
export async function pasteComponent(clip: Extract<Clip, { kind: "component" }>, parent: { equipment_id?: string; component_type_id?: string }, sort_order: number) {
  for (let i = 0; i < clip.nodes.length; i++) {
    await insertComponent(clip.nodes[i], parent, sort_order + i);
  }
}
export async function pasteType(clip: Extract<Clip, { kind: "componentType" }>, equipment_group_id: string, sort_order: number) {
  for (let i = 0; i < clip.nodes.length; i++) {
    await insertType(clip.nodes[i], equipment_group_id, sort_order + i);
  }
}

// ─── Settings clip ────────────────────────────────────────────────────────
export function buildSettingClip(setting: any): Clip {
  return { kind: "setting", nodes: [settingToNode(setting)], sourceLabel: setting.title };
}
export function buildSettingClipMany(settings: any[]): Clip {
  return { kind: "setting", nodes: settings.map(settingToNode), sourceLabel: settings[0]?.title };
}
function settingToNode(s: any): SettingNode {
  return {
    title: s.title,
    body: s.body ?? "",
    photos: (s.setting_photos ?? []).map((p: any) => ({ storage_path: p.storage_path })),
    files: (s.setting_files ?? []).map((f: any) => ({ storage_path: f.storage_path, file_name: f.file_name })),
  };
}

async function copyStorage(bucket: "photos" | "files", src: string): Promise<string | null> {
  // Re-derive a path under a new prefix; copy bytes via download/upload.
  const { data: blob, error: dErr } = await supabase.storage.from(bucket).download(src);
  if (dErr || !blob) return null;
  const filename = src.split("/").pop() ?? `${Date.now()}`;
  const newPath = `equipment-settings/paste/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename}`;
  const { error: uErr } = await supabase.storage.from(bucket).upload(newPath, blob);
  if (uErr) return null;
  return newPath;
}

export async function pasteSetting(
  clip: Extract<Clip, { kind: "setting" }>,
  ctx: { plant_equipment_id: string; sort_order: number; created_by?: string; group_template_id?: string | null },
) {
  for (let i = 0; i < clip.nodes.length; i++) {
    const node = clip.nodes[i];
    const { data, error } = await supabase
      .from("equipment_settings")
      .insert({
        plant_equipment_id: ctx.plant_equipment_id,
        title: node.title,
        body: node.body,
        sort_order: ctx.sort_order + i,
        created_by: ctx.created_by,
        group_template_id: ctx.group_template_id ?? null,
      })
      .select("id")
      .single();
    if (error || !data) { if (error) console.error("clipboard insert error:", error); throw new Error("Paste failed. Please try again."); }
    for (const p of node.photos) {
      const np = await copyStorage("photos", p.storage_path);
      if (np) await supabase.from("setting_photos").insert({ equipment_setting_id: data.id, storage_path: np });
    }
    for (const f of node.files) {
      const np = await copyStorage("files", f.storage_path);
      if (np) await supabase.from("setting_files").insert({ equipment_setting_id: data.id, storage_path: np, file_name: f.file_name });
    }
  }
}

