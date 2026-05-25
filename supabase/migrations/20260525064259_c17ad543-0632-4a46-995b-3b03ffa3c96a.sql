-- Drop duplicate triggers (kept the shorter-named one, which matches naming pattern of other tables)
DROP TRIGGER IF EXISTS replicate_plant_equipment ON public.plant_equipment;
DROP TRIGGER IF EXISTS propagate_pe_update ON public.plant_equipment;
DROP TRIGGER IF EXISTS set_template_id_pe ON public.plant_equipment;

DROP TRIGGER IF EXISTS replicate_equipment_group ON public.equipment_groups;
DROP TRIGGER IF EXISTS propagate_eg_update ON public.equipment_groups;
DROP TRIGGER IF EXISTS set_template_id_eg ON public.equipment_groups;

DROP TRIGGER IF EXISTS replicate_checklist_item ON public.checklist_items;
DROP TRIGGER IF EXISTS propagate_ci_update ON public.checklist_items;
DROP TRIGGER IF EXISTS set_template_id_ci ON public.checklist_items;