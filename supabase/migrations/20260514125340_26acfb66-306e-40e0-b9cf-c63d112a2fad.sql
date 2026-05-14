ALTER TABLE public.equipment_notes ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;
UPDATE public.equipment_notes SET sort_order = sub.rn - 1
FROM (SELECT id, row_number() OVER (PARTITION BY equipment_id ORDER BY created_at) AS rn FROM public.equipment_notes) sub
WHERE public.equipment_notes.id = sub.id;