
do $$
declare fn text;
begin
  foreach fn in array array[
    'set_template_id_ct()',
    'replicate_component_type()',
    'propagate_ct_update()',
    'propagate_pe_mech()',
    'create_default_groups_for_pe()',
    'set_template_id_pe()',
    'set_template_id_eg()',
    'set_template_id_comp()',
    'set_template_id_ci()',
    'replicate_plant_equipment()',
    'replicate_equipment_group()',
    'replicate_component()',
    'replicate_checklist_item()',
    'propagate_pe_update()',
    'propagate_eg_update()',
    'propagate_comp_update()',
    'propagate_ci_update()',
    'populate_new_line_from_template()',
    'touch_updated_at()'
  ] loop
    execute format('revoke execute on function public.%s from public, anon', fn);
  end loop;
end $$;
