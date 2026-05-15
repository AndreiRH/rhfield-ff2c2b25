import { useEffect, useState, type MouseEvent } from "react";
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
  Camera, Paperclip, Check,
} from "lucide-react";
import {
  useClipboard, buildTypeClipMany, buildComponentClipMany, buildItemClipMany, pasteType,
} from "@/lib/clipboard";
import { toast } from "sonner";
import { ComponentsList } from "@/components/ExtraWorkChapterView";
import { calcProgress } from "@/lib/progress";
import { TreeActionProvider, useTreeAction } from "@/components/TreeAction";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function ComponentTypesTree(props: any) {
  return (
    <TreeActionProvider>
      <ComponentTypesTreeInner {...props} />
    </TreeActionProvider>
  );
}

function ComponentTypesTreeInner({ group, canEdit, onChange, emptyHint, lineCount }: any) {
  const types = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [search, setSearch] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const { clip, set: setClipTop, clear: clearClip } = useClipboard();
  const action = useTreeAction()!;
  const inMode = action.mode !== "none";

  // When entering copy/delete mode, expand all so users can reach sublayers.
  useEffect(() => {
    if (inMode) setOpenIds(new Set(types.map((t: any) => t.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMode]);

  const pasteTypeHere = async () => {
    if (clip?.kind !== "componentType" || !group) return;
    try {
      await pasteType(clip, group.id, types.length);
      clearClip();
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
            (t.components ?? []).some(
              (c: any) => !c.deleted_at && (c.name ?? "").toLowerCase().includes(q),
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
    const { data, error } = await supabase.from("component_types").insert({
      equipment_group_id: group.id,
      name: newName.trim(),
      sort_order: types.length,
    }).select("id").single();
    if (error) toast.error(error.message);
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
        setClipTop(buildItemClipMany(entries.map((e) => ({ item: e.payload.item, allItems: e.payload.allItems }))));
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
    if (error) { toast.error(error.message); return; }
    action.setMode("none");
    onChange();
    toast.success(`Deleted ${ids.length} ${kind}${ids.length > 1 ? "s" : ""}${ids.length === 1 ? `: "${labels[0]}"` : ""}`, {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          const { error: undoErr } = await supabase.from(table as any)
            .update({ deleted_at: null }).in("id", ids);
          if (undoErr) toast.error(undoErr.message); else { toast.success("Restored"); onChange(); }
        },
      },
    });
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        {/* Top action bar — single global controls. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {types.length > 0 && !inMode && (
            <Button size="sm" variant="outline" onClick={allOpen ? collapseAll : expandAll} title={allOpen ? "Collapse all" : "Expand all"} aria-label={allOpen ? "Collapse all" : "Expand all"}>
              {allOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
            </Button>
          )}
          {canEdit && !adding && types.length > 0 && (
            <>
              <Button
                size="sm"
                variant={action.mode === "copy" ? "default" : "outline"}
                onClick={action.mode === "copy" ? commitDone : () => action.setMode("copy")}
                disabled={action.mode === "copy" && !action.hasSelection}
                title="Copy"
                aria-label="Copy"
              >
                <Copy className="h-4 w-4" />
                {action.mode === "copy" && action.count ? <span className="ml-1">{action.count}</span> : null}
              </Button>
              <Button
                size="sm"
                variant={action.mode === "delete" ? "destructive" : "outline"}
                onClick={action.mode === "delete" ? commitDone : () => action.setMode("delete")}
                disabled={action.mode === "delete" && !action.hasSelection}
                title="Delete"
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
                {action.mode === "delete" && action.count ? <span className="ml-1">{action.count}</span> : null}
              </Button>
            </>
          )}
          {inMode && (
            <Button size="sm" variant="ghost" onClick={() => action.setMode("none")}>
              Cancel
            </Button>
          )}
          {canEdit && !adding && !inMode && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add type
            </Button>
          )}
          {clip && !inMode && canEdit && clip.kind === "componentType" && (
            <Button size="sm" variant="outline" onClick={pasteTypeHere}
              title={`Paste ${clip.nodes.length} type${clip.nodes.length > 1 ? "s" : ""}`}
              aria-label="Paste">
              <ClipboardPaste className="h-4 w-4" />
              {clip.nodes.length > 1 ? <span className="ml-1">{clip.nodes.length}</span> : null}
            </Button>
          )}
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
              <div className="space-y-4">
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

function TypeSection({ type, canEdit, onChange, open, onToggleOpen, externalSearch }: any) {
  const action = useTreeAction()!;
  const inMode = action.mode !== "none";
  const selected = action.isSelected(type.id);
  const sortableArgs = useSortable({ id: type.id, disabled: !canEdit || inMode });
  const style = {
    transform: CSS.Transform.toString(sortableArgs.transform),
    transition: sortableArgs.transition,
    opacity: sortableArgs.isDragging ? 0.5 : 1,
  };

  const liveComps = (type.components ?? []).filter((c: any) => !c.deleted_at);
  const items = liveComps.flatMap((c: any) => (c.checklist_items ?? []).filter((i: any) => !i.deleted_at));
  const prog = calcProgress(items);
  const notesCount =
    liveComps.filter((c: any) => (c.note ?? "").trim() !== "").length +
    items.filter((i: any) => (i.note ?? "").trim() !== "").length;
  const photosCount =
    liveComps.reduce((acc: number, c: any) => acc + (c.component_photos?.length ?? 0), 0) +
    items.reduce((acc: number, i: any) => acc + (i.item_photos?.length ?? 0), 0);
  const filesCount =
    liveComps.reduce((acc: number, c: any) => acc + (c.component_files?.length ?? 0), 0) +
    items.reduce((acc: number, i: any) => acc + (i.item_files?.length ?? 0), 0);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);

  const rename = async () => {
    if (!name.trim() || name === type.name) { setEditing(false); return; }
    const { error } = await supabase.from("component_types").update({ name: name.trim() }).eq("id", type.id);
    if (error) toast.error(error.message);
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
      className={`overflow-hidden rounded-lg border bg-card shadow-sm transition ${
        action.mode === "delete"
          ? `cursor-pointer ${selected ? "border-destructive bg-destructive/15" : "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"}`
          : action.mode === "copy"
          ? `cursor-pointer ${selected ? "border-primary bg-primary/15" : "border-primary/40 bg-primary/5 hover:bg-primary/10"}`
          : "border-border"
      }`}
    >
      <div
        className={`flex items-center gap-2 border-b bg-muted/60 px-3 py-2 cursor-pointer`}
        onClick={inMode ? onTap : onToggleOpen}
      >
        {canEdit && !inMode && (
          <button {...sortableArgs.attributes} {...sortableArgs.listeners}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        {!inMode && (
          <button onClick={(e) => { e.stopPropagation(); onToggleOpen?.(); }} className="text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
        {inMode && (
          <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? (action.mode === "delete" ? "border-destructive bg-destructive text-destructive-foreground" : "border-primary bg-primary text-primary-foreground") : "border-muted-foreground/30"}`}>
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
          <button
            onClick={inMode ? undefined : onToggleOpen}
            onDoubleClick={(e) => { if (canEdit && !inMode) { e.stopPropagation(); setEditing(true); } }}
            className="flex flex-1 items-center gap-2 text-left"
            title={canEdit && !inMode ? "Double-click to rename" : undefined}
          >
            <span className="text-base font-semibold">{type.name}</span>
          </button>
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

      {(open || inMode) && (
        <div className="p-3">
          <ComponentsList
            group={type}
            parentKind="component_type"
            canEdit={canEdit}
            onChange={onChange}
            externalSearch={externalSearch}
            hideTitle
          />
        </div>
      )}
    </div>
  );
}
