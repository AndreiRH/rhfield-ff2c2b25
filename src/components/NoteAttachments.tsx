import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Camera, Paperclip, X, Share2, Lock } from "lucide-react";
import { toast } from "sonner";
import { toUserMessage } from "@/lib/errors";
import { PhotoPicker } from "@/components/PhotoPicker";
import { StoragePhoto, openStorageFile } from "@/components/StoragePhoto";
import { rememberLocalFile } from "@/lib/local-blobs";
import { confirmSharedDelete } from "@/lib/confirm-shared-delete";

export type NoteParentKind =
  | "item_note"
  | "equipment_note"
  | "calendar_note"
  | "common_folder_note"
  | "pa_note";

export interface NotePhoto {
  id: string;
  parent_kind: string;
  parent_id: string;
  storage_path: string;
  sort_order: number;
  is_shared: boolean;
}
export interface NoteFile {
  id: string;
  parent_kind: string;
  parent_id: string;
  storage_path: string;
  file_name: string;
  sort_order: number;
  is_shared: boolean;
}

/**
 * Reusable multi-photo + multi-file attachments for any note kind.
 * Photos and files are stored polymorphically in `note_photos` / `note_files`
 * keyed by (parent_kind, parent_id).
 */
export function NoteAttachments({
  parentKind,
  parentId,
  storagePrefix,
  canEdit,
  userId,
  defaultShared = false,
  showSharedToggle = true,
  onCountsChange,
}: {
  parentKind: NoteParentKind;
  parentId: string;
  storagePrefix: string;
  canEdit: boolean;
  userId?: string;
  defaultShared?: boolean;
  showSharedToggle?: boolean;
  onCountsChange?: (counts: { photos: number; files: number }) => void;
}) {
  const [photos, setPhotos] = useState<NotePhoto[]>([]);
  const [files, setFiles] = useState<NoteFile[]>([]);

  const load = async () => {
    const [{ data: ph }, { data: fl }] = await Promise.all([
      supabase
        .from("note_photos" as any).select("*")
        .eq("parent_kind", parentKind).eq("parent_id", parentId)
        .order("sort_order").order("uploaded_at"),
      supabase
        .from("note_files" as any).select("*")
        .eq("parent_kind", parentKind).eq("parent_id", parentId)
        .order("sort_order").order("uploaded_at"),
    ]);
    const nextPhotos = (ph ?? []) as NotePhoto[];
    const nextFiles = (fl ?? []) as NoteFile[];
    setPhotos(nextPhotos);
    setFiles(nextFiles);
    onCountsChange?.({ photos: nextPhotos.length, files: nextFiles.length });
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [parentKind, parentId]);

  const uploadPhoto = async (file: File) => {
    const path = `${storagePrefix}/${Date.now()}-${file.name}`;
    rememberLocalFile("photos", path, file);
    const { error: upErr } = await supabase.storage.from("photos").upload(path, file);
    if (upErr) { toast.error(toUserMessage(upErr)); return; }
    const { error } = await supabase.from("note_photos" as any).insert({
      parent_kind: parentKind, parent_id: parentId, storage_path: path,
      sort_order: photos.length, is_shared: defaultShared, uploaded_by: userId,
    } as any);
    if (error) toast.error(toUserMessage(error));
    load();
  };
  const uploadFile = async (file: File) => {
    const path = `${storagePrefix}/${Date.now()}-${file.name}`;
    rememberLocalFile("files", path, file);
    const { error: upErr } = await supabase.storage.from("files").upload(path, file);
    if (upErr) { toast.error(toUserMessage(upErr)); return; }
    const { error } = await supabase.from("note_files" as any).insert({
      parent_kind: parentKind, parent_id: parentId, storage_path: path, file_name: file.name,
      sort_order: files.length, is_shared: defaultShared, uploaded_by: userId,
    } as any);
    if (error) toast.error(toUserMessage(error));
    load();
  };
  const removePhoto = async (p: NotePhoto) => {
    if (!confirmSharedDelete(!!p.is_shared)) return;
    await supabase.storage.from("photos").remove([p.storage_path]);
    await supabase.from("note_photos" as any).delete().eq("id", p.id);
    load();
  };
  const removeFile = async (f: NoteFile) => {
    if (!confirmSharedDelete(!!f.is_shared)) return;
    await supabase.storage.from("files").remove([f.storage_path]);
    await supabase.from("note_files" as any).delete().eq("id", f.id);
    load();
  };
  const toggleSharedPhoto = async (p: NotePhoto) => {
    await supabase.from("note_photos" as any).update({ is_shared: !p.is_shared }).eq("id", p.id);
    load();
  };
  const toggleSharedFile = async (f: NoteFile) => {
    await supabase.from("note_files" as any).update({ is_shared: !f.is_shared }).eq("id", f.id);
    load();
  };

  const photoGallery = photos.map((p) => ({ bucket: "photos", path: p.storage_path }));

  return (
    <div className="space-y-2">
      {photos.length > 0 && (
        <div className="grid grid-cols-3 gap-1">
          {photos.map((p) => (
            <div key={p.id} className="relative">
              <StoragePhoto
                bucket="photos"
                path={p.storage_path}
                imgClassName="h-20 w-full rounded border object-cover"
                canEdit={canEdit}
                onRemove={() => removePhoto(p)}
                gallery={photoGallery as any}
              />
              {canEdit && showSharedToggle && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); toggleSharedPhoto(p); }}
                  title={p.is_shared ? "Shared — click to make local" : "Local — click to share"}
                  className={`absolute left-1 top-1 rounded bg-background/80 p-0.5 backdrop-blur ${p.is_shared ? "text-primary" : "text-muted-foreground"}`}
                >
                  {p.is_shared ? <Share2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.id} className="flex items-center gap-1 rounded border bg-muted/30 px-2 py-1 text-xs">
              <button onClick={() => openStorageFile("files", f.storage_path, f.file_name)}
                className="flex min-w-0 flex-1 items-center gap-1 text-left hover:underline">
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="truncate">{f.file_name}</span>
              </button>
              {canEdit && showSharedToggle && (
                <button type="button" onClick={() => toggleSharedFile(f)}
                  title={f.is_shared ? "Shared — click to make local" : "Local — click to share"}
                  className={`shrink-0 inline-flex h-6 w-6 items-center justify-center rounded ${f.is_shared ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {f.is_shared ? <Share2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
                </button>
              )}
              {canEdit && (
                <button onClick={() => removeFile(f)} className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded text-destructive hover:opacity-80">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="flex gap-2">
          <PhotoPicker onPick={uploadPhoto}>
            <button type="button" className="inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-accent">
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
  );
}
