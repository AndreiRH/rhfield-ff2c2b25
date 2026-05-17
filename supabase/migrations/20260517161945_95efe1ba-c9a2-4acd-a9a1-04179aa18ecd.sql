-- 1. Add columns
ALTER TABLE public.item_photos
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id uuid;

ALTER TABLE public.item_files
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id uuid;

ALTER TABLE public.setting_photos
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id uuid;

ALTER TABLE public.setting_files
  ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS template_id uuid;

CREATE INDEX IF NOT EXISTS idx_item_photos_template ON public.item_photos(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_item_files_template ON public.item_files(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_setting_photos_template ON public.setting_photos(template_id) WHERE template_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_setting_files_template ON public.setting_files(template_id) WHERE template_id IS NOT NULL;

-- 2. BEFORE INSERT: assign template_id if shared and missing
CREATE OR REPLACE FUNCTION public.set_attachment_template_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF new.is_shared AND new.template_id IS NULL THEN
    new.template_id := gen_random_uuid();
  END IF;
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_set_template_item_photos ON public.item_photos;
CREATE TRIGGER trg_set_template_item_photos BEFORE INSERT OR UPDATE ON public.item_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_attachment_template_id();

DROP TRIGGER IF EXISTS trg_set_template_item_files ON public.item_files;
CREATE TRIGGER trg_set_template_item_files BEFORE INSERT OR UPDATE ON public.item_files
  FOR EACH ROW EXECUTE FUNCTION public.set_attachment_template_id();

DROP TRIGGER IF EXISTS trg_set_template_setting_photos ON public.setting_photos;
CREATE TRIGGER trg_set_template_setting_photos BEFORE INSERT OR UPDATE ON public.setting_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_attachment_template_id();

DROP TRIGGER IF EXISTS trg_set_template_setting_files ON public.setting_files;
CREATE TRIGGER trg_set_template_setting_files BEFORE INSERT OR UPDATE ON public.setting_files
  FOR EACH ROW EXECUTE FUNCTION public.set_attachment_template_id();

-- 3. Replication: item_photos
CREATE OR REPLACE FUNCTION public.replicate_item_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ci_tid uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF NOT new.is_shared OR new.template_id IS NULL THEN RETURN new; END IF;
  PERFORM set_config('app.replicating', 'on', true);
  SELECT template_id INTO ci_tid FROM public.checklist_items WHERE id = new.item_id;
  IF ci_tid IS NOT NULL THEN
    INSERT INTO public.item_photos (item_id, storage_path, is_shared, template_id, uploaded_by)
    SELECT sib.id, new.storage_path, true, new.template_id, new.uploaded_by
    FROM public.checklist_items sib
    WHERE sib.template_id = ci_tid AND sib.id <> new.item_id AND sib.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.item_photos ip
        WHERE ip.item_id = sib.id AND ip.template_id = new.template_id
      );
  END IF;
  PERFORM set_config('app.replicating', 'off', true);
  RETURN new;
END $$;

-- toggle is_shared true -> false on a row: delete sibling copies (keep self)
CREATE OR REPLACE FUNCTION public.unshare_item_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF old.is_shared AND NOT new.is_shared AND old.template_id IS NOT NULL THEN
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.item_photos
     WHERE template_id = old.template_id AND id <> new.id;
    -- clear template_id on the surviving local row
    UPDATE public.item_photos SET template_id = NULL WHERE id = new.id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN new;
END $$;

-- delete: cascade to siblings if shared
CREATE OR REPLACE FUNCTION public.cascade_delete_item_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN old; END IF;
  IF old.is_shared AND old.template_id IS NOT NULL THEN
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.item_photos WHERE template_id = old.template_id AND id <> old.id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN old;
END $$;

DROP TRIGGER IF EXISTS trg_replicate_item_photo ON public.item_photos;
CREATE TRIGGER trg_replicate_item_photo AFTER INSERT ON public.item_photos
  FOR EACH ROW EXECUTE FUNCTION public.replicate_item_photo();

DROP TRIGGER IF EXISTS trg_share_toggle_item_photo ON public.item_photos;
CREATE TRIGGER trg_share_toggle_item_photo AFTER UPDATE OF is_shared ON public.item_photos
  FOR EACH ROW WHEN (old.is_shared IS DISTINCT FROM new.is_shared) EXECUTE FUNCTION public.replicate_item_photo();

DROP TRIGGER IF EXISTS trg_unshare_item_photo ON public.item_photos;
CREATE TRIGGER trg_unshare_item_photo AFTER UPDATE OF is_shared ON public.item_photos
  FOR EACH ROW WHEN (old.is_shared = true AND new.is_shared = false) EXECUTE FUNCTION public.unshare_item_photo();

DROP TRIGGER IF EXISTS trg_cascade_delete_item_photo ON public.item_photos;
CREATE TRIGGER trg_cascade_delete_item_photo BEFORE DELETE ON public.item_photos
  FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_item_photo();

-- 4. Replication: item_files (same pattern, includes file_name)
CREATE OR REPLACE FUNCTION public.replicate_item_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE ci_tid uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF NOT new.is_shared OR new.template_id IS NULL THEN RETURN new; END IF;
  PERFORM set_config('app.replicating', 'on', true);
  SELECT template_id INTO ci_tid FROM public.checklist_items WHERE id = new.item_id;
  IF ci_tid IS NOT NULL THEN
    INSERT INTO public.item_files (item_id, storage_path, file_name, is_shared, template_id, uploaded_by)
    SELECT sib.id, new.storage_path, new.file_name, true, new.template_id, new.uploaded_by
    FROM public.checklist_items sib
    WHERE sib.template_id = ci_tid AND sib.id <> new.item_id AND sib.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.item_files ifx
        WHERE ifx.item_id = sib.id AND ifx.template_id = new.template_id
      );
  END IF;
  PERFORM set_config('app.replicating', 'off', true);
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.unshare_item_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF old.is_shared AND NOT new.is_shared AND old.template_id IS NOT NULL THEN
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.item_files WHERE template_id = old.template_id AND id <> new.id;
    UPDATE public.item_files SET template_id = NULL WHERE id = new.id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.cascade_delete_item_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN old; END IF;
  IF old.is_shared AND old.template_id IS NOT NULL THEN
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.item_files WHERE template_id = old.template_id AND id <> old.id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN old;
END $$;

