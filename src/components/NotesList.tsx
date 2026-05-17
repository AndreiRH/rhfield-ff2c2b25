import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Trash2, Camera, Paperclip, GripVertical, X, ChevronDown, ChevronRight, Globe, Lock } from "lucide-react";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";
import { StoragePhoto, openStorageFile } from "@/components/StoragePhoto";
import { rememberLocalFile } from "@/lib/local-blobs";
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

interface Note {
  id: string;
  equipment_id: string;
  title: string;
  body: string;
  sort_order: number;
  photo_path: string | null;
  file_path: string | null;
  file_name: string | null;
  is_shared: boolean;
}

export function NotesList({ equipmentId, canEdit, userId }: { equipmentId: string; canEdit: boolean; userId?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    // Resolve template_id for this equipment to find sibling equipment across lines
    const { data: pe } = await supabase
      .from("plant_equipment").select("template_id").eq("id", equipmentId).single();
    let siblingIds: string[] = [];
    if (pe?.template_id) {
      const { data: sibs } = await supabase
        .from("plant_equipment").select("id")
        .eq("template_id", pe.template_id).neq("id", equipmentId);
      siblingIds = (sibs ?? []).map((s: any) => s.id);
    }
    const orFilter = siblingIds.length > 0
      ? `equipment_id.eq.${equipmentId},and(is_shared.eq.true,equipment_id.in.(${siblingIds.join(",")}))`
      : `equipment_id.eq.${equipmentId}`;
    const { data } = await supabase
      .from("equipment_notes").select("*")
      .or(orFilter)
      .order("sort_order").order("created_at");
    setNotes((data ?? []) as Note[]);
  };
  useEffect(() => { load(); }, [equipmentId]);

  const addNote = async () => {
    const { error } = await supabase.from("equipment_notes").insert({
      equipment_id: equipmentId, title: "Note", body: "",
      sort_order: notes.length, created_by: userId,
    });
    if (error) toast.error(error.message); else load();
  };

  const update = (id: string, patch: Partial<Note>) => {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    supabase.from("equipment_notes").update(patch).eq("id", id).then();
  };

  const remove = async (n: Note) => {
    if (n.photo_path) await supabase.storage.from("photos").remove([n.photo_path]);
    if (n.file_path) await supabase.storage.from("files").remove([n.file_path]);
    await supabase.from("equipment_notes").delete().eq("id", n.id);
    load();
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
                    <NoteRow key={n.id} note={n} canEdit={canEdit}
                      onUpdate={(p: Partial<Note>) => update(n.id, p)} onDelete={() => remove(n)} onReload={load} />
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

function NoteRow({ note, canEdit, onUpdate, onDelete, onReload }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: note.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  useEffect(() => { setTitle(note.title); setBody(note.body); }, [note.title, note.body]);

  const hasPhoto = !!note.photo_path;
  const hasFile = !!note.file_name;

  const maybeAutoDelete = () => {
    const titleEmpty = !title.trim() || title.trim() === "Note";
    if (!body.trim() && titleEmpty && !hasPhoto && !hasFile) {
      onDelete();
    }
  };

  const uploadPhoto = async (file: File) => {
    const path = `equipment-notes/${note.equipment_id}/${note.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("photos", path, file);
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    if (note.photo_path) await supabase.storage.from("photos").remove([note.photo_path]);
    await supabase.from("equipment_notes").update({ photo_path: path }).eq("id", note.id);
    onReload();
  };
  const uploadFile = async (file: File) => {
    const path = `equipment-notes/${note.equipment_id}/${note.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("files", path, file);
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(error.message); return; }
    if (note.file_path) await supabase.storage.from("files").remove([note.file_path]);
    await supabase.from("equipment_notes").update({ file_path: path, file_name: file.name }).eq("id", note.id);
    onReload();
  };
  const removePhoto = async () => {
    if (note.photo_path) await supabase.storage.from("photos").remove([note.photo_path]);
    await supabase.from("equipment_notes").update({ photo_path: null }).eq("id", note.id);
    onReload();
  };
  const removeFile = async () => {
    if (note.file_path) await supabase.storage.from("files").remove([note.file_path]);
    await supabase.from("equipment_notes").update({ file_path: null, file_name: null }).eq("id", note.id);
    onReload();
  };

  return (
    <li ref={setNodeRef} style={style} data-nest className="rounded-md border bg-card">
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1">
        {canEdit && (
          <button {...attributes} {...listeners} className="cursor-grab touch-none p-1 active:cursor-grabbing">
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
              maybeAutoDelete();
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
            {hasPhoto && (
              <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                <Camera className="h-3 w-3" /> 1
              </span>
            )}
            {hasFile && (
              <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                <Paperclip className="h-3 w-3" /> 1
              </span>
            )}
          </button>
        )}
        {canEdit && (
          <button
            onClick={() => {
              if (note.is_shared && note.equipment_id && note.equipment_id !== (window as any).__currentEquipmentId) {
                // The note's home is another line; double-check before yanking it from there.
                const ok = window.confirm(
                  "This note is shared from another production line. Making it local will remove it from this line and keep it only on its original line. Continue?",
                );
                if (!ok) return;
              }
              onUpdate({ is_shared: !note.is_shared });
            }}
            title={note.is_shared ? "Shared across all production lines — click to make local" : "Local to this production line — click to share across all production lines"}
            className={`p-1 ${note.is_shared ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
          >
            {note.is_shared ? <Globe className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
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
              maybeAutoDelete();
            }}
            placeholder="Write something…"
            className="min-h-[60px] resize-y text-sm"
          />
          {note.photo_path && <NotePhoto path={note.photo_path} canEdit={canEdit} onRemove={removePhoto} />}
          {note.file_name && <NoteFile path={note.file_path} name={note.file_name} canEdit={canEdit} onRemove={removeFile} />}
          {canEdit && (
            <div className="flex gap-2">
              <PhotoPicker onPick={uploadPhoto}>
                <button className="inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent">
                  <Camera className="h-3 w-3" /> Photo
                </button>
              </PhotoPicker>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent">
                <Paperclip className="h-3 w-3" /> File
                <input type="file" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              </label>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function NotePhoto({ path, canEdit, onRemove }: { path: string; canEdit: boolean; onRemove: () => void }) {
  return (
    <StoragePhoto
      bucket="photos"
      path={path}
      imgClassName="max-h-40 w-full rounded border object-cover"
      canEdit={canEdit}
      onRemove={onRemove}
    />
  );
}

function NoteFile({ path, name, canEdit, onRemove }: { path: string | null; name: string; canEdit: boolean; onRemove: () => void }) {
  return (
    <div className="flex items-center gap-1 rounded border bg-muted/30 px-2 py-1 text-xs">
      <button onClick={() => openStorageFile("files", path, name)} className="flex flex-1 items-center gap-1 text-left hover:underline">
        <Paperclip className="h-3 w-3" /> <span className="truncate">{name}</span>
      </button>
      {canEdit && (
        <button onClick={onRemove} className="text-destructive hover:opacity-80">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
