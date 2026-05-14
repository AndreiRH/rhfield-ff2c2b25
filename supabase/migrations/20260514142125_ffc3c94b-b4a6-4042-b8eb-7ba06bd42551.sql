
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, display_name text, roles app_role[], created_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can list users';
  end if;
  return query
  select u.id, u.email::text, p.display_name,
    coalesce((select array_agg(ur.role order by ur.role) from public.user_roles ur where ur.user_id = u.id), '{}'::app_role[]),
    u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by u.created_at;
end $$;

create or replace function public.admin_set_user_role(_user_id uuid, _role app_role, _grant boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can change roles';
  end if;
  if _grant then
    insert into public.user_roles (user_id, role) values (_user_id, _role)
    on conflict (user_id, role) do nothing;
  else
    if _role = 'admin' and _user_id = auth.uid() then
      raise exception 'You cannot remove your own admin role';
    end if;
    delete from public.user_roles where user_id = _user_id and role = _role;
  end if;
end $$;
