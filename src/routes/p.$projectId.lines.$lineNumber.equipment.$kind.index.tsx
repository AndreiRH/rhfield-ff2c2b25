import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toUserMessage } from "@/lib/errors";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { localUuid } from "@/lib/local-id";
import { equipmentProgress } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ChevronLeft, ChevronRight, Plus, Trash2, Check, X, Cog, GripVertical, Copy } from "lucide-react";
import { toast } from "sonner";
import ExtraWorkChapterView from "@/components/ExtraWorkChapterView";
import { PANotesList } from "@/components/PANotesList";
import { LineBreadcrumb } from "@/components/LineBreadcrumb";
import { CurrentLineProvider } from "@/lib/current-line";
import {
  DndContext, closestCenter, PointerSensor, TouchSensor, useSensor, useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext, arrayMove, useSortable, verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { fetchEquipmentDetail } from "./p.$projectId.lines.$lineNumber.equipment.$kind.$equipmentId";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/equipment/$kind/")({
  component: PlantEquipmentList,
});

function PlantEquipmentList() {
  const { projectId, lineNumber, kind } = Route.useParams();
  const { session, loading, canEdit, isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const isPlant = kind === "kiln" || kind === "shs";

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["plant-equip-list", projectId, lineNumber, kind],
    queryFn: async () => {
      const { data: line, error } = await supabase
        .from("lines")
        .select("id, number, project_id")
        .eq("project_id", projectId)
        .eq("number", Number(lineNumber))
        .single();
      if (error) throw error;

      if (isPlant) {
        const { data: pe, error: pErr } = await supabase
          .from("plant_equipment")
          .select(`
            id, name, sort_order, deleted_at, mech_mode, mech_manual_pct,
            equipment_groups(
              id, chapter, deleted_at,
              components(id, deleted_at, checklist_items(id, done, deleted_at, parent_item_id, local_line_id)),
              component_types(
                id, deleted_at,
                checklist_items(id, done, deleted_at, parent_item_id, local_line_id),
                components(id, deleted_at, checklist_items(id, done, deleted_at, parent_item_id, local_line_id))
              )
            )
          `)
          .eq("line_id", line.id)
          .eq("kind", kind)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true });
        if (pErr) throw pErr;
        const cleanItems = (items: any[] | null | undefined) =>
          (items ?? []).filter((i: any) => !i.deleted_at && (!i.local_line_id || i.local_line_id === line.id));
        const cleanComponents = (comps: any[] | null | undefined) =>
          (comps ?? [])
            .filter((c: any) => !c.deleted_at)
            .map((c: any) => ({ ...c, checklist_items: cleanItems(c.checklist_items) }));
        const cleanedPE = (pe ?? []).map((p: any) => ({
          ...p,
          equipment_groups: (p.equipment_groups ?? [])
            .filter((g: any) => !g.deleted_at)
            .map((g: any) => ({
              ...g,
              components: cleanComponents(g.components),
              component_types: (g.component_types ?? [])
                .filter((t: any) => !t.deleted_at)
                .map((t: any) => ({
                  ...t,
                  checklist_items: cleanItems(t.checklist_items),
                  components: cleanComponents(t.components),
                })),
            })),
        }));
        return { line, plantEquipment: cleanedPE, extraGroup: null };
      } else {
        const { data: eg, error: eErr } = await supabase
          .from("equipment_groups")
          .select(`
            id, name, chapter, kind, line_id, sort_order, deleted_at,
            components(
              id, name, sort_order, deleted_at, note, note_shared,
              component_photos(id, storage_path),
              component_files(id, storage_path, file_name),
              checklist_items(id, label, done, note, note_shared, sort_order, deleted_at, completed_at, parent_item_id, component_id, template_id, local_line_id, origin_line_id,
                item_photos(id, storage_path, is_shared), item_files(id, storage_path, file_name, is_shared))
            )
          `)
          .eq("id", kind)
          .is("deleted_at", null)
          .single();
        if (eErr) throw eErr;
        const cleanedEg = eg
          ? {
              ...eg,
              components: (eg.components ?? [])
                .filter((c: any) => !c.deleted_at)
                .map((c: any) => ({
                  ...c,
                  checklist_items: (c.checklist_items ?? []).filter((i: any) => !i.deleted_at),
                })),
            }
          : eg;
        return { line, plantEquipment: [], extraGroup: cleanedEg };
      }
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["plant-equip-list", projectId, lineNumber, kind] });

  // Warm equipment-detail cache for every sibling so opening / swiping is instant.
  useEffect(() => {
    if (!data || !isPlant) return;
    const list = (data.plantEquipment ?? []) as { id: string }[];
    for (const pe of list) {
      qc.prefetchQuery({
        queryKey: ["equipment-detail", projectId, lineNumber, kind, pe.id],
        staleTime: 5 * 60_000,
        queryFn: () => fetchEquipmentDetail(projectId, lineNumber, kind, pe.id),
      });
    }
  }, [data, isPlant, projectId, lineNumber, kind, qc]);

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Link to="/p/$projectId/lines/$lineNumber" params={{ projectId, lineNumber }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Production line {lineNumber}
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : isPlant ? (
          <PlantView
            lineId={data.line.id}
            kind={kind}
            equipment={data.plantEquipment}
            canEdit={canEdit} isAdmin={isAdmin}
            userId={user?.id}
            onChange={invalidate}
            projectId={projectId}
            lineNumber={lineNumber}
          />
        ) : (
          <CurrentLineProvider value={{ lineId: data.line.id, lineNumber: data.line.number }}>
            <ExtraWorkChapterView group={data.extraGroup} canEdit={canEdit} onChange={invalidate} />
          </CurrentLineProvider>
        )}
      </main>
    </div>
  );
}

