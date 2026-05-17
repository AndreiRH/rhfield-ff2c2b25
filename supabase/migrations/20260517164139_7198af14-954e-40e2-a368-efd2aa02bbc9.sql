
-- 1. Add origin tracking columns (nullable to allow backfill)
ALTER TABLE public.item_photos    ADD COLUMN IF NOT EXISTS origin_id uuid, ADD COLUMN IF NOT EXISTS origin_line_id uuid;
ALTER TABLE public.item_files     ADD COLUMN IF NOT EXISTS origin_id uuid, ADD COLUMN IF NOT EXISTS origin_line_id uuid;
ALTER TABLE public.setting_photos ADD COLUMN IF NOT EXISTS origin_id uuid, ADD COLUMN IF NOT EXISTS origin_line_id uuid;
ALTER TABLE public.setting_files  ADD COLUMN IF NOT EXISTS origin_id uuid, ADD COLUMN IF NOT EXISTS origin_line_id uuid;

-- 2. Resolver functions: line_id of the parent of an attachment
CREATE OR REPLACE FUNCTION public.checklist_item_line_id(_item_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(
    (SELECT eg.line_id
       FROM checklist_items ci
       JOIN components c ON c.id = ci.component_id
       JOIN equipment_groups eg ON eg.id = c.equipment_id
      WHERE ci.id = _item_id LIMIT 1),
    (SELECT eg.line_id
       FROM checklist_items ci
       JOIN components c ON c.id = ci.component_id
       JOIN component_types ct ON ct.id = c.component_type_id
       JOIN equipment_groups eg ON eg.id = ct.equipment_group_id
      WHERE ci.id = _item_id LIMIT 1),
    (SELECT eg.line_id
       FROM checklist_items ci
       JOIN component_types ct ON ct.id = ci.component_type_id
       JOIN equipment_groups eg ON eg.id = ct.equipment_group_id
      WHERE ci.id = _item_id LIMIT 1)
  );
$$;

CREATE OR REPLACE FUNCTION public.equipment_setting_line_id(_setting_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT pe.line_id
    FROM equipment_settings es
    JOIN plant_equipment pe ON pe.id = es.plant_equipment_id
   WHERE es.id = _setting_id LIMIT 1;
$$;

-- 3. Backfill: every row gets origin_id and origin_line_id.
-- For shared groups (template_id set), the canonical origin is the row with the earliest uploaded_at.
WITH origins AS (
  SELECT DISTINCT ON (template_id)
    template_id, id AS origin_id, item_id AS parent_id
  FROM public.item_photos
  WHERE template_id IS NOT NULL
  ORDER BY template_id, uploaded_at ASC
)
UPDATE public.item_photos ip SET
  origin_id      = COALESCE(ip.origin_id, o.origin_id, ip.id),
  origin_line_id = COALESCE(ip.origin_line_id, public.checklist_item_line_id(COALESCE(o.parent_id, ip.item_id)))
FROM origins o
WHERE ip.template_id = o.template_id;

UPDATE public.item_photos SET
  origin_id      = COALESCE(origin_id, id),
  origin_line_id = COALESCE(origin_line_id, public.checklist_item_line_id(item_id))
WHERE origin_id IS NULL OR origin_line_id IS NULL;

WITH origins AS (
  SELECT DISTINCT ON (template_id)
    template_id, id AS origin_id, item_id AS parent_id
  FROM public.item_files
  WHERE template_id IS NOT NULL
  ORDER BY template_id, uploaded_at ASC
)
UPDATE public.item_files ifx SET
  origin_id      = COALESCE(ifx.origin_id, o.origin_id, ifx.id),
  origin_line_id = COALESCE(ifx.origin_line_id, public.checklist_item_line_id(COALESCE(o.parent_id, ifx.item_id)))
FROM origins o
WHERE ifx.template_id = o.template_id;

UPDATE public.item_files SET
  origin_id      = COALESCE(origin_id, id),
  origin_line_id = COALESCE(origin_line_id, public.checklist_item_line_id(item_id))
WHERE origin_id IS NULL OR origin_line_id IS NULL;

WITH origins AS (
  SELECT DISTINCT ON (template_id)
    template_id, id AS origin_id, equipment_setting_id AS parent_id
  FROM public.setting_photos
  WHERE template_id IS NOT NULL
  ORDER BY template_id, uploaded_at ASC
)
UPDATE public.setting_photos sp SET
  origin_id      = COALESCE(sp.origin_id, o.origin_id, sp.id),
  origin_line_id = COALESCE(sp.origin_line_id, public.equipment_setting_line_id(COALESCE(o.parent_id, sp.equipment_setting_id)))
FROM origins o
WHERE sp.template_id = o.template_id;

UPDATE public.setting_photos SET
  origin_id      = COALESCE(origin_id, id),
  origin_line_id = COALESCE(origin_line_id, public.equipment_setting_line_id(equipment_setting_id))
WHERE origin_id IS NULL OR origin_line_id IS NULL;

WITH origins AS (
  SELECT DISTINCT ON (template_id)
    template_id, id AS origin_id, equipment_setting_id AS parent_id
  FROM public.setting_files
  WHERE template_id IS NOT NULL
  ORDER BY template_id, uploaded_at ASC
)
UPDATE public.setting_files sf SET
  origin_id      = COALESCE(sf.origin_id, o.origin_id, sf.id),
  origin_line_id = COALESCE(sf.origin_line_id, public.equipment_setting_line_id(COALESCE(o.parent_id, sf.equipment_setting_id)))
FROM origins o
WHERE sf.template_id = o.template_id;

UPDATE public.setting_files SET
  origin_id      = COALESCE(origin_id, id),
  origin_line_id = COALESCE(origin_line_id, public.equipment_setting_line_id(equipment_setting_id))
WHERE origin_id IS NULL OR origin_line_id IS NULL;

-- 4. Extend BEFORE INSERT trigger to populate origin_id when missing
CREATE OR REPLACE FUNCTION public.set_attachment_template_id()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF new.is_shared AND new.template_id IS NULL THEN
    new.template_id := gen_random_uuid();
  END IF;
  IF new.origin_id IS NULL THEN
    new.origin_id := new.id;
  END IF;
  RETURN new;
END $$;

-- Per-table BEFORE INSERT to set origin_line_id from parent
CREATE OR REPLACE FUNCTION public.set_item_attachment_origin_line()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF new.origin_line_id IS NULL THEN
    new.origin_line_id := public.checklist_item_line_id(new.item_id);
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.set_setting_attachment_origin_line()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF new.origin_line_id IS NULL THEN
    new.origin_line_id := public.equipment_setting_line_id(new.equipment_setting_id);
  END IF;
  RETURN new;
END $$;

DROP TRIGGER IF EXISTS trg_set_origin_line_item_photos ON public.item_photos;
CREATE TRIGGER trg_set_origin_line_item_photos BEFORE INSERT ON public.item_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_item_attachment_origin_line();

DROP TRIGGER IF EXISTS trg_set_origin_line_item_files ON public.item_files;
CREATE TRIGGER trg_set_origin_line_item_files BEFORE INSERT ON public.item_files
  FOR EACH ROW EXECUTE FUNCTION public.set_item_attachment_origin_line();

DROP TRIGGER IF EXISTS trg_set_origin_line_setting_photos ON public.setting_photos;
CREATE TRIGGER trg_set_origin_line_setting_photos BEFORE INSERT ON public.setting_photos
  FOR EACH ROW EXECUTE FUNCTION public.set_setting_attachment_origin_line();

DROP TRIGGER IF EXISTS trg_set_origin_line_setting_files ON public.setting_files;
CREATE TRIGGER trg_set_origin_line_setting_files BEFORE INSERT ON public.setting_files
  FOR EACH ROW EXECUTE FUNCTION public.set_setting_attachment_origin_line();

-- 5. Update replication: copies inherit origin_id and origin_line_id from source
CREATE OR REPLACE FUNCTION public.replicate_item_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ci_tid uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF NOT new.is_shared OR new.template_id IS NULL THEN RETURN new; END IF;
  PERFORM set_config('app.replicating', 'on', true);
  SELECT template_id INTO ci_tid FROM public.checklist_items WHERE id = new.item_id;
  IF ci_tid IS NOT NULL THEN
    INSERT INTO public.item_photos (item_id, storage_path, is_shared, template_id, uploaded_by, origin_id, origin_line_id)
    SELECT sib.id, new.storage_path, true, new.template_id, new.uploaded_by, new.origin_id, new.origin_line_id
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

CREATE OR REPLACE FUNCTION public.replicate_item_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ci_tid uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF NOT new.is_shared OR new.template_id IS NULL THEN RETURN new; END IF;
  PERFORM set_config('app.replicating', 'on', true);
  SELECT template_id INTO ci_tid FROM public.checklist_items WHERE id = new.item_id;
  IF ci_tid IS NOT NULL THEN
    INSERT INTO public.item_files (item_id, storage_path, file_name, is_shared, template_id, uploaded_by, origin_id, origin_line_id)
    SELECT sib.id, new.storage_path, new.file_name, true, new.template_id, new.uploaded_by, new.origin_id, new.origin_line_id
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

CREATE OR REPLACE FUNCTION public.replicate_setting_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE es_tid uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF NOT new.is_shared OR new.template_id IS NULL THEN RETURN new; END IF;
  PERFORM set_config('app.replicating', 'on', true);
  SELECT template_id INTO es_tid FROM public.equipment_settings WHERE id = new.equipment_setting_id;
  IF es_tid IS NOT NULL THEN
    INSERT INTO public.setting_photos (equipment_setting_id, storage_path, is_shared, template_id, uploaded_by, origin_id, origin_line_id)
    SELECT sib.id, new.storage_path, true, new.template_id, new.uploaded_by, new.origin_id, new.origin_line_id
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

CREATE OR REPLACE FUNCTION public.replicate_setting_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE es_tid uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF NOT new.is_shared OR new.template_id IS NULL THEN RETURN new; END IF;
  PERFORM set_config('app.replicating', 'on', true);
  SELECT template_id INTO es_tid FROM public.equipment_settings WHERE id = new.equipment_setting_id;
  IF es_tid IS NOT NULL THEN
    INSERT INTO public.setting_files (equipment_setting_id, storage_path, file_name, is_shared, template_id, uploaded_by, origin_id, origin_line_id)
    SELECT sib.id, new.storage_path, new.file_name, true, new.template_id, new.uploaded_by, new.origin_id, new.origin_line_id
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

-- 6. Update unshare triggers: keep origin row, delete the rest (including the toggled row if not origin)
CREATE OR REPLACE FUNCTION public.unshare_item_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE keep_id uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF old.is_shared AND NOT new.is_shared AND old.template_id IS NOT NULL THEN
    keep_id := COALESCE(old.origin_id, new.id);
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.item_photos WHERE template_id = old.template_id AND id <> keep_id;
    UPDATE public.item_photos SET is_shared = false, template_id = NULL WHERE id = keep_id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.unshare_item_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE keep_id uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF old.is_shared AND NOT new.is_shared AND old.template_id IS NOT NULL THEN
    keep_id := COALESCE(old.origin_id, new.id);
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.item_files WHERE template_id = old.template_id AND id <> keep_id;
    UPDATE public.item_files SET is_shared = false, template_id = NULL WHERE id = keep_id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.unshare_setting_photo()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE keep_id uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF old.is_shared AND NOT new.is_shared AND old.template_id IS NOT NULL THEN
    keep_id := COALESCE(old.origin_id, new.id);
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.setting_photos WHERE template_id = old.template_id AND id <> keep_id;
    UPDATE public.setting_photos SET is_shared = false, template_id = NULL WHERE id = keep_id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.unshare_setting_file()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE keep_id uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN new; END IF;
  IF old.is_shared AND NOT new.is_shared AND old.template_id IS NOT NULL THEN
    keep_id := COALESCE(old.origin_id, new.id);
    PERFORM set_config('app.replicating', 'on', true);
    DELETE FROM public.setting_files WHERE template_id = old.template_id AND id <> keep_id;
    UPDATE public.setting_files SET is_shared = false, template_id = NULL WHERE id = keep_id;
    PERFORM set_config('app.replicating', 'off', true);
  END IF;
  RETURN new;
END $$;
