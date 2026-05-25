
-- Suppress replication triggers during the fix
SET LOCAL session_replication_role = replica;

-- 1. Build a working set of duplicate equipment_groups, classifying each as
--    canonical (template_id shared across multiple lines for the same plant_equipment template)
--    or orphan (template_id appears on only one line).
WITH pe_tpl AS (
  SELECT id pe_id, template_id pe_tpl, line_id FROM plant_equipment WHERE deleted_at IS NULL
),
eg_all AS (
  SELECT eg.id eg_id, eg.template_id eg_tpl, eg.chapter, eg.plant_equipment_id,
         p.pe_tpl, p.line_id
  FROM equipment_groups eg JOIN pe_tpl p ON p.pe_id = eg.plant_equipment_id
  WHERE eg.deleted_at IS NULL
),
eg_share AS (
  SELECT pe_tpl, chapter, eg_tpl, COUNT(DISTINCT line_id) lines_with_tpl
  FROM eg_all GROUP BY pe_tpl, chapter, eg_tpl
),
dups AS (
  SELECT line_id, plant_equipment_id, chapter
  FROM eg_all GROUP BY line_id, plant_equipment_id, chapter HAVING COUNT(*) > 1
),
classified AS (
  SELECT e.eg_id, e.eg_tpl, e.chapter, e.plant_equipment_id, e.pe_tpl, e.line_id,
         s.lines_with_tpl,
         (SELECT COUNT(*) FROM component_types ct
            WHERE ct.equipment_group_id = e.eg_id AND ct.deleted_at IS NULL) ct_cnt,
         (SELECT COUNT(*) FROM components c
            WHERE c.equipment_id = e.eg_id AND c.deleted_at IS NULL) comp_cnt
  FROM eg_all e
  JOIN dups d ON d.line_id=e.line_id AND d.plant_equipment_id=e.plant_equipment_id AND d.chapter=e.chapter
  JOIN eg_share s ON s.pe_tpl=e.pe_tpl AND s.chapter=e.chapter AND s.eg_tpl=e.eg_tpl
),
-- An orphan that holds data gets "promoted": we soft-delete its empty canonical
-- sibling and re-point the orphan to use the canonical's template_id.
swap AS (
  SELECT o.eg_id AS orphan_eg, o.pe_tpl, o.chapter,
         (SELECT c.eg_id  FROM classified c
            WHERE c.plant_equipment_id=o.plant_equipment_id AND c.chapter=o.chapter
              AND c.lines_with_tpl > 1) AS canonical_eg,
         (SELECT c.eg_tpl FROM classified c
            WHERE c.plant_equipment_id=o.plant_equipment_id AND c.chapter=o.chapter
              AND c.lines_with_tpl > 1) AS canonical_tpl
  FROM classified o
  WHERE o.lines_with_tpl = 1 AND (o.ct_cnt > 0 OR o.comp_cnt > 0)
)
SELECT NULL INTO TEMP TABLE _noop;  -- ensure CTE block evaluates

-- Persist the working sets as temp tables for the rest of the script.
CREATE TEMP TABLE _swap AS
WITH pe_tpl AS (
  SELECT id pe_id, template_id pe_tpl FROM plant_equipment WHERE deleted_at IS NULL
),
eg_all AS (
  SELECT eg.id eg_id, eg.template_id eg_tpl, eg.chapter, eg.plant_equipment_id,
         p.pe_tpl
  FROM equipment_groups eg JOIN pe_tpl p ON p.pe_id = eg.plant_equipment_id
  WHERE eg.deleted_at IS NULL
),
eg_share AS (
  SELECT pe_tpl, chapter, eg_tpl, COUNT(DISTINCT eg_id) cnt
  FROM eg_all GROUP BY pe_tpl, chapter, eg_tpl
),
classified AS (
  SELECT e.eg_id, e.eg_tpl, e.chapter, e.plant_equipment_id, e.pe_tpl,
         (SELECT COUNT(DISTINCT pe.line_id)
            FROM eg_all e2 JOIN plant_equipment pe ON pe.id=e2.plant_equipment_id
            WHERE e2.pe_tpl=e.pe_tpl AND e2.chapter=e.chapter AND e2.eg_tpl=e.eg_tpl) lines_with_tpl,
         (SELECT COUNT(*) FROM component_types ct
            WHERE ct.equipment_group_id=e.eg_id AND ct.deleted_at IS NULL) ct_cnt,
         (SELECT COUNT(*) FROM components c
            WHERE c.equipment_id=e.eg_id AND c.deleted_at IS NULL) comp_cnt
  FROM eg_all e
)
SELECT o.eg_id AS orphan_eg, o.eg_tpl AS orphan_tpl, o.chapter, o.plant_equipment_id,
       c.eg_id AS canonical_eg, c.eg_tpl AS canonical_tpl
FROM classified o
JOIN classified c
  ON c.plant_equipment_id=o.plant_equipment_id AND c.chapter=o.chapter
 AND c.lines_with_tpl > 1
WHERE o.lines_with_tpl = 1 AND (o.ct_cnt > 0 OR o.comp_cnt > 0);