function PlantView({ lineId, kind, equipment, canEdit, isAdmin, userId, onChange, projectId, lineNumber }: any) {
  const totals = equipment.reduce(
    (acc: any, pe: any) => {
      const p = equipmentProgress(pe);
      acc.mech += p.mech; acc.wiring += p.wiring; acc.cold += p.cold; acc.n += 1;
      return acc;
    },
    { mech: 0, wiring: 0, cold: 0, n: 0 },
  );
  const avgMech = totals.n ? Math.round(totals.mech / totals.n) : 0;
  const avgWiring = totals.n ? Math.round(totals.wiring / totals.n) : 0;
  const avgCold = totals.n ? Math.round(totals.cold / totals.n) : 0;
  const overall = Math.round((avgMech + avgWiring + avgCold) / 3);

  type Mode = "none" | "reorder" | "copy" | "delete";
  const [mode, setMode] = useState<Mode>("none");
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const title = kind === "kiln" ? "Kiln" : "SHS";

  const addEquipment = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from("plant_equipment").insert({
      id: localUuid(), line_id: lineId, kind, name: newName.trim(), sort_order: equipment.length,
    });
    if (error) toast.error(toUserMessage(error));
    else { setNewName(""); setAdding(false); onChange(); }
  };

  const duplicateEquipment = async (pe: any) => {
    const { error } = await supabase.from("plant_equipment").insert({
      id: localUuid(), line_id: lineId, kind, name: `${pe.name} (copy)`, sort_order: equipment.length,
    });
    if (error) toast.error(toUserMessage(error));
    else { toast.success(`Duplicated "${pe.name}"`); onChange(); }
  };

  return (
    <>
      <div className="mb-6 border-b pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <LineBreadcrumb projectId={projectId} lineNumber={lineNumber} segments={[title]} currentTitle={title} />
            <h1 className="flex items-center gap-3 text-3xl font-semibold">
              <span>{title}</span>
              <span className="text-base font-normal text-muted-foreground">{overall}%</span>
            </h1>
          </div>
          <Link
            to="/p/$projectId/lines/$lineNumber/equipment/$kind/pa"
            params={{ projectId, lineNumber, kind }}
            className="inline-flex w-fit shrink-0 flex-col items-center self-start rounded-md border border-sky-200 bg-slate-100 px-3 py-1.5 text-xs font-medium leading-tight text-sky-900 hover:bg-sky-50"
          >
            <span>Provisional</span>
            <span>acceptance</span>
          </Link>
        </div>
        {/* 3 chapters in one line */}
        <div className="mt-4 grid grid-cols-3 gap-3">
          <ChapterTile label="Assembly" pct={avgMech} />
          <ChapterTile label="Wiring" pct={avgWiring} />
          <ChapterTile label="Cold comm." pct={avgCold} />
        </div>
      </div>

      {canEdit && !adding && (
        <div className="mb-3 flex flex-wrap items-center justify-end gap-2">
          {equipment.length > 0 && (
            <>
              <Button
                size="icon"
                variant={mode === "reorder" ? "default" : "outline"}
                onClick={() => setMode(mode === "reorder" ? "none" : "reorder")}
                title="Reorder"
                aria-label="Reorder"
              >
                <GripVertical className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant={mode === "copy" ? "default" : "outline"}
                onClick={() => setMode(mode === "copy" ? "none" : "copy")}
                title="Duplicate"
                aria-label="Duplicate"
              >
                <Copy className="h-4 w-4" />
              </Button>
              {isAdmin && (
                <Button
                  size="icon"
                  variant={mode === "delete" ? "destructive" : "outline"}
                  onClick={() => setMode(mode === "delete" ? "none" : "delete")}
                  title="Delete"
                  aria-label="Delete"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </>
          )}
          <Button size="sm" onClick={() => setAdding(true)} title="Add equipment" aria-label="Add equipment">
            <Plus className="h-4 w-4" />
            <span className="ml-1">Add equipment</span>
          </Button>
        </div>
      )}

      {adding && (
        <div className="mb-4 flex max-w-md items-center gap-2">
          <Input value={newName} autoFocus onChange={(e) => setNewName(e.target.value)}
            placeholder="Equipment name (e.g. Burner, Fan)"
            onKeyDown={(e) => e.key === "Enter" && addEquipment()} />
          <Button size="sm" onClick={addEquipment}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
        </div>
      )}

      {mode === "delete" && (
        <p className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          Tap an equipment to delete it. Tap the trash icon again to exit delete mode.
        </p>
      )}
      {mode === "copy" && (
        <p className="mb-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary">
          Tap an equipment to duplicate it. Tap the copy icon again to exit.
        </p>
      )}
      {mode === "reorder" && (
        <p className="mb-3 rounded-md border border-muted-foreground/20 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          Drag the handle on each card to reorder. Tap the reorder icon again when done.
        </p>
      )}

      {equipment.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No equipment yet. Add the first one to start tracking.</p>
      ) : (
        <EquipmentSortable
          equipment={equipment}
          canEdit={canEdit}
          onChange={onChange}
          projectId={projectId}
          lineNumber={lineNumber}
          kind={kind}
          mode={mode}
          onDuplicate={duplicateEquipment}
        />
      )}

      <div className="mt-8">
        <PANotesList lineId={lineId} kind={kind} canEdit={canEdit} userId={userId} />
      </div>
    </>
  );
}

