import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus, GripVertical, ChevronRight, ChevronDown, Camera, Paperclip,
  StickyNote, ListPlus, X, Globe, Lock, ClipboardPaste, Check,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";
import { useClipboard, pasteItem } from "@/lib/clipboard";
import { useTreeAction } from "@/components/TreeAction";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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
  const { clip, clear } = useClipboard();
  const action = useTreeAction();
  const inMode = action?.mode !== "none" && !!action;

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

  const pasteHere = async () => {
    if (clip?.kind !== "item") return;
    try {
      await pasteItem(clip, { component_id: componentId, parent_item_id: null, sort_order: rootItems.length });
      clear();
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
        <div className="flex flex-wrap justify-end gap-1">
          {clip?.kind === "item" && !inMode && (
            <Button size="sm" variant="outline" onClick={pasteHere}
              title={`Paste ${clip.nodes.length} item${clip.nodes.length > 1 ? "s" : ""}`}>
              <ClipboardPaste className="mr-1 h-4 w-4" /> Paste
              {clip.nodes.length > 1 ? ` ${clip.nodes.length}` : ""}
            </Button>
          )}
          {!adding && !inMode && (
            <Button size="sm" onClick={() => setAdding(true)}>
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
  const { clip, clear: clearClip } = useClipboard();
  const action = useTreeAction();
  const mode = action?.mode ?? "none";
  const inMode = mode !== "none";
  const selected = !!action?.isSelected(item.id);

  const subs = allItems
    .filter((i: any) => i.parent_item_id === item.id)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const photos = item.item_photos ?? [];
  const files = item.item_files ?? [];
  const ownNote = (item.note ?? "").trim() !== "";
  const hasContent = !!item.note || subs.length > 0 || photos.length > 0 || files.length > 0;
  const [open, setOpen] = useState(false);
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [note, setNote] = useState(item.note ?? "");
  const [addingSub, setAddingSub] = useState(false);
  const [subText, setSubText] = useState("");

  useEffect(() => { setNote(item.note ?? ""); }, [item.note]);

  const [editingLabel, setEditingLabel] = useState(false);
  const [label, setLabel] = useState(item.label);
  useEffect(() => { setLabel(item.label); }, [item.label]);
  const saveLabel = async () => {
    const trimmed = label.trim();
    setEditingLabel(false);
    if (!trimmed || trimmed === item.label) { setLabel(item.label); return; }
    const { error } = await supabase.from("checklist_items").update({ label: trimmed }).eq("id", item.id);
    if (error) toast.error(error.message); else onChange();
  };

  const toggle = async () => {
    const { error } = await supabase.from("checklist_items")
      .update({ done: !item.done, completed_at: !item.done ? new Date().toISOString() : null })
      .eq("id", item.id);
    if (error) toast.error(error.message); else onChange();
  };
  const pasteAsSub = async () => {
    if (clip?.kind !== "item") return;
    try {
      await pasteItem(clip, { component_id: item.component_id, parent_item_id: item.id, sort_order: subs.length });
      clearClip();
      setOpen(true);
      toast.success("Pasted"); onChange();
    } catch (e: any) { toast.error(e.message ?? "Paste failed"); }
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

  const canExpand = (hasContent || canEdit) && !inMode;

  const onRowClick = () => action?.toggle(item.id, { kind: "item", payload: { item, allItems } });

  const row = (
    <div
      className={`flex items-center gap-1 px-2 py-1.5 ${inMode ? "cursor-pointer" : ""} ${
        mode === "delete" ? (selected ? "bg-destructive/15" : "bg-destructive/5 hover:bg-destructive/10") :
        mode === "copy" ? (selected ? "bg-primary/15" : "bg-primary/5 hover:bg-primary/10") : ""
      }`}
      onClick={inMode ? onRowClick : undefined}
    >
      {sortable && canEdit && !inMode && (
        <button {...sortableArgs.attributes} {...sortableArgs.listeners}
          className="cursor-grab touch-none p-1 active:cursor-grabbing">
          <GripVertical className="h-3.5 w-3.5 text-muted-foreground" />
        </button>
      )}
      {!inMode && (
        <button onClick={() => canExpand && setOpen((v) => !v)}
          className={`p-0.5 ${canExpand ? "text-muted-foreground hover:text-foreground" : "invisible"}`}>
          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </button>
      )}
      {inMode && (
        <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${selected ? (mode === "delete" ? "border-destructive bg-destructive text-destructive-foreground" : "border-primary bg-primary text-primary-foreground") : "border-muted-foreground/30"}`}>
          {selected && <Check className="h-2.5 w-2.5" />}
        </span>
      )}
      {!inMode && <Checkbox checked={item.done} disabled={!canEdit} onCheckedChange={toggle} />}
      {!inMode && editingLabel && canEdit ? (
        <Input
          value={label}
          autoFocus
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
          onDoubleClick={() => !inMode && canEdit && setEditingLabel(true)}
          title={!inMode && canEdit ? "Double-click to rename" : undefined}
          className={`flex-1 text-sm ${item.done && !inMode ? "text-muted-foreground line-through" : ""}`}
        >{item.label}</span>
      )}
      {/* compact indicators when collapsed */}
      {!inMode && !open && (
        <span className="flex items-center gap-1.5">
          {ownNote && <StickyNote className="h-3 w-3 text-primary" aria-label="has note" />}
          {photos.length > 0 && <Camera className="h-3 w-3 text-primary" aria-label="has photos" />}
          {files.length > 0 && <Paperclip className="h-3 w-3 text-primary" aria-label="has files" />}
        </span>
      )}
    </div>
  );

  return (
    <li ref={sortable ? sortableArgs.setNodeRef : undefined} style={style}
      className={`rounded-md border bg-card ${
        mode === "delete" ? (selected ? "border-destructive" : "border-destructive/40") :
        mode === "copy" ? (selected ? "border-primary" : "border-primary/40") : ""
      }`}>
      {row}
      {open && !inMode && (
        <div className="border-t bg-muted/10">
          {canEdit && (
            <div className="flex flex-nowrap items-center gap-1 border-b border-dashed px-2 py-1 sm:px-3 sm:py-1.5">
              <ActionBtn onClick={() => setShowNoteEditor((v) => !v)}
                icon={<StickyNote className="h-3.5 w-3.5" />} label="Note" active={ownNote} iconOnly />
              {depth < 2 && (
                <ActionBtn onClick={() => setAddingSub(true)}
                  icon={<ListPlus className="h-3.5 w-3.5" />} label="Subtask" iconOnly />
              )}
              <PhotoPicker onPick={uploadPhoto}>
                <button title="Photo"
                  className={`inline-flex items-center justify-center rounded p-1 hover:bg-accent hover:text-foreground ${photos.length > 0 ? "text-primary" : "text-muted-foreground"}`}>
                  <Camera className="h-3.5 w-3.5" />
                </button>
              </PhotoPicker>
              <label title="File"
                className={`inline-flex cursor-pointer items-center justify-center rounded p-1 hover:bg-accent hover:text-foreground ${files.length > 0 ? "text-primary" : "text-muted-foreground"}`}>
                <Paperclip className="h-3.5 w-3.5" />
                <input type="file" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
              </label>
              {clip?.kind === "item" && depth < 2 && (
                <button onClick={pasteAsSub}
                  className="inline-flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title={`Paste ${clip.nodes.length} item${clip.nodes.length > 1 ? "s" : ""}`}>
                  <ClipboardPaste className="h-3.5 w-3.5" />
                  {clip.nodes.length > 1 ? <span className="ml-0.5 text-[10px]">{clip.nodes.length}</span> : null}
                </button>
              )}
            </div>
          )}

          {showNoteEditor && (
            <div className="space-y-1 px-3 py-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Note</span>
                {canEdit && (
                  <button
                    onClick={async () => {
                      const { error } = await supabase.from("checklist_items")
                        .update({ note_shared: !item.note_shared }).eq("id", item.id);
                      if (error) toast.error(error.message); else onChange();
                    }}
                    title={item.note_shared ? "Note shared across all lines — click to make local" : "Note local to this line — click to share across all lines"}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${item.note_shared ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}
                  >
                    {item.note_shared ? <><Globe className="h-3 w-3" /> Shared</> : <><Lock className="h-3 w-3" /> Local</>}
                  </button>
                )}
              </div>
              <Textarea value={note} disabled={!canEdit} autoFocus
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => { saveNote(); if (!note.trim()) setShowNoteEditor(false); }}
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

      {/* Render subs even in modes so they're targetable */}
      {inMode && subs.length > 0 && (
        <ul className="space-y-1 border-l-2 border-primary/20 px-2 py-2 ml-4">
          {subs.map((s: any) => (
            <TreeNode key={s.id} item={s} allItems={allItems} canEdit={canEdit}
              onChange={onChange} depth={depth + 1} sortable={false} />
          ))}
        </ul>
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
