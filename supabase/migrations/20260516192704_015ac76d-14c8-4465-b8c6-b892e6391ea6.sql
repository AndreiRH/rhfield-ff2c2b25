
create or replace function public.admin_delete_user(_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not has_role(auth.uid(), 'admin') then
    raise exception 'Only admins can delete users';
  end if;
  if _user_id = auth.uid() then
    raise exception 'You cannot delete your own account';
  end if;
  delete from auth.users where id = _user_id;
end;
$$;

revoke execute on function public.admin_delete_user(uuid) from anon, public;
grant execute on function public.admin_delete_user(uuid) to authenticated;
