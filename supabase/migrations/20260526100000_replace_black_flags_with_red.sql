UPDATE public.checklist_items
SET flag_priority = 'red',
    flag_wait_days = COALESCE(flag_wait_days, 1),
    flag_due_date = COALESCE(flag_due_date, CURRENT_DATE + 1)
WHERE flag_priority = 'black';

UPDATE public.checklist_items
SET flag_priority = 'orange',
    flag_wait_days = COALESCE(flag_wait_days, 7),
    flag_due_date = COALESCE(flag_due_date, CURRENT_DATE + 7)
WHERE flag_priority = 'red'
  AND flagged = true
  AND flag_wait_days = 7;

ALTER TABLE public.checklist_items
  DROP CONSTRAINT IF EXISTS checklist_items_flag_priority_check,
  ADD CONSTRAINT checklist_items_flag_priority_check
    CHECK (flag_priority IS NULL OR flag_priority IN ('yellow', 'orange', 'red'));
