-- Deduplicate shared item_notes that were backfilled across all sibling
-- production lines, leaving 10 copies (one per line) of each shared note.
-- For each group of shared notes that belong to checklist_items sharing the
-- same template_id and have identical (title, body), keep the earliest row
-- and delete the rest. No item_note attachments exist yet, so no reparenting
-- is needed.
WITH grouped AS (
  SELECT n.id,
         ci.template_id,
         n.title,
         n.body,
         ROW_NUMBER() OVER (
           PARTITION BY ci.template_id, n.title, n.body
           ORDER BY n.created_at, n.id
         ) AS rn
  FROM public.item_notes n
  JOIN public.checklist_items ci ON ci.id = n.item_id
  WHERE n.is_shared = true
    AND ci.template_id IS NOT NULL
)
DELETE FROM public.item_notes
WHERE id IN (SELECT id FROM grouped WHERE rn > 1);