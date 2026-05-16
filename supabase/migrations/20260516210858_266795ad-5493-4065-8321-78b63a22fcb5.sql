ALTER TABLE public.equipment_settings ADD COLUMN IF NOT EXISTS group_name text;

CREATE OR REPLACE FUNCTION public.propagate_es_update()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.title = old.title and new.sort_order = old.sort_order
     and new.group_name is not distinct from old.group_name
     and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  perform set_config('app.replicating','on',true);
  update public.equipment_settings
     set title = new.title, sort_order = new.sort_order,
         group_name = new.group_name,
         deleted_at = new.deleted_at
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating','off',true);
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.replicate_equipment_setting()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare pe_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating','on',true);
  select template_id into pe_tid from public.plant_equipment where id = new.plant_equipment_id;
  if pe_tid is not null then
    insert into public.equipment_settings (plant_equipment_id, title, sort_order, group_name, template_id, deleted_at)
      select sib.id, new.title, new.sort_order, new.group_name, new.template_id, new.deleted_at
      from public.plant_equipment sib
      where sib.template_id = pe_tid and sib.id <> new.plant_equipment_id
        and not exists (select 1 from public.equipment_settings s2 where s2.plant_equipment_id = sib.id and s2.template_id = new.template_id);
  end if;
  perform set_config('app.replicating','off',true);
  return new;
end $function$;