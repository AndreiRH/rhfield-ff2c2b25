-- equipment_settings: shared title across sibling PEs (via template_id), local value per row
create table public.equipment_settings (
  id uuid primary key default gen_random_uuid(),
  plant_equipment_id uuid not null,
  template_id uuid,
  title text not null default 'Setting',
  sort_order integer not null default 0,
  -- local value (kept per-row, since each line has its own row replicated by template)
  body text not null default '',
  photo_path text,
  file_path text,
  file_name text,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

alter table public.equipment_settings enable row level security;

create policy "es read" on public.equipment_settings for select to authenticated
  using (has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
create policy "es write" on public.equipment_settings for all to authenticated
  using (has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role]))
  with check (has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role]));

create trigger es_touch before update on public.equipment_settings
  for each row execute function public.touch_updated_at();

-- assign template_id on insert
create or replace function public.set_template_id_es()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.template_id is null then new.template_id := gen_random_uuid(); end if;
  return new;
end $$;
create trigger es_set_template before insert on public.equipment_settings
  for each row execute function public.set_template_id_es();

-- replicate row across all sibling plant_equipment (same project) on insert
create or replace function public.replicate_equipment_setting()
returns trigger language plpgsql security definer set search_path = public as $$
declare pe_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating','on',true);
  select template_id into pe_tid from public.plant_equipment where id = new.plant_equipment_id;
  if pe_tid is not null then
    insert into public.equipment_settings (plant_equipment_id, title, sort_order, template_id, deleted_at)
      select sib.id, new.title, new.sort_order, new.template_id, new.deleted_at
      from public.plant_equipment sib
      where sib.template_id = pe_tid and sib.id <> new.plant_equipment_id
        and not exists (select 1 from public.equipment_settings s2 where s2.plant_equipment_id = sib.id and s2.template_id = new.template_id);
  end if;
  perform set_config('app.replicating','off',true);
  return new;
end $$;
create trigger es_replicate after insert on public.equipment_settings
  for each row execute function public.replicate_equipment_setting();

-- propagate title / sort_order / deleted_at across siblings on update (NOT body/photo/file — those are local)
create or replace function public.propagate_es_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.title = old.title and new.sort_order = old.sort_order
     and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  perform set_config('app.replicating','on',true);
  update public.equipment_settings
     set title = new.title, sort_order = new.sort_order, deleted_at = new.deleted_at
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating','off',true);
  return new;
end $$;
create trigger es_propagate after update on public.equipment_settings
  for each row execute function public.propagate_es_update();