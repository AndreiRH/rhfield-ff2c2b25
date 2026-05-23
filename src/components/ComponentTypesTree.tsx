import { useEffect, useState, type MouseEvent } from "react";
import { toUserMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, GripVertical, ChevronDown, ChevronRight,
  ChevronsDownUp, ChevronsUpDown, Search, Copy, ClipboardPaste, StickyNote,
  Camera, Paperclip, Check, ListPlus, Share2, Lock, X, Flag,
} from "lucide-react";
import {
  useClipboard, buildTypeClipMany, buildComponentClipMany, buildItemClipMany, pasteType, pasteItem,
} from "@/lib/clipboard";
import { toast } from "sonner";
import { ComponentsList } from "@/components/ExtraWorkChapterView";
import { ChecklistTree, PhotoTile, FileChip } from "@/components/ChecklistTree";
import { calcProgress, liveChecklistItems, countFlagged } from "@/lib/progress";
import { TreeActionProvider, useTreeAction } from "@/components/TreeAction";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { localUuid } from "@/lib/local-id";
import { PhotoPicker } from "@/components/PhotoPicker";
import { rememberLocalFile } from "@/lib/local-blobs";
import { useCurrentLine } from "@/lib/current-line";
import { confirmSharedDelete } from "@/lib/confirm-shared-delete";
import { confirmUnshareToOriginLine } from "@/lib/confirm-unshare";
import { TypeNotesEditor } from "@/components/TypeNotesEditor";

import { useAuth } from "@/hooks/use-auth";

export function ComponentTypesTree(props: any) {
  return (
    <TreeActionProvider>
      <ComponentTypesTreeInner {...props} />
    </TreeActionProvider>
  );
}

