import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { calcProgress, itemsFromGroup } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";

// A flat, single-list checklist for the assembly chapter (no component types).
// Items are stored under one auto-created component under the equipment_group.
export function FlatChecklist({ group, canEdit, onChange }: any) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");

  // Use first non-deleted direct component or the first component_type's first component as the bucket.
  const directComps = (group?.components ?? []).filter((c: any) => !c.deleted_at);
  const typeComps = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .flatMap((t: any) => (t.components ?? []).filter((c: any) => !c.deleted_at));
  const bucket = directComps[0] ?? typeComps[0] ?? null;

  const items = (bucket?.checklist_items ?? [])
    .filter((i: any) => !i.deleted_at)
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
      component_id: compId, label: text.trim(), sort_order: items.length,
    });
    if (error) toast.error(error.message);
    else { setText(""); setAdding(false); onChange(); }
  };

  const toggle = async (it: any) => {
    const { error } = await supabase.from("checklist_items")
      .update({ done: !it.done, completed_at: !it.done ? new Date().toISOString() : null })
      .eq("id", it.id);
    if (error) toast.error(error.message); else onChange();
  };

  const remove = async (it: any) => {
    const { error } = await supabase.from("checklist_items")
      .update({ deleted_at: new Date().toISOString() }).eq("id", it.id);
    if (error) toast.error(error.message); else onChange();
  };

  const move = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    const a = items[idx]; const b = items[target];
    await supabase.from("checklist_items").update({ sort_order: b.sort_order }).eq("id", a.id);
    await supabase.from("checklist_items").update({ sort_order: a.sort_order }).eq("id", b.id);
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

        {items.length === 0 && !adding && (
          <p className="text-sm text-muted-foreground">No items yet.</p>
        )}

        <ul className="divide-y">
          {items.map((it: any, idx: number) => (
            <li key={it.id} className="flex items-center gap-2 py-2">
              <Checkbox checked={it.done} disabled={!canEdit} onCheckedChange={() => toggle(it)} />
              <span className={`flex-1 text-sm ${it.done ? "text-muted-foreground line-through" : ""}`}>{it.label}</span>
              {canEdit && (
                <>
                  <button disabled={idx === 0} onClick={() => move(idx, -1)} className="p-1 disabled:opacity-30">
                    <ArrowUp className="h-3 w-3" />
                  </button>
                  <button disabled={idx === items.length - 1} onClick={() => move(idx, 1)} className="p-1 disabled:opacity-30">
                    <ArrowDown className="h-3 w-3" />
                  </button>
                  <button onClick={() => remove(it)} className="p-1">
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
