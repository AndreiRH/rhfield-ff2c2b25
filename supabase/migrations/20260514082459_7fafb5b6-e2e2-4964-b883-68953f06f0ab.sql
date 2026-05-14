grant execute on function public.has_role(uuid, public.app_role) to authenticated;
grant execute on function public.has_any_role(uuid, public.app_role[]) to authenticated;

do $$
declare
  v_project_id uuid;
  v_line_id uuid;
  v_eg_id uuid;
  v_comp_id uuid;
  v_line_num int;
  v_chapter text;
  v_kind text;
  v_chapters text[] := array['assembly','wiring','cold_comm','hot_comm'];
  v_kinds text[] := array['kiln','shs'];
begin
  select id into v_project_id from public.projects where name = 'BlueW1' limit 1;
  if v_project_id is null then
    insert into public.projects (name) values ('BlueW1') returning id into v_project_id;
  end if;

  for v_line_num in 1..10 loop
    select id into v_line_id from public.lines
      where project_id = v_project_id and number = v_line_num limit 1;
    if v_line_id is null then
      insert into public.lines (project_id, number, name)
      values (v_project_id, v_line_num, 'Line ' || v_line_num)
      returning id into v_line_id;
    end if;

    foreach v_chapter in array v_chapters loop
      foreach v_kind in array v_kinds loop
        select id into v_eg_id from public.equipment_groups
          where line_id = v_line_id
            and chapter = v_chapter::public.chapter_kind
            and kind = v_kind::public.equipment_kind
          limit 1;
        if v_eg_id is null then
          insert into public.equipment_groups (line_id, chapter, kind, name)
          values (
            v_line_id,
            v_chapter::public.chapter_kind,
            v_kind::public.equipment_kind,
            upper(v_kind) || ' - ' || initcap(replace(v_chapter,'_',' '))
          )
          returning id into v_eg_id;

          insert into public.components (equipment_id, name, sort_order)
          values (v_eg_id, 'General', 0)
          returning id into v_comp_id;

          insert into public.checklist_items (component_id, label, sort_order) values
            (v_comp_id, 'Inspect',  0),
            (v_comp_id, 'Verify',   1),
            (v_comp_id, 'Sign off', 2);
        end if;
      end loop;
    end loop;
  end loop;
end $$;