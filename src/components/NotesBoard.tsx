import { useEffect, useRef, useState } from "react";
import { toUserMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { NoteAttachments, deleteNoteAttachments } from "@/components/NoteAttachments";
import { undoableDelete } from "@/lib/undoableDelete";

interface Note {
  id: string;
  equipment_id: string;
  title: string;
  body: string;
  position_x: number;
  position_y: number;
  photo_path: string | null;
  file_path: string | null;
  file_name: string | null;
}

export function NotesBoard({ equipmentId, canEdit, userId }: { equipmentId: string; canEdit: boolean; userId?: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const boardRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const { data } = await supabase.from("equipment_notes").select("*").eq("equipment_id", equipmentId).order("created_at");
    setNotes((data ?? []) as Note[]);
  };
  useEffect(() => { load(); }, [equipmentId]);

  const addNote = async () => {
    const offset = notes.length * 20;
    const { error } = await supabase.from("equipment_notes").insert({
      equipment_id: equipmentId, title: "Note", body: "",
      position_x: 16 + offset, position_y: 16 + offset, created_by: userId,
    });
    if (error) toast.error(toUserMessage(error)); else load();
  };

  const update = async (id: string, patch: Partial<Note>) => {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    await supabase.from("equipment_notes").update(patch).eq("id", id);
  };

  const remove = async (n: Note) => {
    undoableDelete({
      label: "Note deleted",
      optimistic: () => setNotes((s) => s.filter((x) => x.id !== n.id)),
      restore: load,
      commit: async () => {
        await deleteNoteAttachments("equipment_note", n.id);
        if (n.photo_path) await supabase.storage.from("photos").remove([n.photo_path]);
        if (n.file_path) await supabase.storage.from("files").remove([n.file_path]);
        await supabase.from("equipment_notes").delete().eq("id", n.id);
      },
      afterCommit: load,
    });
  };


  const boardHeight = Math.max(420, ...notes.map((n) => n.position_y + 280));

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-medium">Notes</h3>
        {canEdit && (
          <Button size="sm" onClick={addNote}>
            <Plus className="mr-1 h-4 w-4" /> Add note
          </Button>
        )}
      </div>
      <div ref={boardRef} className="relative w-full rounded-md border bg-muted/30" style={{ height: boardHeight }}>
        {notes.length === 0 && (
          <p className="p-6 text-sm text-muted-foreground">No notes yet.</p>
        )}
        {notes.map((n) => (
          <NoteCard
            key={n.id}
            note={n}
            canEdit={canEdit}
            userId={userId}
            boardRef={boardRef}
            onUpdate={(patch: Partial<Note>) => update(n.id, patch)}
            onDelete={() => remove(n)}
            onReload={load}
          />
        ))}
      </div>
    </div>
  );
}

function NoteCard({ note, canEdit, userId, boardRef, onUpdate, onDelete, onReload }: any) {
  const [pos, setPos] = useState({ x: note.position_x, y: note.position_y });
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => { setPos({ x: note.position_x, y: note.position_y }); }, [note.position_x, note.position_y]);

  const onMouseDown = (e: React.MouseEvent) => {
    if (!canEdit) return;
    const board = boardRef.current?.getBoundingClientRect();
    if (!board) return;
    dragRef.current = { dx: e.clientX - board.left - pos.x, dy: e.clientY - board.top - pos.y };
    const move = (ev: MouseEvent) => {
      const b = boardRef.current?.getBoundingClientRect();
      if (!b || !dragRef.current) return;
      const x = Math.max(0, Math.min(b.width - 260, ev.clientX - b.left - dragRef.current.dx));
      const y = Math.max(0, ev.clientY - b.top - dragRef.current.dy);
      setPos({ x, y });
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      if (dragRef.current) {
        onUpdate({ position_x: Math.round(pos.x), position_y: Math.round(pos.y) });
      }
      dragRef.current = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  // Touch drag for mobile
  const onTouchStart = (e: React.TouchEvent) => {
    if (!canEdit) return;
    const t = e.touches[0];
    const board = boardRef.current?.getBoundingClientRect();
    if (!board) return;
    dragRef.current = { dx: t.clientX - board.left - pos.x, dy: t.clientY - board.top - pos.y };
    const move = (ev: TouchEvent) => {
      const tt = ev.touches[0];
      const b = boardRef.current?.getBoundingClientRect();
      if (!b || !dragRef.current) return;
      const x = Math.max(0, Math.min(b.width - 260, tt.clientX - b.left - dragRef.current.dx));
      const y = Math.max(0, tt.clientY - b.top - dragRef.current.dy);
      setPos({ x, y });
      ev.preventDefault();
    };
    const up = () => {
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      onUpdate({ position_x: Math.round(pos.x), position_y: Math.round(pos.y) });
      dragRef.current = null;
    };
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up);
  };

  const saveTitle = () => { if (title !== note.title) onUpdate({ title }); };
  const saveBody = () => { if (body !== note.body) onUpdate({ body }); };

  return (
    <div
      className="absolute w-[260px] rounded-md border bg-card shadow-md"
      style={{ left: pos.x, top: pos.y }}
    >
      <div
        onMouseDown={onMouseDown}
        onTouchStart={onTouchStart}
        className="flex cursor-move items-center gap-1 rounded-t-md border-b bg-muted/50 px-2 py-1"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
        <Input
          value={title}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          className="h-6 flex-1 border-0 bg-transparent px-1 text-xs font-medium shadow-none focus-visible:ring-0"
        />
        {canEdit && (
          <button onClick={onDelete} className="text-destructive hover:opacity-80">
            <Trash2 className="h-3 w-3" />
          </button>
        )}
      </div>
      <div className="space-y-2 p-2">
        <Textarea
          value={body}
          disabled={!canEdit}
          onChange={(e) => setBody(e.target.value)}
          onBlur={saveBody}
          placeholder="Write something…"
          data-resize-key={`equipment-note-board:${note.id}`}
          className="min-h-[80px] resize-y text-xs"
        />
        <NoteAttachments
          parentKind="equipment_note"
          parentId={note.id}
          storagePrefix={`equipment-notes/${note.equipment_id}/${note.id}`}
          canEdit={canEdit}
          userId={userId}
          showSharedToggle={false}
        />
      </div>
    </div>
  );
}
