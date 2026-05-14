-- Restore SHS plants that were soft-deleted in bulk
UPDATE public.plant_equipment
SET deleted_at = NULL
WHERE kind = 'shs' AND name = 'Main' AND deleted_at = '2026-05-14 13:28:25.513+00';

-- Provisional Acceptance notes (per line + plant kind)
CREATE TYPE public.plant_kind AS ENUM ('kiln','shs');

CREATE TABLE public.pa_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id uuid NOT NULL,
  kind public.plant_kind NOT NULL,
  title text NOT NULL DEFAULT 'Note',
  body text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  photo_path text,
  file_path text,
  file_name text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX pa_notes_line_kind_idx ON public.pa_notes(line_id, kind);

ALTER TABLE public.pa_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pa read" ON public.pa_notes FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role,'pm'::app_role]));
CREATE POLICY "pa write" ON public.pa_notes FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'engineer'::app_role]));

CREATE TRIGGER pa_notes_touch BEFORE UPDATE ON public.pa_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();