import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, Camera, Paperclip, X, Folder, FolderOpen, ChevronRight, FileText,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";

interface FolderRow {
  id: string;
  line_id: string;
  kind: string;
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
  folder_id: string | null;
  line_id: string;
  kind: string;
  title: string;
  body: string;
  sort_order: number;
  photo_path: string | null;
  file_path: string | null;
  file_name: string | null;
}

export function PAFoldersList({
  lineId, kind, canEdit, userId,
}: { lineId: string; kind: string; canEdit: boolean; userId?: string }) {
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = async () => {
    const { data } = await supabase
      .from("pa_folders")
      .select("*")
      .eq("line_id", lineId)
      .eq("kind", kind as any)
      .order("sort_order")
      .order("created_at");
    setFolders((data ?? []) as FolderRow[]);
  };
  useEffect(() => { load(); }, [lineId, kind]);

  const addFolder = async () => {
    const { data, error } = await supabase.from("pa_folders").insert({
      line_id: lineId, kind: kind as any, name: "New folder",
      sort_order: folders.length, created_by: userId,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    await load();
    if (data) setOpenId(data.id);
  };

  const renameFolder = async (id: string, name: string) => {
    setFolders((f) => f.map((x) => (x.id === id ? { ...x, name } : x)));
    await supabase.from("pa_folders").update({ name }).eq("id", id);
  };

  const deleteFolder = async (id: string) => {
    // remove storage objects under this folder
    const { data: atts } = await supabase.from("pa_attachments").select("kind, storage_path").eq("folder_id", id);
    const photos = (atts ?? []).filter((a: any) => a.kind === "photo").map((a: any) => a.storage_path);
    const files = (atts ?? []).filter((a: any) => a.kind === "file").map((a: any) => a.storage_path);
    const { data: notes } = await supabase.from("pa_notes").select("photo_path, file_path").eq("folder_id", id);
    (notes ?? []).forEach((n: any) => {
      if (n.photo_path) photos.push(n.photo_path);
      if (n.file_path) files.push(n.file_path);
    });
    if (photos.length) await supabase.storage.from("photos").remove(photos);
    if (files.length) await supabase.storage.from("files").remove(files);
    await supabase.from("pa_folders").delete().eq("id", id);
    if (openId === id) setOpenId(null);
    load();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Folders</h2>
        {canEdit && (
          <Button size="sm" onClick={addFolder}>
            <Plus className="mr-1 h-4 w-4" /> New folder
          </Button>
        )}
      </div>

      {folders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No folders yet. Create one to start adding photos, files and notes.</p>
      ) : (
        <ul className="space-y-2">
          {folders.map((f) => (
            <FolderItem
              key={f.id}
              folder={f}
              open={openId === f.id}
              onToggle={() => setOpenId(openId === f.id ? null : f.id)}
              canEdit={canEdit}
              userId={userId}
              onRename={(name) => renameFolder(f.id, name)}
              onDelete={() => deleteFolder(f.id)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function FolderItem({
  folder, open, onToggle, canEdit, userId, onRename, onDelete,
}: any) {
  const [name, setName] = useState(folder.name);
  useEffect(() => setName(folder.name), [folder.name]);

  return (
    <li className="overflow-hidden rounded-md border bg-card">
      <div className="flex items-center gap-1 px-2 py-1.5">
        <button onClick={onToggle} className="flex flex-1 items-center gap-2 text-left">
          <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-90" : ""}`} />
          {open ? <FolderOpen className="h-4 w-4 text-primary" /> : <Folder className="h-4 w-4 text-primary" />}
          <Input
            value={name}
            disabled={!canEdit}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== folder.name && onRename(name.trim() || "Untitled")}
            className="h-7 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
          />
        </button>
        {canEdit && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="p-1 text-destructive hover:opacity-80" title="Delete folder">
                <Trash2 className="h-4 w-4" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{folder.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This deletes the folder and all its photos, files and notes.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {open && (
        <div className="border-t bg-muted/20 p-3">
          <FolderContents folder={folder} canEdit={canEdit} userId={userId} />
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
      supabase.from("pa_attachments").select("*").eq("folder_id", folder.id).order("sort_order").order("uploaded_at"),
      supabase.from("pa_notes").select("*").eq("folder_id", folder.id).order("sort_order").order("created_at"),
    ]);
    setAtts((a.data ?? []) as Attachment[]);
    setNotes((n.data ?? []) as Note[]);
  };
  useEffect(() => { load(); }, [folder.id]);

  const basePath = `pa-folders/${folder.line_id}/${folder.kind}/${folder.id}`;

  const uploadAttachment = async (file: File, kind: "photo" | "file") => {
    const path = `${basePath}/${kind}/${Date.now()}-${file.name}`;
    const bucket = kind === "photo" ? "photos" : "files";
    const { error } = await supabase.storage.from(bucket).upload(path, file);
    if (error) { toast.error(error.message); return; }
    const { error: dbErr } = await supabase.from("pa_attachments").insert({
      folder_id: folder.id, kind, storage_path: path, file_name: file.name,
      sort_order: atts.length, uploaded_by: userId,
    });
    if (dbErr) toast.error(dbErr.message);
    load();
  };

  const removeAttachment = async (a: Attachment) => {
    const bucket = a.kind === "photo" ? "photos" : "files";
    await supabase.storage.from(bucket).remove([a.storage_path]);
    await supabase.from("pa_attachments").delete().eq("id", a.id);
    load();
  };

  const addNote = async () => {
    await supabase.from("pa_notes").insert({
      folder_id: folder.id, line_id: folder.line_id, kind: folder.kind as any,
      title: "Note", body: "", sort_order: notes.length, created_by: userId,
    });
    load();
  };

  const updateNote = (id: string, patch: Partial<Note>) => {
    setNotes((arr) => arr.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    supabase.from("pa_notes").update(patch as any).eq("id", id).then();
  };

  const deleteNote = async (n: Note) => {
    if (n.photo_path) await supabase.storage.from("photos").remove([n.photo_path]);
    if (n.file_path) await supabase.storage.from("files").remove([n.file_path]);
    await supabase.from("pa_notes").delete().eq("id", n.id);
    load();
  };

  const photos = atts.filter((a) => a.kind === "photo");
  const files = atts.filter((a) => a.kind === "file");

  return (
    <div className="space-y-4">
      {/* Photos */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Photos</h3>
          {canEdit && (
            <PhotoPicker onPick={(f) => uploadAttachment(f, "photo")}>
              <button className="inline-flex cursor-pointer items-center gap-1 rounded border bg-card px-2 py-1 text-xs hover:bg-accent">
                <Camera className="h-3 w-3" /> Add photo
              </button>
            </PhotoPicker>
          )}
        </div>
        {photos.length === 0 ? (
          <p className="text-xs text-muted-foreground">No photos.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {photos.map((p) => (
              <AttPhoto key={p.id} att={p} canEdit={canEdit} onRemove={() => removeAttachment(p)} />
            ))}
          </div>
        )}
      </section>

      {/* Files */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Files</h3>
          {canEdit && (
            <label className="inline-flex cursor-pointer items-center gap-1 rounded border bg-card px-2 py-1 text-xs hover:bg-accent">
              <Paperclip className="h-3 w-3" /> Add file
              <input type="file" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadAttachment(f, "file"); e.target.value = ""; }} />
            </label>
          )}
        </div>
        {files.length === 0 ? (
          <p className="text-xs text-muted-foreground">No files.</p>
        ) : (
          <ul className="space-y-1">
            {files.map((f) => (
              <AttFile key={f.id} att={f} canEdit={canEdit} onRemove={() => removeAttachment(f)} />
            ))}
          </ul>
        )}
      </section>

      {/* Notes */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</h3>
          {canEdit && (
            <button onClick={addNote}
              className="inline-flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs hover:bg-accent">
              <FileText className="h-3 w-3" /> Add note
            </button>
          )}
        </div>
        {notes.length === 0 ? (
          <p className="text-xs text-muted-foreground">No notes.</p>
        ) : (
          <ul className="space-y-2">
            {notes.map((n) => (
              <NoteRow key={n.id} note={n} canEdit={canEdit}
                onUpdate={(p: Partial<Note>) => updateNote(n.id, p)}
                onDelete={() => deleteNote(n)} onReload={load} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AttPhoto({ att, canEdit, onRemove }: { att: Attachment; canEdit: boolean; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("photos").createSignedUrl(att.storage_path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  }, [att.storage_path]);
  return (
    <div className="relative">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="" className="h-28 w-full rounded border object-cover" />
        </a>
      ) : (
        <div className="h-28 animate-pulse rounded bg-muted" />
      )}
      {canEdit && (
        <button onClick={onRemove}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function AttFile({ att, canEdit, onRemove }: { att: Attachment; canEdit: boolean; onRemove: () => void }) {
  const open = async () => {
    const { data } = await supabase.storage.from("files").createSignedUrl(att.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };
  return (
    <li className="flex items-center gap-1 rounded border bg-card px-2 py-1 text-xs">
      <button onClick={open} className="flex flex-1 items-center gap-1 text-left hover:underline">
        <Paperclip className="h-3 w-3" /> <span className="truncate">{att.file_name ?? "file"}</span>
      </button>
      {canEdit && (
        <button onClick={onRemove} className="text-destructive hover:opacity-80">
          <X className="h-3 w-3" />
        </button>
      )}
    </li>
  );
}

function NoteRow({ note, canEdit, onUpdate, onDelete, onReload }: any) {
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  useEffect(() => { setTitle(note.title); setBody(note.body); }, [note.title, note.body]);

  const basePath = `pa-notes/${note.line_id}/${note.kind}/${note.id}`;

  const uploadPhoto = async (file: File) => {
    const path = `${basePath}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    if (note.photo_path) await supabase.storage.from("photos").remove([note.photo_path]);
    await supabase.from("pa_notes").update({ photo_path: path }).eq("id", note.id);
    onReload();
  };
  const uploadFile = async (file: File) => {
    const path = `${basePath}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(error.message); return; }
    if (note.file_path) await supabase.storage.from("files").remove([note.file_path]);
    await supabase.from("pa_notes").update({ file_path: path, file_name: file.name }).eq("id", note.id);
    onReload();
  };
  const removePhoto = async () => {
    if (note.photo_path) await supabase.storage.from("photos").remove([note.photo_path]);
    await supabase.from("pa_notes").update({ photo_path: null }).eq("id", note.id);
    onReload();
  };
  const removeFile = async () => {
    if (note.file_path) await supabase.storage.from("files").remove([note.file_path]);
    await supabase.from("pa_notes").update({ file_path: null, file_name: null }).eq("id", note.id);
    onReload();
  };

  return (
    <li className="rounded-md border bg-card">
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
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
    </li>
  );
}

function NotePhoto({ path, canEdit, onRemove }: { path: string; canEdit: boolean; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("photos").createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  }, [path]);
  return (
    <div className="relative">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          <img src={url} alt="" className="max-h-40 w-full rounded border object-cover" />
        </a>
      ) : (
        <div className="h-24 animate-pulse rounded bg-muted" />
      )}
      {canEdit && (
        <button onClick={onRemove}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function NoteFile({ path, name, canEdit, onRemove }: { path: string | null; name: string; canEdit: boolean; onRemove: () => void }) {
  const open = async () => {
    if (!path) return;
    const { data } = await supabase.storage.from("files").createSignedUrl(path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };
  return (
    <div className="flex items-center gap-1 rounded border bg-muted/30 px-2 py-1 text-xs">
      <button onClick={open} className="flex flex-1 items-center gap-1 text-left hover:underline">
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
