CREATE OR REPLACE FUNCTION public.create_default_groups_for_pe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ch text;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  foreach ch in array array['assembly','wiring','cold_comm'] loop
    insert into public.equipment_groups (line_id, chapter, kind, name, sort_order, plant_equipment_id)
    values (new.line_id, ch::chapter_kind, new.kind, new.name, 0, new.id);
  end loop;
  return new;
end $function$;