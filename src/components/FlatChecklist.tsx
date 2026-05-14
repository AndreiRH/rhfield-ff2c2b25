import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, GripVertical, ChevronRight, ChevronDown, Camera, StickyNote, ListTree } from "lucide-react";
import { toast } from "sonner";
import { calcProgress, itemsFromGroup } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

// Flat checklist with per-item note, photo, and subtasks.
export function FlatChecklist({ group, canEdit, onChange }: any) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  const directComps = (group?.components ?? []).filter((c: any) => !c.deleted_at);
  const typeComps = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .flatMap((t: any) => (t.components ?? []).filter((c: any) => !c.deleted_at));
  const bucket = directComps[0] ?? typeComps[0] ?? null;

  const allItems = (bucket?.checklist_items ?? []).filter((i: any) => !i.deleted_at);
  const rootItems = allItems
    .filter((i: any) => !i.parent_item_id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const overall = calcProgress(itemsFromGroup(group));

  const ensureBucket = async (): Promise<string | null> => {
    if (bucket) return bucket.id;
    if (!group) return null;
    const { data, error } = await supabase.from("components")
      .insert({ equipment_id: group.id, name: "Checklist", sort_order: 0 })
      .select("id").single();
    if (error) { toast.error(error.message); return null; }
    return data.id;
  };

  const addItem = async () => {
    if (!text.trim()) return;
    const compId = await ensureBucket();
    if (!compId) return;
    const { error } = await supabase.from("checklist_items").insert({
      component_id: compId, label: text.trim(), sort_order: rootItems.length,
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
    await Promise.all(
      next.map((it: any, i: number) =>
        supabase.from("checklist_items").update({ sort_order: i }).eq("id", it.id),
      ),
    );
    onChange();
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {overall.done}/{overall.total} · {overall.pct}%
          </span>
          {canEdit && !adding && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" /> Add item
            </Button>
          )}
        </div>
        <ProgressBar value={overall.pct} size="sm" />

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
          <p className="text-sm text-muted-foreground">No items yet.</p>
        )}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rootItems.map((i: any) => i.id)} strategy={verticalListSortingStrategy}>
            <ul className="space-y-1">
              {rootItems.map((it: any) => (
                <ChecklistRow
                  key={it.id}
                  item={it}
                  allItems={allItems}
                  canEdit={canEdit}
                  onChange={onChange}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}

function ChecklistRow({ item, allItems, canEdit, onChange }: any) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  const subs = allItems
    .filter((i: any) => i.parent_item_id === item.id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const photos = item.item_photos ?? [];
  const hasExtras = !!item.note || subs.length > 0 || photos.length > 0;

  const [open, setOpen] = useState(hasExtras);
  const [showNote, setShowNote] = useState(!!item.note);
  const [note, setNote] = useState(item.note ?? "");
  const [addingSub, setAddingSub] = useState(false);
  const [subText, setSubText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

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
      component_id: item.component_id,
      label: subText.trim(),
      parent_item_id: item.id,
      sort_order: subs.length,
    });
    if (error) toast.error(error.message);
    else { setSubText(""); setAddingSub(false); onChange(); }
  };

  const toggleSub = async (s: any) => {
    const { error } = await supabase.from("checklist_items")
      .update({ done: !s.done, completed_at: !s.done ? new Date().toISOString() : null })
      .eq("id", s.id);
    if (error) toast.error(error.message); else onChange();
  };
  const removeSub = async (s: any) => {
    const { error } = await supabase.from("checklist_items")
      .update({ deleted_at: new Date().toISOString() }).eq("id", s.id);
    if (error) toast.error(error.message); else onChange();
  };

  const uploadPhoto = async (file: File) => {
    const path = `checklist/${item.id}/${Date.now()}-${file.name}`;
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("item_photos").insert({ item_id: item.id, storage_path: path });
    onChange();
  };

  const expandable = canEdit || hasExtras;

  return (
    <li ref={setNodeRef} style={style} className="rounded-md border bg-card">
      <div className="flex items-center gap-1 px-2 py-1.5">
        {canEdit && (
          <button {...attributes} {...listeners} className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
        )}
        <Checkbox checked={item.done} disabled={!canEdit} onCheckedChange={toggle} />
        <span className={`flex-1 text-sm ${item.done ? "text-muted-foreground line-through" : ""}`}>{item.label}</span>
        {expandable && (
          <button onClick={() => setOpen((v) => !v)} className="p-1 text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        )}
        {canEdit && (
          <button onClick={remove} className="p-1">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </button>
        )}
      </div>
      {open && (
        <div className="space-y-2 border-t bg-muted/20 px-3 py-2">
          {canEdit && (
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowNote((v) => !v)}>
                <StickyNote className="mr-1 h-3 w-3" /> Note
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setAddingSub((v) => !v)}>
                <ListTree className="mr-1 h-3 w-3" /> Subtask
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => fileRef.current?.click()}>
                <Camera className="mr-1 h-3 w-3" /> Photo
              </Button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
            </div>
          )}

          {(showNote || item.note) && (
            <Textarea
              value={note}
              disabled={!canEdit}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveNote}
              placeholder="Note…"
              className="min-h-[50px] text-xs"
            />
          )}

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-1">
              {photos.map((p: any) => <ItemPhoto key={p.id} path={p.storage_path} photoId={p.id} canEdit={canEdit} onChange={onChange} />)}
            </div>
          )}

          {(subs.length > 0 || addingSub) && (
            <ul className="space-y-1 border-l-2 border-muted pl-2">
              {subs.map((s: any) => (
                <li key={s.id} className="flex items-center gap-1">
                  <Checkbox checked={s.done} disabled={!canEdit} onCheckedChange={() => toggleSub(s)} />
                  <span className={`flex-1 text-xs ${s.done ? "text-muted-foreground line-through" : ""}`}>{s.label}</span>
                  {canEdit && (
                    <button onClick={() => removeSub(s)} className="p-1">
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </button>
                  )}
                </li>
              ))}
              {addingSub && (
                <li className="flex gap-1">
                  <Input value={subText} autoFocus onChange={(e) => setSubText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && addSub()}
                    placeholder="Subtask" className="h-7 text-xs" />
                  <Button size="sm" className="h-7" onClick={addSub}>Add</Button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function ItemPhoto({ path, photoId, canEdit, onChange }: { path: string; photoId: string; canEdit: boolean; onChange: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("photos").createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  }, [path]);
  const remove = async () => {
    await supabase.storage.from("photos").remove([path]);
    await supabase.from("item_photos").delete().eq("id", photoId);
    onChange();
  };
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
        <button onClick={remove} className="absolute right-0 top-0 rounded-bl bg-black/60 p-0.5 text-white">
          <Trash2 className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
