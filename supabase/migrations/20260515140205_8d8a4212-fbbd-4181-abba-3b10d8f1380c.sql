
CREATE TABLE public.common_folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL,
  name text NOT NULL DEFAULT 'New folder',
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.common_folders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cfo read" ON public.common_folders FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role, 'pm'::app_role]));
CREATE POLICY "cfo write" ON public.common_folders FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]));
CREATE INDEX common_folders_project_idx ON public.common_folders(project_id);

CREATE TABLE public.common_folder_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.common_folders(id) ON DELETE CASCADE,
  kind text NOT NULL,
  storage_path text NOT NULL,
  file_name text,
  sort_order integer NOT NULL DEFAULT 0,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.common_folder_attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cfa read" ON public.common_folder_attachments FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role, 'pm'::app_role]));
CREATE POLICY "cfa write" ON public.common_folder_attachments FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]));
CREATE INDEX common_folder_attachments_folder_idx ON public.common_folder_attachments(folder_id);

CREATE TABLE public.common_folder_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id uuid NOT NULL REFERENCES public.common_folders(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Note',
  body text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  photo_path text,
  file_path text,
  file_name text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.common_folder_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cfn read" ON public.common_folder_notes FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role, 'pm'::app_role]));
CREATE POLICY "cfn write" ON public.common_folder_notes FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]));
CREATE INDEX common_folder_notes_folder_idx ON public.common_folder_notes(folder_id);