DROP TRIGGER IF EXISTS trg_replicate_item_file ON public.item_files;
CREATE TRIGGER trg_replicate_item_file AFTER INSERT ON public.item_files
  FOR EACH ROW EXECUTE FUNCTION public.replicate_item_file();

DROP TRIGGER IF EXISTS trg_share_toggle_item_file ON public.item_files;
CREATE TRIGGER trg_share_toggle_item_file AFTER UPDATE OF is_shared ON public.item_files
  FOR EACH ROW WHEN (old.is_shared IS DISTINCT FROM new.is_shared) EXECUTE FUNCTION public.replicate_item_file();

DROP TRIGGER IF EXISTS trg_unshare_item_file ON public.item_files;
CREATE TRIGGER trg_unshare_item_file AFTER UPDATE OF is_shared ON public.item_files
  FOR EACH ROW WHEN (old.is_shared = true AND new.is_shared = false) EXECUTE FUNCTION public.unshare_item_file();

DROP TRIGGER IF EXISTS trg_cascade_delete_item_file ON public.item_files;
CREATE TRIGGER trg_cascade_delete_item_file BEFORE DELETE ON public.item_files
  FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_item_file();

-- 5. Replication: setting_photos (sibling = equipment_settings sharing template_id)
CREATE OR REPLACE FUNCTION public.replicate_setting_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE es_tid uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF NOT new.is_shared OR new.template_id IS NULL THEN RETURN new; END IF;
  PERFORM set_config('app.replicating', 'on', true);
  SELECT template_id INTO es_tid FROM public.equipment_settings WHERE id = new.equipment_setting_id;
  IF es_tid IS NOT NULL THEN
    INSERT INTO public.setting_photos (equipment_setting_id, storage_path, is_shared, template_id, uploaded_by)
    SELECT sib.id, new.storage_path, true, new.template_id, new.uploaded_by
    FROM public.equipment_settings sib
    WHERE sib.template_id = es_tid AND sib.id <> new.equipment_setting_id AND sib.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.setting_photos sp
        WHERE sp.equipment_setting_id = sib.id AND sp.template_id = new.template_id
      );
  END IF;
  PERFORM set_config('app.replicating', 'off', true);
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.unshare_setting_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF old.is_shared AND NOT new.is_shared AND old.template_id IS NOT NULL THEN
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.setting_photos WHERE template_id = old.template_id AND id <> new.id;
    UPDATE public.setting_photos SET template_id = NULL WHERE id = new.id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.cascade_delete_setting_photo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN old; END IF;
  IF old.is_shared AND old.template_id IS NOT NULL THEN
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.setting_photos WHERE template_id = old.template_id AND id <> old.id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN old;
END $$;

