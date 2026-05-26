ALTER TABLE public.checklist_items
  ADD COLUMN IF NOT EXISTS flag_priority text,
  ADD COLUMN IF NOT EXISTS flag_wait_days integer,
  ADD COLUMN IF NOT EXISTS flag_due_date date,
  ADD COLUMN IF NOT EXISTS flag_reason text,
  ADD COLUMN IF NOT EXISTS flag_status text,
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz,
  ADD COLUMN IF NOT EXISTS flag_resolved_at timestamptz;

ALTER TABLE public.checklist_items
  DROP CONSTRAINT IF EXISTS checklist_items_flag_priority_check,
  ADD CONSTRAINT checklist_items_flag_priority_check
    CHECK (flag_priority IS NULL OR flag_priority IN ('yellow', 'red', 'black'));

ALTER TABLE public.checklist_items
  DROP CONSTRAINT IF EXISTS checklist_items_flag_status_check,
  ADD CONSTRAINT checklist_items_flag_status_check
    CHECK (flag_status IS NULL OR flag_status IN ('open', 'acknowledged', 'resolved'));

ALTER TABLE public.checklist_items
  DROP CONSTRAINT IF EXISTS checklist_items_flag_wait_days_check,
  ADD CONSTRAINT checklist_items_flag_wait_days_check
    CHECK (flag_wait_days IS NULL OR flag_wait_days >= 0);

CREATE INDEX IF NOT EXISTS checklist_items_flag_due_date_idx
  ON public.checklist_items (flag_due_date)
  WHERE flagged = true;

CREATE INDEX IF NOT EXISTS checklist_items_flag_priority_idx
  ON public.checklist_items (flag_priority)
  WHERE flagged = true;

UPDATE public.checklist_items
SET flag_priority = COALESCE(flag_priority, 'red'),
    flag_wait_days = COALESCE(flag_wait_days, 7),
    flag_due_date = COALESCE(flag_due_date, (CURRENT_DATE + 7)),
    flag_status = COALESCE(flag_status, 'open'),
    flagged_at = COALESCE(flagged_at, updated_at, created_at, now())
WHERE flagged = true;
