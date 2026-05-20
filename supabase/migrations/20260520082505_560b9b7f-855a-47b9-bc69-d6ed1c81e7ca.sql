ALTER TABLE public.checklist_items
ADD COLUMN IF NOT EXISTS origin_line_id uuid;

CREATE INDEX IF NOT EXISTS idx_checklist_items_origin_line_id
ON public.checklist_items(origin_line_id);

WITH item_lines AS (
  SELECT
    ci.id,
    ci.template_id,
    COALESCE(pe_c.line_id, eg_ct.line_id) AS physical_line_id,
    l.number AS line_number,
    ci.created_at
  FROM public.checklist_items ci
  LEFT JOIN public.components c ON c.id = ci.component_id
  LEFT JOIN public.plant_equipment pe_c ON pe_c.id = c.equipment_id
  LEFT JOIN public.component_types ct ON ct.id = ci.component_type_id
  LEFT JOIN public.equipment_groups eg_ct ON eg_ct.id = ct.equipment_group_id
  LEFT JOIN public.lines l ON l.id = COALESCE(pe_c.line_id, eg_ct.line_id)
  WHERE COALESCE(pe_c.line_id, eg_ct.line_id) IS NOT NULL
), origin_by_template AS (
  SELECT DISTINCT ON (template_id)
    template_id,
    physical_line_id AS origin_line_id
  FROM item_lines
  WHERE template_id IS NOT NULL
  ORDER BY template_id, created_at ASC, line_number ASC NULLS LAST
)
UPDATE public.checklist_items ci
SET origin_line_id = COALESCE(ci.origin_line_id, obt.origin_line_id)
FROM origin_by_template obt
WHERE ci.template_id = obt.template_id
  AND ci.origin_line_id IS NULL;

UPDATE public.checklist_items ci
SET origin_line_id = pe.line_id
FROM public.components c
JOIN public.plant_equipment pe ON pe.id = c.equipment_id
WHERE ci.component_id = c.id
  AND ci.origin_line_id IS NULL;

UPDATE public.checklist_items ci
SET origin_line_id = eg.line_id
FROM public.component_types ct
JOIN public.equipment_groups eg ON eg.id = ct.equipment_group_id
WHERE ci.component_type_id = ct.id
  AND ci.origin_line_id IS NULL;

CREATE OR REPLACE FUNCTION public.set_checklist_item_origin_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE resolved_line uuid;
BEGIN
  IF NEW.origin_line_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.component_id IS NOT NULL THEN
    SELECT pe.line_id INTO resolved_line
    FROM public.components c
    JOIN public.plant_equipment pe ON pe.id = c.equipment_id
    WHERE c.id = NEW.component_id;
  ELSIF NEW.component_type_id IS NOT NULL THEN
    SELECT eg.line_id INTO resolved_line
    FROM public.component_types ct
    JOIN public.equipment_groups eg ON eg.id = ct.equipment_group_id
    WHERE ct.id = NEW.component_type_id;
  END IF;

  NEW.origin_line_id := resolved_line;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_checklist_item_origin_line ON public.checklist_items;
CREATE TRIGGER set_checklist_item_origin_line
BEFORE INSERT ON public.checklist_items
FOR EACH ROW
EXECUTE FUNCTION public.set_checklist_item_origin_line();

