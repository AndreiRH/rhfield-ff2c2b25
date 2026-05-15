import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, Check, X, GripVertical, ChevronDown, ChevronRight,
  ChevronsDownUp, ChevronsUpDown, Search, Copy, ClipboardPaste,
} from "lucide-react";
import { useClipboard, buildTypeClip, pasteType } from "@/lib/clipboard";
import { toast } from "sonner";
import { ComponentsList } from "@/components/ExtraWorkChapterView";
import { calcProgress, itemsFromGroup } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

export function ComponentTypesTree({ group, canEdit, onChange, emptyHint }: any) {
  const types = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteMode, setDeleteMode] = useState(false);
  const [search, setSearch] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const { clip } = useClipboard();

  const pasteTypeHere = async () => {
    if (clip?.kind !== "componentType" || !group) return;
    try {
      await pasteType(clip, group.id, types.length);
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

  // While searching, force-open any type that has matching components.
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

  const overall = calcProgress(itemsFromGroup(group));

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {overall.done}/{overall.total} · {overall.pct}%
          </span>
          {types.length > 0 && (
            <Button size="sm" variant="outline" onClick={allOpen ? collapseAll : expandAll}>
              {allOpen ? (
                <><ChevronsDownUp className="mr-1 h-4 w-4" /> Collapse all</>
              ) : (
                <><ChevronsUpDown className="mr-1 h-4 w-4" /> Expand all</>
              )}
            </Button>
          )}
        </div>
        <ProgressBar value={overall.pct} size="sm" />

        {canEdit && !adding && (
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add type
            </Button>
            <Button
              size="sm"
              variant={deleteMode ? "destructive" : "outline"}
              disabled={types.length === 0}
              onClick={() => setDeleteMode((d) => !d)}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {deleteMode ? "Done" : "Delete"}
            </Button>
            {clip?.kind === "componentType" && !deleteMode && (
              <Button size="sm" variant="outline" className="col-span-2" onClick={pasteTypeHere}
                title={`Paste "${clip.sourceLabel ?? clip.node.name}" with all its components & subtasks`}>
                <ClipboardPaste className="mr-1 h-4 w-4" /> Paste "{clip.sourceLabel ?? clip.node.name}"
              </Button>
            )}
          </div>
        )}

        {adding && (
          <div className="flex max-w-md gap-2">
            <Input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Sensors, Valves, Motors"
              onKeyDown={(e) => e.key === "Enter" && addType()} />
            <Button size="sm" onClick={addType}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
          </div>
        )}

        {deleteMode && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Tap a component type to delete it. Tap "Done" to exit delete mode.
          </p>
        )}

        {types.length > 1 && !deleteMode && (
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
                      deleteMode={deleteMode}
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
    </Card>
  );
}

function TypeSection({ type, canEdit, onChange, open, onToggleOpen, deleteMode, externalSearch }: any) {
  const sortableArgs = useSortable({ id: type.id, disabled: !canEdit || deleteMode });
  const style = {
    transform: CSS.Transform.toString(sortableArgs.transform),
    transition: sortableArgs.transition,
    opacity: sortableArgs.isDragging ? 0.5 : 1,
  };

  const items = (type.components ?? [])
    .filter((c: any) => !c.deleted_at)
    .flatMap((c: any) => c.checklist_items ?? []);
  const prog = calcProgress(items);

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(type.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { set: setClip } = useClipboard();

  const rename = async () => {
    if (!name.trim() || name === type.name) { setEditing(false); return; }
    const { error } = await supabase.from("component_types").update({ name: name.trim() }).eq("id", type.id);
    if (error) toast.error(error.message);
    else { setEditing(false); onChange(); }
  };

  const remove = async () => {
    const { error } = await supabase.from("component_types").update({ deleted_at: new Date().toISOString() }).eq("id", type.id);
    if (error) { toast.error(error.message); return; }
    setConfirmDelete(false);
    onChange();
    toast.success(`"${type.name}" deleted`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          const { error: undoErr } = await supabase
            .from("component_types").update({ deleted_at: null }).eq("id", type.id);
          if (undoErr) toast.error(undoErr.message);
          else { toast.success("Restored"); onChange(); }
        },
      },
    });
  };

  return (
    <div
      ref={sortableArgs.setNodeRef}
      style={style}
      className={`overflow-hidden rounded-lg border bg-card shadow-sm transition ${
        deleteMode ? "cursor-pointer border-destructive/50 bg-destructive/5 hover:bg-destructive/10" : "border-border"
      }`}
      onClick={deleteMode ? () => setConfirmDelete(true) : undefined}
    >
      <div className="flex items-center gap-2 border-b bg-muted/60 px-3 py-2">
        {canEdit && !deleteMode && (
          <button {...sortableArgs.attributes} {...sortableArgs.listeners}
            className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        {!deleteMode && (
          <button onClick={onToggleOpen} className="text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
        {deleteMode ? (
          <div className="flex flex-1 items-center gap-2">
            <Trash2 className="h-4 w-4 text-destructive" />
            <span className="text-base font-semibold">{type.name}</span>
          </div>
        ) : editing ? (
          <div className="flex flex-1 items-center gap-2">
            <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") rename(); }} className="h-7" />
            <Button size="icon" variant="ghost" onClick={rename}><Check className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => { setEditing(false); setName(type.name); }}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <button
            onClick={onToggleOpen}
            onDoubleClick={(e) => { if (canEdit) { e.stopPropagation(); setEditing(true); } }}
            className="flex flex-1 items-center gap-2 text-left"
            title={canEdit ? "Double-click to rename" : undefined}
          >
            <span className="text-base font-semibold">{type.name}</span>
          </button>
        )}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total}</span>
        <div className="hidden w-24 sm:block"><ProgressBar value={prog.pct} size="sm" /></div>
        <span className="w-10 text-right font-mono text-xs tabular-nums">{prog.pct}%</span>
        {canEdit && !deleteMode && (
          <button
            onClick={(e) => { e.stopPropagation(); setClip(buildTypeClip(type)); }}
            title="Copy this type with all its components & subtasks"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent"
          >
            <Copy className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {open && (
        <div className="p-3">
          <ComponentsList
            group={type}
            parentKind="component_type"
            canEdit={canEdit && !deleteMode}
            onChange={onChange}
            externalSearch={externalSearch}
            hideTitle
          />
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{type.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              All components and checklists inside will be hidden. You can undo right after.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
