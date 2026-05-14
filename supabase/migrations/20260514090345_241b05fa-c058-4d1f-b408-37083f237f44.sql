
-- New table: plant_equipment represents renameable equipment items inside a plant (Kiln/SHS)
create table if not exists public.plant_equipment (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null,
  kind equipment_kind not null,
  name text not null,
  sort_order integer not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists plant_equipment_line_kind_idx on public.plant_equipment(line_id, kind);

alter table public.plant_equipment enable row level security;

create policy "pe read" on public.plant_equipment
  for select to authenticated
  using (has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role,'pm'::app_role]));

create policy "pe write" on public.plant_equipment
  for all to authenticated
  using (has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role]))
  with check (has_any_role(auth.uid(), array['admin'::app_role,'engineer'::app_role]));

create trigger plant_equipment_touch
  before update on public.plant_equipment
  for each row execute function public.touch_updated_at();

-- Link equipment_groups to a plant_equipment (nullable; null means legacy plant-level)
alter table public.equipment_groups
  add column if not exists plant_equipment_id uuid references public.plant_equipment(id) on delete cascade;

create index if not exists equipment_groups_plant_equipment_idx on public.equipment_groups(plant_equipment_id);

-- Backfill: for each line+kind (kiln, shs) that has equipment_groups but no plant_equipment, create one "Main" and attach existing groups.
do $$
declare r record; new_pe uuid;
begin
  for r in
    select distinct eg.line_id, eg.kind
    from public.equipment_groups eg
    where eg.kind in ('kiln','shs')
      and eg.plant_equipment_id is null
      and eg.deleted_at is null
  loop
    insert into public.plant_equipment (line_id, kind, name, sort_order)
    values (r.line_id, r.kind, 'Main', 0)
    returning id into new_pe;

    update public.equipment_groups
       set plant_equipment_id = new_pe
     where line_id = r.line_id and kind = r.kind and plant_equipment_id is null;
  end loop;
end $$;
