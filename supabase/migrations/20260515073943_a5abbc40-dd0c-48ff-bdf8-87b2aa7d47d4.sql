
CREATE TABLE public.setting_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_setting_id uuid NOT NULL,
  storage_path text NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_setting_photos_setting ON public.setting_photos(equipment_setting_id);
ALTER TABLE public.setting_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sph read" ON public.setting_photos FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
CREATE POLICY "sph write" ON public.setting_photos FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));

CREATE TABLE public.setting_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_setting_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_setting_files_setting ON public.setting_files(equipment_setting_id);
ALTER TABLE public.setting_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sfi read" ON public.setting_files FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
CREATE POLICY "sfi write" ON public.setting_files FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));

-- Migrate existing single photo/file references
INSERT INTO public.setting_photos (equipment_setting_id, storage_path)
  SELECT id, photo_path FROM public.equipment_settings
  WHERE photo_path IS NOT NULL AND deleted_at IS NULL;
INSERT INTO public.setting_files (equipment_setting_id, storage_path, file_name)
  SELECT id, file_path, COALESCE(file_name, 'file')
  FROM public.equipment_settings
  WHERE file_path IS NOT NULL AND deleted_at IS NULL;
