WITH assembly_groups AS (
  SELECT id FROM equipment_groups WHERE chapter = 'assembly'
),
assembly_components AS (
  SELECT id FROM components WHERE equipment_id IN (SELECT id FROM assembly_groups)
),
assembly_types AS (
  SELECT id FROM component_types WHERE equipment_group_id IN (SELECT id FROM assembly_groups)
),
assembly_items AS (
  SELECT id FROM checklist_items
  WHERE component_id IN (SELECT id FROM assembly_components)
     OR component_type_id IN (SELECT id FROM assembly_types)
),
del_item_photos AS (
  DELETE FROM item_photos WHERE item_id IN (SELECT id FROM assembly_items) RETURNING 1
),
del_item_files AS (
  DELETE FROM item_files WHERE item_id IN (SELECT id FROM assembly_items) RETURNING 1
),
del_item_notes AS (
  DELETE FROM item_notes WHERE item_id IN (SELECT id FROM assembly_items) RETURNING 1
),
del_items AS (
  DELETE FROM checklist_items
  WHERE component_id IN (SELECT id FROM assembly_components)
     OR component_type_id IN (SELECT id FROM assembly_types)
  RETURNING 1
),
del_comp_photos AS (
  DELETE FROM component_photos WHERE component_id IN (SELECT id FROM assembly_components) RETURNING 1
),
del_comp_files AS (
  DELETE FROM component_files WHERE component_id IN (SELECT id FROM assembly_components) RETURNING 1
),
del_comps AS (
  DELETE FROM components WHERE equipment_id IN (SELECT id FROM assembly_groups) RETURNING 1
),
del_ct_photos AS (
  DELETE FROM component_type_photos WHERE component_type_id IN (SELECT id FROM assembly_types) RETURNING 1
),
del_ct_files AS (
  DELETE FROM component_type_files WHERE component_type_id IN (SELECT id FROM assembly_types) RETURNING 1
),
del_ct_notes AS (
  DELETE FROM component_type_notes WHERE component_type_id IN (SELECT id FROM assembly_types) RETURNING 1
),
del_cts AS (
  DELETE FROM component_types WHERE equipment_group_id IN (SELECT id FROM assembly_groups) RETURNING 1
)
SELECT 1;