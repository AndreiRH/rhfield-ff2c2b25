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

  insert into public.pa_notes (
    id, line_id, folder_id, kind, title, body, sort_order,
    photo_path, file_path, file_name, is_shared,
    created_by, created_at, updated_at
  )
  select
    id, line_id, folder_id, kind,
    coalesce(title, 'Note'),
    coalesce(body, ''),
    coalesce(sort_order, 0),
    photo_path, file_path, file_name,
    coalesce(is_shared, false),
    created_by,
    coalesce(created_at, now()),
    coalesce(updated_at, now())
  from jsonb_to_recordset(coalesce(payload->'pa_notes', '[]'::jsonb)) as x(
    id uuid,
    line_id uuid,
    folder_id uuid,
    kind public.plant_kind,
    title text,
    body text,
    sort_order integer,
    photo_path text,
    file_path text,
    file_name text,
    is_shared boolean,
    created_by uuid,
    created_at timestamptz,
    updated_at timestamptz
  );

  insert into public.line_activities (
    id, line_id, name, start_date, end_date, color,
    is_shared, shared_group_id, origin_line_id,
    created_by, created_at, show_on_global, sort_order,
    duration_days, follows_activity_id, offset_days
  )
  select
    id, line_id,
    coalesce(name, 'Activity'),
    start_date,
    coalesce(end_date, start_date + (coalesce(duration_days, 1) - 1)),
    coalesce(color, '#3b82f6'),
    coalesce(is_shared, false),
    shared_group_id,
    origin_line_id,
    created_by,
    coalesce(created_at, now()),
    coalesce(show_on_global, true),
    coalesce(sort_order, 0),
    greatest(1, coalesce(duration_days, (coalesce(end_date, start_date) - start_date) + 1, 1)),
    follows_activity_id,
    coalesce(offset_days, 0)
  from jsonb_to_recordset(coalesce(payload->'line_activities', '[]'::jsonb)) as x(
    id uuid,
    line_id uuid,
    name text,
    start_date date,
    end_date date,
    color text,
    is_shared boolean,
    shared_group_id uuid,
    origin_line_id uuid,
    created_by uuid,
    created_at timestamptz,
    show_on_global boolean,
    sort_order integer,
    duration_days integer,
    follows_activity_id uuid,
    offset_days integer
  )
  where start_date is not null;

  insert into public.common_notes
    select * from jsonb_populate_recordset(null::public.common_notes, coalesce(payload->'common_notes', '[]'::jsonb));
  insert into public.common_files
    select * from jsonb_populate_recordset(null::public.common_files, coalesce(payload->'common_files', '[]'::jsonb));

  perform set_config('app.replicating', 'off', true);
exception
  when others then
    perform set_config('app.replicating', 'off', true);
    raise;
end $function$;
