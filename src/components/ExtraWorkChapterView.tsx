import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Camera, X, CornerDownRight, Pencil, Check, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";

export function ComponentsList({ group, canEdit, onChange, parentKind = "equipment_group" }: any) {
  const components = (group.components ?? [])
    .filter((c: any) => !c.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const addComponent = async () => {
    if (!newName.trim()) return;
    const payload: any = parentKind === "component_type"
      ? { component_type_id: group.id, name: newName.trim(), sort_order: components.length }
      : { equipment_id: group.id, name: newName.trim(), sort_order: components.length };
    const { error } = await supabase.from("components").insert(payload);
    if (error) toast.error(error.message);
    else { setNewName(""); setAdding(false); onChange(); }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= components.length) return;
    const a = components[idx];
    const b = components[target];
    const { error: e1 } = await supabase.from("components").update({ sort_order: b.sort_order }).eq("id", a.id);
    const { error: e2 } = await supabase.from("components").update({ sort_order: a.sort_order }).eq("id", b.id);
    if (e1 || e2) toast.error((e1 ?? e2)!.message);
    else onChange();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Components</h2>
        {canEdit && !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add component
          </Button>
        )}
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
      <Accordion type="multiple" className="w-full">
        {components.map((c: any, idx: number) => (
          <ComponentBlock
            key={c.id}
            component={c}
            canEdit={canEdit}
            onChange={onChange}
            canMoveUp={idx > 0}
            canMoveDown={idx < components.length - 1}
            onMoveUp={() => move(idx, -1)}
            onMoveDown={() => move(idx, 1)}
          />
        ))}
      </Accordion>
    </div>
  );
}

// Kept for after-sales / extra-works pages that still use a single-group shell
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

