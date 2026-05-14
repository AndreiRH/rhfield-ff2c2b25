-- Ensure template ids are assigned before structural rows are saved
create trigger set_template_id_pe_before_insert
before insert on public.plant_equipment
for each row execute function public.set_template_id_pe();

create trigger set_template_id_eg_before_insert
before insert on public.equipment_groups
for each row execute function public.set_template_id_eg();

create trigger set_template_id_comp_before_insert
before insert on public.components
for each row execute function public.set_template_id_comp();

create trigger set_template_id_ci_before_insert
before insert on public.checklist_items
for each row execute function public.set_template_id_ci();

-- Replicate newly-created structural rows to sibling lines
create trigger replicate_plant_equipment_after_insert
after insert on public.plant_equipment
for each row execute function public.replicate_plant_equipment();

create trigger replicate_equipment_group_after_insert
after insert on public.equipment_groups
for each row execute function public.replicate_equipment_group();

create trigger replicate_component_after_insert
after insert on public.components
for each row execute function public.replicate_component();

create trigger replicate_checklist_item_after_insert
after insert on public.checklist_items
for each row execute function public.replicate_checklist_item();

-- Propagate structural edits to sibling lines. Completion fields stay line-specific.
create trigger propagate_plant_equipment_after_update
after update of name, sort_order, deleted_at on public.plant_equipment
for each row execute function public.propagate_pe_update();

create trigger propagate_equipment_group_after_update
after update of name, sort_order, deleted_at on public.equipment_groups
for each row execute function public.propagate_eg_update();

create trigger propagate_component_after_update
after update of name, sort_order, deleted_at on public.components
for each row execute function public.propagate_comp_update();

create trigger propagate_checklist_item_after_update
after update of label, sort_order, deleted_at on public.checklist_items
for each row execute function public.propagate_ci_update();

-- New lines inherit the current project structure
create trigger populate_new_line_from_template_after_insert
after insert on public.lines
for each row execute function public.populate_new_line_from_template();

-- Keep equipment timestamps fresh
create trigger touch_plant_equipment_updated_at
before update on public.plant_equipment
for each row execute function public.touch_updated_at();