
ALTER TABLE public.setting_photos
  ADD CONSTRAINT setting_photos_equipment_setting_id_fkey
  FOREIGN KEY (equipment_setting_id) REFERENCES public.equipment_settings(id) ON DELETE CASCADE;
ALTER TABLE public.setting_files
  ADD CONSTRAINT setting_files_equipment_setting_id_fkey
  FOREIGN KEY (equipment_setting_id) REFERENCES public.equipment_settings(id) ON DELETE CASCADE;
