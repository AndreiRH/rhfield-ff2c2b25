CREATE TABLE public.equipment_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'Note',
  body text NOT NULL DEFAULT '',
  position_x integer NOT NULL DEFAULT 0,
  position_y integer NOT NULL DEFAULT 0,
  photo_path text,
  file_path text,
  file_name text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.equipment_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "en read" ON public.equipment_notes FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role, 'pm'::app_role]));

CREATE POLICY "en write" ON public.equipment_notes FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]));

CREATE TRIGGER equipment_notes_updated_at BEFORE UPDATE ON public.equipment_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_equipment_notes_equipment ON public.equipment_notes(equipment_id);