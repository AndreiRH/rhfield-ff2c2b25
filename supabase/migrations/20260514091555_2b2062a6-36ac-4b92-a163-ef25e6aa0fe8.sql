
-- Template id columns
alter table public.plant_equipment add column if not exists template_id uuid;
alter table public.equipment_groups add column if not exists template_id uuid;
alter table public.components add column if not exists template_id uuid;
alter table public.checklist_items add column if not exists template_id uuid;

create index if not exists pe_template_idx on public.plant_equipment(template_id);
create index if not exists eg_template_idx on public.equipment_groups(template_id);
create index if not exists comp_template_idx on public.components(template_id);
create index if not exists ci_template_idx on public.checklist_items(template_id);

-- Backfill plant_equipment template_id by (project, kind, name)
do $$ declare r record; new_t uuid; begin
  for r in
    select l.project_id, pe.kind, pe.name
    from public.plant_equipment pe
    join public.lines l on l.id = pe.line_id
    where pe.template_id is null and pe.deleted_at is null
    group by l.project_id, pe.kind, pe.name
  loop
    new_t := gen_random_uuid();
    update public.plant_equipment pe
       set template_id = new_t
     where pe.id in (
       select pe2.id from public.plant_equipment pe2
       join public.lines l on l.id = pe2.line_id
       where l.project_id = r.project_id and pe2.kind = r.kind and pe2.name = r.name and pe2.template_id is null
     );
  end loop;
end $$;

-- Backfill equipment_groups template_id
do $$ declare r record; new_t uuid; begin
  for r in
    select l.project_id, eg.kind, eg.chapter, eg.name, pe.template_id as pe_tid
    from public.equipment_groups eg
    join public.lines l on l.id = eg.line_id
    left join public.plant_equipment pe on pe.id = eg.plant_equipment_id
    where eg.template_id is null and eg.deleted_at is null
    group by l.project_id, eg.kind, eg.chapter, eg.name, pe.template_id
  loop
    new_t := gen_random_uuid();
    update public.equipment_groups eg
       set template_id = new_t
     where eg.id in (
       select eg2.id from public.equipment_groups eg2
       join public.lines l on l.id = eg2.line_id
       left join public.plant_equipment pe on pe.id = eg2.plant_equipment_id
       where l.project_id = r.project_id
         and eg2.kind = r.kind and eg2.chapter = r.chapter and eg2.name = r.name
         and (pe.template_id is not distinct from r.pe_tid)
         and eg2.template_id is null
     );
  end loop;
end $$;

-- Backfill components template_id
do $$ declare r record; new_t uuid; begin
  for r in
    select eg.template_id as eg_tid, c.name
    from public.components c
    join public.equipment_groups eg on eg.id = c.equipment_id
    where c.template_id is null and c.deleted_at is null and eg.template_id is not null
    group by eg.template_id, c.name
  loop
    new_t := gen_random_uuid();
    update public.components c
       set template_id = new_t
     where c.id in (
       select c2.id from public.components c2
       join public.equipment_groups eg on eg.id = c2.equipment_id
       where eg.template_id = r.eg_tid and c2.name = r.name and c2.template_id is null
     );
  end loop;
end $$;

-- BEFORE INSERT triggers
create or replace function public.set_template_id_pe() returns trigger language plpgsql as $$
begin if new.template_id is null then new.template_id := gen_random_uuid(); end if; return new; end $$;
create or replace function public.set_template_id_eg() returns trigger language plpgsql as $$
begin if new.template_id is null then new.template_id := gen_random_uuid(); end if; return new; end $$;
create or replace function public.set_template_id_comp() returns trigger language plpgsql as $$
begin if new.template_id is null then new.template_id := gen_random_uuid(); end if; return new; end $$;
create or replace function public.set_template_id_ci() returns trigger language plpgsql as $$
begin if new.template_id is null then new.template_id := gen_random_uuid(); end if; return new; end $$;

drop trigger if exists pe_set_template on public.plant_equipment;
create trigger pe_set_template before insert on public.plant_equipment for each row execute function public.set_template_id_pe();
drop trigger if exists eg_set_template on public.equipment_groups;
create trigger eg_set_template before insert on public.equipment_groups for each row execute function public.set_template_id_eg();
drop trigger if exists comp_set_template on public.components;
create trigger comp_set_template before insert on public.components for each row execute function public.set_template_id_comp();
drop trigger if exists ci_set_template on public.checklist_items;
create trigger ci_set_template before insert on public.checklist_items for each row execute function public.set_template_id_ci();

-- Replication on INSERT
create or replace function public.replicate_plant_equipment() returns trigger
language plpgsql security definer set search_path = public as $$
declare proj uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating', 'on', true);
  select project_id into proj from public.lines where id = new.line_id;
  insert into public.plant_equipment (line_id, kind, name, sort_order, template_id, deleted_at)
    select l.id, new.kind, new.name, new.sort_order, new.template_id, new.deleted_at
    from public.lines l
    where l.project_id = proj and l.id <> new.line_id
      and not exists (select 1 from public.plant_equipment p2 where p2.line_id = l.id and p2.template_id = new.template_id);
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;
drop trigger if exists pe_replicate on public.plant_equipment;
create trigger pe_replicate after insert on public.plant_equipment for each row execute function public.replicate_plant_equipment();

