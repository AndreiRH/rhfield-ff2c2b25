ALTER TABLE public.item_files
  ADD CONSTRAINT item_files_item_id_fkey
  FOREIGN KEY (item_id) REFERENCES public.checklist_items(id) ON DELETE CASCADE;