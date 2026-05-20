import { useEffect, useState } from "react";
import { toUserMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { NoteAttachments, deleteNoteAttachments } from "@/components/NoteAttachments";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { undoableDelete } from "@/lib/undoableDelete";

interface Note {
  id: string;
  line_id: string;
  kind: string;
  title: string;
  body: string;
  sort_order: number;
  photo_path: string | null;
  file_path: string | null;
  file_name: string | null;
}

export function PANotesList({ lineId, kind, canEdit, userId }: { lineId: string; kind: string; canEdit: boolean; userId?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("pa_notes")
      .select("*")
      .eq("line_id", lineId)
      .eq("kind", kind as any)
      .order("sort_order")
      .order("created_at");
    setNotes((data ?? []) as Note[]);
  };
  useEffect(() => { load(); }, [lineId, kind]);

  const addNote = async () => {
    const { error } = await supabase.from("pa_notes").insert({
      line_id: lineId, kind: kind as any, title: "Note", body: "",
      sort_order: notes.length, created_by: userId,
    });
    if (error) toast.error(toUserMessage(error)); else load();
  };

  const update = (id: string, patch: Partial<Note>) => {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    supabase.from("pa_notes").update(patch as any).eq("id", id).then();
  };

  const remove = async (n: Note) => {
    undoableDelete({
      label: "Note deleted",
      optimistic: () => setNotes((s) => s.filter((x) => x.id !== n.id)),
      restore: load,
      commit: async () => {
        await deleteNoteAttachments("pa_note", n.id);
        if (n.photo_path) await supabase.storage.from("photos").remove([n.photo_path]);
        if (n.file_path) await supabase.storage.from("files").remove([n.file_path]);
        await supabase.from("pa_notes").delete().eq("id", n.id);
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
      next.map((n, i) => supabase.from("pa_notes").update({ sort_order: i }).eq("id", n.id)),
    );
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <button onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-2 text-sm font-medium hover:text-foreground">
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
        {open && (
          notes.length === 0 ? (
            <p className="text-sm text-muted-foreground">No notes yet.</p>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={notes.map((n) => n.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <NoteRow key={n.id} note={n} canEdit={canEdit}
                      userId={userId} onUpdate={(p: Partial<Note>) => update(n.id, p)} onDelete={() => remove(n)} />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          )
        )}
      </CardContent>
    </Card>
  );
}

function NoteRow({ note, canEdit, userId, onUpdate, onDelete }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: note.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  useEffect(() => { setTitle(note.title); setBody(note.body); }, [note.title, note.body]);

  return (
    <li ref={setNodeRef} style={style} data-nest className="rounded-md border bg-card">
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1">
        {canEdit && (
          <button {...attributes} {...listeners} className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <Input
          value={title}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== note.title && onUpdate({ title })}
          className="h-7 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
        />
        {canEdit && (
          <button onClick={onDelete} className="p-1 text-destructive hover:opacity-80">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="space-y-2 p-3">
        <Textarea
          value={body}
          disabled={!canEdit}
          onChange={(e) => setBody(e.target.value)}
          onBlur={() => body !== note.body && onUpdate({ body })}
          placeholder="Write something…"
          data-resize-key={`pa-note:${note.id}`}
          className="min-h-[60px] resize-y text-sm"
        />
        <NoteAttachments parentKind="pa_note" parentId={note.id} storagePrefix={`pa-notes/${note.line_id}/${note.kind}/${note.id}`}
          canEdit={canEdit} userId={userId} showSharedToggle={false}
          legacyPhotoPath={note.photo_path} legacyFilePath={note.file_path} legacyFileName={note.file_name}
          onLegacyMigrated={(p) => { supabase.from("pa_notes").update(p as any).eq("id", note.id).then(); onUpdate(p); }} />
      </div>
    </li>
  );
}
