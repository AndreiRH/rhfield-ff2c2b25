
-- Auto-assign viewer role to new users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'viewer')
  on conflict (user_id, role) do nothing;
  return new;
end;
$function$;

-- Update all SELECT policies that gate on team roles to include viewer
DO $$
DECLARE
  r record;
  team_roles text := 'ARRAY[''admin''::app_role, ''engineer''::app_role, ''pm''::app_role, ''viewer''::app_role]';
BEGIN
  FOR r IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND cmd = 'SELECT'
      AND qual LIKE '%has_any_role%admin%engineer%pm%'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (has_any_role(auth.uid(), %s))',
      r.policyname, r.tablename, team_roles
    );
  END LOOP;
END $$;
