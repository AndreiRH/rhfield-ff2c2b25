import { supabase } from "@/integrations/supabase/client";

async function fetchLineInfo(lineId: string): Promise<{ label: string; projectId: string | null }> {
  try {
    const { data } = await supabase
      .from("lines")
      .select("number, name, project_id")
      .eq("id", lineId)
      .maybeSingle();
    if (!data) return { label: "its original production line", projectId: null };
    const num = data.number != null ? `Line ${String(data.number).padStart(2, "0")}` : null;
    const label = data.name && num ? `${num} (${data.name})` : (data.name ?? num ?? "its original production line");
    return { label, projectId: data.project_id ?? null };
  } catch {
    return { label: "its original production line", projectId: null };
  }
}

export type UnshareWarning = {
  originLabel: string;
  otherLineCount: number | null;
  otherLinesPhrase: string;
};

async function fetchOtherLineCount(projectId: string | null, originLineId: string): Promise<number | null> {
  if (!projectId) return null;
  try {
    const { count } = await supabase
      .from("lines")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .neq("id", originLineId);
    return count ?? null;
  } catch {
    return null;
  }
}

function formatOtherLinesPhrase(otherCount: number | null): string {
  return otherCount == null
    ? "all other production lines"
    : otherCount === 1
      ? "1 other production line"
      : `all other ${otherCount} production lines`;
}

export async function getUnshareWarning(originLineId: string | null | undefined): Promise<UnshareWarning> {
  if (!originLineId) {
    return {
      originLabel: "its original production line",
      otherLineCount: null,
      otherLinesPhrase: "all other production lines",
    };
  }
  const { label, projectId } = await fetchLineInfo(originLineId);
  const otherLineCount = await fetchOtherLineCount(projectId, originLineId);
  return {
    originLabel: label,
    otherLineCount,
    otherLinesPhrase: formatOtherLinesPhrase(otherLineCount),
  };
}

function promptUnshare(label: string, otherCount: number | null): boolean {
  if (typeof window === "undefined") return true;
  const linesPhrase =
    formatOtherLinesPhrase(otherCount);
  return window.confirm(
    `Make local to ${label}?\n\n` +
    `This item was originally shared from ${label}. ` +
    `If you mark it as local, it will be available only on ${label} ` +
    `and will be removed from ${linesPhrase}.\n\n` +
    `Do you want to continue?`,
  );
}

/** Confirm un-sharing an item whose origin we know by line id. */
export async function confirmUnshareToOriginLine(
  originLineId: string | null | undefined,
  currentLineId: string | null | undefined,
): Promise<boolean> {
  if (!originLineId) return true;
  const { label, projectId } = await fetchLineInfo(originLineId);
  const otherCount = await fetchOtherLineCount(projectId, originLineId);
  return promptUnshare(label, otherCount);
}

/** Confirm un-sharing a note, whose origin we know by equipment id. */
export async function confirmUnshareFromEquipment(
  originEquipmentId: string | null | undefined,
  currentEquipmentId: string | null | undefined,
): Promise<boolean> {
  if (!originEquipmentId || originEquipmentId === currentEquipmentId) return true;
  let label = "its original production line";
  let otherCount: number | null = null;
  try {
    const { data } = await supabase
      .from("plant_equipment")
      .select("line_id")
      .eq("id", originEquipmentId)
      .maybeSingle();
    if (data?.line_id) {
      const info = await fetchLineInfo(data.line_id);
      label = info.label;
      otherCount = await fetchOtherLineCount(info.projectId, data.line_id);
    }
  } catch {}
  return promptUnshare(label, otherCount);
}
