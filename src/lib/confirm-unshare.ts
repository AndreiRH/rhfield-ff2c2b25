import { supabase } from "@/integrations/supabase/client";

async function fetchLineLabel(lineId: string): Promise<string> {
  try {
    const { data } = await supabase
      .from("lines")
      .select("number, name")
      .eq("id", lineId)
      .maybeSingle();
    if (!data) return "its original production line";
    const num = data.number != null ? `Line ${String(data.number).padStart(2, "0")}` : null;
    if (data.name && num) return `${num} (${data.name})`;
    return data.name ?? num ?? "its original production line";
  } catch {
    return "its original production line";
  }
}

function promptUnshare(label: string): boolean {
  if (typeof window === "undefined") return true;
  return window.confirm(
    `Make local to ${label}?\n\n` +
    `This item was originally shared from ${label}. ` +
    `After switching it to local, it will be visible only on ${label} ` +
    `and will disappear from this production line.\n\n` +
    `Do you want to continue?`,
  );
}

/** Confirm un-sharing an item whose origin we know by line id. */
export async function confirmUnshareToOriginLine(
  originLineId: string | null | undefined,
  currentLineId: string | null | undefined,
): Promise<boolean> {
  if (!originLineId || originLineId === currentLineId) return true;
  const label = await fetchLineLabel(originLineId);
  return promptUnshare(label);
}

/** Confirm un-sharing a note, whose origin we know by equipment id. */
export async function confirmUnshareFromEquipment(
  originEquipmentId: string | null | undefined,
  currentEquipmentId: string | null | undefined,
): Promise<boolean> {
  if (!originEquipmentId || originEquipmentId === currentEquipmentId) return true;
  let label = "its original production line";
  try {
    const { data } = await supabase
      .from("plant_equipment")
      .select("line_id")
      .eq("id", originEquipmentId)
      .maybeSingle();
    if (data?.line_id) label = await fetchLineLabel(data.line_id);
  } catch {}
  return promptUnshare(label);
}
