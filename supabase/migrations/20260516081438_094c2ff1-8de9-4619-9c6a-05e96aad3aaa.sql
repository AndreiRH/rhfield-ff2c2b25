-- 1) Wipe all existing component-layer data.
--    checklist_items.component_id is currently NOT NULL, so every item, photo,
--    file and note hanging off a component is removed too. This is what the
--    user explicitly asked for ("delete also the components sublayers").
delete from public.item_photos
 where item_id in (select id from public.checklist_items);
delete from public.item_files
 where item_id in (select id from public.checklist_items);
delete from public.checklist_items;
delete from public.component_photos;
delete from public.component_files;
delete from public.components;

-- 2) Let checklist_items attach to either a component (legacy) OR a
--    component_type (new flat hierarchy). Exactly one of the two must be set.
alter table public.checklist_items
  alter column component_id drop not null;

alter table public.checklist_items
  add column if not exists component_type_id uuid;

alter table public.checklist_items
  drop constraint if exists checklist_items_one_parent;

alter table public.checklist_items
  add constraint checklist_items_one_parent
  check (
    (component_id is not null and component_type_id is null)
    or (component_id is null and component_type_id is not null)
  );

create index if not exists checklist_items_component_type_id_idx
  on public.checklist_items (component_type_id);

-- 3) Teach the per-line replication trigger about items that live directly
--    under a component_type. (Items still under a component continue to
--    replicate via the existing branch.)
create or replace function public.replicate_checklist_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare comp_tid uuid; ct_tid uuid; parent_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating', 'on', true);

  if new.component_type_id is not null then
    select template_id into ct_tid from public.component_types where id = new.component_type_id;
    if ct_tid is not null then
      if new.parent_item_id is null then
        insert into public.checklist_items (component_type_id, label, sort_order, template_id, parent_item_id, deleted_at)
          select sib_ct.id, new.label, new.sort_order, new.template_id, null, new.deleted_at
          from public.component_types sib_ct
          where sib_ct.template_id = ct_tid and sib_ct.id <> new.component_type_id
            and not exists (
              select 1 from public.checklist_items i2
              where i2.component_type_id = sib_ct.id and i2.template_id = new.template_id
            );
      else
        select template_id into parent_tid from public.checklist_items where id = new.parent_item_id;
        if parent_tid is not null then
          insert into public.checklist_items (component_type_id, label, sort_order, template_id, parent_item_id, deleted_at)
            select sib_ct.id, new.label, new.sort_order, new.template_id, sib_parent.id, new.deleted_at
            from public.component_types sib_ct
            join public.checklist_items sib_parent
              on sib_parent.component_type_id = sib_ct.id and sib_parent.template_id = parent_tid
            where sib_ct.template_id = ct_tid and sib_ct.id <> new.component_type_id
              and not exists (
                select 1 from public.checklist_items i2
                where i2.component_type_id = sib_ct.id and i2.template_id = new.template_id
              );
        end if;
      end if;
    end if;
  elsif new.component_id is not null then
    select template_id into comp_tid from public.components where id = new.component_id;
    if comp_tid is not null then
      if new.parent_item_id is null then
        insert into public.checklist_items (component_id, label, sort_order, template_id, parent_item_id, deleted_at)
          select sib_c.id, new.label, new.sort_order, new.template_id, null, new.deleted_at
          from public.components sib_c
          where sib_c.template_id = comp_tid and sib_c.id <> new.component_id
            and not exists (select 1 from public.checklist_items i2 where i2.component_id = sib_c.id and i2.template_id = new.template_id);
      else
        select template_id into parent_tid from public.checklist_items where id = new.parent_item_id;
        if parent_tid is not null then
          insert into public.checklist_items (component_id, label, sort_order, template_id, parent_item_id, deleted_at)
            select sib_c.id, new.label, new.sort_order, new.template_id, sib_parent.id, new.deleted_at
            from public.components sib_c
            join public.checklist_items sib_parent on sib_parent.component_id = sib_c.id and sib_parent.template_id = parent_tid
            where sib_c.template_id = comp_tid and sib_c.id <> new.component_id
              and not exists (select 1 from public.checklist_items i2 where i2.component_id = sib_c.id and i2.template_id = new.template_id);
        end if;
      end if;
    end if;
  end if;

  perform set_config('app.replicating', 'off', true);
  return new;
end $function$;

