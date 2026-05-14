
-- Add is_shared toggle to per-line note tables
ALTER TABLE public.equipment_notes ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;
ALTER TABLE public.pa_notes ADD COLUMN IF NOT EXISTS is_shared boolean NOT NULL DEFAULT false;

-- Add template_id to pa_folders so "same folder across lines" survives renames
ALTER TABLE public.pa_folders ADD COLUMN IF NOT EXISTS template_id uuid;
UPDATE public.pa_folders SET template_id = gen_random_uuid() WHERE template_id IS NULL;

-- Auto-assign template_id on insert
CREATE OR REPLACE FUNCTION public.set_template_id_paf()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
begin
  if new.template_id is null then new.template_id := gen_random_uuid(); end if;
  return new;
end $$;

DROP TRIGGER IF EXISTS trg_set_template_id_paf ON public.pa_folders;
CREATE TRIGGER trg_set_template_id_paf
BEFORE INSERT ON public.pa_folders
FOR EACH ROW EXECUTE FUNCTION public.set_template_id_paf();

-- Replicate folder creation across sibling lines so shared notes have a home
CREATE OR REPLACE FUNCTION public.replicate_pa_folder()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare proj uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating', 'on', true);
  select project_id into proj from public.lines where id = new.line_id;
  insert into public.pa_folders (line_id, kind, name, sort_order, template_id, created_by)
    select l.id, new.kind, new.name, new.sort_order, new.template_id, new.created_by
    from public.lines l
    where l.project_id = proj and l.id <> new.line_id
      and not exists (select 1 from public.pa_folders f2 where f2.line_id = l.id and f2.template_id = new.template_id);
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;

DROP TRIGGER IF EXISTS trg_replicate_pa_folder ON public.pa_folders;
CREATE TRIGGER trg_replicate_pa_folder
AFTER INSERT ON public.pa_folders
FOR EACH ROW EXECUTE FUNCTION public.replicate_pa_folder();

-- Propagate folder rename / sort / soft delete across siblings
CREATE OR REPLACE FUNCTION public.propagate_pa_folder_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  if new.name = old.name and new.sort_order = old.sort_order then return new; end if;
  perform set_config('app.replicating', 'on', true);
  update public.pa_folders set name = new.name, sort_order = new.sort_order
    where template_id = new.template_id and id <> new.id;
  perform set_config('app.replicating', 'off', true);
  return new;
end $$;

DROP TRIGGER IF EXISTS trg_propagate_pa_folder_update ON public.pa_folders;
CREATE TRIGGER trg_propagate_pa_folder_update
AFTER UPDATE ON public.pa_folders
FOR EACH ROW EXECUTE FUNCTION public.propagate_pa_folder_update();
