CREATE TABLE public.item_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL,
  storage_path text NOT NULL,
  file_name text NOT NULL,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.item_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "if read" ON public.item_files FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
CREATE POLICY "if write" ON public.item_files FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));