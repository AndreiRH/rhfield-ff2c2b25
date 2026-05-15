import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Copy, Trash2, ClipboardPaste, ChevronsUpDown, ChevronsDownUp, Search, Plus, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { ChecklistTree } from "@/components/ChecklistTree";
import { TreeActionProvider, useTreeAction } from "@/components/TreeAction";
import { useClipboard, buildItemClipMany, pasteItem } from "@/lib/clipboard";
import { useAuth } from "@/hooks/use-auth";
import { liveChecklistItems } from "@/lib/progress";

export function FlatChecklist(props: any) {
  // headerLeading: optional slot rendered on the left of the action bar (e.g. Manual/Checklist toggle).
  return (
    <TreeActionProvider>
      <FlatChecklistInner {...props} />
    </TreeActionProvider>
  );
}

function FlatChecklistInner({ group, canEdit, onChange, lineCount, headerLeading, noCard }: any) {
  const { isAdmin } = useAuth();
  const directComps = (group?.components ?? []).filter((c: any) => !c.deleted_at);
  const typeComps = (group?.component_types ?? [])
    .filter((t: any) => !t.deleted_at)
    .flatMap((t: any) => (t.components ?? []).filter((c: any) => !c.deleted_at));
  const bucket = directComps[0] ?? typeComps[0] ?? null;
  const allItems = liveChecklistItems((bucket?.checklist_items ?? []) as any[]);

  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [expandAll, setExpandAll] = useState(false);
  const [treeKey, setTreeKey] = useState(0);
  const [search, setSearch] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [newItemText, setNewItemText] = useState("");
  const action = useTreeAction()!;
  const inMode = action.mode !== "none";
  const { clip, set: setClip, clear: clearClip } = useClipboard();

  const toggleExpandAll = () => {
    setExpandAll((v) => !v);
    setTreeKey((k) => k + 1);
  };

  // Filter items by search (include matched items + their ancestors + descendants).
  const q = search.trim().toLowerCase();
  const filteredItems = q
    ? (() => {
        const matches = allItems.filter((i: any) => (i.label ?? "").toLowerCase().includes(q));
        const include = new Set<string>(matches.map((i: any) => i.id));
        for (const m of matches) {
          let cur: any = m;
          while (cur?.parent_item_id) {
            include.add(cur.parent_item_id);
            cur = allItems.find((i: any) => i.id === cur.parent_item_id);
          }
        }
        const stack = matches.map((m: any) => m.id);
        while (stack.length) {
          const id = stack.pop()!;
          for (const c of allItems) if (c.parent_item_id === id) { include.add(c.id); stack.push(c.id); }
        }
        return allItems.filter((i: any) => include.has(i.id));
      })()
    : allItems;

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
    const selectedIds = entries.map((e) => e.payload.item.id);
    const labels = entries.map((e) => e.payload.item.label);
    // Cascade: include all descendants of any selected item so subtasks get deleted too.
    const idSet = new Set<string>(selectedIds);
    const stack = [...selectedIds];
    while (stack.length) {
      const pid = stack.pop()!;
      for (const it of allItems as any[]) {
        if (it.parent_item_id === pid && !idSet.has(it.id)) {
          idSet.add(it.id);
          stack.push(it.id);
        }
      }
    }
    const ids = Array.from(idSet);
    const { error } = await supabase.from("checklist_items")
      .update({ deleted_at: new Date().toISOString() }).in("id", ids);
    setConfirmDelete(false);
    if (error) { toast.error(error.message); return; }
    action.setMode("none");
    onChange();
    toast.success(`Deleted ${selectedIds.length} item${selectedIds.length > 1 ? "s" : ""}${selectedIds.length === 1 ? `: "${labels[0]}"` : ""}`, {
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

  const addRootItem = async () => {
    if (!bucket || !newItemText.trim()) return;
    const rootCount = allItems.filter((i: any) => !i.parent_item_id).length;
    const { error } = await supabase.from("checklist_items").insert({
      component_id: bucket.id, label: newItemText.trim(), sort_order: rootCount,
    });
    if (error) { toast.error(error.message); return; }
    setNewItemText(""); setAddingItem(false); onChange();
  };

  const Wrapper: any = noCard ? "div" : Card;
  const Inner: any = noCard ? "div" : CardContent;
  return (
    <Wrapper>
      <Inner className={noCard ? "space-y-3" : "space-y-3 p-4"}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">{headerLeading}</div>
          <div className="flex flex-wrap items-center justify-end gap-2">
          {bucket && allItems.length > 0 && !inMode && (
            <Button size="sm" variant="outline" onClick={toggleExpandAll} title={expandAll ? "Collapse all" : "Expand all"} aria-label={expandAll ? "Collapse all" : "Expand all"}>
              {expandAll ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
            </Button>
          )}
          {bucket && canEdit && (
            <>
              <Button
                size="sm"
                variant={action.mode === "copy" ? "default" : "outline"}
                onClick={action.mode === "copy" ? commitDone : () => action.setMode("copy")}
                disabled={action.mode === "copy" && !action.hasSelection}
                title="Copy"
                aria-label="Copy"
              >
                <Copy className="h-4 w-4" />
                {action.mode === "copy" && <span className="ml-1">Done{action.count ? ` ${action.count}` : ""}</span>}
              </Button>
              <Button
                size="sm"
                variant={action.mode === "delete" ? "destructive" : "outline"}
                onClick={action.mode === "delete" ? commitDone : () => action.setMode("delete")}
                disabled={action.mode === "delete" && !action.hasSelection}
                title={isAdmin ? "Delete" : "Delete subtasks"}
                aria-label="Delete"
              >
                <Trash2 className="h-4 w-4" />
                {action.mode === "delete" && <span className="ml-1">Done{action.count ? ` ${action.count}` : ""}</span>}
              </Button>
              {inMode && (
                <Button size="sm" variant="ghost" onClick={() => action.setMode("none")}>Cancel</Button>
              )}
              {clip?.kind === "item" && !inMode && (
                <Button size="sm" variant="outline" onClick={pasteHere}
                  title={`Paste ${clip.nodes.length} item${clip.nodes.length > 1 ? "s" : ""}`}
                  aria-label="Paste">
                  <ClipboardPaste className="h-4 w-4" />
                  {clip.nodes.length > 1 ? <span className="ml-1">{clip.nodes.length}</span> : null}
                </Button>
              )}
              {!inMode && !addingItem && (
                <Button size="sm" onClick={() => setAddingItem(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Add item
                </Button>
              )}
            </>
          )}
          </div>
        </div>

        {addingItem && bucket && canEdit && (
          <div className="flex max-w-md gap-2">
            <Input value={newItemText} autoFocus onChange={(e) => setNewItemText(e.target.value)}
              placeholder="Checklist item"
              onKeyDown={(e) => e.key === "Enter" && addRootItem()} />
            <Button size="sm" onClick={addRootItem}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => { setAddingItem(false); setNewItemText(""); }}>Cancel</Button>
          </div>
        )}

        {action.mode === "delete" && (
          <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {isAdmin
              ? `Tap any item or subtask to add it to the deletion list. Tap "Done" to delete all selected.`
              : `Engineers can only delete subtasks. Tap any subtask to add it to the deletion list, then tap "Done".`}
          </p>
        )}
        {action.mode === "copy" && (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
            Tap any item or subtask to add it to the copy. Tap "Done" to copy all selected.
          </p>
        )}

        {bucket && allItems.length > 0 && !inMode && (
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search items…"
              className="h-8 pl-7 text-sm"
            />
          </div>
        )}

        {!bucket ? (
          canEdit ? (
            <Button size="sm" onClick={ensureBucket} disabled={creating}>Start checklist</Button>
          ) : (
            <p className="text-sm text-muted-foreground">No items yet.</p>
          )
        ) : (
          <ChecklistTree
            key={`${treeKey}-${q ? "search" : "all"}`}
            componentId={bucket.id}
            items={filteredItems}
            canEdit={canEdit}
            onChange={onChange}
            canDeleteRoot={isAdmin}
            showLabels
            defaultOpen={expandAll || !!q}
            emptyHint={q ? "No matching items." : "No items yet."}
            hideRootAdd
          />
        )}
      </Inner>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {action.count} item{action.count > 1 ? "s" : ""}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the selected items and everything inside them.
              {lineCount && lineCount > 1 ? (
                <> This is shared content and will be deleted from <strong>all {lineCount} project production lines</strong>.</>
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
    </Wrapper>
  );
}