function ComponentTypesTreeInner({ group, canEdit, onChange, emptyHint, lineCount, headerLeading }: any) {
  const { isAdmin } = useAuth();
  const types = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const { clip, set: setClipTop, clear: clearClip, lockTo } = useClipboard();
  const action = useTreeAction()!;
  const inMode = action.mode !== "none";

  // Preserve the user's current expand/collapse state when entering an
  // action mode (reorder, delete, copy). The expand/collapse button stays
  // available so users can change it themselves if needed.
  const inSelectMode = action.mode === "delete" || action.mode === "copy";

  const typePasteLocationKey = `type:${group?.id ?? ""}`;
  const pasteTypeHere = async () => {
    if (clip?.kind !== "componentType" || !group) return;
    try {
      await pasteType(clip, group.id, types.length);
      lockTo(typePasteLocationKey);
      toast.success("Pasted"); onChange();
    } catch (e: any) { toast.error(e.message ?? "Paste failed"); }
  };

  useEffect(() => {
    setOpenIds((prev) => {
      const next = new Set<string>();
      for (const t of types) if (prev.has(t.id)) next.add(t.id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [types.map((t: any) => t.id).join(",")]);

  const q = search.trim().toLowerCase();

  const matchingTypeIds = q
    ? new Set(
        types
          .filter((t: any) =>
            (t.checklist_items ?? []).some(
              (i: any) => !i.deleted_at && (i.label ?? "").toLowerCase().includes(q),
            ),
          )
          .map((t: any) => t.id),
      )
    : null;

  const allOpen = types.length > 0 && types.every((t: any) => openIds.has(t.id));
  const collapseAll = () => setOpenIds(new Set());
  const expandAll = () => setOpenIds(new Set(types.map((t: any) => t.id)));
  const toggleOne = (id: string) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const addType = async () => {
    if (!newName.trim() || !group) return;
    const id = localUuid();
    const { data, error } = await supabase.from("component_types").insert({
      id,
      equipment_group_id: group.id,
      name: newName.trim(),
      sort_order: types.length,
    }).select("id").single();
    if (error) toast.error(toUserMessage(error));
    else {
      setNewName(""); setAdding(false);
      if (data?.id) setOpenIds((prev) => new Set(prev).add(data.id));
      onChange();
    }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );
  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = types.findIndex((t: any) => t.id === active.id);
    const newIdx = types.findIndex((t: any) => t.id === over.id);
    const next = arrayMove(types, oldIdx, newIdx);
    await Promise.all(next.map((t: any, i: number) =>
      supabase.from("component_types").update({ sort_order: i }).eq("id", t.id)));
    onChange();
  };

  const [confirmDelete, setConfirmDelete] = useState(false);

  // Done handler — commit selection from any kind.
  const commitDone = async () => {
    if (!action.hasSelection) { action.setMode("none"); return; }
    if (action.mode === "delete") {
      setConfirmDelete(true);
      return;
    }
    const entries = Array.from(action.selection.values());
    const kind = entries[0].kind;
    if (action.mode === "copy") {
      if (kind === "type") {
        setClipTop(buildTypeClipMany(entries.map((e) => e.payload)));
      } else if (kind === "component") {
        setClipTop(buildComponentClipMany(entries.map((e) => e.payload)));
      } else if (kind === "item") {
        const selectedIds = new Set(entries.map((e) => e.payload.item.id));
        const topLevelEntries = entries.filter((e) => {
          let parentId = e.payload.item.parent_item_id;
          while (parentId) {
            if (selectedIds.has(parentId)) return false;
            parentId = e.payload.allItems.find((i: any) => i.id === parentId)?.parent_item_id;
          }
          return true;
        });
        setClipTop(buildItemClipMany(topLevelEntries.map((e) => ({ item: e.payload.item, allItems: e.payload.allItems }))));
      }
      action.setMode("none");
    }
  };

  const performDelete = async () => {
    const entries = Array.from(action.selection.values());
    if (entries.length === 0) { setConfirmDelete(false); action.setMode("none"); return; }
    const kind = entries[0].kind;
    const table = kind === "type" ? "component_types" : kind === "component" ? "components" : "checklist_items";
    const ids = entries.map((e) => kind === "item" ? e.payload.item.id : e.payload.id);
    const labels = entries.map((e) => kind === "item" ? e.payload.item.label : e.payload.name);
    const { error } = await supabase.from(table as any)
      .update({ deleted_at: new Date().toISOString() }).in("id", ids);
    setConfirmDelete(false);
    if (error) { toast.error(toUserMessage(error)); return; }
    action.setMode("none");
    onChange();
    toast.success(`Deleted ${ids.length} ${kind}${ids.length > 1 ? "s" : ""}${ids.length === 1 ? `: "${labels[0]}"` : ""}`, {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          const { error: undoErr } = await supabase.from(table as any)
            .update({ deleted_at: null }).in("id", ids);
          if (undoErr) toast.error(toUserMessage(undoErr)); else { toast.success("Restored"); onChange(); }
        },
      },
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Optional leading slot (e.g. Manual/Checklist toggle) — own row on top. */}
        {headerLeading && <div className="flex">{headerLeading}</div>}
        {/* Action bar — collapse/expand on the left, the rest on the right. */}
        <div className="flex flex-wrap items-center gap-2">
          {types.length > 0 && (
            <Button size="sm" variant="outline" onClick={allOpen ? collapseAll : expandAll} title={allOpen ? "Collapse all" : "Expand all"} aria-label={allOpen ? "Collapse all" : "Expand all"}>
              {allOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
            </Button>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {canEdit && !adding && types.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant={action.mode === "reorder" ? "default" : "outline"}
                  onClick={() => action.setMode(action.mode === "reorder" ? "none" : "reorder")}
                  title="Reorder"
                  aria-label="Reorder"
                >
                  <GripVertical className="h-4 w-4" />
                  {action.mode === "reorder" && <span className="ml-1">Done</span>}
                </Button>
                <Button
                  size="sm"
                  variant={action.mode === "copy" ? "default" : "outline"}
                  onClick={action.mode === "copy" ? commitDone : () => action.setMode("copy")}
                  title="Copy"
                  aria-label="Copy"
                >
                  <Copy className="h-4 w-4" />
                  {action.mode === "copy" && <span className="ml-1">Done{action.count ? ` ${action.count}` : ""}</span>}
                </Button>
                {isAdmin && (
                  <Button
                    size="sm"
                    variant={action.mode === "delete" ? "destructive" : "outline"}
                    onClick={action.mode === "delete" ? commitDone : () => action.setMode("delete")}
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 className="h-4 w-4" />
                    {action.mode === "delete" && <span className="ml-1">Done{action.count ? ` ${action.count}` : ""}</span>}
                  </Button>
                )}
              </>
            )}
            {canEdit && !adding && !inMode && (
              <Button size="sm" onClick={() => setAdding(true)} title="Add type" aria-label="Add type">
                <Plus className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Add type</span>
              </Button>
            )}
            {clip && !inMode && canEdit && clip.kind === "componentType" && (!clip.lockedAt || clip.lockedAt === typePasteLocationKey) && (
              <Button size="sm" variant="outline" onClick={pasteTypeHere}
                title={`Paste ${clip.nodes.length} type${clip.nodes.length > 1 ? "s" : ""}`}
                aria-label="Paste">
                <ClipboardPaste className="h-4 w-4" />
                {clip.nodes.length > 1 ? <span className="ml-1">{clip.nodes.length}</span> : null}
              </Button>
            )}
          </div>
        </div>

        {adding && (
          <div className="flex max-w-md gap-2">
            <Input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Sensors, Valves, Motors"
              onKeyDown={(e) => e.key === "Enter" && addType()} />
            <Button size="sm" onClick={addType}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
          </div>
        )}

        {action.mode === "delete" && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Tap any type, component, or item to add it to the deletion list. Tap "Done" to delete all selected.
          </p>
        )}
        {action.mode === "copy" && (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
            Tap any type, component, or item to add it to the copy. Tap "Done" to copy all selected.
          </p>
        )}
        {action.mode === "reorder" && (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
            Drag the handle on each type to reorder. Tap "Done" when finished.
          </p>
        )}

        {types.length > 1 && !inMode && (
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search components across all types…"
              className="h-8 pl-7 text-sm"
            />
          </div>
        )}

        {types.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">{emptyHint ?? "No component types yet. Add one (e.g. Sensors) to start."}</p>
        )}

        {types.length > 0 && (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={types.map((t: any) => t.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {types.map((t: any) => {
                  if (q && matchingTypeIds && !matchingTypeIds.has(t.id)) return null;
                  return (
                    <TypeSection
                      key={t.id}
                      type={t}
                      canEdit={canEdit}
                      onChange={onChange}
                      open={q ? true : openIds.has(t.id)}
                      onToggleOpen={() => toggleOne(t.id)}
                      externalSearch={q ? search : undefined}
                      defaultOpen={allOpen}
                    />
                  );
                })}
                {q && matchingTypeIds && matchingTypeIds.size === 0 && (
                  <p className="text-sm text-muted-foreground">No components match "{search}".</p>
                )}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {action.count} {Array.from(action.selection.values())[0]?.kind ?? "item"}{action.count > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the selected items and everything inside them.
              {lineCount && lineCount > 1 ? (
                <> This is shared content and will be deleted from <strong>all {lineCount} project production lines</strong>.</>
              ) : null}
              {" "}You can undo from the toast for a few seconds.
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

function TypeSection({ type, canEdit, onChange, open, onToggleOpen, externalSearch, defaultOpen }: any) {
  const action = useTreeAction()!;
  const mode = action.mode;
  const inMode = mode !== "none";
  const inSelectMode = mode === "delete" || mode === "copy";
  const inReorder = mode === "reorder";
  const selected = action.isSelected(type.id);
  const sortableArgs = useSortable({ id: type.id, disabled: !canEdit || !inReorder });
  const style = {
    transform: CSS.Transform.toString(sortableArgs.transform),
    transition: sortableArgs.transition,
    opacity: sortableArgs.isDragging ? 0.5 : 1,
  };

  const items = liveChecklistItems(type.checklist_items ?? []);
  const prog = calcProgress(items);
  const notesCount =
    items.filter((i: any) => (i.note ?? "").trim() !== "").length;
  const photosCount =
    items.reduce((acc: number, i: any) => acc + (i.item_photos?.length ?? 0), 0);
  const filesCount =
    items.reduce((acc: number, i: any) => acc + (i.item_files?.length ?? 0), 0);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);

  const rename = async () => {
    if (!name.trim() || name === type.name) { setEditing(false); return; }
    const { error } = await supabase.from("component_types").update({ name: name.trim() }).eq("id", type.id);
    if (error) toast.error(toUserMessage(error));
    else { setEditing(false); onChange(); }
  };

  const onTap = (event: MouseEvent) => {
    event.stopPropagation();
    action.toggle(type.id, { kind: "type", payload: type });
  };

  return (
    <div
      ref={sortableArgs.setNodeRef}
      style={style}
      data-nest
      className={`overflow-hidden rounded-lg border-l-4 border-y border-r bg-card shadow-md transition ${
        mode === "delete"
          ? `cursor-pointer ${selected ? "border-destructive border-l-destructive bg-destructive/15" : "border-destructive/40 border-l-destructive/60 bg-destructive/5 hover:bg-destructive/10"}`
          : mode === "copy"
          ? `cursor-pointer ${selected ? "border-primary border-l-primary bg-primary/15" : "border-primary/40 border-l-primary/60 bg-primary/5 hover:bg-primary/10"}`
          : prog.pct === 100 ? "border-success/40 border-l-success bg-success/10" : "border-border border-l-primary"
      }`}
    >
      <div
        className={`flex items-center gap-2 border-b bg-muted/60 px-3 py-2 ${inReorder ? "" : "cursor-pointer"}`}
        onClick={inSelectMode ? onTap : (inReorder ? undefined : onToggleOpen)}
      >
        {canEdit && inReorder && (
          <button {...sortableArgs.attributes} {...sortableArgs.listeners}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onToggleOpen?.(); }}
          className="text-muted-foreground hover:text-foreground"
          aria-label={open ? "Collapse" : "Expand"}
        >
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {inSelectMode && (
          <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? (mode === "delete" ? "border-destructive bg-destructive text-destructive-foreground" : "border-primary bg-primary text-primary-foreground") : "border-muted-foreground/30"}`}>
            {selected && <Check className="h-3 w-3" />}
          </span>
        )}
        {!inMode && editing ? (
          <div className="flex flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") rename(); }} className="h-7" />
            <Button size="icon" variant="ghost" onClick={rename}><Check className="h-4 w-4" /></Button>
          </div>
        ) : (
          <div
            onDoubleClick={(e) => { if (canEdit && !inMode) { e.stopPropagation(); setEditing(true); } }}
            className="flex min-w-0 flex-1 items-center gap-2 text-left cursor-pointer"
            title={canEdit && !inMode ? "Double-click to rename" : undefined}
          >
            <span className="min-w-0 flex-1 break-words text-base font-semibold">{type.name}</span>
          </div>
        )}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total}</span>
        {notesCount > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground" title="Notes inside">
            <StickyNote className="h-3 w-3" /> {notesCount}
          </span>
        )}
        {photosCount > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground" title="Photos inside">
            <Camera className="h-3 w-3" /> {photosCount}
          </span>
        )}
        {filesCount > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground" title="Files inside">
            <Paperclip className="h-3 w-3" /> {filesCount}
          </span>
        )}
      </div>

      {open && (
        <div className="bg-muted/20">
          <TypeActionBar type={type} canEdit={canEdit} onChange={onChange} />
          <div className="p-3">
            <ChecklistTree
              componentTypeId={type.id}
              items={type.checklist_items ?? []}
              canEdit={canEdit}
              onChange={onChange}
              emptyHint="No items yet."
              defaultOpen={false}
              hideRootAdd
            />
          </div>
        </div>
      )}
    </div>
  );
}

function TypeActionBar({ type, canEdit, onChange }: any) {
  const currentLine = useCurrentLine();
  const { clip, lockTo } = useClipboard();
  const [showNotes, setShowNotes] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  const photos = ((type.component_type_photos ?? []) as any[])
    .slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const files = ((type.component_type_files ?? []) as any[])
    .slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));

  const pasteKey = `tree-root:${type.id}`;

  const addItem = async () => {
    if (!text.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      id: localUuid(), component_type_id: type.id, label: text.trim(),
      sort_order: (type.checklist_items ?? []).length,
    });
    if (error) toast.error(toUserMessage(error));
    else { setText(""); setAdding(false); onChange(); }
  };

  const pasteHere = async () => {
    if (clip?.kind !== "item") return;
    try {
      await pasteItem(clip, { component_type_id: type.id, parent_item_id: null, sort_order: (type.checklist_items ?? []).length });
      lockTo(pasteKey);
      toast.success("Pasted"); onChange();
    } catch (e: any) { toast.error(e.message ?? "Paste failed"); }
  };

  const uploadPhoto = async (file: File) => {
    const path = `component-types/${type.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("photos", path, file);
    const { error: upErr } = await supabase.storage.from("photos").upload(path, file);
    if (upErr) { toast.error(toUserMessage(upErr)); return; }
    await supabase.from("component_type_photos" as any).insert({
      id: localUuid(), component_type_id: type.id, storage_path: path, sort_order: photos.length,
    } as any);
    setShowPhotos(true); onChange();
  };
  const uploadFile = async (file: File) => {
    const path = `component-types/${type.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("files", path, file);
    const { error: upErr } = await supabase.storage.from("files").upload(path, file);
    if (upErr) { toast.error(toUserMessage(upErr)); return; }
    await supabase.from("component_type_files" as any).insert({
      id: localUuid(), component_type_id: type.id, storage_path: path, file_name: file.name, sort_order: files.length,
    } as any);
    setShowFiles(true); onChange();
  };
  const removePhoto = async (p: any) => {
    if (!confirmSharedDelete(!!p.is_shared)) return;
    await supabase.from("component_type_photos" as any).delete().eq("id", p.id);
    if (!p.is_shared) await supabase.storage.from("photos").remove([p.storage_path]);
    onChange();
  };
  const removeFile = async (f: any) => {
    if (!confirmSharedDelete(!!f.is_shared)) return;
    await supabase.from("component_type_files" as any).delete().eq("id", f.id);
    if (!f.is_shared) await supabase.storage.from("files").remove([f.storage_path]);
    onChange();
  };
  const togglePhotoShare = async (p: any) => {
    if (p.is_shared && !(await confirmUnshareToOriginLine(p.origin_line_id, currentLine?.lineId))) return;
    await supabase.from("component_type_photos" as any).update({ is_shared: !p.is_shared }).eq("id", p.id);
    onChange();
  };
  const toggleFileShare = async (f: any) => {
    if (f.is_shared && !(await confirmUnshareToOriginLine(f.origin_line_id, currentLine?.lineId))) return;
    await supabase.from("component_type_files" as any).update({ is_shared: !f.is_shared }).eq("id", f.id);
    onChange();
  };
  const toggleLocal = async () => {
    if (!currentLine) return;
    const next = type.local_line_id ? null : currentLine.lineId;
    const upd: any = { local_line_id: next };
    const q = type.template_id
      ? supabase.from("component_types").update(upd).eq("template_id", type.template_id)
      : supabase.from("component_types").update(upd).eq("id", type.id);
    const { error } = await q;
    if (error) toast.error(toUserMessage(error)); else onChange();
  };

  if (!canEdit) return null;

  return (
    <>
      <div className="flex flex-nowrap items-center gap-1 border-b border-dashed px-2 py-1 sm:px-3 sm:py-1.5">
        <button onClick={() => setShowNotes((v) => !v)} title="Note"
          className={`inline-flex items-center justify-center rounded p-1 hover:bg-accent hover:text-foreground ${showNotes ? "text-primary" : "text-muted-foreground"}`}>
          <StickyNote className="h-3.5 w-3.5" />
        </button>
        <button onClick={() => setAdding(true)} title="Add item"
          className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ListPlus className="h-3.5 w-3.5" />
        </button>
        {photos.length === 0 ? (
          <PhotoPicker onPick={uploadPhoto}>
            <button title="Add photo" className="inline-flex items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <Camera className="h-3.5 w-3.5" />
            </button>
          </PhotoPicker>
        ) : (
          <button onClick={() => setShowPhotos((v) => !v)} title={showPhotos ? "Hide photos" : "Show photos"}
            className={`inline-flex items-center justify-center rounded p-1 hover:bg-accent hover:text-foreground ${showPhotos ? "text-primary" : "text-primary/70"}`}>
            <Camera className="h-3.5 w-3.5" /><span className="ml-0.5 text-[10px]">{photos.length}</span>
          </button>
        )}
        {files.length === 0 ? (
          <label title="Add file" className="inline-flex cursor-pointer items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <Paperclip className="h-3.5 w-3.5" />
            <input type="file" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
          </label>
        ) : (
          <button onClick={() => setShowFiles((v) => !v)} title={showFiles ? "Hide files" : "Show files"}
            className={`inline-flex items-center justify-center rounded p-1 hover:bg-accent hover:text-foreground ${showFiles ? "text-primary" : "text-primary/70"}`}>
            <Paperclip className="h-3.5 w-3.5" /><span className="ml-0.5 text-[10px]">{files.length}</span>
          </button>
        )}
        {clip?.kind === "item" && (!clip.lockedAt || clip.lockedAt === pasteKey) && (
          <button onClick={pasteHere} title={`Paste ${clip.nodes.length} item${clip.nodes.length > 1 ? "s" : ""}`}
            className="inline-flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
            <ClipboardPaste className="h-3.5 w-3.5" />
            {clip.nodes.length > 1 ? <span className="ml-0.5 text-[10px]">{clip.nodes.length}</span> : null}
          </button>
        )}
        {currentLine && (
          <button onClick={toggleLocal}
            title={type.local_line_id ? "Local to this production line — click to share across all production lines" : "Shared across all production lines — click to make local to this line"}
            className={`ml-auto inline-flex items-center justify-center rounded p-1 ${type.local_line_id ? "text-muted-foreground hover:bg-accent hover:text-foreground" : "text-primary hover:bg-accent"}`}>
            {type.local_line_id ? <Lock className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
      {adding && (
        <div className="flex gap-1 px-3 py-2">
          <Input value={text} autoFocus onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addItem()}
            placeholder="Checklist item" className="h-7 text-xs" />
          <Button size="sm" className="h-7" onClick={addItem}>Add</Button>
          <Button size="sm" variant="ghost" className="h-7" onClick={() => { setAdding(false); setText(""); }}>Cancel</Button>
        </div>
      )}
      {showNotes && (
        <TypeNotesEditor typeId={type.id} typeTemplateId={type.template_id} canEdit={canEdit} />
      )}
      {showPhotos && photos.length > 0 && (
        <div className="grid grid-cols-3 gap-1 px-3 pb-2">
          {photos.map((p: any) => (
            <PhotoTile key={p.id} path={p.storage_path} canEdit={canEdit}
              onRemove={() => removePhoto(p)} isShared={!!p.is_shared}
              onToggleShared={() => togglePhotoShare(p)}
              gallery={photos.map((x: any) => ({ bucket: "photos", path: x.storage_path }))} />
          ))}
          <PhotoPicker onPick={uploadPhoto}>
            <button title="Add another photo"
              className="inline-flex items-center justify-center rounded border border-dashed p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
              <Plus className="h-4 w-4" />
            </button>
          </PhotoPicker>
        </div>
      )}
      {showFiles && files.length > 0 && (
        <div className="space-y-1 px-3 pb-2">
          {files.map((f: any) => (
            <FileChip key={f.id} f={f} canEdit={canEdit}
              onRemove={() => removeFile(f)} onToggleShared={() => toggleFileShare(f)} />
          ))}
          <label title="Add file"
            className="inline-flex cursor-pointer items-center justify-center rounded border border-dashed p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
            <Plus className="h-4 w-4" />
            <input type="file" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
          </label>
        </div>
      )}
    </>
  );
}
