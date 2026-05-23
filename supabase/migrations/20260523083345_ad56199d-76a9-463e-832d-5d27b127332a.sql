CREATE OR REPLACE FUNCTION public.sync_shared_activity_follows()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  followed_group_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NOT NEW.is_shared OR NEW.shared_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.follows_activity_id IS NULL THEN
    UPDATE public.line_activities AS own
    SET follows_activity_id = NULL
    WHERE own.shared_group_id = NEW.shared_group_id
      AND own.id <> NEW.id
      AND own.follows_activity_id IS NOT NULL;
    RETURN NEW;
  END IF;

  SELECT followed.shared_group_id
  INTO followed_group_id
  FROM public.line_activities AS followed
  WHERE followed.id = NEW.follows_activity_id
    AND followed.is_shared = TRUE
    AND followed.shared_group_id IS NOT NULL;

  IF followed_group_id IS NULL THEN
    RETURN NEW;
  END IF;

  UPDATE public.line_activities AS own
  SET
    follows_activity_id = followed.id,
    start_date = (followed.start_date + own.offset_days)::date,
    end_date = (followed.start_date + own.offset_days + (own.duration_days - 1))::date
  FROM public.line_activities AS followed
  WHERE own.shared_group_id = NEW.shared_group_id
    AND own.id <> NEW.id
    AND followed.shared_group_id = followed_group_id
    AND followed.line_id = own.line_id
    AND (
      own.follows_activity_id IS DISTINCT FROM followed.id
      OR own.start_date IS DISTINCT FROM (followed.start_date + own.offset_days)::date
      OR own.end_date IS DISTINCT FROM (followed.start_date + own.offset_days + (own.duration_days - 1))::date
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS line_activities_sync_shared_follows ON public.line_activities;

CREATE TRIGGER line_activities_sync_shared_follows
AFTER UPDATE OF follows_activity_id ON public.line_activities
FOR EACH ROW
WHEN (
  NEW.is_shared = TRUE
  AND NEW.shared_group_id IS NOT NULL
  AND OLD.follows_activity_id IS DISTINCT FROM NEW.follows_activity_id
)
EXECUTE FUNCTION public.sync_shared_activity_follows();

WITH shared_follow_sources AS (
  SELECT DISTINCT ON (source.shared_group_id)
    source.shared_group_id AS own_group_id,
    followed.shared_group_id AS followed_group_id
  FROM public.line_activities AS source
  JOIN public.line_activities AS followed
    ON followed.id = source.follows_activity_id
  WHERE source.is_shared = TRUE
    AND source.shared_group_id IS NOT NULL
    AND followed.is_shared = TRUE
    AND followed.shared_group_id IS NOT NULL
  ORDER BY source.shared_group_id, source.created_at DESC
)
UPDATE public.line_activities AS own
SET
  follows_activity_id = followed.id,
  start_date = (followed.start_date + own.offset_days)::date,
  end_date = (followed.start_date + own.offset_days + (own.duration_days - 1))::date
FROM shared_follow_sources AS source
JOIN public.line_activities AS followed
  ON followed.shared_group_id = source.followed_group_id
WHERE own.shared_group_id = source.own_group_id
  AND followed.line_id = own.line_id
  AND (
    own.follows_activity_id IS DISTINCT FROM followed.id
    OR own.start_date IS DISTINCT FROM (followed.start_date + own.offset_days)::date
    OR own.end_date IS DISTINCT FROM (followed.start_date + own.offset_days + (own.duration_days - 1))::date
  );