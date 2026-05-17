import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { toUserMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Plus, Trash2, Camera, Paperclip, GripVertical, ChevronDown, ChevronRight,
  ClipboardPaste, Check, ChevronsDownUp, ChevronsUpDown, Copy, X, FolderPlus,
} from "lucide-react";
import { toast } from "sonner";
import { PhotoPicker } from "@/components/PhotoPicker";
import { PhotoTile, FileChip } from "@/components/ChecklistTree";
import { rememberLocalFile } from "@/lib/local-blobs";
import { TreeActionProvider, useTreeAction } from "@/components/TreeAction";
import {
  useClipboard, buildSettingClipMany, pasteSetting,
} from "@/lib/clipboard";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAuth } from "@/hooks/use-auth";
import { logSetting } from "@/lib/settingLogs";
import { useCurrentLine } from "@/lib/current-line";

interface SettingPhoto { id: string; storage_path: string; is_shared?: boolean; origin_line_id?: string | null }
interface SettingFile { id: string; storage_path: string; file_name: string; is_shared?: boolean; origin_line_id?: string | null }
interface Setting {
  id: string;
  plant_equipment_id: string;
  title: string;
  body: string;
  sort_order: number;
  group_template_id: string | null;
  setting_photos: SettingPhoto[];
  setting_files: SettingFile[];
}
interface SettingGroup {
  id: string;
  plant_equipment_id: string;
  template_id: string;
  name: string;
  sort_order: number;
}

export function SettingsList(props: { equipmentId: string; canEdit: boolean; userId?: string; lineCount?: number }) {
  return (
    <TreeActionProvider>
      <SettingsListInner {...props} />
    </TreeActionProvider>
  );
}

