ALTER TABLE public.component_types
  ADD COLUMN IF NOT EXISTS local_line_id uuid;

CREATE TABLE IF NOT EXISTS public.component_type_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_type_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Note',
  body text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  is_shared boolean NOT NULL DEFAULT false,
  origin_line_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ctn_type ON public.component_type_notes(component_type_id);
ALTER TABLE public.component_type_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ctn read" ON public.component_type_notes FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role, 'pm'::app_role]));
CREATE POLICY "ctn write" ON public.component_type_notes FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]));
CREATE TRIGGER component_type_notes_touch BEFORE UPDATE ON public.component_type_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.component_type_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_type_id uuid NOT NULL,
  storage_path text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_shared boolean NOT NULL DEFAULT false,
  template_id uuid,
  origin_id uuid,
  origin_line_id uuid,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ctp_type ON public.component_type_photos(component_type_id);
ALTER TABLE public.component_type_photos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ctp read" ON public.component_type_photos FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role, 'pm'::app_role]));
CREATE POLICY "ctp write" ON public.component_type_photos FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]));

CREATE TABLE IF NOT EXISTS public.component_type_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component_type_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_shared boolean NOT NULL DEFAULT false,
  template_id uuid,
  origin_id uuid,
  origin_line_id uuid,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ctf_type ON public.component_type_files(component_type_id);
ALTER TABLE public.component_type_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ctf read" ON public.component_type_files FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role, 'pm'::app_role]));
CREATE POLICY "ctf write" ON public.component_type_files FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]));