DO $$
DECLARE
  ri RECORD;
  new_ct_id uuid;
BEGIN
  FOR ri IN
    SELECT ci.id AS item_id, ci.label, ci.sort_order, c.equipment_id AS group_id
    FROM checklist_items ci
    JOIN components c ON c.id = ci.component_id
    JOIN equipment_groups eg ON eg.id = c.equipment_id
    WHERE eg.chapter = 'assembly'
      AND eg.deleted_at IS NULL
      AND ci.deleted_at IS NULL
      AND ci.parent_item_id IS NULL
    ORDER BY ci.sort_order
  LOOP
    new_ct_id := gen_random_uuid();
    INSERT INTO component_types (id, equipment_group_id, name, sort_order)
    VALUES (new_ct_id, ri.group_id, ri.label, ri.sort_order);

    WITH RECURSIVE subtree AS (
      SELECT id FROM checklist_items WHERE id = ri.item_id
      UNION ALL
      SELECT ci2.id FROM checklist_items ci2 JOIN subtree s ON ci2.parent_item_id = s.id
    )
    UPDATE checklist_items
    SET component_type_id = new_ct_id,
        component_id = NULL
    WHERE id IN (SELECT id FROM subtree);

    UPDATE checklist_items SET parent_item_id = NULL WHERE parent_item_id = ri.item_id;
    UPDATE checklist_items SET deleted_at = now() WHERE id = ri.item_id;
  END LOOP;
END $$;