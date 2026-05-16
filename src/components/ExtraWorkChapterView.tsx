import { useEffect, useState, type MouseEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress, liveChecklistItems } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Plus, Check, GripVertical, ChevronDown, ChevronRight,
  StickyNote, Camera, Paperclip, Search, Globe, Lock,
  ClipboardPaste, Trash2, Copy,
} from "lucide-react";
import { toast } from "sonner";
import { ChecklistTree, PhotoTile, FileChip } from "@/components/ChecklistTree";
import { PhotoPicker } from "@/components/PhotoPicker";
import { rememberLocalFile } from "@/lib/local-blobs";
import { useClipboard, pasteComponent } from "@/lib/clipboard";
import { useTreeAction } from "@/components/TreeAction";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { localUuid } from "@/lib/local-id";

export function ComponentsList({ group, canEdit, onChange, parentKind = "equipment_group", externalSearch, hideTitle, defaultOpen }: any) {
  const components = (group.components ?? [])
    .filter((c: any) => !c.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const action = useTreeAction();
  const mode = action?.mode ?? "none";
  const inMode = mode !== "none";
  const inSelectMode = mode === "delete" || mode === "copy";

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [internalSearch, setInternalSearch] = useState("");
  const usingExternal = typeof externalSearch === "string";
  const search = usingExternal ? externalSearch : internalSearch;
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const { clip, clear } = useClipboard();

  const pasteComponentHere = async () => {
    if (clip?.kind !== "component") return;
    try {
      const parent = parentKind === "component_type" ? { component_type_id: group.id } : { equipment_id: group.id };
      await pasteComponent(clip, parent, components.length);
      clear();
      toast.success("Pasted"); onChange();
    } catch (e: any) { toast.error(e.message ?? "Paste failed"); }
  };

  const q = search.trim().toLowerCase();
  const visible = q ? components.filter((c: any) => (c.name ?? "").toLowerCase().includes(q)) : components;

  useEffect(() => {
    setOpenIds((prev) => {
      const next = new Set<string>();
      for (const c of components) if (prev.has(c.id)) next.add(c.id);
      return next;
    });
  }, [components.map((c: any) => c.id).join(",")]);

  // Auto-expand all components when entering any action mode, or when defaultOpen flips on.
  useEffect(() => {
    if (inMode || defaultOpen) setOpenIds(new Set(components.map((c: any) => c.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMode, defaultOpen]);

  const toggleOne = (id: string) => setOpenIds((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const addComponent = async () => {
    if (!newName.trim()) return;
    const id = localUuid();
    const payload: any = parentKind === "component_type"
      ? { id, component_type_id: group.id, name: newName.trim(), sort_order: components.length }
      : { id, equipment_id: group.id, name: newName.trim(), sort_order: components.length };
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
        {!hideTitle ? (
          <h2 className="text-base font-semibold uppercase tracking-wide text-muted-foreground">Components</h2>
        ) : <span />}
        <div className="flex items-center gap-2">
          {canEdit && !inMode && clip?.kind === "component" && (
            <Button size="sm" variant="outline" onClick={pasteComponentHere}
              title={`Paste ${clip.nodes.length} component${clip.nodes.length > 1 ? "s" : ""}`}
              aria-label="Paste">
              <ClipboardPaste className="h-4 w-4" />
              {clip.nodes.length > 1 ? <span className="ml-1">{clip.nodes.length}</span> : null}
            </Button>
          )}
          {canEdit && !adding && !inMode && (
            <Button size="sm" onClick={() => setAdding(true)} title="Add component" aria-label="Add component">
              <Plus className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Add component</span>
            </Button>
          )}
        </div>
      </div>

      {!usingExternal && !hideTitle && components.length > 1 && !inMode && (
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={internalSearch}
            onChange={(e) => setInternalSearch(e.target.value)}
            placeholder="Search components by title…"
            className="h-8 pl-7 text-sm"
          />
        </div>
      )}

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
      {q && visible.length === 0 && (
        <p className="text-sm text-muted-foreground">No components match "{search}".</p>
      )}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible.map((c: any) => c.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {visible.map((c: any) => (
              <ComponentBlock key={c.id} component={c} canEdit={canEdit} onChange={onChange}
                open={openIds.has(c.id)} onToggleOpen={() => toggleOne(c.id)} defaultOpen={defaultOpen} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

export function ChapterGroupCard({ group, canEdit, onChange }: any) {
  const allItems = (group.components ?? [])
    .filter((c: any) => !c.deleted_at)
    .flatMap((c: any) => liveChecklistItems(c.checklist_items ?? []));
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

function ComponentBlock({ component, canEdit, onChange, open: openProp, onToggleOpen, defaultOpen }: any) {
  const action = useTreeAction();
  const mode = action?.mode ?? "none";
  const inMode = mode !== "none";
  const inSelectMode = mode === "delete" || mode === "copy";
  const inReorder = mode === "reorder";
  const selected = !!action?.isSelected(component.id);
  const sortableArgs = useSortable({ id: component.id, disabled: !canEdit || !inReorder });
  const style = {
    transform: CSS.Transform.toString(sortableArgs.transform),
    transition: sortableArgs.transition,
    opacity: sortableArgs.isDragging ? 0.6 : 1,
  };

  const allItems = liveChecklistItems(component.checklist_items ?? []);
  const prog = calcProgress(allItems);
  const ownNote = (component.note ?? "").trim() !== "";
  const notesCount =
    (ownNote ? 1 : 0) +
    allItems.filter((i: any) => (i.note ?? "").trim() !== "").length;
  const photosCount =
    (component.component_photos?.length ?? 0) +
    allItems.reduce((acc: number, i: any) => acc + (i.item_photos?.length ?? 0), 0);
  const filesCount =
    (component.component_files?.length ?? 0) +
    allItems.reduce((acc: number, i: any) => acc + (i.item_files?.length ?? 0), 0);

  const [internalOpen, setInternalOpen] = useState(true);
  const open = openProp ?? internalOpen;
  const toggleOpen = () => { if (onToggleOpen) onToggleOpen(); else setInternalOpen((o) => !o); };
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(component.name);

  const photos = component.component_photos ?? [];
  const files = component.component_files ?? [];
  const [showNoteEditor, setShowNoteEditor] = useState(false);
  const [showPhotos, setShowPhotos] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [note, setNote] = useState(component.note ?? "");
  useEffect(() => { setNote(component.note ?? ""); }, [component.note]);

  const renameComponent = async () => {
    if (!name.trim() || name === component.name) { setEditingName(false); return; }
    const { error } = await supabase.from("components").update({ name: name.trim() }).eq("id", component.id);
    if (error) toast.error(error.message);
    else { setEditingName(false); onChange(); }
  };
  const saveNote = async () => {
    if (note === (component.note ?? "")) return;
    const { error } = await supabase.from("components").update({ note: note || null }).eq("id", component.id);
    if (error) toast.error(error.message); else onChange();
  };
  const uploadPhoto = async (file: File) => {
    const path = `component/${component.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("photos", path, file);
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("component_photos").insert({ id: localUuid(), component_id: component.id, storage_path: path });
    setShowPhotos(true); onChange();
  };
  const uploadFile = async (file: File) => {
    const path = `component/${component.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("files", path, file);
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(error.message); return; }
    await supabase.from("component_files").insert({ id: localUuid(), component_id: component.id, storage_path: path, file_name: file.name });
    setShowFiles(true); onChange();
  };
  const removePhoto = async (p: any) => {
    const { error } = await supabase.from("component_photos").delete().eq("id", p.id);
    if (error) { toast.error(error.message); return; }
    onChange();
    let undone = false;
    toast.success("Photo deleted", {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          undone = true;
          const { error: e } = await supabase.from("component_photos")
            .insert({ id: p.id, component_id: component.id, storage_path: p.storage_path });
          if (e) toast.error(e.message); else onChange();
        },
      },
    });
    setTimeout(async () => {
      if (!undone) await supabase.storage.from("photos").remove([p.storage_path]);
    }, 3500);
  };
  const removeFile = async (f: any) => {
    const { error } = await supabase.from("component_files").delete().eq("id", f.id);
    if (error) { toast.error(error.message); return; }
    onChange();
    let undone = false;
    toast.success("File deleted", {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          undone = true;
          const { error: e } = await supabase.from("component_files")
            .insert({ id: f.id, component_id: component.id, storage_path: f.storage_path, file_name: f.file_name });
          if (e) toast.error(e.message); else onChange();
        },
      },
    });
    setTimeout(async () => {
      if (!undone) await supabase.storage.from("files").remove([f.storage_path]);
    }, 3500);
  };

  const onTap = (event: MouseEvent) => {
    event.stopPropagation();
    action?.toggle(component.id, { kind: "component", payload: component });
  };

  return (
    <div ref={sortableArgs.setNodeRef} style={style}
      className={`ml-2 overflow-hidden rounded-lg border-l-4 border-y border-r bg-card shadow-sm ${
        mode === "delete" ? (selected ? "border-destructive border-l-destructive" : "border-destructive/40 border-l-destructive/60")
        : mode === "copy" ? (selected ? "border-primary border-l-primary" : "border-primary/40 border-l-primary/60")
        : prog.pct === 100 ? "border-success/40 border-l-success" : "border-border border-l-accent"
      }`}>
      <div
        className={`flex items-center gap-2 border-b px-3 py-2 ${
          mode === "delete" ? `cursor-pointer ${selected ? "bg-destructive/15" : "bg-destructive/5 hover:bg-destructive/10"}` :
          mode === "copy" ? `cursor-pointer ${selected ? "bg-primary/15" : "bg-primary/5 hover:bg-primary/10"}` :
          inReorder ? "bg-muted/40" :
          prog.pct === 100 ? "bg-success/10 cursor-pointer" : "bg-muted/40 cursor-pointer"
        }`}
        onClick={inSelectMode ? onTap : (inReorder ? undefined : toggleOpen)}
      >
        {canEdit && inReorder && (
          <button {...sortableArgs.attributes} {...sortableArgs.listeners}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
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
        {!inMode && editingName ? (
          <div className="flex flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
            <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") renameComponent(); }}
              className="h-7" />
            <Button size="icon" variant="ghost" onClick={renameComponent}><Check className="h-4 w-4" /></Button>
          </div>
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); !inMode && canEdit && setEditingName(true); }}
            title={!inMode && canEdit ? "Double-click to rename" : undefined}
            className="flex flex-1 items-center gap-2 font-semibold"
          >
            {component.name}
          </span>
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

      {(open || inMode) && !inMode && (
        <div className="space-y-3 p-3">
          {canEdit && (
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setShowNoteEditor((v) => !v)}
                className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] hover:bg-accent ${ownNote ? "border-primary text-primary" : "text-muted-foreground"}`}>
                <StickyNote className="h-3 w-3" /> Note
              </button>
              {photos.length === 0 ? (
                <PhotoPicker onPick={uploadPhoto}>
                  <button className="inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">
                    <Camera className="h-3 w-3" /> Photo
                  </button>
                </PhotoPicker>
              ) : (
                <button onClick={() => setShowPhotos((v) => !v)}
                  title={showPhotos ? "Hide photos" : "Show photos"}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] hover:bg-accent ${showPhotos ? "border-primary text-primary" : "border-primary/50 text-primary/80"}`}>
                  <Camera className="h-3 w-3" /> Photos {photos.length}
                </button>
              )}
              {files.length === 0 ? (
                <label className="inline-flex cursor-pointer items-center gap-1 rounded border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent">
                  <Paperclip className="h-3 w-3" /> File
                  <input type="file" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
                </label>
              ) : (
                <button onClick={() => setShowFiles((v) => !v)}
                  title={showFiles ? "Hide files" : "Show files"}
                  className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] hover:bg-accent ${showFiles ? "border-primary text-primary" : "border-primary/50 text-primary/80"}`}>
                  <Paperclip className="h-3 w-3" /> Files {files.length}
                </button>
              )}
            </div>
          )}

          {showNoteEditor && (
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Note</span>
                {canEdit && (
                  <button
                    onClick={async () => {
                      const { error } = await supabase.from("components")
                        .update({ note_shared: !component.note_shared }).eq("id", component.id);
                      if (error) toast.error(error.message); else onChange();
                    }}
                    title={component.note_shared ? "Note shared across all production lines — click to make local" : "Note local to this production line — click to share across all production lines"}
                    className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] ${component.note_shared ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent"}`}
                  >
                    {component.note_shared ? <><Globe className="h-3 w-3" /> Shared</> : <><Lock className="h-3 w-3" /> Local</>}
                  </button>
                )}
              </div>
              <Textarea value={note} disabled={!canEdit} autoFocus
                onChange={(e) => setNote(e.target.value)}
                onBlur={() => { saveNote(); if (!note.trim()) setShowNoteEditor(false); }}
                placeholder="Component note…" className="min-h-[50px] text-xs" />
            </div>
          )}

          {showPhotos && photos.length > 0 && (
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-1 sm:grid-cols-4">
                {photos.map((p: any) => (
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
              {files.map((f: any) => (
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

          <div className="rounded-md border border-dashed bg-background p-2">
            <ChecklistTree
              componentId={component.id}
              items={allItems}
              canEdit={canEdit}
              onChange={onChange}
              defaultOpen={defaultOpen}
            />
          </div>
        </div>
      )}

      {/* In copy/delete mode: render ONLY the checklist so items can be selected. */}
      {inMode && open && allItems.length > 0 && (
        <div className="p-3">
          <div className="rounded-md border border-dashed bg-background p-2">
            <ChecklistTree
              componentId={component.id}
              items={allItems}
              canEdit={canEdit}
              onChange={onChange}
              defaultOpen
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

export { Trash2, Copy };
