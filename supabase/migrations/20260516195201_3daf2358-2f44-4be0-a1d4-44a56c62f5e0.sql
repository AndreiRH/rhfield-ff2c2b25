DO $$
DECLARE
  old_wiring_eg uuid := '0f4023fb-d612-411e-91b1-87e36976ad62'; -- Line 1 SB MCC wiring (orphan)
  old_cold_eg   uuid := 'c4124fb2-663a-4ca9-9d65-460d24fafb14'; -- Line 1 SB MCC cold_comm (orphan)
  new_wiring_eg uuid := 'c42e6df5-5959-4009-be22-33c1c94faa97'; -- Line 1 Switchboards wiring (target)
  new_cold_eg   uuid := 'c4fe852b-903a-40b8-b15d-ff645b46a7e8'; -- Line 1 Switchboards cold_comm (target)
  wiring_eg_tid uuid := 'e68c846d-b6cb-44c7-9c62-cfa38ef9f220'; -- shared template across all 10 lines
  cold_eg_tid   uuid := '03ca5adc-e470-4ee9-b068-0aa364f7d582';
BEGIN
  -- Disable replication-trigger logic so we control inserts/updates explicitly.
  PERFORM set_config('app.replicating', 'on', true);

  -- 1) Reparent the 3 wiring + 3 cold_comm component_types from the orphan
  --    Switchboard MCC groups onto the correct shared Switchboards groups on Line 1.
  --    Keep their template_id so we can match them across siblings below.
  UPDATE public.component_types
     SET equipment_group_id = new_wiring_eg
   WHERE equipment_group_id = old_wiring_eg;

  UPDATE public.component_types
     SET equipment_group_id = new_cold_eg
   WHERE equipment_group_id = old_cold_eg;

  -- 2) For each reparented component_type now on Line 1's shared Switchboards group,
  --    insert a matching row into every sibling Switchboards group on Lines 2-10
  --    (siblings = equipment_groups with the same template_id, excluding Line 1's).
  INSERT INTO public.component_types
        (equipment_group_id, name, sort_order, template_id, deleted_at)
  SELECT sib.id, ct.name, ct.sort_order, ct.template_id, ct.deleted_at
    FROM public.component_types ct
    JOIN public.equipment_groups sib
      ON sib.template_id = wiring_eg_tid
     AND sib.id <> new_wiring_eg
   WHERE ct.equipment_group_id = new_wiring_eg
     AND NOT EXISTS (
       SELECT 1 FROM public.component_types existing
        WHERE existing.equipment_group_id = sib.id
          AND existing.template_id = ct.template_id
     );

  INSERT INTO public.component_types
        (equipment_group_id, name, sort_order, template_id, deleted_at)
  SELECT sib.id, ct.name, ct.sort_order, ct.template_id, ct.deleted_at
    FROM public.component_types ct
    JOIN public.equipment_groups sib
      ON sib.template_id = cold_eg_tid
     AND sib.id <> new_cold_eg
   WHERE ct.equipment_group_id = new_cold_eg
     AND NOT EXISTS (
       SELECT 1 FROM public.component_types existing
        WHERE existing.equipment_group_id = sib.id
          AND existing.template_id = ct.template_id
     );

  -- 3) Soft-delete the two now-empty orphan Switchboard MCC equipment groups on Line 1.
  UPDATE public.equipment_groups
     SET deleted_at = now()
   WHERE id IN (old_wiring_eg, old_cold_eg)
     AND deleted_at IS NULL;

  PERFORM set_config('app.replicating', 'off', true);
END $$;