ALTER TABLE public.item_photos ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
ALTER TABLE public.item_files ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;