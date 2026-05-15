import { supabase } from "@/integrations/supabase/client";

export type SettingLogAction =
  | "created"
  | "title_changed"
  | "value_changed"
  | "deleted"
  | "photo_added"
  | "photo_deleted"
  | "file_added"
  | "file_deleted";

export async function logSetting(entry: {
  plant_equipment_id: string;
  equipment_setting_id?: string | null;
  setting_title: string;
  action: SettingLogAction;
  old_value?: string | null;
  new_value?: string | null;
  user_id?: string | null;
}) {
  try {
    await supabase.from("setting_logs").insert({
      plant_equipment_id: entry.plant_equipment_id,
      equipment_setting_id: entry.equipment_setting_id ?? null,
      setting_title: entry.setting_title ?? "",
      action: entry.action,
      old_value: entry.old_value ?? null,
      new_value: entry.new_value ?? null,
      user_id: entry.user_id ?? null,
    });
  } catch {
    // best-effort logging — do not block UI flows
  }
}
