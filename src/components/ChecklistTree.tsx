import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, Trash2, GripVertical, ChevronRight, ChevronDown, Camera, Paperclip,
  StickyNote, ListPlus, X,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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

// Reusable rich checklist tree (notes, photos, files, subtasks, drag reorder).
// Pass the full `items` list (already filtered to non-deleted) for one component
// and the `componentId` so subtasks/new items get inserted in the right place.
export function ChecklistTree({
  componentId, items, canEdit, onChange,
  emptyHint = "No items yet.",
}: {
  componentId: string;
  items: any[];
  canEdit: boolean;
  onChange: () => void;
  emptyHint?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  const rootItems = items
    .filter((i: any) => !i.parent_item_id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const addItem = async () => {
    if (!text.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      component_id: componentId, label: text.trim(), sort_order: rootItems.length,
    });
    if (error) toast.error(error.message);
    else { setText(""); setAdding(false); onChange(); }
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = rootItems.findIndex((i: any) => i.id === active.id);
    const newIdx = rootItems.findIndex((i: any) => i.id === over.id);
    const next = arrayMove(rootItems, oldIdx, newIdx);
    await Promise.all(next.map((it: any, i: number) =>
      supabase.from("checklist_items").update({ sort_order: i }).eq("id", it.id)));
    onChange();
  };

  return (
    <div className="space-y-2">
      {canEdit && (
        <div className="flex justify-end">
          {!adding && (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add item
            </Button>
          )}
        </div>
      )}
      {adding && (
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
              <TreeNode key={it.id} item={it} allItems={items} canEdit={canEdit}
                onChange={onChange} depth={0} sortable />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function TreeNode({ item, allItems, canEdit, onChange, depth, sortable }: any) {
  const sortableArgs = useSortable({ id: item.id, disabled: !sortable });
  const style = sortable
    ? { transform: CSS.Transform.toString(sortableArgs.transform), transition: sortableArgs.transition, opacity: sortableArgs.isDragging ? 0.6 : 1 }
    : undefined;

  const subs = allItems
    .filter((i: any) => i.parent_item_id === item.id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const photos = item.item_photos ?? [];
  const files = item.item_files ?? [];
  const hasContent = !!item.note || subs.length > 0 || photos.length > 0 || files.length > 0;
  const [open, setOpen] = useState(hasContent);
  const [showNoteEditor, setShowNoteEditor] = useState(!!item.note);
  const [note, setNote] = useState(item.note ?? "");
  const [addingSub, setAddingSub] = useState(false);
  const [subText, setSubText] = useState("");

  useEffect(() => { setNote(item.note ?? ""); }, [item.note]);

  const toggle = async () => {
    const { error } = await supabase.from("checklist_items")
      .update({ done: !item.done, completed_at: !item.done ? new Date().toISOString() : null })
      .eq("id", item.id);
    if (error) toast.error(error.message); else onChange();
  };
  const remove = async () => {
    const { error } = await supabase.from("checklist_items")
      .update({ deleted_at: new Date().toISOString() }).eq("id", item.id);
    if (error) toast.error(error.message); else onChange();
  };
  const saveNote = async () => {
    if (note === (item.note ?? "")) return;
    const { error } = await supabase.from("checklist_items").update({ note: note || null }).eq("id", item.id);
    if (error) toast.error(error.message); else onChange();
  };
  const addSub = async () => {
    if (!subText.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      component_id: item.component_id, label: subText.trim(),
      parent_item_id: item.id, sort_order: subs.length,
    });
    if (error) toast.error(error.message);
    else { setSubText(""); setAddingSub(false); setOpen(true); onChange(); }
  };
  const uploadPhoto = async (file: File) => {
    const path = `checklist/${item.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("item_photos").insert({ item_id: item.id, storage_path: path });
    setOpen(true); onChange();
  };
  const uploadFile = async (file: File) => {
    const path = `checklist/${item.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("item_files").insert({ item_id: item.id, storage_path: path, file_name: file.name });
    setOpen(true); onChange();
  };
  const removePhoto = async (p: any) => {
    await supabase.storage.from("photos").remove([p.storage_path]);
    await supabase.from("item_photos").delete().eq("id", p.id);
    onChange();
  };
  const removeFile = async (f: any) => {
    await supabase.storage.from("files").remove([f.storage_path]);
    await supabase.from("item_files").delete().eq("id", f.id);
    onChange();
  };

  const canExpand = hasContent || canEdit;

  const row = (
    <div className="flex items-center gap-1 px-2 py-1.5">
      {sortable && canEdit && (
        <button {...sortableArgs.attributes} {...sortableArgs.listeners}
          className="cursor-grab touch-none p-1 active:cursor-grabbing">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
      <button onClick={() => canExpand && setOpen((v) => !v)}
        className={`p-0.5 ${canExpand ? "text-muted-foreground hover:text-foreground" : "invisible"}`}>
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>
      <Checkbox checked={item.done} disabled={!canEdit} onCheckedChange={toggle} />
      <span className={`flex-1 text-sm ${item.done ? "text-muted-foreground line-through" : ""}`}>{item.label}</span>
      {canEdit && (
        <DeleteItemButton itemLabel={item.label} onConfirm={remove} />
      )}
    </div>
  );

  return (
    <li ref={sortable ? sortableArgs.setNodeRef : undefined} style={style}
      className="rounded-md border bg-card">
      {row}
      {open && (
        <div className="border-t bg-muted/10">
          {canEdit && (
            <div className="flex flex-wrap gap-1 border-b border-dashed px-3 py-1.5">
              <ActionBtn onClick={() => { setShowNoteEditor(true); }} icon={<StickyNote className="h-3 w-3" />} label="Note" />
              <ActionBtn onClick={() => setAddingSub(true)} icon={<ListPlus className="h-3 w-3" />} label="Subtask" />
              <PhotoPicker onPick={uploadPhoto}>
                <button className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Camera className="h-3 w-3" /> Photo
                </button>
              </PhotoPicker>
              <label className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                <Paperclip className="h-3 w-3" /> File
                <input type="file" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              </label>
            </div>
          )}

          {(showNoteEditor || item.note) && (
            <div className="px-3 py-2">
              <Textarea value={note} disabled={!canEdit}
                onChange={(e) => setNote(e.target.value)} onBlur={saveNote}
                placeholder="Note…" className="min-h-[50px] text-xs" />
            </div>
          )}

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-1 px-3 pb-2">
              {photos.map((p: any) => <PhotoTile key={p.id} path={p.storage_path}
                canEdit={canEdit} onRemove={() => removePhoto(p)} />)}
            </div>
          )}

          {files.length > 0 && (
            <div className="space-y-1 px-3 pb-2">
              {files.map((f: any) => <FileChip key={f.id} f={f} canEdit={canEdit} onRemove={() => removeFile(f)} />)}
            </div>
          )}

          {(subs.length > 0 || addingSub) && (
            <div className="space-y-1 border-l-2 border-primary/20 px-2 py-2 ml-4">
              <ul className="space-y-1">
                {subs.map((s: any) => (
                  <TreeNode key={s.id} item={s} allItems={allItems} canEdit={canEdit}
                    onChange={onChange} depth={depth + 1} sortable={false} />
                ))}
              </ul>
              {addingSub && (
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

function ActionBtn({ onClick, icon, label }: any) {
  return (
    <button onClick={onClick}
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
      {icon} {label}
    </button>
  );
}

export function PhotoTile({ path, canEdit, onRemove }: { path: string; canEdit: boolean; onRemove: () => void }) {
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
          <img src={url} alt="" className="h-16 w-full rounded border object-cover" />
        </a>
      ) : (
        <div className="h-16 animate-pulse rounded bg-muted" />
      )}
      {canEdit && (
        <button onClick={onRemove} className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

export function FileChip({ f, canEdit, onRemove }: { f: any; canEdit: boolean; onRemove: () => void }) {
  const open = async () => {
    const { data } = await supabase.storage.from("files").createSignedUrl(f.storage_path, 60);
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };
  return (
    <div className="flex items-center gap-1 rounded border bg-muted/30 px-2 py-1 text-xs">
      <button onClick={open} className="flex flex-1 items-center gap-1 text-left hover:underline">
        <Paperclip className="h-3 w-3" /> <span className="truncate">{f.file_name}</span>
      </button>
      {canEdit && (
        <button onClick={onRemove} className="text-destructive hover:opacity-80">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function DeleteItemButton({ itemLabel, onConfirm }: { itemLabel: string; onConfirm: () => void | Promise<void> }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const close = () => setStep(0);
  return (
    <>
      <button onClick={() => setStep(1)} className="p-1 opacity-60 hover:opacity-100">
        <Trash2 className="h-3.5 w-3.5 text-destructive" />
      </button>
      <AlertDialog open={step === 1} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{itemLabel}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This checklist item is shared across all 10 lines. Deleting it here will remove it from every line in the project.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); setStep(2); }}>Continue</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={step === 2} onOpenChange={(o) => !o && close()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
            <AlertDialogDescription>
              Final confirmation: "{itemLabel}" will be permanently deleted from all 10 lines. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { await onConfirm(); close(); }}>Delete from all lines</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