CREATE OR REPLACE FUNCTION public.replicate_checklist_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE comp_tid uuid; ct_tid uuid; parent_tid uuid;
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN NEW; END IF;
  PERFORM set_config('app.replicating', 'on', true);

  IF NEW.component_type_id IS NOT NULL THEN
    SELECT template_id INTO ct_tid FROM public.component_types WHERE id = NEW.component_type_id;
    IF ct_tid IS NOT NULL THEN
      IF NEW.parent_item_id IS NULL THEN
        INSERT INTO public.checklist_items (component_type_id, label, sort_order, template_id, parent_item_id, deleted_at, local_line_id, origin_line_id)
          SELECT sib_ct.id, NEW.label, NEW.sort_order, NEW.template_id, NULL, NEW.deleted_at, NEW.local_line_id, NEW.origin_line_id
          FROM public.component_types sib_ct
          WHERE sib_ct.template_id = ct_tid AND sib_ct.id <> NEW.component_type_id
            AND NOT EXISTS (
              SELECT 1 FROM public.checklist_items i2
              WHERE i2.component_type_id = sib_ct.id AND i2.template_id = NEW.template_id
            );
      ELSE
        SELECT template_id INTO parent_tid FROM public.checklist_items WHERE id = NEW.parent_item_id;
        IF parent_tid IS NOT NULL THEN
          INSERT INTO public.checklist_items (component_type_id, label, sort_order, template_id, parent_item_id, deleted_at, local_line_id, origin_line_id)
            SELECT sib_ct.id, NEW.label, NEW.sort_order, NEW.template_id, sib_parent.id, NEW.deleted_at, NEW.local_line_id, NEW.origin_line_id
            FROM public.component_types sib_ct
            JOIN public.checklist_items sib_parent
              ON sib_parent.component_type_id = sib_ct.id AND sib_parent.template_id = parent_tid
            WHERE sib_ct.template_id = ct_tid AND sib_ct.id <> NEW.component_type_id
              AND NOT EXISTS (
                SELECT 1 FROM public.checklist_items i2
                WHERE i2.component_type_id = sib_ct.id AND i2.template_id = NEW.template_id
              );
        END IF;
      END IF;
    END IF;
  ELSIF NEW.component_id IS NOT NULL THEN
    SELECT template_id INTO comp_tid FROM public.components WHERE id = NEW.component_id;
    IF comp_tid IS NOT NULL THEN
      IF NEW.parent_item_id IS NULL THEN
        INSERT INTO public.checklist_items (component_id, label, sort_order, template_id, parent_item_id, deleted_at, local_line_id, origin_line_id)
          SELECT sib_c.id, NEW.label, NEW.sort_order, NEW.template_id, NULL, NEW.deleted_at, NEW.local_line_id, NEW.origin_line_id
          FROM public.components sib_c
          WHERE sib_c.template_id = comp_tid AND sib_c.id <> NEW.component_id
            AND NOT EXISTS (SELECT 1 FROM public.checklist_items i2 WHERE i2.component_id = sib_c.id AND i2.template_id = NEW.template_id);
      ELSE
        SELECT template_id INTO parent_tid FROM public.checklist_items WHERE id = NEW.parent_item_id;
        IF parent_tid IS NOT NULL THEN
          INSERT INTO public.checklist_items (component_id, label, sort_order, template_id, parent_item_id, deleted_at, local_line_id, origin_line_id)
            SELECT sib_c.id, NEW.label, NEW.sort_order, NEW.template_id, sib_parent.id, NEW.deleted_at, NEW.local_line_id, NEW.origin_line_id
            FROM public.components sib_c
            JOIN public.checklist_items sib_parent ON sib_parent.component_id = sib_c.id AND sib_parent.template_id = parent_tid
            WHERE sib_c.template_id = comp_tid AND sib_c.id <> NEW.component_id
              AND NOT EXISTS (SELECT 1 FROM public.checklist_items i2 WHERE i2.component_id = sib_c.id AND i2.template_id = NEW.template_id);
        END IF;
      END IF;
    END IF;
  END IF;

  PERFORM set_config('app.replicating', 'off', true);
  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.propagate_ci_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('app.replicating', true) = 'on' THEN RETURN NEW; END IF;
  IF NEW.label = OLD.label
     AND NEW.sort_order = OLD.sort_order
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND NEW.local_line_id IS NOT DISTINCT FROM OLD.local_line_id
     AND NEW.origin_line_id IS NOT DISTINCT FROM OLD.origin_line_id THEN
    RETURN NEW;
  END IF;
  PERFORM set_config('app.replicating', 'on', true);
  UPDATE public.checklist_items
  SET label = NEW.label,
      sort_order = NEW.sort_order,
      deleted_at = NEW.deleted_at,
      local_line_id = NEW.local_line_id,
      origin_line_id = NEW.origin_line_id
  WHERE template_id = NEW.template_id
    AND id <> NEW.id;
  PERFORM set_config('app.replicating', 'off', true);
  RETURN NEW;
END $$;