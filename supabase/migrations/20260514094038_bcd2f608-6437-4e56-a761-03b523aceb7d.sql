-- Make trigger helper functions use an explicit schema search path
create or replace function public.set_template_id_pe()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.template_id is null then new.template_id := gen_random_uuid(); end if;
  return new;
end $$;

create or replace function public.set_template_id_eg()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.template_id is null then new.template_id := gen_random_uuid(); end if;
  return new;
end $$;

create or replace function public.set_template_id_comp()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.template_id is null then new.template_id := gen_random_uuid(); end if;
  return new;
end $$;

create or replace function public.set_template_id_ci()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.template_id is null then new.template_id := gen_random_uuid(); end if;
  return new;
end $$;

-- Backend helper functions should not be callable by anonymous/public users
revoke execute on function public.has_role(uuid, public.app_role) from public;
revoke execute on function public.has_any_role(uuid, public.app_role[]) from public;
revoke execute on function public.handle_new_user() from public;
revoke execute on function public.replicate_plant_equipment() from public;
revoke execute on function public.replicate_equipment_group() from public;
revoke execute on function public.replicate_component() from public;
revoke execute on function public.replicate_checklist_item() from public;
revoke execute on function public.propagate_pe_update() from public;
revoke execute on function public.propagate_eg_update() from public;
revoke execute on function public.propagate_comp_update() from public;
revoke execute on function public.propagate_ci_update() from public;
revoke execute on function public.populate_new_line_from_template() from public;

-- Signed-in app users still need role checks for RLS policies
grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.has_any_role(uuid, public.app_role[]) to authenticated;