import { useEffect, useState } from "react";
import { toUserMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus,
  Trash2,
  Camera,
  Paperclip,
  GripVertical,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { NoteAttachments } from "@/components/NoteAttachments";
import { undoableDelete } from "@/lib/undoableDelete";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface CalendarNote {
  id: string;
  project_id: string;
  line_id: string | null;
  scope: string;
  title: string;
  body: string;
  sort_order: number;
}
interface NoteRowProps {
  note: CalendarNote;
  canEdit: boolean;
  userId?: string;
  onUpdate: (patch: Partial<CalendarNote>) => void;
  onDelete: () => void;
}

export function CalendarNotesList({
  projectId,
  lineId,
  scope,
  canEdit,
  userId,
}: {
  projectId: string;
  lineId?: string | null;
  scope: "global" | "line";
  canEdit: boolean;
  userId?: string;
}) {
  const [notes, setNotes] = useState<CalendarNote[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    let query = supabase
      .from("calendar_notes")
      .select("*")
      .eq("project_id", projectId)
      .eq("scope", scope)
      .order("sort_order")
      .order("created_at");
    query = scope === "line" && lineId ? query.eq("line_id", lineId) : query.is("line_id", null);
    const { data } = await query;
    setNotes((data ?? []) as CalendarNote[]);
  };
  useEffect(() => {
    load();
  }, [projectId, lineId, scope]);

  const addNote = async () => {
    const { error } = await supabase.from("calendar_notes").insert({
      project_id: projectId,
      line_id: scope === "line" ? lineId : null,
      scope,
      title: "Note",
      body: "",
      sort_order: notes.length,
      created_by: userId,
    });
    if (error) toast.error(toUserMessage(error));
    else load();
  };

  const update = (id: string, patch: Partial<CalendarNote>) => {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    supabase.from("calendar_notes").update(patch).eq("id", id).then();
  };

  const remove = async (n: CalendarNote) => {
    undoableDelete({
      label: "Note deleted",
      optimistic: () => setNotes((s) => s.filter((x) => x.id !== n.id)),
      restore: load,
      commit: async () => {
        const [{ data: photos }, { data: files }] = await Promise.all([
          supabase.from("note_photos" as any).select("storage_path")
            .eq("parent_kind", "calendar_note").eq("parent_id", n.id),
          supabase.from("note_files" as any).select("storage_path")
            .eq("parent_kind", "calendar_note").eq("parent_id", n.id),
        ]);
        const photoPaths = ((photos ?? []) as any[]).map((p) => p.storage_path).filter(Boolean);
        const filePaths = ((files ?? []) as any[]).map((f) => f.storage_path).filter(Boolean);
        if (photoPaths.length) await supabase.storage.from("photos").remove(photoPaths);
        if (filePaths.length) await supabase.storage.from("files").remove(filePaths);
        await supabase.from("note_photos" as any).delete()
          .eq("parent_kind", "calendar_note").eq("parent_id", n.id);
        await supabase.from("note_files" as any).delete()
          .eq("parent_kind", "calendar_note").eq("parent_id", n.id);
        await supabase.from("calendar_notes").delete().eq("id", n.id);
      },
      afterCommit: load,
    });
  };


  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = notes.findIndex((n) => n.id === active.id);
    const newIdx = notes.findIndex((n) => n.id === over.id);
    const next = arrayMove(notes, oldIdx, newIdx);
    setNotes(next);
    await Promise.all(
      next.map((n, i) => supabase.from("calendar_notes").update({ sort_order: i }).eq("id", n.id)),
    );
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 text-sm font-medium hover:text-foreground"
          >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Notes
            <span className="font-mono text-xs text-muted-foreground">({notes.length})</span>
          </button>
          {open && canEdit && (
            <Button size="sm" onClick={addNote}>
              <Plus className="mr-1 h-4 w-4" /> Add note
            </Button>
          )}
        </div>
        {open &&
          (notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext
                items={notes.map((n) => n.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <NoteRow
                      key={n.id}
                      note={n}
                      canEdit={canEdit}
                      userId={userId}
                      onUpdate={(p: Partial<CalendarNote>) => update(n.id, p)}
                      onDelete={() => remove(n)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          ))}
      </CardContent>
    </Card>
  );
}

function NoteRow({ note, canEdit, userId, onUpdate, onDelete }: NoteRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: note.id,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [counts, setCounts] = useState<{ photos: number; files: number }>({ photos: 0, files: 0 });
  useEffect(() => {
    setTitle(note.title);
    setBody(note.body);
  }, [note.title, note.body]);

  const basePath = `calendar-notes/${note.project_id}/${note.scope}/${note.line_id ?? "global"}/${note.id}`;

  return (
    <li ref={setNodeRef} style={style} data-nest className="rounded-md border bg-card">
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1">
        {canEdit && (
          <button
            {...attributes}
            {...listeners}
            className="cursor-grab touch-none p-1 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="p-1 text-muted-foreground hover:text-foreground"
          title={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {open ? (
          <Input
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (title !== note.title) onUpdate({ title });
            }}
            className="h-7 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
          />
        ) : (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="flex flex-1 items-center gap-2 truncate px-1 text-left text-sm font-medium"
          >
            <span className="truncate">{note.title || "Untitled"}</span>
            {counts.photos > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                <Camera className="h-3 w-3" /> {counts.photos}
              </span>
            )}
            {counts.files > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                <Paperclip className="h-3 w-3" /> {counts.files}
              </span>
            )}
          </button>
        )}
        {canEdit && (
          <button onClick={onDelete} className="p-1 text-destructive hover:opacity-80">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2 p-3">
          <Textarea
            value={body}
            disabled={!canEdit}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => {
              if (body !== note.body) onUpdate({ body });
            }}
            placeholder="Write something…"
            className="min-h-[60px] resize-y text-sm"
          />
          <NoteAttachments
            parentKind="calendar_note"
            parentId={note.id}
            storagePrefix={basePath}
            canEdit={canEdit}
            userId={userId}
            showSharedToggle={false}
            onCountsChange={setCounts}
          />
        </div>
      )}
    </li>
  );
}
