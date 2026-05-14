import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Plus, Trash2, Pencil, Check, X, ArrowUp, ArrowDown, Layers } from "lucide-react";
import { toast } from "sonner";
import { ComponentsList } from "@/components/ExtraWorkChapterView";
import { calcProgress, itemsFromGroup } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";

// Tree: equipment_group -> component_types -> components -> checklist_items
// Used for assembly (when mech_mode = checklist), wiring and cold_commissioning.
export function ComponentTypesTree({ group, canEdit, onChange, emptyHint }: any) {
  const types = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const addType = async () => {
    if (!newName.trim() || !group) return;
    const { error } = await supabase.from("component_types").insert({
      equipment_group_id: group.id,
      name: newName.trim(),
      sort_order: types.length,
    });
    if (error) toast.error(error.message);
    else { setNewName(""); setAdding(false); onChange(); }
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= types.length) return;
    const a = types[idx]; const b = types[target];
    await supabase.from("component_types").update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("component_types").update({ sort_order: a.sort_order }).eq("id", b.id);
    onChange();
  };

  const overall = calcProgress(itemsFromGroup(group));

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

        <Accordion type="multiple" className="w-full">
          {types.map((t: any, idx: number) => (
            <TypeBlock
              key={t.id}
              type={t}
              canEdit={canEdit}
              onChange={onChange}
              canMoveUp={idx > 0}
              canMoveDown={idx < types.length - 1}
              onMoveUp={() => move(idx, -1)}
              onMoveDown={() => move(idx, 1)}
            />
          ))}
        </Accordion>
      </CardContent>
    </Card>
  );
}

function TypeBlock({ type, canEdit, onChange, canMoveUp, canMoveDown, onMoveUp, onMoveDown }: any) {
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
    <AccordionItem value={type.id}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex w-full items-center justify-between gap-3 pr-2">
          {editing ? (
            <div className="flex flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Input value={name} autoFocus onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") rename(); }} />
              <Button size="icon" variant="ghost" onClick={rename}><Check className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => { setEditing(false); setName(type.name); }}><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <span className="flex flex-1 items-center gap-2 text-left font-medium">
              <Layers className="h-4 w-4 text-muted-foreground" />
              {type.name}
              {canEdit && (
                <span role="button" className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); setEditing(true); }}>
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
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <span role="button" className="inline-flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </span>
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
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total}</span>
            <div className="hidden w-24 sm:block"><ProgressBar value={prog.pct} size="sm" /></div>
            <span className="w-10 text-right font-mono text-xs tabular-nums">{prog.pct}%</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <ComponentsList group={type} parentKind="component_type" canEdit={canEdit} onChange={onChange} />
      </AccordionContent>
    </AccordionItem>
  );
}
