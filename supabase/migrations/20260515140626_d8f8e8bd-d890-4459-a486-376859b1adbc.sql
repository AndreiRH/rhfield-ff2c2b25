
ALTER TABLE public.common_folders
  ADD COLUMN parent_folder_id uuid REFERENCES public.common_folders(id) ON DELETE CASCADE;

CREATE INDEX common_folders_parent_idx ON public.common_folders(parent_folder_id);
