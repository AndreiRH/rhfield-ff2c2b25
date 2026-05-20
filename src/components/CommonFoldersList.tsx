import { useEffect, useMemo, useState } from "react";
import { toUserMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, Camera, Paperclip, X, Folder, FolderOpen, ChevronRight, FileText, ChevronDown, Check, FolderPlus, ChevronsUpDown, ChevronsDownUp, StickyNote,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { PhotoPicker } from "@/components/PhotoPicker";
import { StoragePhoto, openStorageFile } from "@/components/StoragePhoto";
import { rememberLocalFile } from "@/lib/local-blobs";
import { confirmSharedDelete } from "@/lib/confirm-shared-delete";
import { undoableDelete } from "@/lib/undoableDelete";

interface FolderRow {
  id: string;
  project_id: string;
  parent_folder_id: string | null;
  name: string;
  sort_order: number;
}
interface Attachment {
  id: string;
  folder_id: string;
  kind: "photo" | "file";
  storage_path: string;
  file_name: string | null;
  sort_order: number;
}
interface Note {
  id: string;
  folder_id: string;
  project_id: string;
  title: string;
  body: string;
  sort_order: number;
  photo_path: string | null;
  file_path: string | null;
  file_name: string | null;
}

export function CommonFoldersList({
  projectId, canEdit, userId,
}: { projectId: string; canEdit: boolean; userId?: string }) {
  const { isAdmin } = useAuth();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [deleteMode, setDeleteMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [photoCounts, setPhotoCounts] = useState<Map<string, number>>(new Map());
  const [fileCounts, setFileCounts] = useState<Map<string, number>>(new Map());
  const [noteCounts, setNoteCounts] = useState<Map<string, number>>(new Map());

  const load = async () => {
    const { data } = await supabase
      .from("common_folders")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order")
      .order("created_at");
    const rows = (data ?? []) as FolderRow[];
    setFolders(rows);
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) {
      setPhotoCounts(new Map()); setFileCounts(new Map()); setNoteCounts(new Map());
      return;
    }
    const [{ data: atts }, { data: ns }] = await Promise.all([
      supabase.from("common_folder_attachments").select("folder_id, kind").in("folder_id", ids),
      supabase.from("common_folder_notes").select("folder_id").in("folder_id", ids),
    ]);
    const ph = new Map<string, number>(), fl = new Map<string, number>(), nt = new Map<string, number>();
    (atts ?? []).forEach((a: any) => {
      const m = a.kind === "photo" ? ph : fl;
      m.set(a.folder_id, (m.get(a.folder_id) ?? 0) + 1);
    });
    (ns ?? []).forEach((n: any) => nt.set(n.folder_id, (nt.get(n.folder_id) ?? 0) + 1));
    setPhotoCounts(ph); setFileCounts(fl); setNoteCounts(nt);
  };
  useEffect(() => { load(); }, [projectId]);

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, FolderRow[]>();
    for (const f of folders) {
      const k = f.parent_folder_id;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(f);
    }
    return map;
  }, [folders]);

  const collectDescendants = (id: string): string[] => {
    const out: string[] = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop()!;
      const kids = childrenOf.get(cur) ?? [];
      for (const k of kids) { out.push(k.id); stack.push(k.id); }
    }
    return out;
  };

  const toggleOpen = (id: string) => {
    setOpenIds((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const addFolder = async (parentId: string | null) => {
    const siblingCount = (childrenOf.get(parentId) ?? []).length;
    const { data, error } = await supabase.from("common_folders").insert({
      project_id: projectId, parent_folder_id: parentId, name: "New folder",
      sort_order: siblingCount, created_by: userId,
    }).select().single();
    if (error) { toast.error(toUserMessage(error)); return; }
    await load();
    if (data) {
      setOpenIds((s) => {
        const next = new Set(s);
        if (parentId) next.add(parentId);
        next.add(data.id);
        return next;
      });
    }
  };

  const renameFolder = async (id: string, name: string) => {
    setFolders((f) => f.map((x) => (x.id === id ? { ...x, name } : x)));
    await supabase.from("common_folders").update({ name }).eq("id", id);
  };

  const deleteFolders = async (ids: string[]) => {
    const all = new Set<string>();
    for (const id of ids) {
      all.add(id);
      for (const d of collectDescendants(id)) all.add(d);
    }
    const allIds = Array.from(all);
    const label = ids.length > 1 ? `${ids.length} folders deleted` : "Folder deleted";
    undoableDelete({
      label,
      optimistic: () => setOpenIds((s) => {
        const next = new Set(s);
        allIds.forEach((id) => next.delete(id));
        return next;
      }),
      restore: load,
      commit: async () => {
        const { data: atts } = await supabase.from("common_folder_attachments")
          .select("kind, storage_path").in("folder_id", allIds);
        const photos = (atts ?? []).filter((a: any) => a.kind === "photo").map((a: any) => a.storage_path);
        const files = (atts ?? []).filter((a: any) => a.kind === "file").map((a: any) => a.storage_path);
        const { data: notes } = await supabase.from("common_folder_notes")
          .select("photo_path, file_path").in("folder_id", allIds);
        (notes ?? []).forEach((n: any) => {
          if (n.photo_path) photos.push(n.photo_path);
          if (n.file_path) files.push(n.file_path);
        });
        if (photos.length) await supabase.storage.from("photos").remove(photos);
        if (files.length) await supabase.storage.from("files").remove(files);
        await supabase.from("common_folders").delete().in("id", ids);
      },
      afterCommit: load,
    });
  };


  const toggleSelect = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const cancelDelete = () => { setDeleteMode(false); setSelected(new Set()); };
  const commitDelete = () => {
    if (selected.size === 0) { cancelDelete(); return; }
    setConfirmDelete(true);
  };
  const performDelete = async () => {
    // Drop selected ids that are descendants of other selected ids — CASCADE handles them
    const sel = new Set(selected);
    const minimal: string[] = [];
    for (const id of sel) {
      let p = folders.find((f) => f.id === id)?.parent_folder_id ?? null;
      let covered = false;
      while (p) {
        if (sel.has(p)) { covered = true; break; }
        p = folders.find((f) => f.id === p)?.parent_folder_id ?? null;
      }
      if (!covered) minimal.push(id);
    }
    setConfirmDelete(false);
    await deleteFolders(minimal);
    cancelDelete();
    toast.success(`Deleted ${selected.size} folder${selected.size > 1 ? "s" : ""}`);
  };

  const roots = childrenOf.get(null) ?? [];

  const renderFolder = (f: FolderRow, depth: number) => {
    const kids = childrenOf.get(f.id) ?? [];
    const isOpen = openIds.has(f.id) || deleteMode;
    return (
      <FolderItem
        key={f.id}
        folder={f}
        depth={depth}
        open={isOpen}
        onToggle={() => toggleOpen(f.id)}
        canEdit={canEdit}
        userId={userId}
        onRename={(name: string) => renameFolder(f.id, name)}
        onAddChild={() => addFolder(f.id)}
        deleteMode={deleteMode}
        selected={selected.has(f.id)}
        onSelectToggle={() => toggleSelect(f.id)}
        childrenContent={kids.length > 0 ? (
          <ul className="space-y-2">
            {kids.map((c) => renderFolder(c, depth + 1))}
          </ul>
        ) : null}
      />
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Folders</h2>
        <div className="flex flex-1 items-center gap-2 justify-end">
          {folders.length > 0 && !deleteMode && (() => {
            const allOpen = openIds.size === folders.length;
            return (
              <Button
                size="sm"
                variant="outline"
                className="mr-auto"
                onClick={() => setOpenIds(allOpen ? new Set() : new Set(folders.map((f) => f.id)))}
                title={allOpen ? "Collapse all" : "Expand all"}
                aria-label={allOpen ? "Collapse all" : "Expand all"}
              >
                {allOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
              </Button>
            );
          })()}
          {canEdit && isAdmin && folders.length > 0 && (
            <Button
              size="sm"
              variant={deleteMode ? "destructive" : "outline"}
              onClick={deleteMode ? commitDelete : () => setDeleteMode(true)}
              title="Delete"
              aria-label="Delete"
            >
              <Trash2 className="h-4 w-4" />
              {deleteMode && <span className="ml-1">Done{selected.size ? ` ${selected.size}` : ""}</span>}
            </Button>
          )}
          {canEdit && !deleteMode && (
            <Button size="sm" onClick={() => addFolder(null)}>
              <Plus className="mr-1 h-4 w-4" /> New folder
            </Button>
          )}
        </div>
      </div>

      {deleteMode && (
        <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Tap any folder to add it to the deletion list. Subfolders inside a selected folder are deleted too. Tap "Done" to delete all selected.
        </p>
      )}

      {roots.length === 0 ? (
        <p className="text-sm text-muted-foreground">No folders yet. Create one to start adding photos, files and notes.</p>
      ) : (
        <ul className="space-y-2">
          {roots.map((f) => renderFolder(f, 0))}
        </ul>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} folder{selected.size > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This deletes the selected folders, all their subfolders, and all photos, files and notes inside them.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FolderItem({
  folder, depth, open, onToggle, canEdit, userId, onRename, onAddChild,
  deleteMode, selected, onSelectToggle, childrenContent,
}: any) {
  const [name, setName] = useState(folder.name);
  const [editing, setEditing] = useState(false);
  useEffect(() => setName(folder.name), [folder.name]);

  const commit = () => {
    setEditing(false);
    if (name !== folder.name) onRename(name.trim() || "Untitled");
  };

  const rowClick = deleteMode ? onSelectToggle : onToggle;

  return (
    <li data-nest className={`overflow-hidden rounded-md border bg-card ${
      deleteMode ? (selected ? "border-destructive" : "border-destructive/40") : ""
    }`}>
      <div
        className={`flex items-center gap-1 px-2 py-1.5 ${
          deleteMode ? `cursor-pointer ${selected ? "bg-destructive/15" : "bg-destructive/5 hover:bg-destructive/10"}` : ""
        }`}
        onClick={deleteMode ? rowClick : undefined}
      >
        <button
          onClick={(e) => { e.stopPropagation(); rowClick(); }}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          {deleteMode ? (
            <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? "border-destructive bg-destructive text-destructive-foreground" : "border-muted-foreground/30"}`}>
              {selected && <Check className="h-3 w-3" />}
            </span>
          ) : (
            <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          )}
          {open ? <FolderOpen className="h-4 w-4 shrink-0 text-primary" /> : <Folder className="h-4 w-4 shrink-0 text-primary" />}
          {!deleteMode && editing && canEdit ? (
            <Input
              autoFocus
              value={name}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setName(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
                if (e.key === "Escape") { setName(folder.name); setEditing(false); }
              }}
              className="h-7 min-w-0 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
            />
          ) : (
            <span
              onDoubleClick={(e) => { if (!deleteMode && canEdit) { e.stopPropagation(); setEditing(true); } }}
              className="min-w-0 flex-1 truncate px-1 text-sm font-medium"
              title={!deleteMode && canEdit ? "Double-click to rename" : undefined}
            >
              {name}
            </span>
          )}
        </button>
        {!deleteMode && canEdit && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddChild(); }}
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Add subfolder"
            aria-label="Add subfolder"
          >
            <FolderPlus className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && (
        <div className="space-y-3 border-t bg-muted/20 p-3">
          {!deleteMode && <FolderContents folder={folder} canEdit={canEdit} userId={userId} />}
          {childrenContent && (
            <div className="pl-3 border-l-2 border-muted">
              {childrenContent}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function FolderContents({ folder, canEdit, userId }: any) {
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [notes, setNotes] = useState<Note[]>([]);

  const load = async () => {
    const [a, n] = await Promise.all([
      supabase.from("common_folder_attachments").select("*").eq("folder_id", folder.id).order("sort_order").order("uploaded_at"),
      supabase.from("common_folder_notes").select("*").eq("folder_id", folder.id).order("sort_order").order("created_at"),
    ]);
    setAtts((a.data ?? []) as Attachment[]);
    setNotes((n.data ?? []) as Note[]);
  };
  useEffect(() => { load(); }, [folder.id]);

  const basePath = `common-folders/${folder.project_id}/${folder.id}`;

  const uploadAttachment = async (file: File, kind: "photo" | "file") => {
    const path = `${basePath}/${kind}/${Date.now()}-${file.name}`;
    const bucket = kind === "photo" ? "photos" : "files";
    rememberLocalFile(bucket, path, file);
    const { error } = await supabase.storage.from(bucket).upload(path, file);
    if (error) { toast.error(toUserMessage(error)); return; }
    const { error: dbErr } = await supabase.from("common_folder_attachments").insert({
      folder_id: folder.id, kind, storage_path: path, file_name: file.name,
      sort_order: atts.length, uploaded_by: userId,
    });
    if (dbErr) toast.error(toUserMessage(dbErr));
    load();
  };

  const removeAttachment = async (a: Attachment) => {
    if (!confirmSharedDelete(true)) return;
    undoableDelete({
      label: a.kind === "photo" ? "Photo deleted" : "File deleted",
      optimistic: () => setAtts((s) => s.filter((x) => x.id !== a.id)),
      restore: load,
      commit: async () => {
        const bucket = a.kind === "photo" ? "photos" : "files";
        await supabase.storage.from(bucket).remove([a.storage_path]);
        await supabase.from("common_folder_attachments").delete().eq("id", a.id);
      },
      afterCommit: load,
    });
  };

  const addNote = async () => {
    await supabase.from("common_folder_notes").insert({
      folder_id: folder.id, project_id: folder.project_id,
      title: "Note", body: "", sort_order: notes.length, created_by: userId,
    });
    load();
  };

  const updateNote = (id: string, patch: Partial<Note>) => {
    setNotes((arr) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    supabase.from("common_folder_notes").update(patch as any).eq("id", id).then();
  };

  const deleteNote = async (n: Note) => {
    if (!confirmSharedDelete(true)) return;
    undoableDelete({
      label: "Note deleted",
      optimistic: () => setNotes((s) => s.filter((x) => x.id !== n.id)),
      restore: load,
      commit: async () => {
        if (n.photo_path) await supabase.storage.from("photos").remove([n.photo_path]);
        if (n.file_path) await supabase.storage.from("files").remove([n.file_path]);
        await supabase.from("common_folder_notes").delete().eq("id", n.id);
      },
      afterCommit: load,
    });
  };


  const photos = atts.filter((a) => a.kind === "photo");
  const files = atts.filter((a) => a.kind === "file");

  const [photosOpen, setPhotosOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const SectionHeader = ({ open, onToggle, label, count, action }: any) => (
    <div className="flex items-center justify-between">
      <button onClick={onToggle} className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {label} <span className="font-mono normal-case tracking-normal">({count})</span>
      </button>
      {action}
    </div>
  );

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <SectionHeader
          open={photosOpen} onToggle={() => setPhotosOpen((o) => !o)}
          label="Photos" count={photos.length}
          action={canEdit && (
            <PhotoPicker onPick={(f) => uploadAttachment(f, "photo")}>
              <button className="inline-flex cursor-pointer items-center gap-1 rounded border bg-card px-2 py-1 text-xs hover:bg-accent">
                <Camera className="h-3 w-3" /> Add photo
              </button>
            </PhotoPicker>
          )}
        />
        {photosOpen && (photos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No photos.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((p) => (
              <AttPhoto key={p.id} att={p} canEdit={canEdit} onRemove={() => removeAttachment(p)} />
            ))}
          </div>
        ))}
      </section>

      <section className="space-y-2">
        <SectionHeader
          open={filesOpen} onToggle={() => setFilesOpen((o) => !o)}
          label="Files" count={files.length}
          action={canEdit && (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded border bg-card px-2 py-1 text-xs hover:bg-accent">
              <Paperclip className="h-3 w-3" /> Add file
              <input type="file" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f, "file"); e.target.value = ""; }} />
            </label>
          )}
        />
        {filesOpen && (files.length === 0 ? (
          <p className="text-xs text-muted-foreground">No files.</p>
        ) : (
          <ul className="space-y-1">
            {files.map((f) => (
              <AttFile key={f.id} att={f} canEdit={canEdit} onRemove={() => removeAttachment(f)} />
            ))}
          </ul>
        ))}
      </section>

      <section className="space-y-2">
        <SectionHeader
          open={notesOpen} onToggle={() => setNotesOpen((o) => !o)}
          label="Notes" count={notes.length}
          action={canEdit && (
            <button onClick={addNote}
              className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs hover:bg-accent">
              <FileText className="h-3 w-3" /> Add note
            </button>
          )}
        />
        {notesOpen && (notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notes.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <NoteRow key={n.id} note={n} canEdit={canEdit}
                onUpdate={(p: Partial<Note>) => updateNote(n.id, p)}
                onDelete={() => deleteNote(n)} onReload={load} />
            ))}
          </ul>
        ))}
      </section>
    </div>
  );
}

function AttPhoto({ att, canEdit, onRemove }: { att: Attachment; canEdit: boolean; onRemove: () => void }) {
  return (
    <StoragePhoto
      bucket="photos"
      path={att.storage_path}
      imgClassName="h-28 w-full rounded border object-cover"
      canEdit={canEdit}
      onRemove={onRemove}
    />
  );
}

function AttFile({ att, canEdit, onRemove }: { att: Attachment; canEdit: boolean; onRemove: () => void }) {
  return (
    <li className="flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs">
      <button onClick={() => openStorageFile("files", att.storage_path, att.file_name ?? "file")} className="flex min-w-0 flex-1 items-center gap-1 text-left hover:underline">
        <Paperclip className="h-3 w-3 shrink-0" /> <span className="min-w-0 flex-1 truncate">{att.file_name ?? "file"}</span>
      </button>
      {canEdit && (
        <button onClick={onRemove} className="shrink-0 p-1 text-destructive hover:opacity-80" aria-label="Remove file">
          <X className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

function NoteRow({ note, canEdit, onUpdate, onDelete, onReload }: any) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [open, setOpen] = useState(false);
  useEffect(() => { setTitle(note.title); setBody(note.body); }, [note.title, note.body]);

  const basePath = `common-notes/${note.project_id}/${note.id}`;

  const uploadPhoto = async (file: File) => {
    const path = `${basePath}/${Date.now()}-${file.name}`;
    rememberLocalFile("photos", path, file);
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(toUserMessage(error)); return; }
    if (note.photo_path) await supabase.storage.from("photos").remove([note.photo_path]);
    await supabase.from("common_folder_notes").update({ photo_path: path }).eq("id", note.id);
    onReload();
  };
  const uploadFile = async (file: File) => {
    const path = `${basePath}/${Date.now()}-${file.name}`;
    rememberLocalFile("files", path, file);
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(toUserMessage(error)); return; }
    if (note.file_path) await supabase.storage.from("files").remove([note.file_path]);
    await supabase.from("common_folder_notes").update({ file_path: path, file_name: file.name }).eq("id", note.id);
    onReload();
  };
  const removePhoto = async () => {
    if (!confirmSharedDelete(true)) return;
    if (note.photo_path) await supabase.storage.from("photos").remove([note.photo_path]);
    await supabase.from("common_folder_notes").update({ photo_path: null }).eq("id", note.id);
    onReload();
  };
  const removeFile = async () => {
    if (!confirmSharedDelete(true)) return;
    if (note.file_path) await supabase.storage.from("files").remove([note.file_path]);
    await supabase.from("common_folder_notes").update({ file_path: null, file_name: null }).eq("id", note.id);
    onReload();
  };

  return (
    <li className="rounded-md border bg-card">
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="p-0.5 text-muted-foreground hover:text-foreground"
          title={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <Input
          value={title}
          disabled={!canEdit}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => title !== note.title && onUpdate({ title })}
          className="h-7 flex-1 min-w-0 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
        />
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
            onBlur={() => body !== note.body && onUpdate({ body })}
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

