-- 1) item_notes: multiple notes per checklist item/subtask
CREATE TABLE IF NOT EXISTS public.item_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Note',
  body text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  is_shared boolean NOT NULL DEFAULT false,
  origin_line_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS item_notes_item_idx ON public.item_notes(item_id);
ALTER TABLE public.item_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "in read" ON public.item_notes;
CREATE POLICY "in read" ON public.item_notes FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
DROP POLICY IF EXISTS "in write" ON public.item_notes;
CREATE POLICY "in write" ON public.item_notes FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));
DROP TRIGGER IF EXISTS item_notes_touch ON public.item_notes;
CREATE TRIGGER item_notes_touch BEFORE UPDATE ON public.item_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Backfill from existing single note field on checklist_items
INSERT INTO public.item_notes (item_id, body, sort_order, is_shared, origin_line_id)
SELECT id, note, 0, COALESCE(note_shared, false), origin_line_id
FROM public.checklist_items
WHERE note IS NOT NULL AND length(btrim(note)) > 0
ON CONFLICT DO NOTHING;

-- 2) note_photos: polymorphic multi-photo attachments for any kind of note
CREATE TABLE IF NOT EXISTS public.note_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_kind text NOT NULL,
  parent_id uuid NOT NULL,
  storage_path text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_shared boolean NOT NULL DEFAULT false,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_photos_parent_idx ON public.note_photos(parent_kind, parent_id);
ALTER TABLE public.note_photos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "np read" ON public.note_photos;
CREATE POLICY "np read" ON public.note_photos FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
DROP POLICY IF EXISTS "np write" ON public.note_photos;
CREATE POLICY "np write" ON public.note_photos FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));

-- 3) note_files: polymorphic multi-file attachments for any kind of note
CREATE TABLE IF NOT EXISTS public.note_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_kind text NOT NULL,
  parent_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  is_shared boolean NOT NULL DEFAULT false,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_files_parent_idx ON public.note_files(parent_kind, parent_id);
ALTER TABLE public.note_files ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "nf read" ON public.note_files;
CREATE POLICY "nf read" ON public.note_files FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
DROP POLICY IF EXISTS "nf write" ON public.note_files;
CREATE POLICY "nf write" ON public.note_files FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));

-- Backfill existing single photo/file attachments on every note table
INSERT INTO public.note_photos (parent_kind, parent_id, storage_path, is_shared)
SELECT 'equipment_note', id, photo_path, COALESCE(is_shared, false)
FROM public.equipment_notes WHERE photo_path IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO public.note_files (parent_kind, parent_id, storage_path, file_name, is_shared)
SELECT 'equipment_note', id, file_path, COALESCE(file_name, file_path), COALESCE(is_shared, false)
FROM public.equipment_notes WHERE file_path IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.note_photos (parent_kind, parent_id, storage_path)
SELECT 'calendar_note', id, photo_path
FROM public.calendar_notes WHERE photo_path IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO public.note_files (parent_kind, parent_id, storage_path, file_name)
SELECT 'calendar_note', id, file_path, COALESCE(file_name, file_path)
FROM public.calendar_notes WHERE file_path IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.note_photos (parent_kind, parent_id, storage_path)
SELECT 'common_folder_note', id, photo_path
FROM public.common_folder_notes WHERE photo_path IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO public.note_files (parent_kind, parent_id, storage_path, file_name)
SELECT 'common_folder_note', id, file_path, COALESCE(file_name, file_path)
FROM public.common_folder_notes WHERE file_path IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO public.note_photos (parent_kind, parent_id, storage_path, is_shared)
SELECT 'pa_note', id, photo_path, COALESCE(is_shared, false)
FROM public.pa_notes WHERE photo_path IS NOT NULL
ON CONFLICT DO NOTHING;
INSERT INTO public.note_files (parent_kind, parent_id, storage_path, file_name, is_shared)
SELECT 'pa_note', id, file_path, COALESCE(file_name, file_path), COALESCE(is_shared, false)
FROM public.pa_notes WHERE file_path IS NOT NULL
ON CONFLICT DO NOTHING;