function EquipmentSortable({ equipment, canEdit, onChange, projectId, lineNumber, kind, mode, onDuplicate }: any) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );
  const [items, setItems] = useState(equipment);
  useEffect(() => { setItems(equipment); }, [equipment]);

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((x: any) => x.id === active.id);
    const newIdx = items.findIndex((x: any) => x.id === over.id);
    const next = arrayMove(items, oldIdx, newIdx);
    setItems(next);
    await Promise.all(
      next.map((n: any, i: number) =>
        supabase.from("plant_equipment").update({ sort_order: i }).eq("id", n.id),
      ),
    );
    onChange();
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <SortableContext items={items.map((x: any) => x.id)} strategy={verticalListSortingStrategy}>
        <div className="grid gap-3 md:grid-cols-2">
          {items.map((pe: any) => (
            <EquipmentCard
              key={pe.id}
              pe={pe}
              canEdit={canEdit}
              onChange={onChange}
              projectId={projectId}
              lineNumber={lineNumber}
              kind={kind}
              mode={mode}
              onDuplicate={onDuplicate}
            />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}

function ChapterTile({ label, pct }: { label: string; pct: number }) {
  return (
    <div className={`min-w-0 rounded-md border p-3 ${pct === 100 ? "border-success/40 bg-success/10" : "bg-card"}`}>
      <div className="mb-1 flex items-baseline justify-between gap-1">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums">{pct}%</span>
      </div>
      <ProgressBar value={pct} size="sm" />
    </div>
  );
}

function EquipmentCard({ pe, canEdit, onChange, projectId, lineNumber, kind, mode, onDuplicate }: any) {
  const navigate = useNavigate();
  const { mech, wiring, cold, overall } = equipmentProgress(pe);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(pe.name);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: pe.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 };

  const save = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from("plant_equipment").update({ name: name.trim() }).eq("id", pe.id);
    if (error) toast.error(toUserMessage(error));
    else { setEditing(false); onChange(); }
  };

  const remove = async () => {
    const { error } = await supabase.from("plant_equipment").update({ deleted_at: new Date().toISOString() }).eq("id", pe.id);
    if (error) { toast.error(toUserMessage(error)); return; }
    setConfirmDelete(false);
    onChange();
    toast.success(`"${pe.name}" deleted`, {
      duration: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          const { error: undoErr } = await supabase
            .from("plant_equipment").update({ deleted_at: null }).eq("id", pe.id);
          if (undoErr) toast.error(toUserMessage(undoErr));
          else { toast.success("Restored"); onChange(); }
        },
      },
    });
  };

  const isDelete = mode === "delete";
  const isCopy = mode === "copy";
  const isReorder = mode === "reorder";
  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`transition ${isDelete ? "cursor-pointer border-destructive/50 bg-destructive/5 hover:bg-destructive/10" : isCopy ? "cursor-pointer border-primary/50 bg-primary/5 hover:bg-primary/10" : editing ? "" : "cursor-pointer hover:border-primary/40"}`}
      onClick={(e) => {
        if (isDelete) { setConfirmDelete(true); return; }
        if (isCopy) { onDuplicate?.(pe); return; }
        if (isReorder) return;
        if (editing) return;
        const target = e.target as HTMLElement;
        if (target.closest("button, a, input, textarea, [role='button'], [data-no-nav]")) return;
        navigate({
          to: "/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId",
          params: { projectId, lineNumber, kind, equipmentId: pe.id },
        });
      }}
    >
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          {canEdit && !editing && isReorder && (
            <button
              type="button"
              className="-ml-1 cursor-grab touch-none rounded p-1 text-muted-foreground hover:bg-accent active:cursor-grabbing"
              title="Drag to reorder"
              onClick={(e) => e.stopPropagation()}
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
          )}
          {editing ? (
            <div className="flex flex-1 items-center gap-2" onClick={(e) => e.stopPropagation()}>
              <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
              <Button size="icon" variant="ghost" onClick={save}><Check className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => { setEditing(false); setName(pe.name); }}><X className="h-4 w-4" /></Button>
            </div>
          ) : isDelete ? (
            <div className="flex flex-1 items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              <h3 className="text-lg font-semibold">{pe.name}</h3>
              <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">{overall}%</span>
            </div>
          ) : isCopy ? (
            <div className="flex flex-1 items-center gap-2">
              <Copy className="h-5 w-5 text-primary" />
              <h3 className="text-lg font-semibold">{pe.name}</h3>
              <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">{overall}%</span>
            </div>
          ) : (
            <div className="flex flex-1 items-center gap-2">
              <Cog className="h-5 w-5 text-muted-foreground" />
              <h3
                data-no-nav
                onDoubleClick={(e) => { if (canEdit) { e.stopPropagation(); setEditing(true); } }}
                title={canEdit ? "Double-click to rename" : undefined}
                className={`text-lg font-semibold ${canEdit ? "cursor-text" : ""}`}
              >{pe.name}</h3>
              <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">{overall}%</span>
              <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground" />
            </div>
          )}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Assembly" pct={mech} />
          <MiniStat label="Wiring" pct={wiring} />
          <MiniStat label="Cold comm." pct={cold} />
        </div>
      </CardContent>
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{pe.name}"?</AlertDialogTitle>
            <AlertDialogDescription>This removes the equipment on every line of the project.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function MiniStat({ label, pct }: { label: string; pct: number }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between text-[11px] text-muted-foreground">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{pct}%</span>
      </div>
      <ProgressBar value={pct} size="sm" />
    </div>
  );
}
