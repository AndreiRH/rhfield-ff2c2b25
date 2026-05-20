DO $$
DECLARE
  ct RECORD;
  root_id uuid;
  comp_id uuid;
BEGIN
  FOR ct IN
    SELECT id, equipment_group_id FROM component_types
    WHERE created_at = '2026-05-20 12:40:18.578046+00'
  LOOP
    SELECT id INTO root_id FROM checklist_items
    WHERE component_type_id = ct.id AND deleted_at IS NOT NULL
    ORDER BY deleted_at DESC LIMIT 1;

    SELECT id INTO comp_id FROM components
    WHERE equipment_id = ct.equipment_group_id AND deleted_at IS NULL
    ORDER BY created_at LIMIT 1;

    IF root_id IS NULL OR comp_id IS NULL THEN
      CONTINUE;
    END IF;

    -- Re-link direct children to the root (they had parent_item_id nulled)
    UPDATE checklist_items
    SET parent_item_id = root_id
    WHERE component_type_id = ct.id
      AND parent_item_id IS NULL
      AND id <> root_id;

    -- Move the whole subtree back under the component
    UPDATE checklist_items
    SET component_id = comp_id, component_type_id = NULL
    WHERE component_type_id = ct.id;

    -- Restore the root item
    UPDATE checklist_items
    SET deleted_at = NULL
    WHERE id = root_id;
  END LOOP;

  DELETE FROM component_types
  WHERE created_at = '2026-05-20 12:40:18.578046+00';
END $$;