import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, Pencil, Check, X, GripVertical, ChevronDown, ChevronRight,
  StickyNote, Camera, Paperclip, ChevronsDownUp, ChevronsUpDown,
} from "lucide-react";
import { toast } from "sonner";
import { ChecklistTree, PhotoTile, FileChip } from "@/components/ChecklistTree";
import { PhotoPicker } from "@/components/PhotoPicker";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Renders the list of components inside an equipment_group (or component_type).
// Each component is a strongly-styled card with its own checklist + notes/files.
export function ComponentsList({ group, canEdit, onChange, parentKind = "equipment_group" }: any) {
  const components = (group.components ?? [])
    .filter((c: any) => !c.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(components.map((c: any) => c.id)));

  // Auto-include freshly-added components in open set, drop removed ones
  useEffect(() => {
    setOpenIds((prev) => {
      const next = new Set<string>();
      for (const c of components) if (prev.has(c.id)) next.add(c.id);
      // newly created (not in prev) → default open
      for (const c of components) if (!prev.has(c.id) && prev.size === 0) next.add(c.id);
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [components.map((c: any) => c.id).join(",")]);

  const allOpen = components.length > 0 && components.every((c: any) => openIds.has(c.id));
  const collapseAll = () => setOpenIds(new Set());
  const expandAll = () => setOpenIds(new Set(components.map((c: any) => c.id)));
  const toggleOne = (id: string) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const addComponent = async () => {
    if (!newName.trim()) return;
    const payload: any = parentKind === "component_type"
      ? { component_type_id: group.id, name: newName.trim(), sort_order: components.length }
      : { equipment_id: group.id, name: newName.trim(), sort_order: components.length };
    const { error } = await supabase.from("components").insert(payload);
    if (error) toast.error(error.message);
    else { setNewName(""); setAdding(false); onChange(); }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );
  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = components.findIndex((c: any) => c.id === active.id);
    const newIdx = components.findIndex((c: any) => c.id === over.id);
    const next = arrayMove(components, oldIdx, newIdx);
    await Promise.all(next.map((c: any, i: number) =>
      supabase.from("components").update({ sort_order: i }).eq("id", c.id)));
    onChange();
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">Components</h2>
        <div className="flex items-center gap-2">
          {components.length > 0 && (
            <Button size="sm" variant="outline" onClick={allOpen ? collapseAll : expandAll}>
              {allOpen ? (
                <><ChevronsDownUp className="mr-1 h-4 w-4" /> Collapse all</>
              ) : (
                <><ChevronsUpDown className="mr-1 h-4 w-4" /> Expand all</>
              )}
            </Button>
          )}
          {canEdit && !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add component
            </Button>
          )}
        </div>
      </div>
      {adding && (
        <div className="flex max-w-md gap-2">
          <Input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)}
            placeholder="Component name" onKeyDown={(e) => e.key === "Enter" && addComponent()} />
          <Button size="sm" onClick={addComponent}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
        </div>
      )}
      {components.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">No components yet. Add the first one to start tracking checks.</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={components.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-3">
            {components.map((c: any) => (
              <ComponentBlock key={c.id} component={c} canEdit={canEdit} onChange={onChange}
                open={openIds.has(c.id)} onToggleOpen={() => toggleOne(c.id)} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

// Kept for after-sales / extra-works pages
export function ChapterGroupCard({ group, canEdit, onChange }: any) {
  const allItems = (group.components ?? [])
    .filter((c: any) => !c.deleted_at)
    .flatMap((c: any) => c.checklist_items ?? []);
  const prog = calcProgress(allItems);
  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold">{group.name}</h3>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total} · {prog.pct}%</span>
        </div>
        <ProgressBar value={prog.pct} size="sm" className="mb-4" />
        <ComponentsList group={group} canEdit={canEdit} onChange={onChange} />
      </CardContent>
    </Card>
  );
}

function ComponentBlock({ component, canEdit, onChange }: any) {
  const sortableArgs = useSortable({ id: component.id, disabled: !canEdit });
  const style = {
    transform: CSS.Transform.toString(sortableArgs.transform),
    transition: sortableArgs.transition,
    opacity: sortableArgs.isDragging ? 0.6 : 1,
  };

  const allItems = (component.checklist_items ?? []).filter((i: any) => !i.deleted_at);
  const prog = calcProgress(allItems);

  const [open, setOpen] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(component.name);

  const photos = component.component_photos ?? [];
  const files = component.component_files ?? [];
  const [showNoteEditor, setShowNoteEditor] = useState(!!component.note);
  const [note, setNote] = useState(component.note ?? "");
  useEffect(() => { setNote(component.note ?? ""); }, [component.note]);

  const renameComponent = async () => {
    if (!name.trim() || name === component.name) { setEditingName(false); return; }
    const { error } = await supabase.from("components").update({ name: name.trim() }).eq("id", component.id);
    if (error) toast.error(error.message);
    else { setEditingName(false); onChange(); }
  };
  const deleteComponent = async () => {
    const { error } = await supabase.from("components").update({ deleted_at: new Date().toISOString() }).eq("id", component.id);
    if (error) toast.error(error.message);
    else { toast.success("Component removed"); onChange(); }
  };
  const saveNote = async () => {
    if (note === (component.note ?? "")) return;
    const { error } = await supabase.from("components").update({ note: note || null }).eq("id", component.id);
    if (error) toast.error(error.message); else onChange();
  };
  const uploadPhoto = async (file: File) => {
    const path = `component/${component.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("component_photos").insert({ component_id: component.id, storage_path: path });
    onChange();
  };
  const uploadFile = async (file: File) => {
    const path = `component/${component.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("component_files").insert({ component_id: component.id, storage_path: path, file_name: file.name });
    onChange();
  };
  const removePhoto = async (p: any) => {
    await supabase.storage.from("photos").remove([p.storage_path]);
    await supabase.from("component_photos").delete().eq("id", p.id);
    onChange();
  };
  const removeFile = async (f: any) => {
    await supabase.storage.from("files").remove([f.storage_path]);
    await supabase.from("component_files").delete().eq("id", f.id);
    onChange();
  };

  return (
    <div ref={sortableArgs.setNodeRef} style={style}
      className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
        {canEdit && (
          <button {...sortableArgs.attributes} {...sortableArgs.listeners}
            className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <button onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground">
          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        {editingName ? (
          <div className="flex flex-1 items-center gap-2">
            <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") renameComponent(); }}
              className="h-7" />
            <Button size="icon" variant="ghost" onClick={renameComponent}><Check className="h-4 w-4" /></Button>
            <Button size="icon" variant="ghost" onClick={() => { setEditingName(false); setName(component.name); }}><X className="h-4 w-4" /></Button>
          </div>
        ) : (
          <span className="flex flex-1 items-center gap-2 font-semibold">
            {component.name}
            {canEdit && (
              <button onClick={() => setEditingName(true)}
                className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent">
                <Pencil className="h-3 w-3 text-muted-foreground" />
              </button>
            )}
          </span>
        )}
        <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total}</span>
        <div className="hidden w-24 sm:block"><ProgressBar value={prog.pct} size="sm" /></div>
        <span className="w-10 text-right font-mono text-xs tabular-nums">{prog.pct}%</span>
        {canEdit && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <button className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent">
                <Trash2 className="h-4 w-4 text-destructive" />
              </button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete "{component.name}"?</AlertDialogTitle>
                <AlertDialogDescription>All items inside will be hidden.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={deleteComponent}>Delete</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {open && (
        <div className="space-y-3 p-3">
          {canEdit && (
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setShowNoteEditor(true)}
                className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">
                <StickyNote className="h-3 w-3" /> Note
              </button>
              <PhotoPicker onPick={uploadPhoto}>
                <button className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">
                  <Camera className="h-3 w-3" /> Photo
                </button>
              </PhotoPicker>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">
                <Paperclip className="h-3 w-3" /> File
                <input type="file" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              </label>
            </div>
          )}

          {(showNoteEditor || component.note) && (
            <Textarea value={note} disabled={!canEdit}
              onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
              placeholder="Component note…" className="min-h-[50px] text-xs" />
          )}

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
              {photos.map((p: any) => (
                <PhotoTile key={p.id} path={p.storage_path} canEdit={canEdit} onRemove={() => removePhoto(p)} />
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className="space-y-1">
              {files.map((f: any) => (
                <FileChip key={f.id} f={f} canEdit={canEdit} onRemove={() => removeFile(f)} />
              ))}
            </div>
          )}

          <div className="rounded-md border border-dashed bg-background p-2">
            <ChecklistTree
              componentId={component.id}
              items={allItems}
              canEdit={canEdit}
              onChange={onChange}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function ExtraWorkChapterView({ group, canEdit, onChange }: any) {
  return <ChapterGroupCard group={group} canEdit={canEdit} onChange={onChange} />;
}
