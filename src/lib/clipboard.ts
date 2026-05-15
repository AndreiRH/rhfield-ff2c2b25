import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────
export type ItemNode = { label: string; subs: ItemNode[] };
export type ComponentClipNode = { name: string; items: ItemNode[] };
export type TypeClipNode = { name: string; components: ComponentClipNode[] };

export type Clip =
  | { kind: "item"; nodes: ItemNode[]; sourceLabel?: string }
  | { kind: "component"; nodes: ComponentClipNode[]; sourceLabel?: string }
  | { kind: "componentType"; nodes: TypeClipNode[]; sourceLabel?: string };

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
    set: (c: Clip) => { write(c); toast.success(`Copied ${labelOf(c)}`); },
    setSilent: (c: Clip) => { write(c); },
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
  return `type "${c.sourceLabel ?? c.nodes[0]?.name ?? ""}"${suffix}`;
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
  return { name: type.name, components };
}

// ─── Paste helpers ────────────────────────────────────────────────────────
async function insertItemTree(node: ItemNode, ctx: { component_id: string; parent_item_id: string | null; sort_order: number }) {
  const { data, error } = await supabase.from("checklist_items").insert({
    component_id: ctx.component_id,
    parent_item_id: ctx.parent_item_id,
    label: node.label,
    sort_order: ctx.sort_order,
  }).select("id").single();
  if (error || !data) throw error ?? new Error("insert failed");
  for (let i = 0; i < node.subs.length; i++) {
    await insertItemTree(node.subs[i], { component_id: ctx.component_id, parent_item_id: data.id, sort_order: i });
  }
}
async function insertComponent(node: ComponentClipNode, parent: { equipment_id?: string; component_type_id?: string }, sort_order: number) {
  const { data, error } = await supabase.from("components").insert({
    ...parent,
    name: node.name,
    sort_order,
  }).select("id").single();
  if (error || !data) throw error ?? new Error("insert failed");
  for (let i = 0; i < node.items.length; i++) {
    await insertItemTree(node.items[i], { component_id: data.id, parent_item_id: null, sort_order: i });
  }
}
async function insertType(node: TypeClipNode, equipment_group_id: string, sort_order: number) {
  const { data, error } = await supabase.from("component_types").insert({
    equipment_group_id, name: node.name, sort_order,
  }).select("id").single();
  if (error || !data) throw error ?? new Error("insert failed");
  for (let i = 0; i < node.components.length; i++) {
    await insertComponent(node.components[i], { component_type_id: data.id }, i);
  }
}

export async function pasteItem(clip: Extract<Clip, { kind: "item" }>, ctx: { component_id: string; parent_item_id: string | null; sort_order: number }) {
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
