import { useEffect, useState } from "react";
import { toUserMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, GripVertical, ChevronDown, ChevronRight, Share2, Lock } from "lucide-react";
import { toast } from "sonner";
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
import { confirmSharedDelete } from "@/lib/confirm-shared-delete";
import { confirmUnshareFromEquipment } from "@/lib/confirm-unshare";
import { NoteAttachments } from "@/components/NoteAttachments";
import { undoableDelete } from "@/lib/undoableDelete";

interface Note {
  id: string;
  equipment_id: string;
  title: string;
  body: string;
  sort_order: number;
  is_shared: boolean;
}

export function NotesList({ equipmentId, canEdit, userId, section = "assembly" }: { equipmentId: string; canEdit: boolean; userId?: string; section?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    const { data: pe } = await supabase
      .from("plant_equipment").select("template_id").eq("id", equipmentId).single();
    let siblingIds: string[] = [];
    if (pe?.template_id) {
      const { data: sibs } = await supabase
        .from("plant_equipment").select("id")
        .eq("template_id", pe.template_id).neq("id", equipmentId).is("deleted_at", null);
      siblingIds = (sibs ?? []).map((s: any) => s.id);
    }
    const orFilter = siblingIds.length > 0
      ? `equipment_id.eq.${equipmentId},and(is_shared.eq.true,equipment_id.in.(${siblingIds.join(",")}))`
      : `equipment_id.eq.${equipmentId}`;
    const { data } = await supabase
      .from("equipment_notes").select("id,equipment_id,title,body,sort_order,is_shared")
      .eq("section", section)
      .or(orFilter)
      .order("sort_order").order("created_at");
    setNotes((data ?? []) as Note[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [equipmentId, section]);

  const addNote = async () => {
    const { error } = await supabase.from("equipment_notes").insert({
      equipment_id: equipmentId, title: "Note", body: "",
      sort_order: notes.length, created_by: userId, section,
    } as any);
    if (error) toast.error(toUserMessage(error)); else load();
  };

  const update = (id: string, patch: Partial<Note>) => {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    supabase.from("equipment_notes").update(patch).eq("id", id).then();
  };

  const remove = async (n: Note) => {
    if (!confirmSharedDelete(!!n.is_shared)) return;
    undoableDelete({
      label: "Note deleted",
      optimistic: () => setNotes((s) => s.filter((x) => x.id !== n.id)),
      restore: load,
      commit: async () => {
        const [{ data: photos }, { data: files }] = await Promise.all([
          supabase.from("note_photos" as any).select("storage_path").eq("parent_kind", "equipment_note").eq("parent_id", n.id),
          supabase.from("note_files" as any).select("storage_path").eq("parent_kind", "equipment_note").eq("parent_id", n.id),
        ]);
        const photoPaths = ((photos ?? []) as any[]).map((p) => p.storage_path).filter(Boolean);
        const filePaths = ((files ?? []) as any[]).map((f) => f.storage_path).filter(Boolean);
        if (photoPaths.length) await supabase.storage.from("photos").remove(photoPaths);
        if (filePaths.length) await supabase.storage.from("files").remove(filePaths);
        await supabase.from("note_photos" as any).delete().eq("parent_kind", "equipment_note").eq("parent_id", n.id);
        await supabase.from("note_files" as any).delete().eq("parent_kind", "equipment_note").eq("parent_id", n.id);
        await supabase.from("equipment_notes").delete().eq("id", n.id);
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
      next.map((n, i) => supabase.from("equipment_notes").update({ sort_order: i }).eq("id", n.id)),
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
                    <NoteRow key={n.id} note={n} canEdit={canEdit} userId={userId} currentEquipmentId={equipmentId}
                      onUpdate={(p: Partial<Note>) => update(n.id, p)} onDelete={() => remove(n)} />
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

function NoteRow({ note, canEdit, userId, currentEquipmentId, onUpdate, onDelete }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: note.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  const [open, setOpen] = useState(false);
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
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="p-1 text-muted-foreground hover:text-foreground" title={open ? "Collapse" : "Expand"}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {open ? (
          <Input
            value={title} disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title !== note.title) onUpdate({ title }); }}
            className="h-7 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
          />
        ) : (
          <button type="button" onClick={() => setOpen(true)}
            className="flex flex-1 items-center gap-2 truncate px-1 text-left text-sm font-medium">
            <span className="truncate">{note.title || "Untitled"}</span>
          </button>
        )}
        {canEdit && (
          <button
            onClick={async () => {
              if (note.is_shared && note.equipment_id && note.equipment_id !== currentEquipmentId) {
                const ok = await confirmUnshareFromEquipment(note.equipment_id, currentEquipmentId);
                if (!ok) return;
              }
              onUpdate({ is_shared: !note.is_shared });
            }}
            title={note.is_shared ? "Shared across all production lines — click to make local" : "Local to this production line — click to share across all production lines"}
            className={`p-1 ${note.is_shared ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {note.is_shared ? <Share2 className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
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
            value={body} disabled={!canEdit}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => { if (body !== note.body) onUpdate({ body }); }}
            placeholder="Write something…"
            className="min-h-[60px] resize-y text-sm"
          />
          <NoteAttachments
            parentKind="equipment_note"
            parentId={note.id}
            storagePrefix={`equipment-notes/${note.equipment_id}/${note.id}`}
            canEdit={canEdit}
            userId={userId}
            defaultShared={!!note.is_shared}
          />
        </div>
      )}
    </li>
  );
}
