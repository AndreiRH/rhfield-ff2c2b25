CREATE OR REPLACE FUNCTION public.replicate_checklist_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare comp_tid uuid; ct_tid uuid; parent_tid uuid;
begin
  if current_setting('app.replicating', true) = 'on' then return new; end if;
  perform set_config('app.replicating', 'on', true);

  if new.component_id is not null then
    select template_id into comp_tid from public.components where id = new.component_id;
    if comp_tid is not null then
      if new.parent_item_id is null then
        insert into public.checklist_items (component_id, label, sort_order, template_id, parent_item_id, deleted_at)
          select sib_c.id, new.label, new.sort_order, new.template_id, null, new.deleted_at
          from public.components sib_c
          where sib_c.template_id = comp_tid and sib_c.id <> new.component_id
            and not exists (select 1 from public.checklist_items i2 where i2.component_id = sib_c.id and i2.template_id = new.template_id);
      else
        select template_id into parent_tid from public.checklist_items where id = new.parent_item_id;
        if parent_tid is not null then
          insert into public.checklist_items (component_id, label, sort_order, template_id, parent_item_id, deleted_at)
            select sib_c.id, new.label, new.sort_order, new.template_id, sib_parent.id, new.deleted_at
            from public.components sib_c
            join public.checklist_items sib_parent on sib_parent.component_id = sib_c.id and sib_parent.template_id = parent_tid
            where sib_c.template_id = comp_tid and sib_c.id <> new.component_id
              and not exists (select 1 from public.checklist_items i2 where i2.component_id = sib_c.id and i2.template_id = new.template_id);
        end if;
      end if;
    end if;
  elsif new.component_type_id is not null then
    select template_id into ct_tid from public.component_types where id = new.component_type_id;
    if ct_tid is not null then
      if new.parent_item_id is null then
        insert into public.checklist_items (component_type_id, label, sort_order, template_id, parent_item_id, deleted_at)
          select sib_ct.id, new.label, new.sort_order, new.template_id, null, new.deleted_at
          from public.component_types sib_ct
          where sib_ct.template_id = ct_tid and sib_ct.id <> new.component_type_id
            and not exists (
              select 1 from public.checklist_items i2
              where i2.component_type_id = sib_ct.id and i2.template_id = new.template_id
            );
      else
        select template_id into parent_tid from public.checklist_items where id = new.parent_item_id;
        if parent_tid is not null then
          insert into public.checklist_items (component_type_id, label, sort_order, template_id, parent_item_id, deleted_at)
            select sib_ct.id, new.label, new.sort_order, new.template_id, sib_parent.id, new.deleted_at
            from public.component_types sib_ct
            join public.checklist_items sib_parent
              on sib_parent.component_type_id = sib_ct.id and sib_parent.template_id = parent_tid
            where sib_ct.template_id = ct_tid and sib_ct.id <> new.component_type_id
              and not exists (
                select 1 from public.checklist_items i2
                where i2.component_type_id = sib_ct.id and i2.template_id = new.template_id
              );
        end if;
      end if;
    end if;
  end if;

  perform set_config('app.replicating', 'off', true);
  return new;
end $function$;