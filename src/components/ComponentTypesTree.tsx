import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Pencil, Check, X, GripVertical, Layers } from "lucide-react";
import { toast } from "sonner";
import { ComponentsList } from "@/components/ExtraWorkChapterView";
import { calcProgress, itemsFromGroup } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, horizontalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Tree: equipment_group -> component_types (as TABS) -> components -> checklist_items
// Used for wiring and cold_commissioning.
export function ComponentTypesTree({ group, canEdit, onChange, emptyHint }: any) {
  const types = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    if (types.length === 0) { setActiveId(null); return; }
    if (!activeId || !types.some((t: any) => t.id === activeId)) {
      setActiveId(types[0].id);
    }
  }, [types, activeId]);

  const addType = async () => {
    if (!newName.trim() || !group) return;
    const { data, error } = await supabase.from("component_types").insert({
      equipment_group_id: group.id,
      name: newName.trim(),
      sort_order: types.length,
    }).select("id").single();
    if (error) toast.error(error.message);
    else { setNewName(""); setAdding(false); if (data?.id) setActiveId(data.id); onChange(); }
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
  const active = types.find((t: any) => t.id === activeId) ?? null;

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-baseline gap-3">
            <h3 className="text-lg font-semibold">Component types</h3>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {overall.done}/{overall.total} · {overall.pct}%
            </span>
          </div>
          {canEdit && !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add type
            </Button>
          )}
        </div>
        <ProgressBar value={overall.pct} size="sm" className="mb-4" />

        {adding && (
          <div className="mb-4 flex max-w-md gap-2">
            <Input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Sensors, Valves, Motors"
              onKeyDown={(e) => e.key === "Enter" && addType()} />
            <Button size="sm" onClick={addType}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
          </div>
        )}

        {types.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">{emptyHint ?? "No component types yet. Add one (e.g. Sensors) to start."}</p>
        )}

        {types.length > 0 && (
          <>
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
              <SortableContext items={types.map((t: any) => t.id)} strategy={horizontalListSortingStrategy}>
                <div className="mb-4 flex flex-wrap gap-1.5 border-b pb-2">
                  {types.map((t: any) => (
                    <TypeTab key={t.id} type={t} active={t.id === activeId} canEdit={canEdit}
                      onClick={() => setActiveId(t.id)} onChange={onChange} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            {active && (
              <div className="rounded-lg border bg-background/40 p-3">
                <ComponentsList group={active} parentKind="component_type" canEdit={canEdit} onChange={onChange} />
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function TypeTab({ type, active, canEdit, onClick, onChange }: any) {
  const sortableArgs = useSortable({ id: type.id, disabled: !canEdit });
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

  const rename = async () => {
    if (!name.trim() || name === type.name) { setEditing(false); return; }
    const { error } = await supabase.from("component_types").update({ name: name.trim() }).eq("id", type.id);
    if (error) toast.error(error.message);
    else { setEditing(false); onChange(); }
  };

  const remove = async () => {
    const { error } = await supabase.from("component_types").update({ deleted_at: new Date().toISOString() }).eq("id", type.id);
    if (error) toast.error(error.message);
    else { toast.success("Type removed"); onChange(); }
  };

  return (
    <div ref={sortableArgs.setNodeRef} style={style}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-sm ${active
        ? "border-primary bg-primary/10 text-foreground"
        : "border-border bg-card text-muted-foreground hover:text-foreground"}`}>
      {canEdit && (
        <button {...sortableArgs.attributes} {...sortableArgs.listeners}
          className="cursor-grab touch-none active:cursor-grabbing">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
      {editing ? (
        <>
          <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") rename(); }} className="h-6 w-32 text-xs" />
          <button onClick={rename} className="p-0.5"><Check className="h-3 w-3" /></button>
          <button onClick={() => { setEditing(false); setName(type.name); }} className="p-0.5"><X className="h-3 w-3" /></button>
        </>
      ) : (
        <button onClick={onClick} className="flex items-center gap-1.5">
          <Layers className="h-3.5 w-3.5" />
          <span className="font-medium">{type.name}</span>
          <span className="font-mono text-[10px] tabular-nums opacity-70">{prog.done}/{prog.total}</span>
        </button>
      )}
      {canEdit && !editing && (
        <>
          <button onClick={() => setEditing(true)} className="p-0.5 text-muted-foreground hover:text-foreground">
            <Pencil className="h-3 w-3" />
          </button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="p-0.5"><Trash2 className="h-3 w-3 text-destructive" /></button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{type.name}"?</AlertDialogTitle>
                <AlertDialogDescription>All components and checklists inside will be hidden across every line.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}
