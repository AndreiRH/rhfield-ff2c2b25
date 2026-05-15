import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus, Trash2, Camera, Paperclip, GripVertical, X, ChevronDown, ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface Setting {
  id: string;
  plant_equipment_id: string;
  title: string;
  body: string;
  sort_order: number;
  photo_path: string | null;
  file_path: string | null;
  file_name: string | null;
}

export function SettingsList({
  equipmentId, canEdit, userId,
}: { equipmentId: string; canEdit: boolean; userId?: string }) {
  const [rows, setRows] = useState<Setting[]>([]);
  const [deleteMode, setDeleteMode] = useState(false);

  const load = async () => {
    const { data } = await supabase
      .from("equipment_settings").select("*")
      .eq("plant_equipment_id", equipmentId)
      .is("deleted_at", null)
      .order("sort_order").order("created_at");
    setRows((data ?? []) as Setting[]);
  };
  useEffect(() => { load(); }, [equipmentId]);

  const addRow = async () => {
    const { error } = await supabase.from("equipment_settings").insert({
      plant_equipment_id: equipmentId, title: "Setting", body: "",
      sort_order: rows.length, created_by: userId,
    });
    if (error) toast.error(error.message); else load();
  };

  // Title updates propagate via DB trigger. Local-only fields update only this row.
  const updateTitle = (id: string, title: string) => {
    setRows((n) => n.map((x) => (x.id === id ? { ...x, title } : x)));
    supabase.from("equipment_settings").update({ title }).eq("id", id).then();
  };
  const updateLocal = (id: string, patch: Partial<Setting>) => {
    setRows((n) => n.map((x) => (x.id === id ? { ...x, ...patch } : x)));
    supabase.from("equipment_settings").update(patch).eq("id", id).then();
  };

  const remove = async (s: Setting) => {
    if (s.photo_path) await supabase.storage.from("photos").remove([s.photo_path]);
    if (s.file_path) await supabase.storage.from("files").remove([s.file_path]);
    // Soft-delete; trigger propagates deleted_at to siblings.
    await supabase.from("equipment_settings")
      .update({ deleted_at: new Date().toISOString() }).eq("id", s.id);
    load();
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );
  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = rows.findIndex((n) => n.id === active.id);
    const newIdx = rows.findIndex((n) => n.id === over.id);
    const next = arrayMove(rows, oldIdx, newIdx);
    setRows(next);
    await Promise.all(
      next.map((n, i) => supabase.from("equipment_settings").update({ sort_order: i }).eq("id", n.id)),
    );
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {canEdit && (
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={addRow}>
              <Plus className="mr-1 h-4 w-4" /> Add setting
            </Button>
            <Button
              size="sm"
              variant={deleteMode ? "destructive" : "outline"}
              disabled={rows.length === 0}
              onClick={() => setDeleteMode((d) => !d)}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {deleteMode ? "Done" : "Delete"}
            </Button>
          </div>
        )}

        {deleteMode && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Tap a setting's trash icon to delete it across all lines. Tap "Done" to exit.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Setting titles are shared across all lines. Values, photos and files are local to this line.
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No settings yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={rows.map((n) => n.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-2">
                {rows.map((s) => (
                  <SettingRow
                    key={s.id} setting={s} canEdit={canEdit} deleteMode={deleteMode}
                    onTitle={(t) => updateTitle(s.id, t)}
                    onLocal={(p) => updateLocal(s.id, p)}
                    onDelete={() => remove(s)}
                    onReload={load}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
    </Card>
  );
}

function SettingRow({
  setting, canEdit, deleteMode, onTitle, onLocal, onDelete, onReload,
}: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: setting.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(setting.title);
  const [body, setBody] = useState(setting.body);
  useEffect(() => { setTitle(setting.title); setBody(setting.body); }, [setting.title, setting.body]);

  const uploadPhoto = async (file: File) => {
    const path = `equipment-settings/${setting.plant_equipment_id}/${setting.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    if (setting.photo_path) await supabase.storage.from("photos").remove([setting.photo_path]);
    await supabase.from("equipment_settings").update({ photo_path: path }).eq("id", setting.id);
    onReload();
  };
  const uploadFile = async (file: File) => {
    const path = `equipment-settings/${setting.plant_equipment_id}/${setting.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(error.message); return; }
    if (setting.file_path) await supabase.storage.from("files").remove([setting.file_path]);
    await supabase.from("equipment_settings").update({ file_path: path, file_name: file.name }).eq("id", setting.id);
    onReload();
  };
  const removePhoto = async () => {
    if (setting.photo_path) await supabase.storage.from("photos").remove([setting.photo_path]);
    await supabase.from("equipment_settings").update({ photo_path: null }).eq("id", setting.id);
    onReload();
  };
  const removeFile = async () => {
    if (setting.file_path) await supabase.storage.from("files").remove([setting.file_path]);
    await supabase.from("equipment_settings").update({ file_path: null, file_name: null }).eq("id", setting.id);
    onReload();
  };

  const hasPhoto = !!setting.photo_path;
  const hasFile = !!setting.file_name;

  return (
    <li ref={setNodeRef} style={style} className="rounded-md border bg-card">
      <div className="flex items-center gap-1 border-b bg-muted/40 px-2 py-1">
        {canEdit && !deleteMode && (
          <button {...attributes} {...listeners} className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <button type="button" onClick={() => setOpen((o) => !o)}
          className="p-1 text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {open ? (
          <Input
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== setting.title && onTitle(title)}
            className="h-7 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
          />
        ) : (
          <button type="button" onClick={() => setOpen(true)}
            className="flex flex-1 items-center gap-2 truncate px-1 text-left text-sm font-medium">
            <span className="truncate">{setting.title || "Untitled"}</span>
            {setting.body && (
              <span className="truncate text-xs font-normal text-muted-foreground">— {setting.body}</span>
            )}
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
        {canEdit && deleteMode && (
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
            onBlur={() => body !== setting.body && onLocal({ body })}
            placeholder="Value (local to this line)…"
            className="min-h-[60px] resize-y text-sm"
          />
          {setting.photo_path && <SettingPhoto path={setting.photo_path} canEdit={canEdit} onRemove={removePhoto} />}
          {setting.file_name && <SettingFile path={setting.file_path} name={setting.file_name} canEdit={canEdit} onRemove={removeFile} />}
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

function SettingPhoto({ path, canEdit, onRemove }: { path: string; canEdit: boolean; onRemove: () => void }) {
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

function SettingFile({ path, name, canEdit, onRemove }:
  { path: string | null; name: string; canEdit: boolean; onRemove: () => void }) {
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
