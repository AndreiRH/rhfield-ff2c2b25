
ALTER TABLE public.components ADD COLUMN IF NOT EXISTS note text;

CREATE TABLE IF NOT EXISTS public.component_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES public.components(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.component_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_id uuid NOT NULL REFERENCES public.components(id) ON DELETE CASCADE,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.component_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.component_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "cph read" ON public.component_photos FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
CREATE POLICY "cph write" ON public.component_photos FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));

CREATE POLICY "cfi read" ON public.component_files FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
CREATE POLICY "cfi write" ON public.component_files FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));
