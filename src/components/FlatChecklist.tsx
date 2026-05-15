import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Trash2, ClipboardPaste, ChevronsUpDown, ChevronsDownUp } from "lucide-react";
import { toast } from "sonner";
import { ChecklistTree } from "@/components/ChecklistTree";
import { TreeActionProvider, useTreeAction } from "@/components/TreeAction";
import { useClipboard, buildItemClipMany, pasteItem } from "@/lib/clipboard";

export function FlatChecklist(props: any) {
  return (
    <TreeActionProvider>
      <FlatChecklistInner {...props} />
    </TreeActionProvider>
  );
}

function FlatChecklistInner({ group, canEdit, onChange, lineCount }: any) {
  const directComps = (group?.components ?? []).filter((c: any) => !c.deleted_at);
  const typeComps = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .flatMap((t: any) => (t.components ?? []).filter((c: any) => !c.deleted_at));
  const bucket = directComps[0] ?? typeComps[0] ?? null;
  const allItems = (bucket?.checklist_items ?? []).filter((i: any) => !i.deleted_at);
  const overall = calcProgress(itemsFromGroup(group));

  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const action = useTreeAction()!;
  const inMode = action.mode !== "none";
  const { clip, set: setClip, clear: clearClip } = useClipboard();

  // exit selection mode when bucket changes
  useEffect(() => { if (inMode) action.setMode("none"); /* eslint-disable-next-line */ }, [bucket?.id]);

  const ensureBucket = async () => {
    if (bucket || !group || creating) return;
    setCreating(true);
    const { error } = await supabase.from("components")
      .insert({ equipment_id: group.id, name: "Checklist", sort_order: 0 });
    setCreating(false);
    if (error) toast.error(error.message);
    else onChange();
  };

  const commitDone = async () => {
    if (!action.hasSelection) { action.setMode("none"); return; }
    if (action.mode === "delete") { setConfirmDelete(true); return; }
    if (action.mode === "copy") {
      const entries = Array.from(action.selection.values());
      setClip(buildItemClipMany(entries.map((e) => ({ item: e.payload.item, allItems: e.payload.allItems }))));
      action.setMode("none");
      toast.success(`Copied ${entries.length} item${entries.length > 1 ? "s" : ""}`);
    }
  };

  const performDelete = async () => {
    const entries = Array.from(action.selection.values());
    if (entries.length === 0) { setConfirmDelete(false); action.setMode("none"); return; }
    const ids = entries.map((e) => e.payload.item.id);
    const labels = entries.map((e) => e.payload.item.label);
    const { error } = await supabase.from("checklist_items")
      .update({ deleted_at: new Date().toISOString() }).in("id", ids);
    setConfirmDelete(false);
    if (error) { toast.error(error.message); return; }
    action.setMode("none");
    onChange();
    toast.success(`Deleted ${ids.length} item${ids.length > 1 ? "s" : ""}${ids.length === 1 ? `: "${labels[0]}"` : ""}`, {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          const { error: undoErr } = await supabase.from("checklist_items")
            .update({ deleted_at: null }).in("id", ids);
          if (undoErr) toast.error(undoErr.message); else { toast.success("Restored"); onChange(); }
        },
      },
    });
  };

  const pasteHere = async () => {
    if (!bucket || clip?.kind !== "item") return;
    try {
      await pasteItem(clip, { component_id: bucket.id, parent_item_id: null, sort_order: allItems.filter((i: any) => !i.parent_item_id).length });
      clearClip();
      toast.success("Pasted"); onChange();
    } catch (e: any) { toast.error(e.message ?? "Paste failed"); }
  };

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {overall.done}/{overall.total} · {overall.pct}%
          </span>
          {bucket && canEdit && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={action.mode === "copy" ? "default" : "outline"}
                onClick={action.mode === "copy" ? commitDone : () => action.setMode("copy")}
                disabled={action.mode === "copy" && !action.hasSelection}
              >
                <Copy className="mr-1 h-4 w-4" />
                {action.mode === "copy" ? `Done${action.count ? ` (${action.count})` : ""}` : "Copy"}
              </Button>
              <Button
                size="sm"
                variant={action.mode === "delete" ? "destructive" : "outline"}
                onClick={action.mode === "delete" ? commitDone : () => action.setMode("delete")}
                disabled={action.mode === "delete" && !action.hasSelection}
              >
                <Trash2 className="mr-1 h-4 w-4" />
                {action.mode === "delete" ? `Done${action.count ? ` (${action.count})` : ""}` : "Delete"}
              </Button>
              {inMode && (
                <Button size="sm" variant="ghost" onClick={() => action.setMode("none")}>Cancel</Button>
              )}
              {clip?.kind === "item" && !inMode && (
                <Button size="sm" variant="outline" onClick={pasteHere}
                  title={`Paste ${clip.nodes.length} item${clip.nodes.length > 1 ? "s" : ""}`}>
                  <ClipboardPaste className="mr-1 h-4 w-4" /> Paste
                  {clip.nodes.length > 1 ? ` ${clip.nodes.length}` : ""}
                </Button>
              )}
            </div>
          )}
        </div>
        <ProgressBar value={overall.pct} size="sm" />

        {action.mode === "delete" && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            Tap any item or subtask to add it to the deletion list. Tap "Done" to delete all selected.
          </p>
        )}
        {action.mode === "copy" && (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
            Tap any item or subtask to add it to the copy. Tap "Done" to copy all selected.
          </p>
        )}

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

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {action.count} item{action.count > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the selected items and everything inside them.
              {lineCount && lineCount > 1 ? (
                <> This is shared content and will be deleted from <strong>all {lineCount} project lines</strong>.</>
              ) : null}
              {" "}You can undo from the toast for a few seconds.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={performDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
