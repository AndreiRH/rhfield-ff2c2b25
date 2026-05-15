create table public.setting_logs (
  id uuid primary key default gen_random_uuid(),
  plant_equipment_id uuid not null,
  equipment_setting_id uuid,
  setting_title text not null default '',
  action text not null,
  old_value text,
  new_value text,
  user_id uuid,
  created_at timestamptz not null default now()
);

create index setting_logs_pe_created_idx
  on public.setting_logs (plant_equipment_id, created_at desc);

alter table public.setting_logs enable row level security;

create policy "sl read" on public.setting_logs
  for select to authenticated
  using (has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));

create policy "sl write" on public.setting_logs
  for insert to authenticated
  with check (has_any_role(auth.uid(), array['admin','engineer']::app_role[]));