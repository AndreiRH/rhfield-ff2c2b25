
-- Folders inside the Provisional Acceptance page
CREATE TABLE public.pa_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL,
  kind public.plant_kind NOT NULL,
  name text NOT NULL DEFAULT 'New folder',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pa_folders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pa_folders read" ON public.pa_folders FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
CREATE POLICY "pa_folders write" ON public.pa_folders FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));

CREATE TRIGGER pa_folders_touch BEFORE UPDATE ON public.pa_folders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Independent photos/files attached directly inside a folder
CREATE TABLE public.pa_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.pa_folders(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo','file')),
  storage_path text NOT NULL,
  file_name text,
  sort_order integer NOT NULL DEFAULT 0,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.pa_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pa_att read" ON public.pa_attachments FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
CREATE POLICY "pa_att write" ON public.pa_attachments FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));

-- Link existing pa_notes to a folder
ALTER TABLE public.pa_notes ADD COLUMN folder_id uuid REFERENCES public.pa_folders(id) ON DELETE CASCADE;
CREATE INDEX pa_notes_folder_idx ON public.pa_notes(folder_id);
CREATE INDEX pa_attachments_folder_idx ON public.pa_attachments(folder_id);
CREATE INDEX pa_folders_line_kind_idx ON public.pa_folders(line_id, kind);
