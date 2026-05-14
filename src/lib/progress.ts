export interface ProgressNumbers {
  done: number;
  total: number;
  pct: number;
}

export function calcProgress(items: { done: boolean; deleted_at: string | null }[]): ProgressNumbers {
  const live = items.filter((i) => !i.deleted_at);
  const total = live.length;
  const done = live.filter((i) => i.done).length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

export const CHAPTER_LABELS: Record<string, string> = {
  assembly: "Assembly",
  wiring: "Wiring",
  cold_comm: "Cold commissioning",
  hot_comm: "Hot commissioning",
  after_sales: "After-sales",
};

export const CHAPTER_ORDER = ["assembly", "wiring", "cold_comm"] as const;

export const HOT_MILESTONE_PRESETS = [
  "Kiln heat-up",
  "Loading empty saggars",
  "Loading full saggars",
  "Purging dry air",
  "Purging oxygen",
  "Holding temperature",
  "Provisional acceptance measurements",
];

// Pull every checklist item out of a group (handles both legacy shape with
// components directly under the group, and new shape with components under
// component_types).
export function itemsFromGroup(group: any): any[] {
  if (!group) return [];
  const direct = (group.components ?? [])
    .filter((c: any) => !c.deleted_at)
    .flatMap((c: any) => c.checklist_items ?? []);
  const fromTypes = (group.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .flatMap((t: any) =>
      (t.components ?? [])
        .filter((c: any) => !c.deleted_at)
        .flatMap((c: any) => c.checklist_items ?? []),
    );
  return [...direct, ...fromTypes];
}

// Compute the three plant-equipment percentages.
// pe.equipment_groups is expected to contain entries for chapters
// 'assembly' | 'wiring' | 'cold_comm' (per the trigger that auto-creates them).
export function equipmentProgress(pe: any): { mech: number; wiring: number; cold: number; overall: number } {
  const groups = (pe.equipment_groups ?? []).filter((g: any) => !g.deleted_at);
  const byCh = (ch: string) => groups.find((g: any) => g.chapter === ch);

  const wiringGroup = byCh("wiring");
  const coldGroup = byCh("cold_comm");
  const assemblyGroup = byCh("assembly");

  const wiring = calcProgress(itemsFromGroup(wiringGroup)).pct;
  const cold = calcProgress(itemsFromGroup(coldGroup)).pct;

  let mech = 0;
  if (pe.mech_mode === "checklist") {
    mech = calcProgress(itemsFromGroup(assemblyGroup)).pct;
  } else {
    mech = Math.max(0, Math.min(100, pe.mech_manual_pct ?? 0));
  }

  const overall = Math.round((mech + wiring + cold) / 3);
  return { mech, wiring, cold, overall };
}