function SettingsListInner({
  equipmentId, canEdit, userId, lineCount,
}: { equipmentId: string; canEdit: boolean; userId?: string; lineCount?: number }) {
  const { isAdmin } = useAuth();
  const [rows, setRows] = useState<Setting[]>([]);
  const [groups, setGroups] = useState<SettingGroup[]>([]);
  const [openIds, setOpenIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const { clip, set: setClip, clear: clearClip, lockTo } = useClipboard();
  const settingPasteLocationKey = `setting:${equipmentId}`;
  const action = useTreeAction()!;
  const inMode = action.mode !== "none";
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const load = async () => {
    const [{ data: s }, { data: g }] = await Promise.all([
      supabase
        .from("equipment_settings")
        .select("*, setting_photos(id, storage_path, is_shared, origin_line_id), setting_files(id, storage_path, file_name, is_shared, origin_line_id)")
        .eq("plant_equipment_id", equipmentId)
        .is("deleted_at", null)
        .order("sort_order").order("created_at"),
      supabase
        .from("equipment_setting_groups")
        .select("*")
        .eq("plant_equipment_id", equipmentId)
        .is("deleted_at", null)
        .order("sort_order").order("created_at"),
    ]);
    const groupsList = ((g ?? []) as unknown) as SettingGroup[];
    setRows(((s ?? []) as unknown) as Setting[]);
    setGroups(groupsList);
    // Hydrate collapsed state from localStorage for current groups
    if (typeof window !== "undefined") {
      const next = new Set<string>();
      for (const gr of groupsList) {
        if (window.localStorage.getItem(`settings_group_collapsed_${gr.template_id}`) === "1") {
          next.add(gr.template_id);
        }
      }
      setCollapsedGroups(next);
    }
  };
  useEffect(() => { load(); }, [equipmentId]);

  const addRow = async (groupTemplateId: string | null = null) => {
    const { data, error } = await supabase.from("equipment_settings").insert({
      plant_equipment_id: equipmentId, title: "Setting", body: "",
      sort_order: rows.length, created_by: userId,
      group_template_id: groupTemplateId,
    }).select("id, title").single();
    if (error) { toast.error(toUserMessage(error)); return; }
    await logSetting({
      plant_equipment_id: equipmentId,
      equipment_setting_id: data?.id, setting_title: data?.title ?? "Setting",
      action: "created", user_id: userId,
    });
    load();
  };

  const addGroup = async () => {
    const { error } = await supabase.from("equipment_setting_groups").insert({
      plant_equipment_id: equipmentId,
      name: "New group",
      sort_order: groups.length,
    });
    if (error) { toast.error(toUserMessage(error)); return; }
    load();
  };

  const updateGroupName = (g: SettingGroup, name: string) => {
    const next = name.trim() || "New group";
    if (next === g.name) return;
    setGroups((arr) => arr.map((x) => (x.id === g.id ? { ...x, name: next } : x)));
    supabase.from("equipment_setting_groups").update({ name: next }).eq("id", g.id).then(({ error }) => {
      if (error) toast.error(toUserMessage(error));
    });
  };

  // Group deletion happens via the action button's delete mode (see performDelete).

  const updateTitle = (id: string, title: string) => {
    const prev = rows.find((x) => x.id === id);
    const oldTitle = prev?.title ?? "";
    setRows((n) => n.map((x) => (x.id === id ? { ...x, title } : x)));
    supabase.from("equipment_settings").update({ title }).eq("id", id).then(() => {
      if (oldTitle !== title) logSetting({
        plant_equipment_id: equipmentId, equipment_setting_id: id, setting_title: title,
        action: "title_changed", old_value: oldTitle, new_value: title, user_id: userId,
      });
    });
  };
  const updateBody = (id: string, body: string) => {
    const prev = rows.find((x) => x.id === id);
    const oldBody = prev?.body ?? "";
    const title = prev?.title ?? "";
    setRows((n) => n.map((x) => (x.id === id ? { ...x, body } : x)));
    supabase.from("equipment_settings").update({ body }).eq("id", id).then(() => {
      if (oldBody !== body) logSetting({
        plant_equipment_id: equipmentId, equipment_setting_id: id, setting_title: title,
        action: "value_changed", old_value: oldBody, new_value: body, user_id: userId,
      });
    });
  };

  const removeOne = async (s: Setting) => {
    for (const p of s.setting_photos ?? []) {
      await supabase.storage.from("photos").remove([p.storage_path]);
    }
    for (const f of s.setting_files ?? []) {
      await supabase.storage.from("files").remove([f.storage_path]);
    }
    await supabase.from("equipment_settings")
      .update({ deleted_at: new Date().toISOString() }).eq("id", s.id);
    await logSetting({
      plant_equipment_id: equipmentId, equipment_setting_id: s.id, setting_title: s.title,
      action: "deleted", old_value: s.body, user_id: userId,
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  // Build flat ordered list: ungrouped settings first, then per group [header, items...].
  type FlatEntry =
    | { type: "setting"; setting: Setting }
    | { type: "header"; group: SettingGroup };

  const buildFlat = (): FlatEntry[] => {
    const flat: FlatEntry[] = [];
    const byGroup = new Map<string | null, Setting[]>();
    for (const r of rows) {
      const key = r.group_template_id;
      if (!byGroup.has(key)) byGroup.set(key, []);
      byGroup.get(key)!.push(r);
    }
    // Ungrouped first
    for (const s of byGroup.get(null) ?? []) flat.push({ type: "setting", setting: s });
    // Then each group in sort_order
    for (const g of groups) {
      flat.push({ type: "header", group: g });
      for (const s of byGroup.get(g.template_id) ?? []) flat.push({ type: "setting", setting: s });
    }
    // Orphan groups (setting points to a group that no longer exists on this line) — render as ungrouped
    return flat;
  };
  const flat = buildFlat();
  const sortableIds = flat.map((e) =>
    e.type === "header" ? `g:${e.group.id}` : e.setting.id,
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = sortableIds.indexOf(String(active.id));
    const newIdx = sortableIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    const nextFlat = arrayMove(flat, oldIdx, newIdx);

    // Recompute groups in their new order (skip groups that get pushed before ungrouped — they still count)
    const newGroupOrder: SettingGroup[] = [];
    const newSettings: Setting[] = [];
    let currentGroupTemplateId: string | null = null;
    let settingSort = 0;
    for (const entry of nextFlat) {
      if (entry.type === "header") {
        currentGroupTemplateId = entry.group.template_id;
        newGroupOrder.push(entry.group);
      } else {
        const s = entry.setting;
        if (s.group_template_id !== currentGroupTemplateId) {
          newSettings.push({ ...s, group_template_id: currentGroupTemplateId, sort_order: settingSort });
        } else {
          newSettings.push({ ...s, sort_order: settingSort });
        }
        settingSort++;
      }
    }
    // optimistic
    setRows(newSettings);
    setGroups(newGroupOrder.map((g, i) => ({ ...g, sort_order: i })));

    // Persist setting changes (sort_order or group_template_id changes)
    const settingUpdates: Array<Promise<unknown>> = [];
    for (const n of newSettings) {
      const prev = rows.find((r) => r.id === n.id);
      if (!prev) continue;
      if (prev.sort_order === n.sort_order && prev.group_template_id === n.group_template_id) continue;
      settingUpdates.push(
        Promise.resolve(
          supabase.from("equipment_settings")
            .update({ sort_order: n.sort_order, group_template_id: n.group_template_id })
            .eq("id", n.id),
        ),
      );
    }
    const groupUpdates: Array<Promise<unknown>> = [];
    newGroupOrder.forEach((g, i) => {
      if (g.sort_order === i) return;
      groupUpdates.push(
        Promise.resolve(
          supabase.from("equipment_setting_groups")
            .update({ sort_order: i })
            .eq("id", g.id),
        ),
      );
    });
    await Promise.all([...settingUpdates, ...groupUpdates]);
  };

  const allSettingsOpen = rows.length === 0 || openIds.size === rows.length;
  const allGroupsOpen = groups.length === 0 || collapsedGroups.size === 0;
  const allOpen = allSettingsOpen && allGroupsOpen && (rows.length > 0 || groups.length > 0);
  const toggleAll = () => {
    if (allOpen) {
      setOpenIds(new Set());
      const next = new Set(groups.map((g) => g.template_id));
      setCollapsedGroups(next);
      if (typeof window !== "undefined") {
        for (const g of groups) {
          try { window.localStorage.setItem(`settings_group_collapsed_${g.template_id}`, "1"); } catch {}
        }
      }
    } else {
      setOpenIds(new Set(rows.map((r) => r.id)));
      setCollapsedGroups(new Set());
      if (typeof window !== "undefined") {
        for (const g of groups) {
          try { window.localStorage.setItem(`settings_group_collapsed_${g.template_id}`, "0"); } catch {}
        }
      }
    }
  };
  const setGroupCollapsed = (templateId: string, collapsed: boolean) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (collapsed) next.add(templateId); else next.delete(templateId);
      return next;
    });
    if (typeof window !== "undefined") {
      try { window.localStorage.setItem(`settings_group_collapsed_${templateId}`, collapsed ? "1" : "0"); } catch {}
    }
  };
  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const pasteHere = async (groupTemplateId: string | null = null) => {
    if (clip?.kind !== "setting") return;
    try {
      const groupRows = groupTemplateId
        ? rows.filter((r) => r.group_template_id === groupTemplateId)
        : rows;
      await pasteSetting(clip, {
        plant_equipment_id: equipmentId,
        sort_order: groupRows.length,
        created_by: userId,
        group_template_id: groupTemplateId,
      });
      lockTo(settingPasteLocationKey);
      toast.success("Pasted"); load();
    } catch (e: any) { toast.error(e.message ?? "Paste failed"); }
  };

  const confirmCopy = () => {
    const selected = Array.from(action.selection.values()).map((s) => s.payload as Setting);
    if (selected.length === 0) { action.setMode("none"); return; }
    setClip(buildSettingClipMany(selected));
    action.setMode("none");
  };
  const selectionKind: "setting" | "group" | null =
    action.selection.size > 0
      ? ((action.selection.values().next().value!.kind as unknown) as "setting" | "group")
      : null;

  const confirmDelete = async () => {
    if (action.selection.size === 0) { action.setMode("none"); return; }
    setConfirmDeleteOpen(true);
  };

  const performDelete = async () => {
    if (selectionKind === "group") {
      const selectedGroups = Array.from(action.selection.values()).map((s) => s.payload as SettingGroup);
      for (const g of selectedGroups) {
        await supabase.from("equipment_settings")
          .update({ group_template_id: null })
          .eq("group_template_id", g.template_id);
        await supabase.from("equipment_setting_groups")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", g.id);
      }
    } else {
      const selected = Array.from(action.selection.values()).map((s) => s.payload as Setting);
      for (const s of selected) await removeOne(s);
    }
    setConfirmDeleteOpen(false);
    action.setMode("none");
    load();
  };

  // Settings split for rendering
  const ungrouped = rows.filter((r) => r.group_template_id === null
    || !groups.some((g) => g.template_id === r.group_template_id));

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canEdit && (
          <>
            {clip?.kind === "setting" && !inMode && (!clip.lockedAt || clip.lockedAt === settingPasteLocationKey) && (
              <Button size="sm" variant="outline" onClick={() => pasteHere(null)}
                title={`Paste ${clip.nodes.length} setting${clip.nodes.length > 1 ? "s" : ""}`}
                aria-label="Paste">
                <ClipboardPaste className="h-4 w-4" />
                {clip.nodes.length > 1 ? <span className="ml-1">{clip.nodes.length}</span> : null}
              </Button>
            )}
            {rows.length > 0 && !inMode && (
              <Button size="sm" variant="outline" className="mr-auto" onClick={toggleAll}
                title={allOpen ? "Collapse all" : "Expand all"} aria-label={allOpen ? "Collapse all" : "Expand all"}>
                {allOpen ? <ChevronsDownUp className="h-4 w-4" /> : <ChevronsUpDown className="h-4 w-4" />}
              </Button>
            )}
            {(rows.length > 0 || groups.length > 0) && (
              <Button size="sm"
                variant={action.mode === "reorder" ? "default" : "outline"}
                onClick={() => action.setMode(action.mode === "reorder" ? "none" : "reorder")}
                title="Reorder" aria-label="Reorder">
                <GripVertical className="h-4 w-4" />
                {action.mode === "reorder" && <span className="ml-1 text-xs">Done</span>}
              </Button>
            )}
            {rows.length > 0 && (
              <Button size="sm"
                variant={action.mode === "copy" ? "default" : "outline"}
                onClick={() => {
                  if (action.mode === "copy") confirmCopy();
                  else action.setMode("copy");
                }}
                title={action.mode === "copy" ? "Copy selected" : "Copy"}
                aria-label="Copy">
                <Copy className="h-4 w-4" />
                {action.mode === "copy" && <span className="ml-1 text-xs">Done{action.count > 0 ? ` ${action.count}` : ""}</span>}
              </Button>
            )}
            {(rows.length > 0 || groups.length > 0) && isAdmin && (
              <Button size="sm"
                variant={action.mode === "delete" ? "destructive" : "outline"}
                onClick={() => {
                  if (action.mode === "delete") confirmDelete();
                  else action.setMode("delete");
                }}
                title={action.mode === "delete" ? "Delete selected" : "Delete"}
                aria-label="Delete">
                <Trash2 className="h-4 w-4" />
                {action.mode === "delete" && <span className="ml-1 text-xs">Done{action.count > 0 ? ` ${action.count}` : ""}</span>}
              </Button>
            )}
            {inMode && (
              <Button size="sm" variant="ghost" onClick={() => action.setMode("none")}
                title="Cancel" aria-label="Cancel">
                <X className="h-4 w-4" />
              </Button>
            )}
            {!inMode && (
              <Button size="sm" variant="outline" onClick={addGroup} title="New group" aria-label="New group">
                <FolderPlus className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">New group</span>
              </Button>
            )}
            {!inMode && (
              <Button size="sm" onClick={() => addRow(null)} title="Add setting" aria-label="Add setting">
                <Plus className="h-4 w-4 sm:mr-1" /> <span className="hidden sm:inline">Add setting</span>
              </Button>
            )}
          </>
          )}
        </div>

        {(action.mode === "delete" || action.mode === "copy") && (
          <p className={`rounded-md border px-3 py-2 text-xs ${action.mode === "delete" ? "border-destructive/30 bg-destructive/5 text-destructive" : "border-primary/30 bg-primary/5 text-primary"}`}>
            {action.mode === "delete"
              ? "Tap settings or group headers to delete, then tap the trash icon again."
              : "Tap settings to copy, then tap the copy icon again."}
          </p>
        )}
        {action.mode === "reorder" && (
          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
            Drag handles to reorder settings and groups. Drop a setting across a group's items to move it. Tap "Done" when finished.
          </p>
        )}

        <p className="text-xs text-muted-foreground">
          Setting titles and groups are shared across all production lines. Values, photos and files are local to this production line.
        </p>

        {rows.length === 0 && groups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No settings yet.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
              <div className="space-y-3">
                {/* Ungrouped flat list */}
                {ungrouped.length > 0 && (
                  <ul className="space-y-2">
                    {ungrouped.map((s) => (
                      <SettingRow
                        key={s.id} setting={s} canEdit={canEdit}
                        open={openIds.has(s.id)}
                        onToggleOpen={() => toggleOpen(s.id)}
                        onTitle={(t: string) => updateTitle(s.id, t)}
                        onBody={(b: string) => updateBody(s.id, b)}
                        onReload={load}
                        plantEquipmentId={equipmentId}
                        userId={userId}
                      />
                    ))}
                  </ul>
                )}
                {/* Groups */}
                {groups.map((g) => {
                  const items = rows.filter((r) => r.group_template_id === g.template_id);
                  return (
                    <SettingsGroupSection
                      key={g.id}
                      group={g}
                      canEdit={canEdit}
                      onRename={(name) => updateGroupName(g, name)}
                      onAddSetting={() => addRow(g.template_id)}
                      itemCount={items.length}
                      pasteCount={clip?.kind === "setting" && (!clip.lockedAt || clip.lockedAt === settingPasteLocationKey) ? clip.nodes.length : 0}
                      onPaste={() => pasteHere(g.template_id)}
                      collapsed={collapsedGroups.has(g.template_id)}
                      onToggleCollapsed={() => setGroupCollapsed(g.template_id, !collapsedGroups.has(g.template_id))}
                    >
                      <ul className="space-y-2">
                        {items.map((s) => (
                          <SettingRow
                            key={s.id} setting={s} canEdit={canEdit}
                            open={openIds.has(s.id)}
                            onToggleOpen={() => toggleOpen(s.id)}
                            onTitle={(t: string) => updateTitle(s.id, t)}
                            onBody={(b: string) => updateBody(s.id, b)}
                            onReload={load}
                            plantEquipmentId={equipmentId}
                            userId={userId}
                          />
                        ))}
                      </ul>
                    </SettingsGroupSection>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        )}
      </CardContent>
      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {selectionKind === "group"
                ? `Delete ${action.count} group${action.count > 1 ? "s" : ""}?`
                : `Delete ${action.count} setting${action.count > 1 ? "s" : ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectionKind === "group" ? (
                <>
                  The selected group{action.count > 1 ? "s" : ""} will be removed from <strong>all {lineCount ?? 10} production lines</strong>.
                  Settings currently inside will be moved to ungrouped.
                </>
              ) : (
                <>
                  This will delete the selected setting names from <strong>all {lineCount ?? 10} production lines</strong>.
                  Values, photos, and files attached to the selected settings on this line will also be removed.
                </>
              )}
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

function SettingsGroupSection({
  group, canEdit, onRename, onAddSetting, itemCount, pasteCount, onPaste, collapsed, onToggleCollapsed, children,
}: {
  group: SettingGroup;
  canEdit: boolean;
  onRename: (name: string) => void;
  onAddSetting: () => void;
  itemCount: number;
  pasteCount: number;
  onPaste: () => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  children: ReactNode;
}) {
  const action = useTreeAction()!;
  const inReorder = action.mode === "reorder";
  const inDelete = action.mode === "delete";
  const inMode = action.mode !== "none";
  const sortableId = `g:${group.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: sortableId, disabled: !inReorder });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  const selected = action.isSelected(`group:${group.id}`);
  const toggleSelect = () => {
    action.toggle(`group:${group.id}`, { kind: "group" as unknown as "setting", payload: group });
  };

  const toggle = onToggleCollapsed;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(group.name);
  useEffect(() => { setDraft(group.name); }, [group.name]);

  return (
    <div ref={setNodeRef} style={style} className="space-y-2">
      <div
        className={`flex items-center gap-1 rounded px-1 ${
          inDelete
            ? `cursor-pointer border ${selected ? "border-destructive bg-destructive/15" : "border-destructive/40 bg-destructive/5 hover:bg-destructive/10"}`
            : ""
        }`}
        onClick={inDelete ? toggleSelect : undefined}
      >
        {canEdit && inReorder && (
          <button {...attributes} {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        {inDelete && (
          <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${selected ? "border-destructive bg-destructive text-destructive-foreground" : "border-muted-foreground/30"}`}>
            {selected ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggle(); }}
          className="text-muted-foreground hover:text-foreground p-1"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand group" : "Collapse group"}
        >
          {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {editing && canEdit ? (
          <Input
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => { setEditing(false); onRename(draft); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              else if (e.key === "Escape") { setDraft(group.name); setEditing(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="h-6 flex-1 max-w-[260px] border-0 bg-transparent px-1 text-[10px] font-semibold uppercase tracking-wider shadow-none focus-visible:ring-0"
          />
        ) : (
          <button
            type="button"
            disabled={!canEdit || inMode}
            onClick={(e) => { if (canEdit && !inMode) { e.stopPropagation(); setEditing(true); } }}
            className="flex-1 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            {group.name}
            {inDelete && itemCount > 0 && (
              <span className="ml-2 normal-case tracking-normal text-muted-foreground/70">
                ({itemCount} setting{itemCount > 1 ? "s" : ""} will be ungrouped)
              </span>
            )}
          </button>
        )}
        {canEdit && !inMode && pasteCount > 0 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onPaste(); }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            title={`Paste ${pasteCount} setting${pasteCount > 1 ? "s" : ""} into this group`}
            aria-label="Paste into group"
          >
            <ClipboardPaste className="h-3 w-3" />
            {pasteCount > 1 ? <span>{pasteCount}</span> : null}
          </button>
        )}
        {canEdit && !inMode && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onAddSetting(); }}
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Add setting to this group"
            aria-label="Add setting to this group"
          >
            <Plus className="h-3 w-3" /> Add
          </button>
        )}
      </div>
      {!collapsed && (
        <div className="animate-accordion-down overflow-hidden">
          {children}
        </div>
      )}
    </div>
  );
}

function SettingRow({
  setting, canEdit, open, onToggleOpen, onTitle, onBody, onReload, plantEquipmentId, userId,
}: {
  setting: Setting; canEdit: boolean; open: boolean;
  onToggleOpen: () => void;
  onTitle: (t: string) => void;
  onBody: (b: string) => void;
  onReload: () => void;
  plantEquipmentId: string;
  userId?: string;
}) {
  const action = useTreeAction()!;
  const mode = action.mode;
  const inMode = mode !== "none";
  const inSelectMode = mode === "delete" || mode === "copy";
  const inReorder = mode === "reorder";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: setting.id, disabled: !inReorder });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };
  const selected = action.isSelected(setting.id);

  const [title, setTitle] = useState(setting.title);
  const [body, setBody] = useState(setting.body);
  useEffect(() => { setTitle(setting.title); setBody(setting.body); }, [setting.title, setting.body]);
  const [editingTitle, setEditingTitle] = useState(false);

  const photos = setting.setting_photos ?? [];
  const files = setting.setting_files ?? [];
  const [showPhotos, setShowPhotos] = useState(false);
  const [showFiles, setShowFiles] = useState(false);

  const uploadPhoto = async (file: File) => {
    const path = `equipment-settings/${setting.plant_equipment_id}/${setting.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("photos", path, file);
    const { error } = await supabase.storage.from("photos").upload(path, file);
    if (error) { toast.error(toUserMessage(error)); return; }
    await supabase.from("setting_photos").insert({ equipment_setting_id: setting.id, storage_path: path });
    await logSetting({ plant_equipment_id: plantEquipmentId, equipment_setting_id: setting.id, setting_title: setting.title, action: "photo_added", new_value: file.name, user_id: userId });
    onReload();
  };
  const uploadFile = async (file: File) => {
    const path = `equipment-settings/${setting.plant_equipment_id}/${setting.id}/${Date.now()}-${file.name}`;
    rememberLocalFile("files", path, file);
    const { error } = await supabase.storage.from("files").upload(path, file);
    if (error) { toast.error(toUserMessage(error)); return; }
    await supabase.from("setting_files").insert({ equipment_setting_id: setting.id, storage_path: path, file_name: file.name });
    await logSetting({ plant_equipment_id: plantEquipmentId, equipment_setting_id: setting.id, setting_title: setting.title, action: "file_added", new_value: file.name, user_id: userId });
    onReload();
  };
  const removePhoto = async (p: SettingPhoto) => {
    const { error } = await supabase.from("setting_photos").delete().eq("id", p.id);
    if (error) { toast.error(toUserMessage(error)); return; }
    await logSetting({ plant_equipment_id: plantEquipmentId, equipment_setting_id: setting.id, setting_title: setting.title, action: "photo_deleted", old_value: p.storage_path.split("/").pop() ?? null, user_id: userId });
    onReload();
    let undone = false;
    toast.success("Photo deleted", {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          undone = true;
          const { error: undoError } = await supabase.from("setting_photos")
            .insert({ id: p.id, equipment_setting_id: setting.id, storage_path: p.storage_path, is_shared: p.is_shared ?? false });
          if (undoError) toast.error(undoError.message); else onReload();
        },
      },
    });
    setTimeout(async () => {
      if (!undone && !p.is_shared) await supabase.storage.from("photos").remove([p.storage_path]);
    }, 3500);
  };
  const removeFile = async (f: SettingFile) => {
    const { error } = await supabase.from("setting_files").delete().eq("id", f.id);
    if (error) { toast.error(toUserMessage(error)); return; }
    await logSetting({ plant_equipment_id: plantEquipmentId, equipment_setting_id: setting.id, setting_title: setting.title, action: "file_deleted", old_value: f.file_name, user_id: userId });
    onReload();
    let undone = false;
    toast.success("File deleted", {
      duration: 3000,
      action: {
        label: "Undo",
        onClick: async () => {
          undone = true;
          const { error: undoError } = await supabase.from("setting_files")
            .insert({ id: f.id, equipment_setting_id: setting.id, storage_path: f.storage_path, file_name: f.file_name, is_shared: f.is_shared ?? false });
          if (undoError) toast.error(undoError.message); else onReload();
        },
      },
    });
    setTimeout(async () => {
      if (!undone && !f.is_shared) await supabase.storage.from("files").remove([f.storage_path]);
    }, 3500);
  };
  const currentLine = useCurrentLine();
  const confirmUnshare = (origin?: string | null) => {
    if (!origin || !currentLine?.lineId || origin === currentLine.lineId) return true;
    return window.confirm(
      "This attachment was shared from another production line. Making it local will remove it from this line and keep it only on the original line. Continue?",
    );
  };
  const togglePhotoShared = async (p: SettingPhoto) => {
    if (p.is_shared && !confirmUnshare(p.origin_line_id)) return;
    const { error } = await supabase.from("setting_photos").update({ is_shared: !p.is_shared }).eq("id", p.id);
    if (error) toast.error(toUserMessage(error)); else onReload();
  };
  const toggleFileShared = async (f: SettingFile) => {
    if (f.is_shared && !confirmUnshare(f.origin_line_id)) return;
    const { error } = await supabase.from("setting_files").update({ is_shared: !f.is_shared }).eq("id", f.id);
    if (error) toast.error(toUserMessage(error)); else onReload();
  };

  const onRowClick = (e: MouseEvent) => {
    e.stopPropagation();
    if (inSelectMode) action.toggle(setting.id, { kind: "setting", payload: setting });
    else if (!inReorder) onToggleOpen();
  };

  return (
    <li ref={setNodeRef} style={style}
      data-nest
      className={`rounded-md border bg-card ${
        mode === "delete" ? (selected ? "border-destructive" : "border-destructive/40") :
        mode === "copy" ? (selected ? "border-primary" : "border-primary/40") : ""
      }`}>
      <div
        className={`flex items-center gap-1 border-b bg-muted/40 px-2 py-1 ${inReorder ? "" : "cursor-pointer"} ${
          mode === "delete" ? (selected ? "bg-destructive/15" : "bg-destructive/5 hover:bg-destructive/10") :
          mode === "copy" ? (selected ? "bg-primary/15" : "bg-primary/5 hover:bg-primary/10") : ""
        }`}
        onClick={onRowClick}
      >
        {canEdit && inReorder && (
          <button {...attributes} {...listeners}
            onClick={(e) => e.stopPropagation()}
            className="cursor-grab touch-none p-1 active:cursor-grabbing">
            <GripVertical className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
        {!inMode && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onToggleOpen(); }}
            className="p-1 text-muted-foreground hover:text-foreground">
            {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
        )}
        {inSelectMode && (
          <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border ${selected ? (mode === "delete" ? "border-destructive bg-destructive text-destructive-foreground" : "border-primary bg-primary text-primary-foreground") : "border-muted-foreground/30"}`}>
            {selected && <Check className="h-2.5 w-2.5" />}
          </span>
        )}
        {!inMode && open && editingTitle && canEdit ? (
          <Input
            value={title} autoFocus
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => { setEditingTitle(false); if (title !== setting.title) onTitle(title); }}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
              else if (e.key === "Escape") { setTitle(setting.title); setEditingTitle(false); }
            }}
            className="h-7 flex-1 border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-0"
          />
        ) : (
          <button type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (inSelectMode) action.toggle(setting.id, { kind: "setting", payload: setting });
            }}
            onDoubleClick={(e) => { e.stopPropagation(); if (!inMode && canEdit) { if (!open) onToggleOpen(); setEditingTitle(true); } }}
            className="flex flex-1 items-center gap-2 truncate px-1 text-left text-sm font-medium cursor-default">
            <span className="truncate">{setting.title || "Untitled"}</span>
            {!open && setting.body && (
              <span className="truncate text-xs font-normal text-muted-foreground">— {setting.body}</span>
            )}
            {!open && photos.length > 0 && (
              <span className="ml-auto inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                <Camera className="h-3 w-3" /> {photos.length}
              </span>
            )}
            {!open && files.length > 0 && (
              <span className={`${photos.length > 0 ? "" : "ml-auto"} inline-flex items-center gap-0.5 font-mono text-[10px] tabular-nums text-muted-foreground`}>
                <Paperclip className="h-3 w-3" /> {files.length}
              </span>
            )}
          </button>
        )}
      </div>
      {open && !inMode && (
        <div className="space-y-2 p-3">
          <Textarea
            value={body}
            disabled={!canEdit}
            onChange={(e) => setBody(e.target.value)}
            onBlur={() => body !== setting.body && onBody(body)}
            placeholder="Value (local to this production line)…"
            className="min-h-[60px] resize-y text-sm"
          />
          {canEdit && (
            <div className="flex flex-wrap items-center gap-1">
              {photos.length === 0 ? (
                <PhotoPicker onPick={uploadPhoto}>
                  <button title="Add photo"
                    className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                    <Camera className="h-3.5 w-3.5" /><span>Photo</span>
                  </button>
                </PhotoPicker>
              ) : (
                <button type="button" title={showPhotos ? "Hide photos" : "Show photos"}
                  onClick={() => setShowPhotos((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] hover:bg-accent ${showPhotos ? "text-primary" : "text-primary/70"}`}>
                  <Camera className="h-3.5 w-3.5" /><span>Photos {photos.length}</span>
                </button>
              )}
              {files.length === 0 ? (
                <label title="Add file"
                  className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground">
                  <Paperclip className="h-3.5 w-3.5" /><span>File</span>
                  <input type="file" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = ""; }} />
                </label>
              ) : (
                <button type="button" title={showFiles ? "Hide files" : "Show files"}
                  onClick={() => setShowFiles((v) => !v)}
                  className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] hover:bg-accent ${showFiles ? "text-primary" : "text-primary/70"}`}>
                  <Paperclip className="h-3.5 w-3.5" /><span>Files {files.length}</span>
                </button>
              )}
            </div>
          )}
          {showPhotos && photos.length > 0 && (
            <div className="space-y-1">
              <div className="grid grid-cols-3 gap-1">
                {photos.map((p) => (
                  <PhotoTile key={p.id} path={p.storage_path} canEdit={canEdit}
                    onRemove={() => removePhoto(p)}
                    isShared={!!p.is_shared} onToggleShared={() => togglePhotoShared(p)} />
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
              {files.map((f) => (
                <FileChip key={f.id} f={f} canEdit={canEdit}
                  onRemove={() => removeFile(f)}
                  onToggleShared={() => toggleFileShared(f)} />
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
        </div>
      )}
    </li>
  );
}
