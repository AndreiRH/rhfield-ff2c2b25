drop trigger if exists set_template_id_pe_before_insert on public.plant_equipment;
drop trigger if exists replicate_plant_equipment_after_insert on public.plant_equipment;
drop trigger if exists propagate_plant_equipment_after_update on public.plant_equipment;
drop trigger if exists touch_plant_equipment_updated_at on public.plant_equipment;

drop trigger if exists set_template_id_eg_before_insert on public.equipment_groups;
drop trigger if exists replicate_equipment_group_after_insert on public.equipment_groups;
drop trigger if exists propagate_equipment_group_after_update on public.equipment_groups;

drop trigger if exists set_template_id_comp_before_insert on public.components;
drop trigger if exists replicate_component_after_insert on public.components;
drop trigger if exists propagate_component_after_update on public.components;

drop trigger if exists set_template_id_ci_before_insert on public.checklist_items;
drop trigger if exists replicate_checklist_item_after_insert on public.checklist_items;
drop trigger if exists propagate_checklist_item_after_update on public.checklist_items;

drop trigger if exists populate_new_line_from_template_after_insert on public.lines;