-- 2. For each orphan-with-data: soft-delete the empty canonical, then re-point
--    the orphan's template_id to the canonical's template_id so that future
--    inserts replicate normally.
UPDATE equipment_groups SET deleted_at = now()
WHERE id IN (SELECT canonical_eg FROM _swap);

UPDATE equipment_groups eg SET template_id = s.canonical_tpl
FROM _swap s WHERE eg.id = s.orphan_eg;

-- 3. Manually replicate each component_type in the (now-canonical) orphan eg
--    to sibling equipment_groups on other lines that share the same template_id.
INSERT INTO component_types (equipment_group_id, name, sort_order, template_id, deleted_at)
SELECT sib.id, ct.name, ct.sort_order, ct.template_id, ct.deleted_at
FROM _swap s
JOIN component_types ct       ON ct.equipment_group_id = s.orphan_eg AND ct.deleted_at IS NULL
JOIN equipment_groups sib     ON sib.template_id = s.canonical_tpl
                              AND sib.id <> s.orphan_eg
                              AND sib.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM component_types t2
  WHERE t2.equipment_group_id = sib.id AND t2.template_id = ct.template_id
);

-- 4. Replicate the root-level checklist_items (parent_item_id IS NULL) into the
--    newly created sibling component_types.
INSERT INTO checklist_items (component_type_id, label, sort_order, template_id, parent_item_id, deleted_at)
SELECT sib_ct.id, ci.label, ci.sort_order, ci.template_id, NULL, ci.deleted_at
FROM _swap s
JOIN component_types ct       ON ct.equipment_group_id = s.orphan_eg AND ct.deleted_at IS NULL
JOIN checklist_items ci       ON ci.component_type_id = ct.id AND ci.deleted_at IS NULL AND ci.parent_item_id IS NULL
JOIN component_types sib_ct   ON sib_ct.template_id = ct.template_id AND sib_ct.id <> ct.id AND sib_ct.deleted_at IS NULL
WHERE NOT EXISTS (
  SELECT 1 FROM checklist_items i2
  WHERE i2.component_type_id = sib_ct.id AND i2.template_id = ci.template_id
);

-- 5. Replicate nested checklist_items (children), resolving parent via template_id.
--    Loop until no more rows are added (handles arbitrary nesting depth).
DO $$
DECLARE inserted_count int;
BEGIN
  LOOP
    INSERT INTO checklist_items (component_type_id, label, sort_order, template_id, parent_item_id, deleted_at)
    SELECT sib_ct.id, ci.label, ci.sort_order, ci.template_id, sib_parent.id, ci.deleted_at
    FROM _swap s
    JOIN component_types ct       ON ct.equipment_group_id = s.orphan_eg AND ct.deleted_at IS NULL
    JOIN checklist_items ci       ON ci.component_type_id = ct.id AND ci.deleted_at IS NULL AND ci.parent_item_id IS NOT NULL
    JOIN checklist_items parent   ON parent.id = ci.parent_item_id
    JOIN component_types sib_ct   ON sib_ct.template_id = ct.template_id AND sib_ct.id <> ct.id AND sib_ct.deleted_at IS NULL
    JOIN checklist_items sib_parent ON sib_parent.component_type_id = sib_ct.id AND sib_parent.template_id = parent.template_id
    WHERE NOT EXISTS (
      SELECT 1 FROM checklist_items i2
      WHERE i2.component_type_id = sib_ct.id AND i2.template_id = ci.template_id
    );
    GET DIAGNOSTICS inserted_count = ROW_COUNT;
    EXIT WHEN inserted_count = 0;
  END LOOP;
END $$;

-- 6. Soft-delete all remaining orphan equipment_groups (those that were empty
--    duplicates) across every line. After step 2 above, the surviving orphan
--    egs are already re-pointed and excluded from this set via NOT IN _swap.
WITH pe_tpl AS (
  SELECT id pe_id, template_id pe_tpl FROM plant_equipment WHERE deleted_at IS NULL
),
eg_all AS (
  SELECT eg.id eg_id, eg.template_id eg_tpl, eg.chapter, eg.plant_equipment_id, p.pe_tpl
  FROM equipment_groups eg JOIN pe_tpl p ON p.pe_id = eg.plant_equipment_id
  WHERE eg.deleted_at IS NULL
),
share_cnt AS (
  SELECT e.eg_id,
         (SELECT COUNT(DISTINCT pe.line_id)
            FROM eg_all e2 JOIN plant_equipment pe ON pe.id=e2.plant_equipment_id
            WHERE e2.pe_tpl=e.pe_tpl AND e2.chapter=e.chapter AND e2.eg_tpl=e.eg_tpl) lines_with_tpl
  FROM eg_all e
),
dup_pairs AS (
  SELECT eg_id FROM eg_all
  WHERE (plant_equipment_id, chapter) IN (
    SELECT plant_equipment_id, chapter FROM eg_all
    GROUP BY plant_equipment_id, chapter HAVING COUNT(*) > 1
  )
)
UPDATE equipment_groups SET deleted_at = now()
WHERE id IN (
  SELECT dp.eg_id FROM dup_pairs dp
  JOIN share_cnt sc ON sc.eg_id = dp.eg_id
  WHERE sc.lines_with_tpl = 1
)
AND id NOT IN (SELECT orphan_eg FROM _swap);

DROP TABLE _swap;
DROP TABLE _noop;
