
ALTER TABLE public.checklist_items ADD COLUMN IF NOT EXISTS note_shared boolean NOT NULL DEFAULT false;
ALTER TABLE public.components       ADD COLUMN IF NOT EXISTS note_shared boolean NOT NULL DEFAULT false;

-- Replace propagate_ci_update to also sync note + note_shared when sharing is on
CREATE OR REPLACE FUNCTION public.propagate_ci_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare share_active boolean;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  share_active := coalesce(new.note_shared, false) or coalesce(old.note_shared, false);
  if new.label = old.label
     and new.sort_order = old.sort_order
     and new.deleted_at is not distinct from old.deleted_at
     and not share_active then
    return new;
  end if;
  perform set_config('app.replicating', 'on', true);
  if share_active then
    update public.checklist_items
      set label = new.label,
          sort_order = new.sort_order,
          deleted_at = new.deleted_at,
          note = new.note,
          note_shared = new.note_shared
     where template_id = new.template_id and id <> new.id;
  else
    update public.checklist_items
      set label = new.label, sort_order = new.sort_order, deleted_at = new.deleted_at
     where template_id = new.template_id and id <> new.id;
  end if;
  perform set_config('app.replicating', 'off', true);
  return new;
end $function$;

-- Replace propagate_comp_update with same behavior
CREATE OR REPLACE FUNCTION public.propagate_comp_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare share_active boolean;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  share_active := coalesce(new.note_shared, false) or coalesce(old.note_shared, false);
  if new.name = old.name
     and new.sort_order = old.sort_order
     and new.deleted_at is not distinct from old.deleted_at
     and not share_active then
    return new;
  end if;
  perform set_config('app.replicating', 'on', true);
  if share_active then
    update public.components
      set name = new.name,
          sort_order = new.sort_order,
          deleted_at = new.deleted_at,
          note = new.note,
          note_shared = new.note_shared
     where template_id = new.template_id and id <> new.id;
  else
    update public.components
      set name = new.name, sort_order = new.sort_order, deleted_at = new.deleted_at
     where template_id = new.template_id and id <> new.id;
  end if;
  perform set_config('app.replicating', 'off', true);
  return new;
end $function$;
