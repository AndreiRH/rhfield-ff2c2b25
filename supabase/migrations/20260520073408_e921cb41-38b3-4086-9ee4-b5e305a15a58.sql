ALTER TABLE public.checklist_items ADD COLUMN local_line_id uuid;
CREATE INDEX IF NOT EXISTS idx_checklist_items_local_line_id ON public.checklist_items(local_line_id);