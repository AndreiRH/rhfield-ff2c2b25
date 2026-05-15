import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Types ─────────────────────────────────────────────────────────────────
export type ItemNode = { label: string; subs: ItemNode[] };
export type ComponentClipNode = { name: string; items: ItemNode[] };
export type TypeClipNode = { name: string; components: ComponentClipNode[] };

export type Clip =
  | { kind: "item"; node: ItemNode; sourceLabel?: string }
  | { kind: "component"; node: ComponentClipNode; sourceLabel?: string }
  | { kind: "componentType"; node: TypeClipNode; sourceLabel?: string };

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
    clear: () => { write(null); },
  };
}

function read(): Clip | null {
  if (typeof window === "undefined") return null;
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function write(c: Clip | null) {
  if (typeof window === "undefined") return;
  if (c) localStorage.setItem(KEY, JSON.stringify(c));
  else localStorage.removeItem(KEY);
  window.dispatchEvent(new Event(EVT));
}
function labelOf(c: Clip) {
  if (c.kind === "item") return `subtask "${c.node.label}"`;
  if (c.kind === "component") return `item "${c.node.name}"`;
  return `type "${c.node.name}"`;
}

// ─── Clip builders (from loaded data) ─────────────────────────────────────
export function buildItemClip(item: any, allItems: any[]): Clip {
  return { kind: "item", node: itemToNode(item, allItems), sourceLabel: item.label };
}
function itemToNode(item: any, all: any[]): ItemNode {
  const subs = all
    .filter((i) => i.parent_item_id === item.id && !i.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((s) => itemToNode(s, all));
  return { label: item.label, subs };
}
export function buildComponentClip(component: any): Clip {
  const items = (component.checklist_items ?? [])
    .filter((i: any) => !i.deleted_at && !i.parent_item_id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((i: any) => itemToNode(i, component.checklist_items ?? []));
  return { kind: "component", node: { name: component.name, items }, sourceLabel: component.name };
}
export function buildTypeClip(type: any): Clip {
  const components = (type.components ?? [])
    .filter((c: any) => !c.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order)
    .map((c: any): ComponentClipNode => {
      const items = (c.checklist_items ?? [])
        .filter((i: any) => !i.deleted_at && !i.parent_item_id)
        .sort((a: any, b: any) => a.sort_order - b.sort_order)
        .map((i: any) => itemToNode(i, c.checklist_items ?? []));
      return { name: c.name, items };
    });
  return { kind: "componentType", node: { name: type.name, components }, sourceLabel: type.name };
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

export async function pasteItem(clip: Extract<Clip, { kind: "item" }>, ctx: { component_id: string; parent_item_id: string | null; sort_order: number }) {
  await insertItemTree(clip.node, ctx);
}
export async function pasteComponent(clip: Extract<Clip, { kind: "component" }>, parent: { equipment_id?: string; component_type_id?: string }, sort_order: number) {
  await insertComponent(clip.node, parent, sort_order);
}
export async function pasteType(clip: Extract<Clip, { kind: "componentType" }>, equipment_group_id: string, sort_order: number) {
  const { data, error } = await supabase.from("component_types").insert({
    equipment_group_id,
    name: clip.node.name,
    sort_order,
  }).select("id").single();
  if (error || !data) throw error ?? new Error("insert failed");
  for (let i = 0; i < clip.node.components.length; i++) {
    await insertComponent(clip.node.components[i], { component_type_id: data.id }, i);
  }
}
