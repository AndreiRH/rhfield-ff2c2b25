import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { calcProgress, itemsFromGroup } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { ChecklistTree } from "@/components/ChecklistTree";

// Used for the Mechanical (assembly) view when mech_mode = checklist.
// Picks (or creates) a single bucket component under the assembly group and
// renders the rich ChecklistTree against it.
export function FlatChecklist({ group, canEdit, onChange }: any) {
  const directComps = (group?.components ?? []).filter((c: any) => !c.deleted_at);
  const typeComps = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .flatMap((t: any) => (t.components ?? []).filter((c: any) => !c.deleted_at));
  const bucket = directComps[0] ?? typeComps[0] ?? null;
  const allItems = (bucket?.checklist_items ?? []).filter((i: any) => !i.deleted_at);
  const overall = calcProgress(itemsFromGroup(group));

  const [creating, setCreating] = useState(false);

  const ensureBucket = async () => {
    if (bucket || !group || creating) return;
    setCreating(true);
    const { error } = await supabase.from("components")
      .insert({ equipment_id: group.id, name: "Checklist", sort_order: 0 });
    setCreating(false);
    if (error) toast.error(error.message);
    else onChange();
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {overall.done}/{overall.total} · {overall.pct}%
          </span>
        </div>
        <ProgressBar value={overall.pct} size="sm" />

        {!bucket ? (
          canEdit ? (
            <Button size="sm" onClick={ensureBucket} disabled={creating}>Start checklist</Button>
          ) : (
            <p className="text-sm text-muted-foreground">No items yet.</p>
          )
        ) : (
          <ChecklistTree
            componentId={bucket.id}
            items={allItems}
            canEdit={canEdit}
            onChange={onChange}
            showLabels
          />
        )}
      </CardContent>
    </Card>
  );
}
