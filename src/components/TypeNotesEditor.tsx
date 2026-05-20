import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/errors";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Plus, Trash2, ChevronDown, ChevronRight, Share2, Lock, StickyNote } from "lucide-react";
import { NoteAttachments } from "@/components/NoteAttachments";
import { undoableDelete } from "@/lib/undoableDelete";

interface TypeNote {
  id: string;
  component_type_id: string;
  title: string;
  body: string;
  sort_order: number;
  is_shared: boolean;
  origin_line_id: string | null;
}

/**
 * Multi-note editor for a component type.
 * Loads notes for this type plus shared notes from sibling component_types
 * across other production lines (same template_id).
 */
export function TypeNotesEditor({
  typeId,
  typeTemplateId,
  canEdit,
  userId,
}: {
  typeId: string;
  typeTemplateId?: string | null;
  canEdit: boolean;
  userId?: string;
}) {
  const [notes, setNotes] = useState<TypeNote[]>([]);
  const [autoOpenId, setAutoOpenId] = useState<string | null>(null);

  const load = async () => {
    let siblingIds: string[] = [];
    if (typeTemplateId) {
      const { data: sibs } = await supabase
        .from("component_types").select("id")
        .eq("template_id", typeTemplateId).neq("id", typeId).is("deleted_at", null);
      siblingIds = (sibs ?? []).map((s: any) => s.id);
    }
    const orFilter = siblingIds.length > 0
      ? `component_type_id.eq.${typeId},and(is_shared.eq.true,component_type_id.in.(${siblingIds.join(",")}))`
      : `component_type_id.eq.${typeId}`;
    const { data } = await supabase
      .from("component_type_notes" as any).select("*")
      .or(orFilter)
      .order("sort_order").order("created_at");
    setNotes((data ?? []) as any);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [typeId, typeTemplateId]);

  const addNote = async () => {
    const { data, error } = await supabase.from("component_type_notes" as any).insert({
      component_type_id: typeId, title: "Note", body: "",
      sort_order: notes.length, created_by: userId,
    } as any).select("id").single();
    if (error) { toast.error(toUserMessage(error)); return; }
    setAutoOpenId((data as any)?.id ?? null);
    load();
  };

  const update = (id: string, patch: Partial<TypeNote>) => {
    setNotes((n) => n.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    supabase.from("component_type_notes" as any).update(patch as any).eq("id", id).then();
  };

  const remove = async (n: TypeNote) => {
    undoableDelete({
      label: "Note deleted",
      optimistic: () => setNotes((s) => s.filter((x) => x.id !== n.id)),
      restore: load,
      commit: async () => {
        const [{ data: photos }, { data: files }] = await Promise.all([
          supabase.from("note_photos" as any).select("storage_path").eq("parent_kind", "component_type_note" as any).eq("parent_id", n.id),
          supabase.from("note_files" as any).select("storage_path").eq("parent_kind", "component_type_note" as any).eq("parent_id", n.id),
        ]);
        const photoPaths = ((photos ?? []) as any[]).map((p) => p.storage_path).filter(Boolean);
        const filePaths = ((files ?? []) as any[]).map((f) => f.storage_path).filter(Boolean);
        if (photoPaths.length) await supabase.storage.from("photos").remove(photoPaths);
        if (filePaths.length) await supabase.storage.from("files").remove(filePaths);
        await supabase.from("note_photos" as any).delete().eq("parent_kind", "component_type_note" as any).eq("parent_id", n.id);
        await supabase.from("note_files" as any).delete().eq("parent_kind", "component_type_note" as any).eq("parent_id", n.id);
        await supabase.from("component_type_notes" as any).delete().eq("id", n.id);
      },
      afterCommit: load,
    });
  };


  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <StickyNote className="h-3 w-3" /> Notes ({notes.length})
        </span>
        {canEdit && (
          <button onClick={addNote}
            className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-accent">
            <Plus className="h-3 w-3" /> Add note
          </button>
        )}
      </div>
      {notes.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">No notes yet.</p>
      ) : (
        <ul className="space-y-2">
          {notes.map((n) => (
            <NoteRow key={n.id} note={n} canEdit={canEdit} userId={userId}
              autoOpen={autoOpenId === n.id}
              onUpdate={(p: Partial<TypeNote>) => update(n.id, p)} onDelete={() => remove(n)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NoteRow({ note, canEdit, userId, autoOpen, onUpdate, onDelete }: any) {
  const [open, setOpen] = useState(!!autoOpen);
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setTitle(note.title); setBody(note.body); }, [note.title, note.body]);
  useEffect(() => {
    if (autoOpen) {
      setOpen(true);
      requestAnimationFrame(() => { titleRef.current?.focus(); titleRef.current?.select(); });
    }
  }, [autoOpen]);

  return (
    <li className="rounded-md border bg-card">
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1">
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="p-1 text-muted-foreground hover:text-foreground" title={open ? "Collapse" : "Expand"}>
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {open ? (
          <Input ref={titleRef} value={title} disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { if (title !== note.title) onUpdate({ title }); }}
            className="h-7 flex-1 border-0 bg-transparent px-1 text-xs font-medium shadow-none focus-visible:ring-0" />
        ) : (
          <button type="button" onClick={() => setOpen(true)}
            className="flex flex-1 items-center gap-2 truncate px-1 text-left text-xs font-medium">
            <span className="truncate">{note.title || "Untitled"}</span>
            {(note.body ?? "").trim() && (
              <span className="truncate text-[10px] font-normal text-muted-foreground">— {note.body.slice(0, 40)}</span>
            )}
          </button>
        )}
        {canEdit && (
          <button onClick={() => onUpdate({ is_shared: !note.is_shared })}
            title={note.is_shared ? "Shared across all production lines — click to make local" : "Local — click to share"}
            className={`p-1 ${note.is_shared ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
            {note.is_shared ? <Share2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          </button>
        )}
        {canEdit && (
          <button onClick={onDelete} className="p-1 text-destructive hover:opacity-80">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2 p-2">
          <Textarea value={body} disabled={!canEdit}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => { if (body !== note.body) onUpdate({ body }); }}
            placeholder="Write something…"
            className="min-h-[50px] resize-y text-xs" />
          <NoteAttachments
            parentKind={"component_type_note" as any}
            parentId={note.id}
            storagePrefix={`component-type-notes/${note.component_type_id}/${note.id}`}
            canEdit={canEdit}
            userId={userId}
            defaultShared={!!note.is_shared}
          />
        </div>
      )}
    </li>
  );
}
