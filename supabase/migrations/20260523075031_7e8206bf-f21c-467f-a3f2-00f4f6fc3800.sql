
ALTER TABLE public.line_activities
  ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS follows_activity_id uuid REFERENCES public.line_activities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offset_days integer NOT NULL DEFAULT 0;

UPDATE public.line_activities
SET duration_days = GREATEST(1, (end_date - start_date) + 1)
WHERE duration_days = 1 AND end_date IS NOT NULL AND start_date IS NOT NULL;

CREATE OR REPLACE FUNCTION public.line_activity_sync()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  parent_start date;
BEGIN
  IF NEW.follows_activity_id IS NOT NULL THEN
    IF NEW.follows_activity_id = NEW.id THEN
      NEW.follows_activity_id := NULL;
    ELSE
      SELECT start_date INTO parent_start
        FROM public.line_activities
        WHERE id = NEW.follows_activity_id;
      IF parent_start IS NOT NULL THEN
        NEW.start_date := parent_start + COALESCE(NEW.offset_days, 0);
      END IF;
    END IF;
  END IF;
  IF NEW.duration_days IS NULL OR NEW.duration_days < 1 THEN
    NEW.duration_days := 1;
  END IF;
  NEW.end_date := NEW.start_date + (NEW.duration_days - 1);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS line_activity_sync_trg ON public.line_activities;
CREATE TRIGGER line_activity_sync_trg
BEFORE INSERT OR UPDATE ON public.line_activities
FOR EACH ROW EXECUTE FUNCTION public.line_activity_sync();

CREATE OR REPLACE FUNCTION public.line_activity_propagate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.start_date = OLD.start_date
    AND NEW.duration_days = OLD.duration_days THEN
    RETURN NEW;
  END IF;
  UPDATE public.line_activities
    SET start_date = NEW.start_date + COALESCE(offset_days, 0)
    WHERE follows_activity_id = NEW.id
      AND id <> NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS line_activity_propagate_trg ON public.line_activities;
CREATE TRIGGER line_activity_propagate_trg
AFTER INSERT OR UPDATE ON public.line_activities
FOR EACH ROW EXECUTE FUNCTION public.line_activity_propagate();
