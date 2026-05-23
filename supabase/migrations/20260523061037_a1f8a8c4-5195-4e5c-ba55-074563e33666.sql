ALTER TABLE public.line_activities
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY line_id ORDER BY start_date, created_at) - 1 AS rn
  FROM public.line_activities
)
UPDATE public.line_activities la
SET sort_order = r.rn
FROM ranked r
WHERE la.id = r.id;

CREATE INDEX IF NOT EXISTS line_activities_line_sort_idx
  ON public.line_activities (line_id, sort_order);