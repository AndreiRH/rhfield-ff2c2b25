import { useEffect, useState, type MouseEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus, Trash2, Camera, Paperclip, GripVertical, ChevronDown, ChevronRight,
  ClipboardPaste, Check, ChevronsDownUp, ChevronsUpDown, Copy, X,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";
import { PhotoTile, FileChip } from "@/components/ChecklistTree";
import { TreeActionProvider, useTreeAction } from "@/components/TreeAction";
import {
  useClipboard, buildSettingClipMany, pasteSetting,
} from "@/lib/clipboard";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

interface SettingPhoto { id: string; storage_path: string }
interface SettingFile { id: string; storage_path: string; file_name: string }
interface Setting {
  id: string;
  plant_equipment_id: string;
  title: string;
  body: string;
  sort_order: number;
  setting_photos: SettingPhoto[];
  setting_files: SettingFile[];
}

export function SettingsList(props: { equipmentId: string; canEdit: boolean; userId?: string }) {
  return (
    <TreeActionProvider>
      <SettingsListInner {...props} />
    </TreeActionProvider>
  );
}

function SettingsListInner({
  equipmentId, canEdit, userId,
}: { equipmentId: string; canEdit: boolean; userId?: string }) {
  const [rows, setRows] = useState<Setting[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const { clip, set: setClip, clear: clearClip } = useClipboard();
  const action = useTreeAction()!;
  const inMode = action.mode !== "none";

  const load = async () => {
    const { data } = await supabase
      .from("equipment_settings")
      .select("*, setting_photos(id, storage_path), setting_files(id, storage_path, file_name)")
      .eq("plant_equipment_id", equipmentId)
      .is("deleted_at", null)
      .order("sort_order").order("created_at");
    setRows(((data ?? []) as unknown) as Setting[]);
  };
  useEffect(() => { load(); }, [equipmentId]);

  const addRow = async () => {
    const { error } = await supabase.from("equipment_settings").insert({
      plant_equipment_id: equipmentId, title: "Setting", body: "",
      sort_order: rows.length, created_by: userId,
    });
    if (error) toast.error(error.message); else load();
  };

  const updateTitle = (id: string, title: string) => {
    setRows((n) => n.map((x) => (x.id === id ? { ...x, title } : x)));
    supabase.from("equipment_settings").update({ title }).eq("id", id).then();
  };
  const updateBody = (id: string, body: string) => {
    setRows((n) => n.map((x) => (x.id === id ? { ...x, body } : x)));
    supabase.from("equipment_settings").update({ body }).eq("id", id).then();
  };

  const removeOne = async (s: Setting) => {
    for (const p of s.setting_photos ?? []) {
      await supabase.storage.from("photos").remove([p.storage_path]);
    }
    for (const f of s.setting_files ?? []) {
      await supabase.storage.from("files").remove([f.storage_path]);
    }
    await supabase.from("equipment_settings")
      .update({ deleted_at: new Date().toISOString() }).eq("id", s.id);
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

  const allOpen = openIds.size === rows.length && rows.length > 0;
  const toggleAll = () => setOpenIds(allOpen ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const pasteHere = async () => {
    if (clip?.kind !== "setting") return;
    try {
      await pasteSetting(clip, { plant_equipment_id: equipmentId, sort_order: rows.length, created_by: userId });
      clearClip();
      toast.success("Pasted"); load();
    } catch (e: any) { toast.error(e.message ?? "Paste failed"); }
  };

  const confirmCopy = () => {
    const selected = Array.from(action.selection.values()).map((s) => s.payload as Setting);
    if (selected.length === 0) { action.setMode("none"); return; }
    setClip(buildSettingClipMany(selected));
    action.setMode("none");
  };
  const confirmDelete = async () => {
    const selected = Array.from(action.selection.values()).map((s) => s.payload as Setting);
    for (const s of selected) await removeOne(s);
    action.setMode("none");
    load();
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {canEdit && (
          <div className="flex flex-wrap items-center justify-end gap-1">
            {clip?.kind === "setting" && !inMode && (
              <Button size="sm" variant="outline" onClick={pasteHere}
                title={`Paste ${clip.nodes.length} setting${clip.nodes.length > 1 ? "s" : ""}`}>
                <ClipboardPaste className="mr-1 h-4 w-4" /> Paste
                {clip.nodes.length > 1 ? ` ${clip.nodes.length}` : ""}
              </Button>
            )}
            {!inMode && (
              <Button size="sm" onClick={addRow}>
                <Plus className="mr-1 h-4 w-4" /> Add setting
              </Button>
            )}
            {rows.length > 0 && !inMode && (
              <Button size="sm" variant="outline" onClick={toggleAll}
                title={allOpen ? "Collapse all" : "Expand all"} aria-label={allOpen ? "Collapse all" : "Expand all"}>
                {allOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
              </Button>
            )}
            {rows.length > 0 && (
              <Button size="sm"
                variant={action.mode === "copy" ? "default" : "outline"}
                onClick={() => {
                  if (action.mode === "copy") confirmCopy();
                  else action.setMode("copy");
                }}
                title={action.mode === "copy" ? "Copy selected" : "Copy"}
                aria-label="Copy">
                <Copy className="h-4 w-4" />
                {action.mode === "copy" && action.count > 0 && <span className="ml-1 text-xs">{action.count}</span>}
              </Button>
            )}
            {rows.length > 0 && (
              <Button size="sm"
                variant={action.mode === "delete" ? "destructive" : "outline"}
                onClick={() => {
                  if (action.mode === "delete") confirmDelete();
                  else action.setMode("delete");
                }}
                title={action.mode === "delete" ? "Delete selected" : "Delete"}
                aria-label="Delete">
                <Trash2 className="h-4 w-4" />
                {action.mode === "delete" && action.count > 0 && <span className="ml-1 text-xs">{action.count}</span>}
              </Button>
            )}
            {inMode && (
              <Button size="sm" variant="ghost" onClick={() => action.setMode("none")}
                title="Cancel" aria-label="Cancel">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}

        {inMode && (
          <p className={`rounded-md border px-3 py-2 text-xs ${action.mode === "delete" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/30 bg-primary/5 text-primary"}`}>
            Tap settings to {action.mode === "delete" ? "delete" : "copy"}, then tap the {action.mode === "delete" ? "trash" : "copy"} icon again.
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
                    key={s.id} setting={s} canEdit={canEdit}
                    open={openIds.has(s.id)}
                    onToggleOpen={() => toggleOpen(s.id)}
                    onTitle={(t: string) => updateTitle(s.id, t)}
                    onBody={(b: string) => updateBody(s.id, b)}
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
  setting, canEdit, open, onToggleOpen, onTitle, onBody, onReload,
}: {
  setting: Setting; canEdit: boolean; open: boolean;
  onToggleOpen: () => void;
  onTitle: (t: string) => void;
  onBody: (b: string) => void;
  onReload: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: setting.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const action = useTreeAction()!;
  const mode = action.mode;
  const inMode = mode !== "none";
  const selected = action.isSelected(setting.id);

  const [title, setTitle] = useState(setting.title);
  const [body, setBody] = useState(setting.body);
  useEffect(() => { setTitle(setting.title); setBody(setting.body); }, [setting.title, setting.body]);
  const [editingTitle, setEditingTitle] = useState(false);

  const photos = setting.setting_photos ?? [];
  const files = setting.setting_files ?? [];

  const uploadPhoto = async (file: File) => {
    const path = `equipment-settings/${setting.plant_equipment_id}/${setting.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("setting_photos").insert({ equipment_setting_id: setting.id, storage_path: path });
    onReload();
  };
  const uploadFile = async (file: File) => {
    const path = `equipment-settings/${setting.plant_equipment_id}/${setting.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("setting_files").insert({ equipment_setting_id: setting.id, storage_path: path, file_name: file.name });
    onReload();
  };
  const removePhoto = async (p: SettingPhoto) => {
    await supabase.storage.from("photos").remove([p.storage_path]);
    await supabase.from("setting_photos").delete().eq("id", p.id);
    onReload();
  };
  const removeFile = async (f: SettingFile) => {
    await supabase.storage.from("files").remove([f.storage_path]);
    await supabase.from("setting_files").delete().eq("id", f.id);
    onReload();
  };

  const onRowClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (inMode) action.toggle(setting.id, { kind: "setting", payload: setting });
    else onToggleOpen();
  };

  return (
    <li ref={setNodeRef} style={style}
      className={`rounded-md border bg-card ${
        mode === "delete" ? (selected ? "border-destructive" : "border-destructive/40") :
        mode === "copy" ? (selected ? "border-primary" : "border-primary/40") : ""
      }`}>
      <div
        className={`flex items-center gap-1 border-b bg-muted/40 px-2 py-1 cursor-pointer ${
          mode === "delete" ? (selected ? "bg-destructive/15" : "bg-destructive/5 hover:bg-destructive/10") :
          mode === "copy" ? (selected ? "bg-primary/15" : "bg-primary/5 hover:bg-primary/10") : ""
        }`}
        onClick={onRowClick}
      >
        {canEdit && !inMode && (
          <button {...attributes} {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        {!inMode && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggleOpen(); }}
            className="p-1 text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
        {inMode && (
          <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${selected ? (mode === "delete" ? "border-destructive bg-destructive text-destructive-foreground" : "border-primary bg-primary text-primary-foreground") : "border-muted-foreground/30"}`}>
            {selected && <Check className="h-2.5 w-2.5" />}
          </span>
        )}
        {!inMode && open && editingTitle && canEdit ? (
          <Input
            value={title} autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { setEditingTitle(false); if (title !== setting.title) onTitle(title); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              else if (e.key === "Escape") { setTitle(setting.title); setEditingTitle(false); }
            }}
            className="h-7 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
          />
        ) : (
          <button type="button"
            onClick={(e) => { e.stopPropagation(); if (!inMode) onToggleOpen(); }}
            onDoubleClick={(e) => { e.stopPropagation(); if (!inMode && canEdit) { if (!open) onToggleOpen(); setEditingTitle(true); } }}
            className="flex flex-1 items-center gap-2 truncate px-1 text-left text-sm font-medium">
            <span className="truncate">{setting.title || "Untitled"}</span>
            {!open && setting.body && (
              <span className="truncate text-xs font-normal text-muted-foreground">— {setting.body}</span>
            )}
            {!open && photos.length > 0 && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                <Camera className="h-3 w-3" /> {photos.length}
              </span>
            )}
            {!open && files.length > 0 && (
              <span className="inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                <Paperclip className="h-3 w-3" /> {files.length}
              </span>
            )}
          </button>
        )}
      </div>
      {open && !inMode && (
        <div className="space-y-2 p-3">
          <Textarea
            value={body}
            disabled={!canEdit}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => body !== setting.body && onBody(body)}
            placeholder="Value (local to this line)…"
            className="min-h-[60px] resize-y text-sm"
          />
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-1">
              {photos.map((p) => (
                <PhotoTile key={p.id} path={p.storage_path} canEdit={canEdit} onRemove={() => removePhoto(p)} />
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f) => (
                <FileChip key={f.id} f={f} canEdit={canEdit} onRemove={() => removeFile(f)} />
              ))}
            </div>
          )}
          {canEdit && (
            <div className="flex items-center gap-2">
              <PhotoPicker onPick={uploadPhoto}>
                <button title="Add photo"
                  className="inline-flex items-center justify-center rounded border border-dashed p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Camera className="h-4 w-4" />
                </button>
              </PhotoPicker>
              <label title="Add file"
                className="inline-flex cursor-pointer items-center justify-center rounded border border-dashed p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                <Paperclip className="h-4 w-4" />
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
