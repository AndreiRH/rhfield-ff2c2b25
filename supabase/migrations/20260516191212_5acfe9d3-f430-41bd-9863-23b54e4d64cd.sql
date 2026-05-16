
-- 1) Restrict user_roles SELECT: only self, or admin can see all
DROP POLICY IF EXISTS "user_roles read" ON public.user_roles;
CREATE POLICY "user_roles read own or admin" ON public.user_roles
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));

-- 2) Revoke EXECUTE on internal trigger functions (called only by triggers, never by clients)
REVOKE EXECUTE ON FUNCTION public.propagate_comp_update() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.propagate_ci_update() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_template_id_ci() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_template_id_comp() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_template_id_ct() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.propagate_ct_update() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.propagate_pe_mech() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_template_id_pe() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_template_id_eg() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.create_default_groups_for_pe() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.propagate_pe_update() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.propagate_eg_update() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.replicate_component_type() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.replicate_plant_equipment() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.replicate_component() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.replicate_checklist_item() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.propagate_pa_folder_update() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.replicate_pa_folder() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_template_id_paf() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.set_template_id_es() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.propagate_es_update() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.replicate_equipment_setting() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.populate_new_line_from_template() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.replicate_equipment_group() FROM anon, authenticated, public;
