-- 1. New groups table
CREATE TABLE public.equipment_setting_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plant_equipment_id uuid NOT NULL,
  template_id uuid,
  name text NOT NULL DEFAULT 'New group',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX idx_esg_plant_equipment ON public.equipment_setting_groups(plant_equipment_id);
CREATE INDEX idx_esg_template ON public.equipment_setting_groups(template_id);

ALTER TABLE public.equipment_setting_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "esg read" ON public.equipment_setting_groups FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
CREATE POLICY "esg write" ON public.equipment_setting_groups FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));

-- template_id default
CREATE OR REPLACE FUNCTION public.set_template_id_esg()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
begin
  if new.template_id is null then new.template_id := gen_random_uuid(); end if;
  return new;
end $$;

CREATE TRIGGER esg_set_template BEFORE INSERT ON public.equipment_setting_groups
  FOR EACH ROW EXECUTE FUNCTION public.set_template_id_esg();

CREATE TRIGGER esg_touch BEFORE UPDATE ON public.equipment_setting_groups
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- replicate new group to all sibling equipment
CREATE OR REPLACE FUNCTION public.replicate_equipment_setting_group()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare pe_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating','on',true);
  select template_id into pe_tid from public.plant_equipment where id = new.plant_equipment_id;
  if pe_tid is not null then
    insert into public.equipment_setting_groups (plant_equipment_id, name, sort_order, template_id, deleted_at)
      select sib.id, new.name, new.sort_order, new.template_id, new.deleted_at
      from public.plant_equipment sib
      where sib.template_id = pe_tid and sib.id <> new.plant_equipment_id
        and not exists (
          select 1 from public.equipment_setting_groups g2
          where g2.plant_equipment_id = sib.id and g2.template_id = new.template_id
        );
  end if;
  perform set_config('app.replicating','off',true);
  return new;
end $$;

CREATE TRIGGER esg_replicate AFTER INSERT ON public.equipment_setting_groups
  FOR EACH ROW EXECUTE FUNCTION public.replicate_equipment_setting_group();

-- propagate name/sort/deleted across siblings on update
CREATE OR REPLACE FUNCTION public.propagate_esg_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.name = old.name and new.sort_order = old.sort_order
     and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  perform set_config('app.replicating','on',true);
  update public.equipment_setting_groups
     set name = new.name, sort_order = new.sort_order, deleted_at = new.deleted_at
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating','off',true);
  return new;
end $$;

CREATE TRIGGER esg_propagate AFTER UPDATE ON public.equipment_setting_groups
  FOR EACH ROW EXECUTE FUNCTION public.propagate_esg_update();

-- 2. equipment_settings: replace group_name with group_template_id
ALTER TABLE public.equipment_settings DROP COLUMN group_name;
ALTER TABLE public.equipment_settings ADD COLUMN group_template_id uuid;
CREATE INDEX idx_es_group_template ON public.equipment_settings(group_template_id);

-- 3. Update propagate / replicate triggers to use group_template_id
CREATE OR REPLACE FUNCTION public.propagate_es_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.title = old.title and new.sort_order = old.sort_order
     and new.group_template_id is not distinct from old.group_template_id
     and new.deleted_at is not distinct from old.deleted_at then return new; end if;
  perform set_config('app.replicating','on',true);
  update public.equipment_settings
     set title = new.title, sort_order = new.sort_order,
         group_template_id = new.group_template_id,
         deleted_at = new.deleted_at
   where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating','off',true);
  return new;
end $$;

CREATE OR REPLACE FUNCTION public.replicate_equipment_setting()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare pe_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating','on',true);
  select template_id into pe_tid from public.plant_equipment where id = new.plant_equipment_id;
  if pe_tid is not null then
    insert into public.equipment_settings (plant_equipment_id, title, sort_order, group_template_id, template_id, deleted_at)
      select sib.id, new.title, new.sort_order, new.group_template_id, new.template_id, new.deleted_at
      from public.plant_equipment sib
      where sib.template_id = pe_tid and sib.id <> new.plant_equipment_id
        and not exists (
          select 1 from public.equipment_settings s2
          where s2.plant_equipment_id = sib.id and s2.template_id = new.template_id
        );
  end if;
  perform set_config('app.replicating','off',true);
  return new;
end $$;