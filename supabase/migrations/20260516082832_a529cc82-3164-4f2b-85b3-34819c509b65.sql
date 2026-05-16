ALTER TABLE public.checklist_items
  ADD CONSTRAINT checklist_items_component_type_id_fkey
  FOREIGN KEY (component_type_id) REFERENCES public.component_types(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS checklist_items_component_type_id_idx
  ON public.checklist_items(component_type_id);

NOTIFY pgrst, 'reload schema';