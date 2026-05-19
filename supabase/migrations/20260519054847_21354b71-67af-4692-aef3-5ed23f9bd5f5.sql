CREATE TABLE public.calendar_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  line_id uuid REFERENCES public.lines(id) ON DELETE CASCADE,
  scope text NOT NULL,
  title text NOT NULL DEFAULT 'Note',
  body text NOT NULL DEFAULT '',
  sort_order integer NOT NULL DEFAULT 0,
  photo_path text,
  file_path text,
  file_name text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_notes_scope_check CHECK (scope IN ('global', 'line')),
  CONSTRAINT calendar_notes_scope_line_check CHECK (
    (scope = 'global' AND line_id IS NULL)
    OR (scope = 'line' AND line_id IS NOT NULL)
  )
);

ALTER TABLE public.calendar_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "calendar notes read" ON public.calendar_notes
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role, 'pm'::app_role]));

CREATE POLICY "calendar notes write" ON public.calendar_notes
FOR ALL TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]))
WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'engineer'::app_role]));

CREATE INDEX calendar_notes_project_scope_idx ON public.calendar_notes(project_id, scope, sort_order, created_at);
CREATE INDEX calendar_notes_line_idx ON public.calendar_notes(line_id, sort_order, created_at) WHERE line_id IS NOT NULL;

CREATE TRIGGER calendar_notes_touch
BEFORE UPDATE ON public.calendar_notes
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();