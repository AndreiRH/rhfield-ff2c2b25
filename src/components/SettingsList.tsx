import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, Camera, Paperclip, GripVertical, ChevronDown, ChevronRight,
  ClipboardPaste, Check, ChevronsDownUp, ChevronsUpDown, Copy, X,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";
import { PhotoTile, FileChip } from "@/components/ChecklistTree";
import { rememberLocalFile } from "@/lib/local-blobs";
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
import { useAuth } from "@/hooks/use-auth";
import { logSetting } from "@/lib/settingLogs";

interface SettingPhoto { id: string; storage_path: string }
interface SettingFile { id: string; storage_path: string; file_name: string }
interface Setting {
  id: string;
  plant_equipment_id: string;
  title: string;
  body: string;
  sort_order: number;
  group_name: string | null;
  setting_photos: SettingPhoto[];
  setting_files: SettingFile[];
}

export function SettingsList(props: { equipmentId: string; canEdit: boolean; userId?: string; lineCount?: number }) {
  return (
    <TreeActionProvider>
      <SettingsListInner {...props} />
    </TreeActionProvider>
  );
}

function SettingsListInner({
  equipmentId, canEdit, userId, lineCount,
}: { equipmentId: string; canEdit: boolean; userId?: string; lineCount?: number }) {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Setting[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const { clip, set: setClip, clear: clearClip, lockTo } = useClipboard();
  const settingPasteLocationKey = `setting:${equipmentId}`;
  const action = useTreeAction()!;
  const inMode = action.mode !== "none";
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

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
    const { data, error } = await supabase.from("equipment_settings").insert({
      plant_equipment_id: equipmentId, title: "Setting", body: "",
      sort_order: rows.length, created_by: userId,
    }).select("id, title").single();
    if (error) { toast.error(error.message); return; }
    await logSetting({
      plant_equipment_id: equipmentId,
      equipment_setting_id: data?.id, setting_title: data?.title ?? "Setting",
      action: "created", user_id: userId,
    });
    load();
  };

  const updateTitle = (id: string, title: string) => {
    const prev = rows.find((x) => x.id === id);
    const oldTitle = prev?.title ?? "";
    setRows((n) => n.map((x) => (x.id === id ? { ...x, title } : x)));
    supabase.from("equipment_settings").update({ title }).eq("id", id).then(() => {
      if (oldTitle !== title) logSetting({
        plant_equipment_id: equipmentId, equipment_setting_id: id, setting_title: title,
        action: "title_changed", old_value: oldTitle, new_value: title, user_id: userId,
      });
    });
  };
  const updateBody = (id: string, body: string) => {
    const prev = rows.find((x) => x.id === id);
    const oldBody = prev?.body ?? "";
    const title = prev?.title ?? "";
    setRows((n) => n.map((x) => (x.id === id ? { ...x, body } : x)));
    supabase.from("equipment_settings").update({ body }).eq("id", id).then(() => {
      if (oldBody !== body) logSetting({
        plant_equipment_id: equipmentId, equipment_setting_id: id, setting_title: title,
        action: "value_changed", old_value: oldBody, new_value: body, user_id: userId,
      });
    });
  };
  const updateGroup = (id: string, group: string) => {
    const g = group.trim() === "" ? null : group.trim();
    setRows((n) => n.map((x) => (x.id === id ? { ...x, group_name: g } : x)));
    supabase.from("equipment_settings").update({ group_name: g }).eq("id", id).then(({ error }) => {
      if (error) toast.error(error.message);
    });
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
    await logSetting({
      plant_equipment_id: equipmentId, equipment_setting_id: s.id, setting_title: s.title,
      action: "deleted", old_value: s.body, user_id: userId,
    });
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
      lockTo(settingPasteLocationKey);
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
    if (selected.length === 0) { action.setMode("none"); return; }
    setConfirmDeleteOpen(true);
  };

  const performDelete = async () => {
    const selected = Array.from(action.selection.values()).map((s) => s.payload as Setting);
    for (const s of selected) await removeOne(s);
    setConfirmDeleteOpen(false);
    action.setMode("none");
    load();
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEdit && (
          <>
            {clip?.kind === "setting" && !inMode && (!clip.lockedAt || clip.lockedAt === settingPasteLocationKey) && (
              <Button size="sm" variant="outline" onClick={pasteHere}
                title={`Paste ${clip.nodes.length} setting${clip.nodes.length > 1 ? "s" : ""}`}
                aria-label="Paste">
                <ClipboardPaste className="h-4 w-4" />
                {clip.nodes.length > 1 ? <span className="ml-1">{clip.nodes.length}</span> : null}
              </Button>
            )}
            {rows.length > 0 && !inMode && (
              <Button size="sm" variant="outline" className="mr-auto" onClick={toggleAll}
                title={allOpen ? "Collapse all" : "Expand all"} aria-label={allOpen ? "Collapse all" : "Expand all"}>
                {allOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
              </Button>
            )}
            {rows.length > 0 && (
              <Button size="sm"
                variant={action.mode === "reorder" ? "default" : "outline"}
                onClick={() => action.setMode(action.mode === "reorder" ? "none" : "reorder")}
                title="Reorder" aria-label="Reorder">
                <GripVertical className="h-4 w-4" />
                {action.mode === "reorder" && <span className="ml-1 text-xs">Done</span>}
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
                {action.mode === "copy" && <span className="ml-1 text-xs">Done{action.count > 0 ? ` ${action.count}` : ""}</span>}
              </Button>
            )}
            {rows.length > 0 && isAdmin && (
              <Button size="sm"
                variant={action.mode === "delete" ? "destructive" : "outline"}
                onClick={() => {
                  if (action.mode === "delete") confirmDelete();
                  else action.setMode("delete");
                }}
                title={action.mode === "delete" ? "Delete selected" : "Delete"}
                aria-label="Delete">
                <Trash2 className="h-4 w-4" />
                {action.mode === "delete" && <span className="ml-1 text-xs">Done{action.count > 0 ? ` ${action.count}` : ""}</span>}
              </Button>
            )}
            {inMode && (
              <Button size="sm" variant="ghost" onClick={() => action.setMode("none")}
                title="Cancel" aria-label="Cancel">
                <X className="h-4 w-4" />
              </Button>
            )}
            {!inMode && (
              <Button size="sm" onClick={addRow} title="Add setting" aria-label="Add setting">
                <Plus className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Add setting</span>
              </Button>
            )}
          </>
          )}
        </div>

        {(action.mode === "delete" || action.mode === "copy") && (
          <p className={`rounded-md border px-3 py-2 text-xs ${action.mode === "delete" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/30 bg-primary/5 text-primary"}`}>
            Tap settings to {action.mode === "delete" ? "delete" : "copy"}, then tap the {action.mode === "delete" ? "trash" : "copy"} icon again.
          </p>
        )}
        {action.mode === "reorder" && (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
            Drag the handle on each setting to reorder. Tap "Done" when finished.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Setting titles are shared across all production lines. Values, photos and files are local to this production line.
        </p>

        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No settings yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SettingsGroupedList
              rows={rows}
              renderRow={(s) => (
                <SettingRow
                  key={s.id} setting={s} canEdit={canEdit}
                  open={openIds.has(s.id)}
                  onToggleOpen={() => toggleOpen(s.id)}
                  onTitle={(t: string) => updateTitle(s.id, t)}
                  onBody={(b: string) => updateBody(s.id, b)}
                  onGroup={(g: string) => updateGroup(s.id, g)}
                  onReload={load}
                  plantEquipmentId={equipmentId}
                  userId={userId}
                />
              )}
            />
          </DndContext>
        )}
      </CardContent>
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {action.count} setting{action.count > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the selected setting names from <strong>all {lineCount ?? 10} production lines</strong>.
              Values, photos, and files attached to the selected settings on this line will also be removed.
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
    </Card>
  );
}

function SettingRow({
  setting, canEdit, open, onToggleOpen, onTitle, onBody, onGroup, onReload, plantEquipmentId, userId,
}: {
  setting: Setting; canEdit: boolean; open: boolean;
  onToggleOpen: () => void;
  onTitle: (t: string) => void;
  onBody: (b: string) => void;
  onGroup: (g: string) => void;
  onReload: () => void;
  plantEquipmentId: string;
  userId?: string;
}) {
  const action = useTreeAction()!;
  const mode = action.mode;
  const inMode = mode !== "none";
  const inSelectMode = mode === "delete" || mode === "copy";
  const inReorder = mode === "reorder";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: setting.id, disabled: !inReorder });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const selected = action.isSelected(setting.id);

  const [title, setTitle] = useState(setting.title);
  const [body, setBody] = useState(setting.body);
  const [groupDraft, setGroupDraft] = useState(setting.group_name ?? "");
  useEffect(() => { setTitle(setting.title); setBody(setting.body); setGroupDraft(setting.group_name ?? ""); }, [setting.title, setting.body, setting.group_name]);
  const [editingTitle, setEditingTitle] = useState(false);

  const photos = setting.setting_photos ?? [];
  const files = setting.setting_files ?? [];
  const [showPhotos, setShowPhotos] = useState(false);
  const [showFiles, setShowFiles] = useState(false);

  const uploadPhoto = async (file: File) => {
    const path = `equipment-settings/${setting.plant_equipment_id}/${setting.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("photos", path, file);
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("setting_photos").insert({ equipment_setting_id: setting.id, storage_path: path });
    await logSetting({ plant_equipment_id: plantEquipmentId, equipment_setting_id: setting.id, setting_title: setting.title, action: "photo_added", new_value: file.name, user_id: userId });
    onReload();
  };
  const uploadFile = async (file: File) => {
    const path = `equipment-settings/${setting.plant_equipment_id}/${setting.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("files", path, file);
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("setting_files").insert({ equipment_setting_id: setting.id, storage_path: path, file_name: file.name });
    await logSetting({ plant_equipment_id: plantEquipmentId, equipment_setting_id: setting.id, setting_title: setting.title, action: "file_added", new_value: file.name, user_id: userId });
    onReload();
  };
  const removePhoto = async (p: SettingPhoto) => {
    const { error } = await supabase.from("setting_photos").delete().eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    await logSetting({ plant_equipment_id: plantEquipmentId, equipment_setting_id: setting.id, setting_title: setting.title, action: "photo_deleted", old_value: p.storage_path.split("/").pop() ?? null, user_id: userId });
    onReload();
    let undone = false;
    toast.success("Photo deleted", {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          undone = true;
          const { error: undoError } = await supabase.from("setting_photos")
            .insert({ id: p.id, equipment_setting_id: setting.id, storage_path: p.storage_path });
          if (undoError) toast.error(undoError.message); else onReload();
        },
      },
    });
    setTimeout(async () => {
      if (!undone) await supabase.storage.from("photos").remove([p.storage_path]);
    }, 3500);
  };
  const removeFile = async (f: SettingFile) => {
    const { error } = await supabase.from("setting_files").delete().eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    await logSetting({ plant_equipment_id: plantEquipmentId, equipment_setting_id: setting.id, setting_title: setting.title, action: "file_deleted", old_value: f.file_name, user_id: userId });
    onReload();
    let undone = false;
    toast.success("File deleted", {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          undone = true;
          const { error: undoError } = await supabase.from("setting_files")
            .insert({ id: f.id, equipment_setting_id: setting.id, storage_path: f.storage_path, file_name: f.file_name });
          if (undoError) toast.error(undoError.message); else onReload();
        },
      },
    });
    setTimeout(async () => {
      if (!undone) await supabase.storage.from("files").remove([f.storage_path]);
    }, 3500);
  };

  const onRowClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (inSelectMode) action.toggle(setting.id, { kind: "setting", payload: setting });
    else if (!inReorder) onToggleOpen();
  };

  return (
    <li ref={setNodeRef} style={style}
      data-nest
      className={`rounded-md border bg-card ${
        mode === "delete" ? (selected ? "border-destructive" : "border-destructive/40") :
        mode === "copy" ? (selected ? "border-primary" : "border-primary/40") : ""
      }`}>
      <div
        className={`flex items-center gap-1 border-b bg-muted/40 px-2 py-1 ${inReorder ? "" : "cursor-pointer"} ${
          mode === "delete" ? (selected ? "bg-destructive/15" : "bg-destructive/5 hover:bg-destructive/10") :
          mode === "copy" ? (selected ? "bg-primary/15" : "bg-primary/5 hover:bg-primary/10") : ""
        }`}
        onClick={onRowClick}
      >
        {canEdit && inReorder && (
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
        {inSelectMode && (
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
            onClick={(e) => {
              e.stopPropagation();
              if (inSelectMode) action.toggle(setting.id, { kind: "setting", payload: setting });
            }}
            onDoubleClick={(e) => { e.stopPropagation(); if (!inMode && canEdit) { if (!open) onToggleOpen(); setEditingTitle(true); } }}
            className="flex flex-1 items-center gap-2 truncate px-1 text-left text-sm font-medium cursor-default">
            <span className="truncate">{setting.title || "Untitled"}</span>
            {!open && setting.body && (
              <span className="truncate text-xs font-normal text-muted-foreground">— {setting.body}</span>
            )}
            {!open && photos.length > 0 && (
              <span className="ml-auto inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                <Camera className="h-3 w-3" /> {photos.length}
              </span>
            )}
            {!open && files.length > 0 && (
              <span className={`${photos.length > 0 ? "" : "ml-auto"} inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground`}>
                <Paperclip className="h-3 w-3" /> {files.length}
              </span>
            )}
          </button>
        )}
      </div>
      {open && !inMode && (
        <div className="space-y-2 p-3">
          {canEdit && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Group</span>
              <Input
                value={groupDraft}
                onChange={(e) => setGroupDraft(e.target.value)}
                onBlur={() => {
                  const next = groupDraft.trim();
                  const cur = setting.group_name ?? "";
                  if (next !== cur) onGroup(next);
                }}
                placeholder="(none)"
                className="h-6 flex-1 max-w-[200px] border-0 bg-transparent px-1 text-xs shadow-none focus-visible:ring-0"
              />
            </div>
          )}
          <Textarea
            value={body}
            disabled={!canEdit}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => body !== setting.body && onBody(body)}
            placeholder="Value (local to this production line)…"
            className="min-h-[60px] resize-y text-sm"
          />
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1">
              {photos.length === 0 ? (
                <PhotoPicker onPick={uploadPhoto}>
                  <button title="Add photo"
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Camera className="h-3.5 w-3.5" /><span>Photo</span>
                  </button>
                </PhotoPicker>
              ) : (
                <button type="button" title={showPhotos ? "Hide photos" : "Show photos"}
                  onClick={() => setShowPhotos((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] hover:bg-accent ${showPhotos ? "text-primary" : "text-primary/70"}`}>
                  <Camera className="h-3.5 w-3.5" /><span>Photos {photos.length}</span>
                </button>
              )}
              {files.length === 0 ? (
                <label title="Add file"
                  className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Paperclip className="h-3.5 w-3.5" /><span>File</span>
                  <input type="file" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
                </label>
              ) : (
                <button type="button" title={showFiles ? "Hide files" : "Show files"}
                  onClick={() => setShowFiles((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] hover:bg-accent ${showFiles ? "text-primary" : "text-primary/70"}`}>
                  <Paperclip className="h-3.5 w-3.5" /><span>Files {files.length}</span>
                </button>
              )}
            </div>
          )}
          {showPhotos && photos.length > 0 && (
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-1">
                {photos.map((p) => (
                  <PhotoTile key={p.id} path={p.storage_path} canEdit={canEdit} onRemove={() => removePhoto(p)} />
                ))}
              </div>
              {canEdit && (
                <PhotoPicker onPick={uploadPhoto}>
                  <button title="Add another photo"
                    className="inline-flex items-center justify-center rounded border border-dashed p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Plus className="h-4 w-4" />
                  </button>
                </PhotoPicker>
              )}
            </div>
          )}
          {showFiles && files.length > 0 && (
            <div className="space-y-1">
              {files.map((f) => (
                <FileChip key={f.id} f={f} canEdit={canEdit} onRemove={() => removeFile(f)} />
              ))}
              {canEdit && (
                <label title="Add file"
                  className="inline-flex cursor-pointer items-center justify-center rounded border border-dashed p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Plus className="h-4 w-4" />
                  <input type="file" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
                </label>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function SettingsGroupedList({
  rows, renderRow,
}: {
  rows: Setting[];
  renderRow: (s: Setting) => ReactNode;
}) {
  // Preserve global sort_order; bucket by group_name; ungrouped first.
  const groups: { key: string; name: string | null; items: Setting[] }[] = [];
  const seen = new Map<string, number>();
  for (const r of rows) {
    const name = r.group_name && r.group_name.trim() !== "" ? r.group_name : null;
    const key = name ?? "__ungrouped__";
    let idx = seen.get(key);
    if (idx === undefined) {
      idx = groups.length;
      seen.set(key, idx);
      groups.push({ key, name, items: [] });
    }
    groups[idx].items.push(r);
  }
  // Render ungrouped first (if present), then named groups in first-seen order.
  groups.sort((a, b) => {
    if (a.name === null && b.name !== null) return -1;
    if (b.name === null && a.name !== null) return 1;
    return 0;
  });

  return (
    <div className="space-y-3">
      {groups.map((g) =>
        g.name === null ? (
          <SortableContext key={g.key} items={g.items.map((n) => n.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-2">{g.items.map((s) => renderRow(s))}</ul>
          </SortableContext>
        ) : (
          <SettingsGroupSection key={g.key} name={g.name} items={g.items} renderRow={renderRow} />
        ),
      )}
    </div>
  );
}

function SettingsGroupSection({
  name, items, renderRow,
}: {
  name: string;
  items: Setting[];
  renderRow: (s: Setting) => ReactNode;
}) {
  const storageKey = `settings_group_collapsed_${name}`;
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(storageKey) === "1";
  });
  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try { window.localStorage.setItem(storageKey, next ? "1" : "0"); } catch {}
      return next;
    });
  };
  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center justify-between rounded-md px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
        aria-expanded={!collapsed}
      >
        <span>{name}</span>
        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
      </button>
      {!collapsed && (
        <SortableContext items={items.map((n) => n.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-2 animate-accordion-down overflow-hidden">
            {items.map((s) => renderRow(s))}
          </ul>
        </SortableContext>
      )}
    </div>
  );
}