-- 4) Teach the "new line copies from sister line" trigger to also copy
--    items that live directly under a component_type.
create or replace function public.populate_new_line_from_template()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare other_line uuid;
  pe record; eg record; ct record; comp record; ci record;
  new_pe uuid; new_eg uuid; new_ct uuid; new_comp uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  select id into other_line from public.lines
   where project_id = new.project_id and id <> new.id
   limit 1;
  if other_line is null then return new; end if;
  perform set_config('app.replicating', 'on', true);

  for pe in select * from public.plant_equipment where line_id = other_line and deleted_at is null loop
    insert into public.plant_equipment (line_id, kind, name, sort_order, template_id)
      values (new.id, pe.kind, pe.name, pe.sort_order, pe.template_id)
      returning id into new_pe;
    for eg in select * from public.equipment_groups
              where line_id = other_line and plant_equipment_id = pe.id and deleted_at is null loop
      insert into public.equipment_groups (line_id, chapter, kind, name, sort_order, template_id, plant_equipment_id)
        values (new.id, eg.chapter, eg.kind, eg.name, eg.sort_order, eg.template_id, new_pe)
        returning id into new_eg;

      -- component_types under this equipment_group, with their items
      for ct in select * from public.component_types where equipment_group_id = eg.id and deleted_at is null loop
        insert into public.component_types (equipment_group_id, name, sort_order, template_id)
          values (new_eg, ct.name, ct.sort_order, ct.template_id)
          returning id into new_ct;
        for ci in select * from public.checklist_items
                  where component_type_id = ct.id and parent_item_id is null and deleted_at is null loop
          insert into public.checklist_items (component_type_id, label, sort_order, template_id)
            values (new_ct, ci.label, ci.sort_order, ci.template_id);
        end loop;
        for ci in select * from public.checklist_items
                  where component_type_id = ct.id and parent_item_id is not null and deleted_at is null loop
          insert into public.checklist_items (component_type_id, label, sort_order, template_id, parent_item_id)
          select new_ct, ci.label, ci.sort_order, ci.template_id, sib.id
          from public.checklist_items sib
          where sib.component_type_id = new_ct
            and sib.template_id = (select template_id from public.checklist_items where id = ci.parent_item_id);
        end loop;
      end loop;

      -- legacy: components under this equipment_group (kept for backward compat)
      for comp in select * from public.components where equipment_id = eg.id and deleted_at is null loop
        insert into public.components (equipment_id, name, sort_order, template_id)
          values (new_eg, comp.name, comp.sort_order, comp.template_id)
          returning id into new_comp;
        for ci in select * from public.checklist_items
                  where component_id = comp.id and parent_item_id is null and deleted_at is null loop
          insert into public.checklist_items (component_id, label, sort_order, template_id)
            values (new_comp, ci.label, ci.sort_order, ci.template_id);
        end loop;
        for ci in select * from public.checklist_items
                  where component_id = comp.id and parent_item_id is not null and deleted_at is null loop
          insert into public.checklist_items (component_id, label, sort_order, template_id, parent_item_id)
          select new_comp, ci.label, ci.sort_order, ci.template_id, sib.id
          from public.checklist_items sib
          where sib.component_id = new_comp
            and sib.template_id = (select template_id from public.checklist_items where id = ci.parent_item_id);
        end loop;
      end loop;
    end loop;
  end loop;

  for eg in select * from public.equipment_groups
            where line_id = other_line and plant_equipment_id is null and deleted_at is null loop
    insert into public.equipment_groups (line_id, chapter, kind, name, sort_order, template_id)
      values (new.id, eg.chapter, eg.kind, eg.name, eg.sort_order, eg.template_id)
      returning id into new_eg;
    for ct in select * from public.component_types where equipment_group_id = eg.id and deleted_at is null loop
      insert into public.component_types (equipment_group_id, name, sort_order, template_id)
        values (new_eg, ct.name, ct.sort_order, ct.template_id)
        returning id into new_ct;
      for ci in select * from public.checklist_items
                where component_type_id = ct.id and parent_item_id is null and deleted_at is null loop
        insert into public.checklist_items (component_type_id, label, sort_order, template_id)
          values (new_ct, ci.label, ci.sort_order, ci.template_id);
      end loop;
    end loop;
    for comp in select * from public.components where equipment_id = eg.id and deleted_at is null loop
      insert into public.components (equipment_id, name, sort_order, template_id)
        values (new_eg, comp.name, comp.sort_order, comp.template_id)
        returning id into new_comp;
      for ci in select * from public.checklist_items
                where component_id = comp.id and parent_item_id is null and deleted_at is null loop
        insert into public.checklist_items (component_id, label, sort_order, template_id)
          values (new_comp, ci.label, ci.sort_order, ci.template_id);
      end loop;
    end loop;
  end loop;

  perform set_config('app.replicating', 'off', true);
  return new;
end $function$;

-- 5) Update delete_project_cascade so items-under-types are removed too.
create or replace function public.delete_project_cascade(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $function$
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
  delete from public.milestones where line_id = any(coalesce(line_ids,'{}'::uuid[]));
  delete from public.common_notes where project_id = p_project_id;
  delete from public.common_files where project_id = p_project_id;
  delete from public.lines where project_id = p_project_id;
  delete from public.projects where id = p_project_id;

  perform set_config('app.replicating', 'off', true);
end $function$;