create or replace function public.replicate_equipment_group() returns trigger
language plpgsql security definer set search_path = public as $$
declare proj uuid; pe_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating', 'on', true);
  select project_id into proj from public.lines where id = new.line_id;
  if new.plant_equipment_id is not null then
    select template_id into pe_tid from public.plant_equipment where id = new.plant_equipment_id;
    insert into public.equipment_groups (line_id, chapter, kind, name, sort_order, template_id, plant_equipment_id, deleted_at)
      select l.id, new.chapter, new.kind, new.name, new.sort_order, new.template_id, sib_pe.id, new.deleted_at
      from public.lines l
      join public.plant_equipment sib_pe on sib_pe.line_id = l.id and sib_pe.template_id = pe_tid
      where l.project_id = proj and l.id <> new.line_id
        and not exists (select 1 from public.equipment_groups e2 where e2.line_id = l.id and e2.template_id = new.template_id);
  else
    insert into public.equipment_groups (line_id, chapter, kind, name, sort_order, template_id, deleted_at)
      select l.id, new.chapter, new.kind, new.name, new.sort_order, new.template_id, new.deleted_at
      from public.lines l
      where l.project_id = proj and l.id <> new.line_id
        and not exists (select 1 from public.equipment_groups e2 where e2.line_id = l.id and e2.template_id = new.template_id);
  end if;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;
drop trigger if exists eg_replicate on public.equipment_groups;
create trigger eg_replicate after insert on public.equipment_groups for each row execute function public.replicate_equipment_group();

create or replace function public.replicate_component() returns trigger
language plpgsql security definer set search_path = public as $$
declare eg_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating', 'on', true);
  select template_id into eg_tid from public.equipment_groups where id = new.equipment_id;
  if eg_tid is not null then
    insert into public.components (equipment_id, name, sort_order, template_id, deleted_at)
      select sib_eg.id, new.name, new.sort_order, new.template_id, new.deleted_at
      from public.equipment_groups sib_eg
      where sib_eg.template_id = eg_tid and sib_eg.id <> new.equipment_id
        and not exists (select 1 from public.components c2 where c2.equipment_id = sib_eg.id and c2.template_id = new.template_id);
  end if;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;
drop trigger if exists comp_replicate on public.components;
create trigger comp_replicate after insert on public.components for each row execute function public.replicate_component();

create or replace function public.replicate_checklist_item() returns trigger
language plpgsql security definer set search_path = public as $$
declare comp_tid uuid; parent_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating', 'on', true);
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
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;
drop trigger if exists ci_replicate on public.checklist_items;
create trigger ci_replicate after insert on public.checklist_items for each row execute function public.replicate_checklist_item();

-- Propagation AFTER UPDATE (rename / reorder / soft-delete only)
create or replace function public.propagate_pe_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.name = old.name and new.sort_order = old.sort_order and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  perform set_config('app.replicating', 'on', true);
  update public.plant_equipment set name = new.name, sort_order = new.sort_order, deleted_at = new.deleted_at
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;
drop trigger if exists pe_propagate on public.plant_equipment;
create trigger pe_propagate after update on public.plant_equipment for each row execute function public.propagate_pe_update();

create or replace function public.propagate_eg_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.name = old.name and new.sort_order = old.sort_order and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  perform set_config('app.replicating', 'on', true);
  update public.equipment_groups set name = new.name, sort_order = new.sort_order, deleted_at = new.deleted_at
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;
drop trigger if exists eg_propagate on public.equipment_groups;
create trigger eg_propagate after update on public.equipment_groups for each row execute function public.propagate_eg_update();

create or replace function public.propagate_comp_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.name = old.name and new.sort_order = old.sort_order and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  perform set_config('app.replicating', 'on', true);
  update public.components set name = new.name, sort_order = new.sort_order, deleted_at = new.deleted_at
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;
drop trigger if exists comp_propagate on public.components;
create trigger comp_propagate after update on public.components for each row execute function public.propagate_comp_update();

create or replace function public.propagate_ci_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.label = old.label and new.sort_order = old.sort_order and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  perform set_config('app.replicating', 'on', true);
  update public.checklist_items set label = new.label, sort_order = new.sort_order, deleted_at = new.deleted_at
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;
drop trigger if exists ci_propagate on public.checklist_items;
create trigger ci_propagate after update on public.checklist_items for each row execute function public.propagate_ci_update();

-- New lines inherit project's existing template structure
create or replace function public.populate_new_line_from_template() returns trigger
language plpgsql security definer set search_path = public as $$
declare other_line uuid;
  pe record; eg record; comp record; ci record;
  new_pe uuid; new_eg uuid; new_comp uuid;
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
end $$;
drop trigger if exists lines_populate_template on public.lines;
create trigger lines_populate_template after insert on public.lines for each row execute function public.populate_new_line_from_template();