function ComponentBlock({ component, canEdit, onChange, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: any) {
  const allItems = (component.checklist_items ?? []).filter((i: any) => !i.deleted_at);
  const topLevel = allItems.filter((i: any) => !i.parent_item_id).sort((a: any, b: any) => a.sort_order - b.sort_order);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const i of allItems) {
      if (i.parent_item_id) {
        const arr = map.get(i.parent_item_id) ?? [];
        arr.push(i);
        map.set(i.parent_item_id, arr);
      }
    }
    for (const arr of map.values()) arr.sort((a: any, b: any) => a.sort_order - b.sort_order);
    return map;
  }, [allItems]);

  const prog = calcProgress(allItems);
  const [newItem, setNewItem] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(component.name);

  const renameComponent = async () => {
    if (!name.trim() || name === component.name) { setEditingName(false); return; }
    const { error } = await supabase.from("components").update({ name: name.trim() }).eq("id", component.id);
    if (error) toast.error(error.message);
    else { setEditingName(false); onChange(); }
  };

  const addItem = async () => {
    if (!newItem.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      component_id: component.id, label: newItem.trim(), sort_order: topLevel.length,
    });
    if (error) toast.error(error.message);
    else { setNewItem(""); onChange(); }
  };

  const deleteComponent = async () => {
    const { error } = await supabase.from("components").update({ deleted_at: new Date().toISOString() }).eq("id", component.id);
    if (error) toast.error(error.message);
    else { toast.success("Component removed"); onChange(); }
  };

  return (
    <AccordionItem value={component.id}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex w-full items-center justify-between gap-3 pr-2">
          {editingName ? (
            <div className="flex flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") renameComponent(); }} />
              <Button size="icon" variant="ghost" onClick={renameComponent}><Check className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => { setEditingName(false); setName(component.name); }}><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <span className="flex flex-1 items-center gap-2 text-left font-medium">
              {component.name}
              {canEdit && (
                <span
                  role="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); setEditingName(true); }}
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </span>
              )}
            </span>
          )}
          <div className="flex items-center gap-2">
            {canEdit && (
              <>
                <span role="button" aria-disabled={!canMoveUp}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent ${!canMoveUp ? "pointer-events-none opacity-30" : ""}`}
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); onMoveUp?.(); }}>
                  <ArrowUp className="h-3 w-3 text-muted-foreground" />
                </span>
                <span role="button" aria-disabled={!canMoveDown}
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent ${!canMoveDown ? "pointer-events-none opacity-30" : ""}`}
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); onMoveDown?.(); }}>
                  <ArrowDown className="h-3 w-3 text-muted-foreground" />
                </span>
              </>
            )}
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total}</span>
            <div className="hidden w-24 sm:block"><ProgressBar value={prog.pct} size="sm" /></div>
            <span className="w-10 text-right font-mono text-xs tabular-nums">{prog.pct}%</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <ul className="space-y-1">
          {topLevel.map((it: any) => (
            <ChecklistRow
              key={it.id}
              item={it}
              componentId={component.id}
              childrenByParent={childrenByParent}
              depth={0}
              canEdit={canEdit}
              onChange={onChange}
            />
          ))}
        </ul>
        {canEdit && (
          <div className="mt-3 flex items-center gap-2 border-t pt-3">
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="New item"
              onKeyDown={(e) => e.key === "Enter" && addItem()}
            />
            <Button size="sm" onClick={addItem}><Plus className="h-4 w-4" /></Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button>
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
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function ChecklistRow({ item, componentId, childrenByParent, depth, canEdit, onChange }: any) {
  const { user } = useAuth();
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<any[]>(item.item_photos ?? []);
  const [addingChild, setAddingChild] = useState(false);
  const [childLabel, setChildLabel] = useState("");
  const children = childrenByParent.get(item.id) ?? [];

  const toggleDone = async (val: boolean) => {
    const { error } = await supabase.from("checklist_items").update({
      done: val,
      completed_at: val ? new Date().toISOString() : null,
      completed_by: val ? user?.id : null,
    }).eq("id", item.id);
    if (error) toast.error(error.message);
    else onChange();
  };

  const saveNote = async () => {
    const { error } = await supabase.from("checklist_items").update({ note }).eq("id", item.id);
    if (error) toast.error(error.message);
    else { setShowNote(false); onChange(); }
  };

  const softDelete = async () => {
    const { error } = await supabase.from("checklist_items").update({ deleted_at: new Date().toISOString() }).eq("id", item.id);
    if (error) toast.error(error.message);
    else {
      toast("Item removed", {
        action: {
          label: "Undo",
          onClick: async () => {
            await supabase.from("checklist_items").update({ deleted_at: null }).eq("id", item.id);
            onChange();
          },
        },
      });
      onChange();
    }
  };

  const uploadPhoto = async (file: File) => {
    setBusy(true);
    const path = `${item.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("photos").upload(path, file);
    if (upErr) { toast.error(upErr.message); setBusy(false); return; }
    const { data: ins, error: insErr } = await supabase.from("item_photos").insert({
      item_id: item.id, storage_path: path, uploaded_by: user?.id,
    }).select().single();
    setBusy(false);
    if (insErr) toast.error(insErr.message);
    else { setPhotos([...photos, ins]); onChange(); }
  };

  const addChild = async () => {
    if (!childLabel.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      component_id: componentId, parent_item_id: item.id,
      label: childLabel.trim(), sort_order: children.length,
    });
    if (error) toast.error(error.message);
    else { setChildLabel(""); setAddingChild(false); onChange(); }
  };

  return (
    <li className="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-muted/40" style={{ marginLeft: depth * 20 }}>
      <div className="flex items-start gap-3">
        {depth > 0 && <CornerDownRight className="mt-1 h-3 w-3 text-muted-foreground" />}
        <Checkbox
          checked={item.done}
          disabled={!canEdit}
          onCheckedChange={(v) => toggleDone(!!v)}
          className="mt-1"
        />
        <div className="flex-1">
          <div className={`text-sm ${item.done ? "text-muted-foreground line-through" : ""}`}>{item.label}</div>
          {item.note && !showNote && <div className="text-xs text-muted-foreground">{item.note}</div>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <button title="Add subtask" className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent" onClick={() => setAddingChild((s) => !s)}>
              <Plus className="h-4 w-4 text-muted-foreground" />
            </button>
            <label className="cursor-pointer">
              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent">
                <Camera className="h-4 w-4 text-muted-foreground" />
              </span>
            </label>
            <button className="inline-flex h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowNote((s) => !s)}>note</button>
            <button className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent" onClick={softDelete}>
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>
      {showNote && (
        <div className="ml-7 flex gap-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[60px] flex-1" />
          <Button size="sm" onClick={saveNote}>Save</Button>
        </div>
      )}
      {photos.length > 0 && (
        <div className="ml-7 flex flex-wrap gap-2">
          {photos.map((p) => <PhotoThumb key={p.id} path={p.storage_path} />)}
        </div>
      )}
      {addingChild && (
        <div className="ml-7 flex gap-2">
          <Input
            value={childLabel}
            onChange={(e) => setChildLabel(e.target.value)}
            placeholder="Subtask"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && addChild()}
          />
          <Button size="sm" onClick={addChild}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAddingChild(false); setChildLabel(""); }}>Cancel</Button>
        </div>
      )}
      {children.length > 0 && (
        <ul className="space-y-1">
          {children.map((c: any) => (
            <ChecklistRow
              key={c.id}
              item={c}
              componentId={componentId}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              canEdit={canEdit}
              onChange={onChange}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function PhotoThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("photos").createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  }, [path]);
  if (!url) return <div className="h-12 w-12 animate-pulse rounded bg-muted" />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="h-12 w-12 rounded border object-cover" /></a>;
}

export default function ExtraWorkChapterView({ group, canEdit, onChange }: any) {
  return <ChapterGroupCard group={group} canEdit={canEdit} onChange={onChange} />;
}
