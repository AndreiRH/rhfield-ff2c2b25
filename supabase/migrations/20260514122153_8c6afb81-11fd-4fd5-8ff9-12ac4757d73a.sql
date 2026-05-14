
-- =========================================================
-- 1. New mechanical fields on plant_equipment
-- =========================================================
alter table public.plant_equipment
  add column if not exists mech_mode text not null default 'manual',
  add column if not exists mech_manual_pct int,
  add column if not exists mech_notes text;

alter table public.plant_equipment
  drop constraint if exists plant_equipment_mech_mode_check;
alter table public.plant_equipment
  add constraint plant_equipment_mech_mode_check
    check (mech_mode in ('manual','checklist'));

alter table public.plant_equipment
  drop constraint if exists plant_equipment_mech_pct_check;
alter table public.plant_equipment
  add constraint plant_equipment_mech_pct_check
    check (mech_manual_pct is null or (mech_manual_pct between 0 and 100));

-- =========================================================
-- 2. equipment_photos (mechanical evidence at equipment level)
-- =========================================================
create table if not exists public.equipment_photos (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null,
  storage_path text not null,
  uploaded_by uuid,
  uploaded_at timestamptz not null default now()
);
alter table public.equipment_photos enable row level security;

drop policy if exists "ep read" on public.equipment_photos;
create policy "ep read" on public.equipment_photos
  for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role,'pm'::app_role]));

drop policy if exists "ep write" on public.equipment_photos;
create policy "ep write" on public.equipment_photos
  for all to authenticated
  using (public.has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role]))
  with check (public.has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role]));

-- =========================================================
-- 3. component_types (Sensors, Valves, ...)
-- =========================================================
create table if not exists public.component_types (
  id uuid primary key default gen_random_uuid(),
  equipment_group_id uuid not null,
  name text not null,
  sort_order int not null default 0,
  template_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.component_types enable row level security;

drop policy if exists "ct read" on public.component_types;
create policy "ct read" on public.component_types
  for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role,'pm'::app_role]));

drop policy if exists "ct write" on public.component_types;
create policy "ct write" on public.component_types
  for all to authenticated
  using (public.has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role]))
  with check (public.has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role]));

-- =========================================================
-- 4. components -> component_type_id link
-- =========================================================
alter table public.components
  add column if not exists component_type_id uuid;

-- Make equipment_id nullable so plant components can live under types only
alter table public.components
  alter column equipment_id drop not null;

-- =========================================================
-- 5. WIPE existing plant component data (per user request)
--    Keep extra_work groups and their components (after-sales).
-- =========================================================
-- Drop photos for items belonging to plant components
delete from public.item_photos
 where item_id in (
   select ci.id from public.checklist_items ci
   join public.components c on c.id = ci.component_id
   join public.equipment_groups eg on eg.id = c.equipment_id
   where eg.kind in ('kiln','shs')
 );

delete from public.checklist_items
 where component_id in (
   select c.id from public.components c
   join public.equipment_groups eg on eg.id = c.equipment_id
   where eg.kind in ('kiln','shs')
 );

delete from public.components
 where equipment_id in (
   select id from public.equipment_groups where kind in ('kiln','shs')
 );

delete from public.equipment_groups where kind in ('kiln','shs');

-- =========================================================
-- 6. Helper: ensure templates on component_types
-- =========================================================
create or replace function public.set_template_id_ct()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.template_id is null then new.template_id := gen_random_uuid(); end if;
  return new;
end $$;

drop trigger if exists set_template_id_ct on public.component_types;
create trigger set_template_id_ct before insert on public.component_types
  for each row execute function public.set_template_id_ct();

-- updated_at touch
drop trigger if exists touch_ct_updated_at on public.component_types;
create trigger touch_ct_updated_at before update on public.component_types
  for each row execute function public.touch_updated_at();

-- =========================================================
-- 7. Replicate component_types across sibling equipment_groups
-- =========================================================
create or replace function public.replicate_component_type()
returns trigger language plpgsql security definer set search_path = public as $$
declare eg_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating', 'on', true);
  select template_id into eg_tid from public.equipment_groups where id = new.equipment_group_id;
  if eg_tid is not null then
    insert into public.component_types (equipment_group_id, name, sort_order, template_id, deleted_at)
      select sib.id, new.name, new.sort_order, new.template_id, new.deleted_at
      from public.equipment_groups sib
      where sib.template_id = eg_tid and sib.id <> new.equipment_group_id
        and not exists (
          select 1 from public.component_types t2
          where t2.equipment_group_id = sib.id and t2.template_id = new.template_id
        );
  end if;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;

drop trigger if exists replicate_component_type on public.component_types;
create trigger replicate_component_type after insert on public.component_types
  for each row execute function public.replicate_component_type();

create or replace function public.propagate_ct_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.name = old.name and new.sort_order = old.sort_order
     and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  perform set_config('app.replicating', 'on', true);
  update public.component_types
     set name = new.name, sort_order = new.sort_order, deleted_at = new.deleted_at
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;

drop trigger if exists propagate_ct_update on public.component_types;
create trigger propagate_ct_update after update on public.component_types
  for each row execute function public.propagate_ct_update();

