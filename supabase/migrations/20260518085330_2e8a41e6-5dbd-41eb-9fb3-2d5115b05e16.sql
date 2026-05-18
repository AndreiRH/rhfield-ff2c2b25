-- Drop old milestones table and replace with line_activities
DROP TABLE IF EXISTS public.milestones CASCADE;

CREATE TABLE public.line_activities (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id         uuid NOT NULL REFERENCES public.lines(id) ON DELETE CASCADE,
  name            text NOT NULL,
  start_date      date NOT NULL,
  end_date        date NOT NULL,
  color           text NOT NULL,
  is_shared       boolean NOT NULL DEFAULT false,
  shared_group_id uuid,
  origin_line_id  uuid REFERENCES public.lines(id),
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX line_activities_line_id_idx ON public.line_activities(line_id);
CREATE INDEX line_activities_shared_group_id_idx ON public.line_activities(shared_group_id);

ALTER TABLE public.line_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "la read" ON public.line_activities FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role, 'pm'::app_role]));

CREATE POLICY "la write" ON public.line_activities FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]));

-- Update delete_project_cascade: replace milestones reference with line_activities
CREATE OR REPLACE FUNCTION public.delete_project_cascade(p_project_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare line_ids uuid[];
  pe_ids uuid[];
  eg_ids uuid[];
  ct_ids uuid[];
  comp_ids uuid[];
  ci_ids uuid[];
  folder_ids uuid[];
begin
  if not has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can delete projects';
  end if;
  perform set_config('app.replicating', 'on', true);

  select array_agg(id) into line_ids from public.lines where project_id = p_project_id;
  select array_agg(id) into pe_ids from public.plant_equipment where line_id = any(coalesce(line_ids,'{}'::uuid[]));
  select array_agg(id) into eg_ids from public.equipment_groups where line_id = any(coalesce(line_ids,'{}'::uuid[]));
  select array_agg(id) into ct_ids from public.component_types where equipment_group_id = any(coalesce(eg_ids,'{}'::uuid[]));
  select array_agg(id) into comp_ids from public.components
    where equipment_id = any(coalesce(eg_ids,'{}'::uuid[])) or component_type_id = any(coalesce(ct_ids,'{}'::uuid[]));
  select array_agg(id) into ci_ids from public.checklist_items
    where component_id = any(coalesce(comp_ids,'{}'::uuid[]))
       or component_type_id = any(coalesce(ct_ids,'{}'::uuid[]));
  select array_agg(id) into folder_ids from public.pa_folders where line_id = any(coalesce(line_ids,'{}'::uuid[]));

  delete from public.item_photos where item_id = any(coalesce(ci_ids,'{}'::uuid[]));
  delete from public.item_files where item_id = any(coalesce(ci_ids,'{}'::uuid[]));
  delete from public.checklist_items where id = any(coalesce(ci_ids,'{}'::uuid[]));
  delete from public.components where id = any(coalesce(comp_ids,'{}'::uuid[]));
  delete from public.component_types where id = any(coalesce(ct_ids,'{}'::uuid[]));
  delete from public.equipment_notes where equipment_id = any(coalesce(pe_ids,'{}'::uuid[]));
  delete from public.equipment_photos where equipment_id = any(coalesce(pe_ids,'{}'::uuid[]));
  delete from public.equipment_groups where id = any(coalesce(eg_ids,'{}'::uuid[]));
  delete from public.plant_equipment where id = any(coalesce(pe_ids,'{}'::uuid[]));
  delete from public.pa_attachments where folder_id = any(coalesce(folder_ids,'{}'::uuid[]));
  delete from public.pa_notes where line_id = any(coalesce(line_ids,'{}'::uuid[]));
  delete from public.pa_folders where id = any(coalesce(folder_ids,'{}'::uuid[]));
  delete from public.line_activities where line_id = any(coalesce(line_ids,'{}'::uuid[]));
  delete from public.common_notes where project_id = p_project_id;
  delete from public.common_files where project_id = p_project_id;
  delete from public.lines where project_id = p_project_id;
  delete from public.projects where id = p_project_id;

  perform set_config('app.replicating', 'off', true);
end $function$;

-- Update import_project_bulk: replace milestones with line_activities
CREATE OR REPLACE FUNCTION public.import_project_bulk(payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can import projects';
  end if;

  perform set_config('app.replicating', 'on', true);

  insert into public.projects
    select * from jsonb_populate_recordset(null::public.projects, coalesce(payload->'projects', '[]'::jsonb));
  insert into public.lines
    select * from jsonb_populate_recordset(null::public.lines, coalesce(payload->'lines', '[]'::jsonb));
  insert into public.plant_equipment
    select * from jsonb_populate_recordset(null::public.plant_equipment, coalesce(payload->'plant_equipment', '[]'::jsonb));
  insert into public.equipment_groups
    select * from jsonb_populate_recordset(null::public.equipment_groups, coalesce(payload->'equipment_groups', '[]'::jsonb));
  insert into public.component_types
    select * from jsonb_populate_recordset(null::public.component_types, coalesce(payload->'component_types', '[]'::jsonb));
  insert into public.components
    select * from jsonb_populate_recordset(null::public.components, coalesce(payload->'components', '[]'::jsonb));
  insert into public.checklist_items
    select * from jsonb_populate_recordset(null::public.checklist_items,
      coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(payload->'checklist_items','[]'::jsonb)) x where x->>'parent_item_id' is null), '[]'::jsonb));
  insert into public.checklist_items
    select * from jsonb_populate_recordset(null::public.checklist_items,
      coalesce((select jsonb_agg(x) from jsonb_array_elements(coalesce(payload->'checklist_items','[]'::jsonb)) x where x->>'parent_item_id' is not null), '[]'::jsonb));
  insert into public.item_photos
    select * from jsonb_populate_recordset(null::public.item_photos, coalesce(payload->'item_photos', '[]'::jsonb));
  insert into public.item_files
    select * from jsonb_populate_recordset(null::public.item_files, coalesce(payload->'item_files', '[]'::jsonb));
  insert into public.equipment_notes
    select * from jsonb_populate_recordset(null::public.equipment_notes, coalesce(payload->'equipment_notes', '[]'::jsonb));
  insert into public.equipment_photos
    select * from jsonb_populate_recordset(null::public.equipment_photos, coalesce(payload->'equipment_photos', '[]'::jsonb));
  insert into public.pa_folders
    select * from jsonb_populate_recordset(null::public.pa_folders, coalesce(payload->'pa_folders', '[]'::jsonb));
  insert into public.pa_attachments
    select * from jsonb_populate_recordset(null::public.pa_attachments, coalesce(payload->'pa_attachments', '[]'::jsonb));
  insert into public.pa_notes
    select * from jsonb_populate_recordset(null::public.pa_notes, coalesce(payload->'pa_notes', '[]'::jsonb));
  insert into public.line_activities
    select * from jsonb_populate_recordset(null::public.line_activities, coalesce(payload->'line_activities', '[]'::jsonb));
  insert into public.common_notes
    select * from jsonb_populate_recordset(null::public.common_notes, coalesce(payload->'common_notes', '[]'::jsonb));
  insert into public.common_files
    select * from jsonb_populate_recordset(null::public.common_files, coalesce(payload->'common_files', '[]'::jsonb));

  perform set_config('app.replicating', 'off', true);
end $function$;