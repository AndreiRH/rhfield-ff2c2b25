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

export const CHAPTER_ORDER = ["assembly", "wiring", "cold_comm", "hot_comm", "after_sales"] as const;

export const HOT_MILESTONE_PRESETS = [
  "Kiln heat-up",
  "Loading empty saggars",
  "Loading full saggars",
  "Purging dry air",
  "Purging oxygen",
  "Holding temperature",
  "Provisional acceptance measurements",
];
