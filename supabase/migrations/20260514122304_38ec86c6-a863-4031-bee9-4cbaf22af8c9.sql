
alter table public.component_types
  drop constraint if exists component_types_equipment_group_id_fkey,
  add constraint component_types_equipment_group_id_fkey
    foreign key (equipment_group_id) references public.equipment_groups(id) on delete cascade;

alter table public.components
  drop constraint if exists components_component_type_id_fkey,
  add constraint components_component_type_id_fkey
    foreign key (component_type_id) references public.component_types(id) on delete cascade;

alter table public.equipment_photos
  drop constraint if exists equipment_photos_equipment_id_fkey,
  add constraint equipment_photos_equipment_id_fkey
    foreign key (equipment_id) references public.plant_equipment(id) on delete cascade;

create index if not exists idx_component_types_eg on public.component_types(equipment_group_id);
create index if not exists idx_components_ct on public.components(component_type_id);
create index if not exists idx_equipment_photos_eq on public.equipment_photos(equipment_id);