DROP TRIGGER IF EXISTS trg_replicate_setting_photo ON public.setting_photos;
CREATE TRIGGER trg_replicate_setting_photo AFTER INSERT ON public.setting_photos
  FOR EACH ROW EXECUTE FUNCTION public.replicate_setting_photo();

DROP TRIGGER IF EXISTS trg_share_toggle_setting_photo ON public.setting_photos;
CREATE TRIGGER trg_share_toggle_setting_photo AFTER UPDATE OF is_shared ON public.setting_photos
  FOR EACH ROW WHEN (old.is_shared IS DISTINCT FROM new.is_shared) EXECUTE FUNCTION public.replicate_setting_photo();

DROP TRIGGER IF EXISTS trg_unshare_setting_photo ON public.setting_photos;
CREATE TRIGGER trg_unshare_setting_photo AFTER UPDATE OF is_shared ON public.setting_photos
  FOR EACH ROW WHEN (old.is_shared = true AND new.is_shared = false) EXECUTE FUNCTION public.unshare_setting_photo();

DROP TRIGGER IF EXISTS trg_cascade_delete_setting_photo ON public.setting_photos;
CREATE TRIGGER trg_cascade_delete_setting_photo BEFORE DELETE ON public.setting_photos
  FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_setting_photo();

-- 6. Replication: setting_files
CREATE OR REPLACE FUNCTION public.replicate_setting_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE es_tid uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF NOT new.is_shared OR new.template_id IS NULL THEN RETURN new; END IF;
  PERFORM set_config('app.replicating', 'on', true);
  SELECT template_id INTO es_tid FROM public.equipment_settings WHERE id = new.equipment_setting_id;
  IF es_tid IS NOT NULL THEN
    INSERT INTO public.setting_files (equipment_setting_id, storage_path, file_name, is_shared, template_id, uploaded_by)
    SELECT sib.id, new.storage_path, new.file_name, true, new.template_id, new.uploaded_by
    FROM public.equipment_settings sib
    WHERE sib.template_id = es_tid AND sib.id <> new.equipment_setting_id AND sib.deleted_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.setting_files sf
        WHERE sf.equipment_setting_id = sib.id AND sf.template_id = new.template_id
      );
  END IF;
  PERFORM set_config('app.replicating', 'off', true);
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.unshare_setting_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF old.is_shared AND NOT new.is_shared AND old.template_id IS NOT NULL THEN
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.setting_files WHERE template_id = old.template_id AND id <> new.id;
    UPDATE public.setting_files SET template_id = NULL WHERE id = new.id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.cascade_delete_setting_file()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN old; END IF;
  IF old.is_shared AND old.template_id IS NOT NULL THEN
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.setting_files WHERE template_id = old.template_id AND id <> old.id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN old;
END $$;

DROP TRIGGER IF EXISTS trg_replicate_setting_file ON public.setting_files;
CREATE TRIGGER trg_replicate_setting_file AFTER INSERT ON public.setting_files
  FOR EACH ROW EXECUTE FUNCTION public.replicate_setting_file();

DROP TRIGGER IF EXISTS trg_share_toggle_setting_file ON public.setting_files;
CREATE TRIGGER trg_share_toggle_setting_file AFTER UPDATE OF is_shared ON public.setting_files
  FOR EACH ROW WHEN (old.is_shared IS DISTINCT FROM new.is_shared) EXECUTE FUNCTION public.replicate_setting_file();

DROP TRIGGER IF EXISTS trg_unshare_setting_file ON public.setting_files;
CREATE TRIGGER trg_unshare_setting_file AFTER UPDATE OF is_shared ON public.setting_files
  FOR EACH ROW WHEN (old.is_shared = true AND new.is_shared = false) EXECUTE FUNCTION public.unshare_setting_file();

DROP TRIGGER IF EXISTS trg_cascade_delete_setting_file ON public.setting_files;
CREATE TRIGGER trg_cascade_delete_setting_file BEFORE DELETE ON public.setting_files
  FOR EACH ROW EXECUTE FUNCTION public.cascade_delete_setting_file();