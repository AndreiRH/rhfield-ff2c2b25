import { useEffect, useState, type MouseEvent } from "react";
import { toUserMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, GripVertical, ChevronRight, ChevronDown, Camera, Paperclip,
  StickyNote, ListPlus, X, Share2, Lock, ClipboardPaste, Check,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";
import { StoragePhoto, openStorageFile } from "@/components/StoragePhoto";
import { rememberLocalFile } from "@/lib/local-blobs";
import { useClipboard, pasteItem } from "@/lib/clipboard";
import { useTreeAction } from "@/components/TreeAction";
import { liveChecklistItems } from "@/lib/progress";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy, rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { localUuid } from "@/lib/local-id";
import { useCurrentLine } from "@/lib/current-line";
import { confirmUnshareToOriginLine, getUnshareWarning } from "@/lib/confirm-unshare";
import { confirmSharedDelete } from "@/lib/confirm-shared-delete";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ItemNotesEditor } from "@/components/ItemNotesEditor";


export function ChecklistTree({
  componentId, componentTypeId, items, canEdit, onChange,
  emptyHint = "No items yet.", showLabels = false, defaultOpen = false,
  canDeleteRoot = true, hideRootAdd = false,
}: {
  componentId?: string;
  componentTypeId?: string;
  items: any[];
  canEdit: boolean;
  onChange: () => void;
  emptyHint?: string;
  showLabels?: boolean;
  defaultOpen?: boolean;
  canDeleteRoot?: boolean;
  hideRootAdd?: boolean;
}) {
  const currentLine = useCurrentLine();
  const parentCols = componentTypeId
    ? { component_type_id: componentTypeId }
    : { component_id: componentId! };
  const visibleItems = liveChecklistItems(
    (items ?? []).filter((i: any) => !i.local_line_id || (currentLine && i.local_line_id === currentLine.lineId))
  );
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const [localConfirm, setLocalConfirm] = useState<{
    originLabel: string;
    otherLinesPhrase: string;
    apply: () => Promise<void>;
  } | null>(null);
  const { clip, lockTo } = useClipboard();
  const rootPasteLocationKey = `tree-root:${(parentCols as any).component_id ?? (parentCols as any).component_type_id ?? ""}`;
  const action = useTreeAction();
  const inMode = action?.mode !== "none" && !!action;

  const rootItems = visibleItems
    .filter((i: any) => !i.parent_item_id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const addItem = async () => {
    if (!text.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      id: localUuid(), ...parentCols, label: text.trim(), sort_order: rootItems.length,
    });
    if (error) toast.error(toUserMessage(error));
    else { setText(""); setAdding(false); onChange(); }
  };

  const pasteHere = async () => {
    if (clip?.kind !== "item") return;
    try {
      await pasteItem(clip, { ...parentCols, parent_item_id: null, sort_order: rootItems.length });
      lockTo(rootPasteLocationKey);
      toast.success("Pasted"); onChange();
    } catch (e: any) { toast.error(e.message ?? "Paste failed"); }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const activeItem = visibleItems.find((i: any) => i.id === active.id);
    const overItem = visibleItems.find((i: any) => i.id === over.id);
    if (!activeItem || !overItem) return;
    const activeParent = activeItem.parent_item_id ?? null;
    const overParent = overItem.parent_item_id ?? null;
    if (activeParent !== overParent) return;
    const siblings = visibleItems
      .filter((i: any) => (i.parent_item_id ?? null) === activeParent)
      .sort((a: any, b: any) => a.sort_order - b.sort_order);
    const oldIdx = siblings.findIndex((i: any) => i.id === active.id);
    const newIdx = siblings.findIndex((i: any) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(siblings, oldIdx, newIdx);
    await Promise.all(next.map((it: any, i: number) =>
      supabase.from("checklist_items").update({ sort_order: i }).eq("id", it.id)));
    onChange();
  };

  return (
    <div className="space-y-2">
      {canEdit && !hideRootAdd && (
        <div className="flex flex-wrap justify-end gap-1">
          {clip?.kind === "item" && !inMode && (!clip.lockedAt || clip.lockedAt === rootPasteLocationKey) && (
            <Button size="sm" variant="outline" onClick={pasteHere}
              title={`Paste ${clip.nodes.length} item${clip.nodes.length > 1 ? "s" : ""}`}
              aria-label="Paste">
              <ClipboardPaste className="h-4 w-4" />
              {clip.nodes.length > 1 ? <span className="ml-1">{clip.nodes.length}</span> : null}
            </Button>
          )}
          {!adding && !inMode && (
            <Button size="sm" onClick={() => setAdding(true)} title="Add item" aria-label="Add item">
              <Plus className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Add item</span>
            </Button>
          )}
        </div>
      )}
      {adding && !hideRootAdd && (
        <div className="flex gap-2">
          <Input value={text} autoFocus onChange={(e) => setText(e.target.value)}
            placeholder="Checklist item"
            onKeyDown={(e) => e.key === "Enter" && addItem()} />
          <Button size="sm" onClick={addItem}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setText(""); }}>Cancel</Button>
        </div>
      )}

      {rootItems.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">{emptyHint}</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={rootItems.map((i: any) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {rootItems.map((it: any) => (
              <TreeNode key={it.id} item={it} allItems={visibleItems} canEdit={canEdit}
                onChange={onChange} depth={0} sortable showLabels={showLabels} defaultOpen={defaultOpen}
                canDeleteRoot={canDeleteRoot} requestLocalConfirm={setLocalConfirm} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
      <AlertDialog open={!!localConfirm} onOpenChange={(open) => { if (!open) setLocalConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Make item local?</AlertDialogTitle>
            <AlertDialogDescription>
              This item was originally shared from <strong>{localConfirm?.originLabel}</strong>. If you confirm, it will only be accessible there and will be removed from {localConfirm?.otherLinesPhrase}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => {
              const pending = localConfirm;
              setLocalConfirm(null);
              await pending?.apply();
            }}>
              Make local
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TreeNode({ item, allItems, canEdit, onChange, depth, sortable, showLabels, defaultOpen = false, canDeleteRoot = true, requestLocalConfirm }: any) {
  const currentLine = useCurrentLine();
  const action = useTreeAction();
  const mode = action?.mode ?? "none";
  const inMode = mode !== "none";
  const inSelectMode = mode === "delete" || mode === "copy";
  const inReorder = mode === "reorder";
  const sortableArgs = useSortable({ id: item.id, disabled: !sortable || !inReorder });
  const style = sortable
    ? { transform: CSS.Transform.toString(sortableArgs.transform), transition: sortableArgs.transition, opacity: sortableArgs.isDragging ? 0.6 : 1 }
    : undefined;
  const { clip, lockTo } = useClipboard();
  const subPasteLocationKey = `tree-item:${item.id}`;
  const selected = !!action?.isSelected(item.id);

  const subs = allItems
    .filter((i: any) => i.parent_item_id === item.id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const photos = ((item.item_photos ?? []) as any[])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const files = ((item.item_files ?? []) as any[])
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const ownNote = (item.note ?? "").trim() !== "";
  const hasContent = !!item.note || subs.length > 0 || photos.length > 0 || files.length > 0;
  const [open, setOpen] = useState<boolean>(!!defaultOpen);

  // Recursive content stats (subs + own attachments).
  const descendants = (() => {
    const out: any[] = [];
    const stack = allItems.filter((i: any) => i.parent_item_id === item.id);
    while (stack.length) {
      const n = stack.pop()!;
      out.push(n);
      for (const c of allItems) if (c.parent_item_id === n.id) stack.push(c);
    }
    return out;
  })();
  const subsTotal = descendants.length;
  const subsDone = descendants.filter((d: any) => d.done).length;
  const descNotes = descendants.filter((d: any) => (d.note ?? "").trim() !== "").length;
  const notesCount = descNotes + (ownNote ? 1 : 0);
  const photosCount = descendants.reduce((s: number, d: any) => s + (d.item_photos?.length ?? 0), 0) + photos.length;
  const filesCount = descendants.reduce((s: number, d: any) => s + (d.item_files?.length ?? 0), 0) + files.length;
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [addingSub, setAddingSub] = useState(false);
  const [subText, setSubText] = useState("");



  const [editingLabel, setEditingLabel] = useState(false);
  const [label, setLabel] = useState(item.label);
  useEffect(() => { setLabel(item.label); }, [item.label]);
  const saveLabel = async () => {
    const trimmed = label.trim();
    setEditingLabel(false);
    if (!trimmed || trimmed === item.label) { setLabel(item.label); return; }
    const { error } = await supabase.from("checklist_items").update({ label: trimmed }).eq("id", item.id);
    if (error) toast.error(toUserMessage(error)); else onChange();
  };

  const toggle = async () => {
    const next = !item.done;
    const nowIso = new Date().toISOString();
    // Cascade down to all descendants.
    const ids = [item.id, ...descendants.map((d: any) => d.id)];
    const { error } = await supabase.from("checklist_items")
      .update({ done: next, completed_at: next ? nowIso : null }).in("id", ids);
    if (error) { toast.error(toUserMessage(error)); return; }
    // Cascade up: marking done propagates when all siblings are done;
    // unmarking propagates to any done ancestor (an item can't be done if a descendant isn't).
    if (next) {
      const doneSet = new Set(ids);
      let parentId: string | null = item.parent_item_id ?? null;
      while (parentId) {
        const parent: any = allItems.find((i: any) => i.id === parentId);
        if (!parent || parent.done) break;
        const siblings = allItems.filter((i: any) => i.parent_item_id === parentId);
        const allDone = siblings.every((s: any) => doneSet.has(s.id) || s.done);
        if (!allDone) break;
        const { error: pErr } = await supabase.from("checklist_items")
          .update({ done: true, completed_at: nowIso }).eq("id", parentId);
        if (pErr) { toast.error(toUserMessage(pErr)); break; }
        doneSet.add(parentId);
        parentId = parent.parent_item_id ?? null;
      }
    } else {
      const ancestors: string[] = [];
      let parentId: string | null = item.parent_item_id ?? null;
      while (parentId) {
        const parent: any = allItems.find((i: any) => i.id === parentId);
        if (!parent) break;
        if (parent.done) ancestors.push(parentId);
        parentId = parent.parent_item_id ?? null;
      }
      if (ancestors.length) {
        const { error: pErr } = await supabase.from("checklist_items")
          .update({ done: false, completed_at: null }).in("id", ancestors);
        if (pErr) toast.error(toUserMessage(pErr));
      }
    }
    onChange();
  };
  const itemParentCols = item.component_type_id
    ? { component_type_id: item.component_type_id as string }
    : { component_id: item.component_id as string };
  const unmarkSelfAndAncestors = async () => {
    const ids: string[] = [];
    if (item.done) ids.push(item.id);
    let parentId: string | null = item.parent_item_id ?? null;
    while (parentId) {
      const parent: any = allItems.find((i: any) => i.id === parentId);
      if (!parent) break;
      if (parent.done) ids.push(parentId);
      parentId = parent.parent_item_id ?? null;
    }
    if (ids.length) {
      const { error } = await supabase.from("checklist_items")
        .update({ done: false, completed_at: null }).in("id", ids);
      if (error) toast.error(toUserMessage(error));
    }
  };
  const pasteAsSub = async () => {
    if (clip?.kind !== "item") return;
    try {
      await pasteItem(clip, { ...itemParentCols, parent_item_id: item.id, sort_order: subs.length });
      await unmarkSelfAndAncestors();
      lockTo(subPasteLocationKey);
      setOpen(true);
      toast.success("Pasted"); onChange();
    } catch (e: any) { toast.error(e.message ?? "Paste failed"); }
  };
  const addSub = async () => {
    if (!subText.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      id: localUuid(), ...itemParentCols, label: subText.trim(),
      parent_item_id: item.id, sort_order: subs.length,
      local_line_id: item.local_line_id ?? null,
    });
    if (error) { toast.error(toUserMessage(error)); return; }
    await unmarkSelfAndAncestors();
    setSubText(""); setAddingSub(false); setOpen(true); onChange();
  };
  const uploadPhoto = async (file: File) => {
    const path = `checklist/${item.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("photos", path, file);
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(toUserMessage(error)); return; }
    await supabase.from("item_photos").insert({ id: localUuid(), item_id: item.id, storage_path: path });
    setOpen(true); setShowPhotos(true); onChange();
  };
  const uploadFile = async (file: File) => {
    const path = `checklist/${item.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("files", path, file);
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(toUserMessage(error)); return; }
    await supabase.from("item_files").insert({ id: localUuid(), item_id: item.id, storage_path: path, file_name: file.name });
    setOpen(true); setShowFiles(true); onChange();
  };
  const removePhoto = async (p: any) => {
    if (!confirmSharedDelete(!!p.is_shared)) return;
    const { error } = await supabase.from("item_photos").delete().eq("id", p.id);
    if (error) { toast.error(toUserMessage(error)); return; }
    onChange();
    let undone = false;
    toast.success("Photo deleted", {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          undone = true;
          const { error: e } = await supabase.from("item_photos")
            .insert({ id: p.id, item_id: item.id, storage_path: p.storage_path, is_shared: p.is_shared ?? false });
          if (e) toast.error(toUserMessage(e)); else onChange();
        },
      },
    });
    setTimeout(async () => {
      if (!undone && !p.is_shared) await supabase.storage.from("photos").remove([p.storage_path]);
    }, 3500);
  };
  const removeFile = async (f: any) => {
    if (!confirmSharedDelete(!!f.is_shared)) return;
    const { error } = await supabase.from("item_files").delete().eq("id", f.id);
    if (error) { toast.error(toUserMessage(error)); return; }
    onChange();
    let undone = false;
    toast.success("File deleted", {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          undone = true;
          const { error: e } = await supabase.from("item_files")
            .insert({ id: f.id, item_id: item.id, storage_path: f.storage_path, file_name: f.file_name, is_shared: f.is_shared ?? false });
          if (e) toast.error(toUserMessage(e)); else onChange();
        },
      },
    });
    setTimeout(async () => {
      if (!undone && !f.is_shared) await supabase.storage.from("files").remove([f.storage_path]);
    }, 3500);
  };
  const resolveItemOriginLine = async (it: any): Promise<string | null> => {
    try {
      if (it.component_id) {
        const { data: c } = await supabase
          .from("components").select("equipment_id, component_type_id").eq("id", it.component_id).maybeSingle();
        if (c?.equipment_id) {
          const { data: pe } = await supabase.from("plant_equipment").select("line_id").eq("id", c.equipment_id).maybeSingle();
          if (pe?.line_id) return pe.line_id;
        }
        if (c?.component_type_id) {
          const { data: ct } = await supabase.from("component_types").select("equipment_group_id").eq("id", c.component_type_id).maybeSingle();
          if (ct?.equipment_group_id) {
            const { data: g } = await supabase.from("equipment_groups").select("line_id").eq("id", ct.equipment_group_id).maybeSingle();
            if (g?.line_id) return g.line_id;
          }
        }
      }
      if (it.component_type_id) {
        const { data: ct } = await supabase.from("component_types").select("equipment_group_id").eq("id", it.component_type_id).maybeSingle();
        if (ct?.equipment_group_id) {
          const { data: g } = await supabase.from("equipment_groups").select("line_id").eq("id", ct.equipment_group_id).maybeSingle();
          if (g?.line_id) return g.line_id;
        }
      }
    } catch {}
    return null;
  };
  const toggleLocalLine = async () => {
    if (!currentLine) return;
    const next = item.local_line_id ? null : item.origin_line_id ?? await resolveItemOriginLine(item) ?? currentLine.lineId;
    // Collect all descendant ids (cascade so sublayers follow parent)
    const descendantIds: string[] = [];
    const collect = (pid: string) => {
      for (const it of allItems as any[]) {
        if (it.parent_item_id === pid) {
          descendantIds.push(it.id);
          collect(it.id);
        }
      }
    };
    collect(item.id);

    const updates: PromiseLike<any>[] = [];
    const baseUpd = { local_line_id: next };
    if (item.template_id) {
      updates.push(supabase.from("checklist_items").update(baseUpd).eq("template_id", item.template_id));
    } else {
      updates.push(supabase.from("checklist_items").update(baseUpd).eq("id", item.id));
    }
    // Cascade to descendants — group by template_id when present, else by id
    const descTemplateIds = new Set<string>();
    const descPlainIds: string[] = [];
    for (const id of descendantIds) {
      const d: any = (allItems as any[]).find((x) => x.id === id);
      if (d?.template_id) descTemplateIds.add(d.template_id);
      else descPlainIds.push(id);
    }
    if (descTemplateIds.size) {
      updates.push(supabase.from("checklist_items").update(baseUpd).in("template_id", Array.from(descTemplateIds)));
    }
    if (descPlainIds.length) {
      updates.push(supabase.from("checklist_items").update(baseUpd).in("id", descPlainIds));
    }
    const applyLocalChange = async () => {
      const results = await Promise.all(updates);
      const firstErr = results.find((r) => r.error)?.error;
      if (firstErr) toast.error(toUserMessage(firstErr)); else onChange();
    };

    if (!item.local_line_id) {
      const warning = await getUnshareWarning(next);
      requestLocalConfirm?.({
        originLabel: warning.originLabel,
        otherLinesPhrase: warning.otherLinesPhrase,
        apply: applyLocalChange,
      });
      return;
    }

    await applyLocalChange();
  };

  const toggleSharePhoto = async (p: any) => {
    if (p.is_shared && !(await confirmUnshareToOriginLine(p.origin_line_id, currentLine?.lineId))) return;
    const { error } = await supabase.from("item_photos").update({ is_shared: !p.is_shared }).eq("id", p.id);
    if (error) toast.error(toUserMessage(error)); else onChange();
  };

  const attachSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 300, tolerance: 8 } }),
  );
  const reorderPhotos = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = photos.findIndex((p: any) => p.id === active.id);
    const newIdx = photos.findIndex((p: any) => p.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(photos, oldIdx, newIdx);
    await Promise.all(next.map((p: any, i: number) =>
      supabase.from("item_photos").update({ sort_order: i }).eq("id", p.id)));
    onChange();
  };
  const reorderFiles = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = files.findIndex((f: any) => f.id === active.id);
    const newIdx = files.findIndex((f: any) => f.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(files, oldIdx, newIdx);
    await Promise.all(next.map((f: any, i: number) =>
      supabase.from("item_files").update({ sort_order: i }).eq("id", f.id)));
    onChange();
  };
  const toggleShareFile = async (f: any) => {
    if (f.is_shared && !(await confirmUnshareToOriginLine(f.origin_line_id, currentLine?.lineId))) return;
    const { error } = await supabase.from("item_files").update({ is_shared: !f.is_shared }).eq("id", f.id);
    if (error) toast.error(toUserMessage(error)); else onChange();
  };

  const canExpand = hasContent || canEdit;

  // Engineers (canDeleteRoot=false) cannot select root items in delete mode.
  const blockedFromMode = mode === "delete" && !canDeleteRoot && !item.parent_item_id;

  const onRowClick = (event: MouseEvent) => {
    event.stopPropagation();
    if (blockedFromMode) return;
    const entries: Array<[string, { kind: "item"; payload: { item: any; allItems: any[] } }]> = [item, ...descendants].map((node: any) => [
      node.id,
      { kind: "item" as const, payload: { item: node, allItems } },
    ]);
    action?.toggleMany(entries);
  };

  const row = (
    <div
      className={`flex items-center gap-1 px-2 py-1.5 ${(inSelectMode || canExpand) ? "cursor-pointer" : ""} ${
        mode === "delete" ? (blockedFromMode ? "opacity-40" : selected ? "bg-destructive/15" : "bg-destructive/5 hover:bg-destructive/10") :
        mode === "copy" ? (selected ? "bg-primary/15" : "bg-primary/5 hover:bg-primary/10") :
        inReorder ? "bg-muted/30" : ""
      }`}
      onClick={inSelectMode ? onRowClick : (canExpand ? () => setOpen((v) => !v) : undefined)}
    >
      {sortable && canEdit && inReorder && (
        <button {...sortableArgs.attributes} {...sortableArgs.listeners}
          onClick={(e) => e.stopPropagation()}
          className="cursor-grab touch-none p-1 active:cursor-grabbing">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
        <button onClick={(e) => { e.stopPropagation(); canExpand && setOpen((v) => !v); }}
          className={`p-0.5 ${canExpand ? "text-muted-foreground hover:text-foreground" : "invisible"}`}
          aria-label={open ? "Collapse" : "Expand"}
        >
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      {inSelectMode && (
        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${selected ? (mode === "delete" ? "border-destructive bg-destructive text-destructive-foreground" : "border-primary bg-primary text-primary-foreground") : "border-muted-foreground/30"}`}>
          {selected && <Check className="h-2.5 w-2.5" />}
        </span>
      )}
      {!inMode && (
        <span onClick={(e) => e.stopPropagation()}>
          <Checkbox checked={item.done} disabled={!canEdit} onCheckedChange={toggle} />
        </span>
      )}
      {!inMode && editingLabel && canEdit ? (
        <Input
          value={label}
          autoFocus
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setLabel(e.target.value)}
          onBlur={saveLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); saveLabel(); }
            else if (e.key === "Escape") { setLabel(item.label); setEditingLabel(false); }
          }}
          className="h-7 flex-1 border-0 bg-transparent px-1 text-sm shadow-none focus-visible:ring-0"
        />
      ) : (
        <span
          onClick={(e) => { if (!inMode) e.stopPropagation(); }}
          onDoubleClick={(e) => { e.stopPropagation(); !inMode && canEdit && setEditingLabel(true); }}
          title={!inMode && canEdit ? "Double-click to rename" : undefined}
          className={`flex-1 min-w-0 break-words text-sm ${item.done && !inMode ? "text-muted-foreground" : ""} ${!inMode ? "cursor-default" : ""}`}
        >{item.label}</span>
      )}
      {/* Always-visible content indicators */}
      <span className="flex shrink-0 items-center gap-2">
        {subsTotal > 0 && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{subsDone}/{subsTotal}</span>
        )}
        {!inMode && notesCount > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground" title="Notes">
            <StickyNote className="h-3 w-3" /> {notesCount}
          </span>
        )}
        {!inMode && photosCount > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground" title="Photos">
            <Camera className="h-3 w-3" /> {photosCount}
          </span>
        )}
        {!inMode && filesCount > 0 && (
          <span className="inline-flex items-center gap-0.5 font-mono text-xs tabular-nums text-muted-foreground" title="Files">
            <Paperclip className="h-3 w-3" /> {filesCount}
          </span>
        )}
      </span>
    </div>
  );

  return (
    <li ref={sortable ? sortableArgs.setNodeRef : undefined} style={style}
      data-nest
      className={`rounded-md border bg-card ${depth === 0 ? "ml-2 border-l-4 border-l-muted-foreground/30" : ""} ${
        mode === "delete" ? (selected ? "border-destructive" : "border-destructive/40") :
        mode === "copy" ? (selected ? "border-primary" : "border-primary/40") :
        item.done ? "border-success/40 bg-success/10" : ""
      }`}>
      {row}
      {open && (
        <div className="border-t bg-muted/10">
          {!inMode && canEdit && (
            <div className="flex flex-nowrap items-center gap-1 border-b border-dashed px-2 py-1 sm:px-3 sm:py-1.5">
              <ActionBtn onClick={() => setShowNoteEditor((v) => !v)}
                icon={<StickyNote className="h-3.5 w-3.5" />} label="Note" active={ownNote} iconOnly={!showLabels} />
              {depth < 2 && (
                <ActionBtn onClick={() => setAddingSub(true)}
                  icon={<ListPlus className="h-3.5 w-3.5" />} label="Subtask" iconOnly={!showLabels} />
              )}
              {photos.length === 0 ? (
                <PhotoPicker onPick={uploadPhoto}>
                  <button title="Add photo"
                    className={`inline-flex items-center ${showLabels ? "gap-1 px-2 py-0.5 text-[11px]" : "justify-center p-1"} rounded text-muted-foreground hover:bg-accent hover:text-foreground`}>
                    <Camera className="h-3.5 w-3.5" />{showLabels && <span>Photo</span>}
                  </button>
                </PhotoPicker>
              ) : (
                <button title={showPhotos ? "Hide photos" : "Show photos"}
                  onClick={() => setShowPhotos((v) => !v)}
                  className={`inline-flex items-center ${showLabels ? "gap-1 px-2 py-0.5 text-[11px]" : "justify-center p-1"} rounded hover:bg-accent hover:text-foreground ${showPhotos ? "text-primary" : "text-primary/70"}`}>
                  <Camera className="h-3.5 w-3.5" />{showLabels ? <span>Photos {photos.length}</span> : <span className="ml-0.5 text-[10px]">{photos.length}</span>}
                </button>
              )}
              {files.length === 0 ? (
                <label title="Add file"
                  className={`inline-flex cursor-pointer items-center ${showLabels ? "gap-1 px-2 py-0.5 text-[11px]" : "justify-center p-1"} rounded text-muted-foreground hover:bg-accent hover:text-foreground`}>
                  <Paperclip className="h-3.5 w-3.5" />{showLabels && <span>File</span>}
                  <input type="file" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
                </label>
              ) : (
                <button title={showFiles ? "Hide files" : "Show files"}
                  onClick={() => setShowFiles((v) => !v)}
                  className={`inline-flex items-center ${showLabels ? "gap-1 px-2 py-0.5 text-[11px]" : "justify-center p-1"} rounded hover:bg-accent hover:text-foreground ${showFiles ? "text-primary" : "text-primary/70"}`}>
                  <Paperclip className="h-3.5 w-3.5" />{showLabels ? <span>Files {files.length}</span> : <span className="ml-0.5 text-[10px]">{files.length}</span>}
                </button>
              )}
              {clip?.kind === "item" && depth < 2 && (!clip.lockedAt || clip.lockedAt === subPasteLocationKey) && (
                <button onClick={pasteAsSub}
                  className={`inline-flex shrink-0 items-center ${showLabels ? "gap-1 px-2 py-0.5 text-[11px]" : "justify-center p-1"} rounded text-muted-foreground hover:bg-accent hover:text-foreground`}
                  title={`Paste ${clip.nodes.length} item${clip.nodes.length > 1 ? "s" : ""}`}>
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  {showLabels ? <span>Paste{clip.nodes.length > 1 ? ` ${clip.nodes.length}` : ""}</span> :
                    (clip.nodes.length > 1 ? <span className="ml-0.5 text-[10px]">{clip.nodes.length}</span> : null)}
                </button>
              )}
              {currentLine && (
                <button
                  onClick={toggleLocalLine}
                  title={item.local_line_id ? "Local to this production line — click to share across all production lines" : "Shared across all production lines — click to make local to this line"}
                  aria-label={item.local_line_id ? "Make shared" : "Make local"}
                  className={`ml-auto inline-flex items-center ${showLabels ? "gap-1 px-2 py-0.5 text-[11px]" : "justify-center p-1"} rounded ${item.local_line_id ? "text-muted-foreground hover:bg-accent hover:text-foreground" : "text-primary hover:bg-accent"}`}
                >
                  {item.local_line_id ? <Lock className="h-3.5 w-3.5" /> : <Share2 className="h-3.5 w-3.5" />}
                  {showLabels && <span>{item.local_line_id ? "Local" : "Shared"}</span>}
                </button>
              )}
            </div>
          )}

          {!inMode && showNoteEditor && (
            <ItemNotesEditor
              itemId={item.id}
              itemTemplateId={item.template_id}
              canEdit={canEdit}
              userId={undefined}
            />
          )}


          {!inMode && showPhotos && photos.length > 0 && (() => {
            const photoGallery = photos.map((p: any) => ({ bucket: "photos", path: p.storage_path }));
            return (
            <div className="space-y-1 px-3 pb-2">
              {photos.length > 1 && canEdit ? (
                <DndContext id={`photos-${item.id}`} sensors={attachSensors} collisionDetection={closestCenter} onDragEnd={reorderPhotos}>
                  <SortableContext items={photos.map((p: any) => p.id)} strategy={rectSortingStrategy}>
                    <div className="grid grid-cols-3 gap-1">
                      {photos.map((p: any) => (
                        <SortablePhotoTile key={p.id} id={p.id} path={p.storage_path}
                          canEdit={canEdit} onRemove={() => removePhoto(p)}
                          isShared={!!p.is_shared} onToggleShared={() => toggleSharePhoto(p)}
                          gallery={photoGallery} />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {photos.map((p: any) => <PhotoTile key={p.id} path={p.storage_path}
                    canEdit={canEdit} onRemove={() => removePhoto(p)}
                    isShared={!!p.is_shared} onToggleShared={() => toggleSharePhoto(p)}
                    gallery={photoGallery} />)}
                </div>
              )}
              {canEdit && (
                <PhotoPicker onPick={uploadPhoto}>
                  <button title="Add another photo"
                    className="inline-flex items-center justify-center rounded border border-dashed p-2 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Plus className="h-4 w-4" />
                  </button>
                </PhotoPicker>
              )}
            </div>
            );
          })()}

          {!inMode && showFiles && files.length > 0 && (
            <div className="space-y-1 px-3 pb-2">
              {files.length > 1 && canEdit ? (
                <DndContext id={`files-${item.id}`} sensors={attachSensors} collisionDetection={closestCenter} onDragEnd={reorderFiles}>
                  <SortableContext items={files.map((f: any) => f.id)} strategy={verticalListSortingStrategy}>
                    {files.map((f: any) => (
                      <SortableFileChip key={f.id} id={f.id} f={f} canEdit={canEdit}
                        onRemove={() => removeFile(f)} onToggleShared={() => toggleShareFile(f)} />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                files.map((f: any) => <FileChip key={f.id} f={f} canEdit={canEdit}
                  onRemove={() => removeFile(f)} onToggleShared={() => toggleShareFile(f)} />)
              )}
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

          {(subs.length > 0 || (addingSub && !inMode)) && (
            <div className="ml-4 mt-2 space-y-1 rounded border-l-2 border-primary/30 bg-muted/20 px-2 py-2">
              <SortableContext items={subs.map((s: any) => s.id)} strategy={verticalListSortingStrategy}>
                <ul className="space-y-1">
                  {subs.map((s: any) => (
                    <TreeNode key={s.id} item={s} allItems={allItems} canEdit={canEdit}
                      onChange={onChange} depth={depth + 1} sortable showLabels={false}
                      canDeleteRoot={canDeleteRoot} defaultOpen={defaultOpen}
                      requestLocalConfirm={requestLocalConfirm} />
                  ))}
                </ul>
              </SortableContext>
              {!inMode && addingSub && (
                <div className="flex gap-1">
                  <Input value={subText} autoFocus onChange={(e) => setSubText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addSub()}
                    placeholder="Subtask" className="h-7 text-xs" />
                  <Button size="sm" className="h-7" onClick={addSub}>Add</Button>
                  <Button size="sm" variant="ghost" className="h-7"
                    onClick={() => { setAddingSub(false); setSubText(""); }}>Cancel</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function ActionBtn({ onClick, icon, label, active, iconOnly }: any) {
  if (iconOnly) {
    return (
      <button onClick={onClick} title={label}
        className={`inline-flex items-center justify-center rounded p-1 hover:bg-accent hover:text-foreground ${active ? "text-primary" : "text-muted-foreground"}`}>
        {icon}
      </button>
    );
  }
  return (
    <button onClick={onClick}
      className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] hover:bg-accent hover:text-foreground ${active ? "text-primary" : "text-muted-foreground"}`}>
      {icon} {label}
    </button>
  );
}

export function PhotoTile({ path, canEdit, onRemove, isShared, onToggleShared, gallery }: {
  path: string; canEdit: boolean; onRemove: () => void;
  isShared?: boolean; onToggleShared?: () => void;
  gallery?: { bucket: string; path: string; name?: string }[];
}) {
  return (
    <div className="relative">
      <StoragePhoto
        bucket="photos"
        path={path}
        imgClassName="h-16 w-full rounded border object-cover"
        canEdit={canEdit}
        onRemove={onRemove}
        gallery={gallery}
      />
      {canEdit && onToggleShared && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleShared(); }}
          title={isShared ? "Shared across all production lines — click to make local" : "Local to this production line — click to share across all production lines"}
          className={`absolute left-1 top-1 rounded bg-background/80 p-0.5 backdrop-blur ${isShared ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          {isShared ? <Share2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}

export function FileChip({ f, canEdit, onRemove, onToggleShared }: {
  f: any; canEdit: boolean; onRemove: () => void;
  onToggleShared?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded border bg-muted/30 pl-2 pr-1 py-1 text-xs">
      <button
        onClick={() => openStorageFile("files", f.storage_path, f.file_name)}
        className="flex min-w-0 flex-1 items-center gap-1 text-left hover:underline"
      >
        <Paperclip className="h-3 w-3 shrink-0" /> <span className="truncate">{f.file_name}</span>
      </button>
      {canEdit && onToggleShared && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleShared(); }}
          title={f.is_shared ? "Shared across all production lines — click to make local" : "Local to this production line — click to share across all production lines"}
          className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded ${f.is_shared ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          {f.is_shared ? <Share2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        </button>
      )}
      {canEdit && (
        <button onClick={onRemove} className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded text-destructive hover:opacity-80">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function SortablePhotoTile({ id, path, canEdit, onRemove, isShared, onToggleShared, gallery }: {
  id: string; path: string; canEdit: boolean; onRemove: () => void;
  isShared?: boolean; onToggleShared?: () => void;
  gallery?: { bucket: string; path: string; name?: string }[];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-no-swipe
      {...attributes}
      {...listeners}
      title="Long-press and drag to reorder"
      className="relative touch-none cursor-grab active:cursor-grabbing"
    >
      <StoragePhoto
        bucket="photos"
        path={path}
        imgClassName="h-16 w-full rounded border object-cover"
        canEdit={canEdit}
        onRemove={onRemove}
        gallery={gallery}
      />
      {canEdit && onToggleShared && (
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleShared(); }}
          title={isShared ? "Shared across all production lines — click to make local" : "Local to this production line — click to share across all production lines"}
          className={`absolute left-1 top-1 rounded bg-background/80 p-0.5 backdrop-blur ${isShared ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          {isShared ? <Share2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}

function SortableFileChip({ id, f, canEdit, onRemove, onToggleShared }: {
  id: string; f: any; canEdit: boolean; onRemove: () => void;
  onToggleShared?: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="flex min-w-0 items-center gap-3 rounded border bg-muted/30 pl-1 pr-1 py-1 text-xs">
      <button
        type="button"
        data-no-swipe
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}
        title="Drag to reorder"
        className="shrink-0 cursor-grab touch-none p-0.5 text-muted-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <button
        onClick={() => openStorageFile("files", f.storage_path, f.file_name)}
        className="flex min-w-0 flex-1 items-center gap-1 text-left hover:underline"
      >
        <Paperclip className="h-3 w-3 shrink-0" /> <span className="truncate">{f.file_name}</span>
      </button>
      {canEdit && onToggleShared && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleShared(); }}
          title={f.is_shared ? "Shared across all production lines — click to make local" : "Local to this production line — click to share across all production lines"}
          className={`shrink-0 inline-flex h-7 w-7 items-center justify-center rounded ${f.is_shared ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
        >
          {f.is_shared ? <Share2 className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
        </button>
      )}
      {canEdit && (
        <button onClick={onRemove} className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded text-destructive hover:opacity-80">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