-- =========================================================
-- 8. Update component replication to also mirror component_type_id
-- =========================================================
create or replace function public.replicate_component()
returns trigger language plpgsql security definer set search_path = public as $$
declare eg_tid uuid; ct_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating', 'on', true);

  if new.component_type_id is not null then
    select template_id into ct_tid from public.component_types where id = new.component_type_id;
    if ct_tid is not null then
      insert into public.components (equipment_id, component_type_id, name, sort_order, template_id, deleted_at)
        select null, sib.id, new.name, new.sort_order, new.template_id, new.deleted_at
        from public.component_types sib
        where sib.template_id = ct_tid and sib.id <> new.component_type_id
          and not exists (
            select 1 from public.components c2
            where c2.component_type_id = sib.id and c2.template_id = new.template_id
          );
    end if;
  elsif new.equipment_id is not null then
    select template_id into eg_tid from public.equipment_groups where id = new.equipment_id;
    if eg_tid is not null then
      insert into public.components (equipment_id, name, sort_order, template_id, deleted_at)
        select sib_eg.id, new.name, new.sort_order, new.template_id, new.deleted_at
        from public.equipment_groups sib_eg
        where sib_eg.template_id = eg_tid and sib_eg.id <> new.equipment_id
          and not exists (
            select 1 from public.components c2
            where c2.equipment_id = sib_eg.id and c2.template_id = new.template_id
          );
    end if;
  end if;

  perform set_config('app.replicating', 'off', true);
  return new;
end $$;

-- (re)attach trigger
drop trigger if exists replicate_component on public.components;
create trigger replicate_component after insert on public.components
  for each row execute function public.replicate_component();

drop trigger if exists propagate_comp_update on public.components;
create trigger propagate_comp_update after update on public.components
  for each row execute function public.propagate_comp_update();

drop trigger if exists set_template_id_comp on public.components;
create trigger set_template_id_comp before insert on public.components
  for each row execute function public.set_template_id_comp();

-- Make sure plant_equipment / equipment_groups / checklist_items triggers exist
drop trigger if exists set_template_id_pe on public.plant_equipment;
create trigger set_template_id_pe before insert on public.plant_equipment
  for each row execute function public.set_template_id_pe();
drop trigger if exists replicate_plant_equipment on public.plant_equipment;
create trigger replicate_plant_equipment after insert on public.plant_equipment
  for each row execute function public.replicate_plant_equipment();
drop trigger if exists propagate_pe_update on public.plant_equipment;
create trigger propagate_pe_update after update on public.plant_equipment
  for each row execute function public.propagate_pe_update();

drop trigger if exists set_template_id_eg on public.equipment_groups;
create trigger set_template_id_eg before insert on public.equipment_groups
  for each row execute function public.set_template_id_eg();
drop trigger if exists replicate_equipment_group on public.equipment_groups;
create trigger replicate_equipment_group after insert on public.equipment_groups
  for each row execute function public.replicate_equipment_group();
drop trigger if exists propagate_eg_update on public.equipment_groups;
create trigger propagate_eg_update after update on public.equipment_groups
  for each row execute function public.propagate_eg_update();

drop trigger if exists set_template_id_ci on public.checklist_items;
create trigger set_template_id_ci before insert on public.checklist_items
  for each row execute function public.set_template_id_ci();
drop trigger if exists replicate_checklist_item on public.checklist_items;
create trigger replicate_checklist_item after insert on public.checklist_items
  for each row execute function public.replicate_checklist_item();
drop trigger if exists propagate_ci_update on public.checklist_items;
create trigger propagate_ci_update after update on public.checklist_items
  for each row execute function public.propagate_ci_update();

-- =========================================================
-- 9. Mechanical status replication on plant_equipment
-- =========================================================
create or replace function public.propagate_pe_mech()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.mech_mode = old.mech_mode then return new; end if;
  perform set_config('app.replicating', 'on', true);
  update public.plant_equipment
     set mech_mode = new.mech_mode
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;

drop trigger if exists propagate_pe_mech on public.plant_equipment;
create trigger propagate_pe_mech after update on public.plant_equipment
  for each row execute function public.propagate_pe_mech();

-- =========================================================
-- 10. Auto-create the 3 chapter groups under each plant equipment
--     (per-line; replicate_equipment_group will mirror them across lines)
-- =========================================================
create or replace function public.create_default_groups_for_pe()
returns trigger language plpgsql security definer set search_path = public as $$
declare ch text;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  foreach ch in array array['assembly','wiring','cold_comm'] loop
    insert into public.equipment_groups (line_id, chapter, kind, name, sort_order, plant_equipment_id)
    values (new.line_id, ch::chapter, new.kind, new.name, 0, new.id);
  end loop;
  return new;
end $$;

drop trigger if exists create_default_groups_for_pe on public.plant_equipment;
create trigger create_default_groups_for_pe after insert on public.plant_equipment
  for each row execute function public.create_default_groups_for_pe();

grant execute on function public.set_template_id_ct() to authenticated;
grant execute on function public.replicate_component_type() to authenticated;
grant execute on function public.propagate_ct_update() to authenticated;
grant execute on function public.propagate_pe_mech() to authenticated;
grant execute on function public.create_default_groups_for_pe() to authenticated;
