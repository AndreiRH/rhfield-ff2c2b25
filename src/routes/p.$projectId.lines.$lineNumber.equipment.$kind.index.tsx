import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress } from "@/lib/progress";
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
import { ChevronLeft, ChevronRight, Plus, Pencil, Trash2, Check, X, Cog, ArrowUp, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import ExtraWorkChapterView from "@/components/ExtraWorkChapterView";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/equipment/$kind/")({
  component: PlantEquipmentList,
});

function PlantEquipmentList() {
  const { projectId, lineNumber, kind } = Route.useParams();
  const { session, loading, canEdit } = useAuth();
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
            id, name, sort_order, deleted_at,
            equipment_groups(
              id, deleted_at,
              components(
                id, deleted_at,
                checklist_items(id, done, deleted_at)
              )
            )
          `)
          .eq("line_id", line.id)
          .eq("kind", kind)
          .is("deleted_at", null)
          .order("sort_order", { ascending: true });
        if (pErr) throw pErr;
        return { line, plantEquipment: pe ?? [], extraGroup: null };
      } else {
        const { data: eg, error: eErr } = await supabase
          .from("equipment_groups")
          .select(`
            id, name, chapter, kind, line_id, sort_order, deleted_at,
            components(
              id, name, sort_order, deleted_at,
              checklist_items(id, label, done, note, sort_order, deleted_at, completed_at, parent_item_id,
                item_photos(id, storage_path))
            )
          `)
          .eq("id", kind)
          .is("deleted_at", null)
          .single();
        if (eErr) throw eErr;
        return { line, plantEquipment: [], extraGroup: eg };
      }
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["plant-equip-list", projectId, lineNumber, kind] });

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Link to="/p/$projectId/lines/$lineNumber" params={{ projectId, lineNumber }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Line {lineNumber}
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : isPlant ? (
          <PlantView
            lineId={data.line.id}
            kind={kind}
            equipment={data.plantEquipment}
            canEdit={canEdit}
            onChange={invalidate}
            projectId={projectId}
            lineNumber={lineNumber}
          />
        ) : (
          <ExtraWorkChapterView group={data.extraGroup} canEdit={canEdit} onChange={invalidate} />
        )}
      </main>
    </div>
  );
}

function PlantView({ lineId, kind, equipment, canEdit, onChange, projectId, lineNumber }: any) {
  const allItems = equipment.flatMap((pe: any) =>
    (pe.equipment_groups ?? []).filter((eg: any) => !eg.deleted_at).flatMap((eg: any) =>
      (eg.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? [])
    )
  );
  const overall = calcProgress(allItems);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const title = kind === "kiln" ? "Kiln" : "SHS";

  const addEquipment = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from("plant_equipment").insert({
      line_id: lineId, kind, name: newName.trim(), sort_order: equipment.length,
    });
    if (error) toast.error(error.message);
    else { setNewName(""); setAdding(false); onChange(); }
  };

  return (
    <>
      <div className="mb-6 border-b pb-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Line {lineNumber} · Plant</span>
            <h1 className="text-3xl font-semibold">
              {title}
              <span className="ml-3 text-base font-normal text-muted-foreground">{overall.pct}%</span>
            </h1>
          </div>
          <div className="min-w-[240px] flex-1 sm:max-w-md">
            <ProgressBar value={overall.pct} size="md" />
          </div>
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Equipment</h2>
        {canEdit && !adding && (
          <Button size="sm" onClick={() => setAdding(true)}>
            <Plus className="mr-1 h-4 w-4" /> Add equipment
          </Button>
        )}
      </div>

      {adding && (
        <div className="mb-4 flex max-w-md items-center gap-2">
          <Input
            value={newName}
            autoFocus
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Equipment name (e.g. Burner, Fan)"
            onKeyDown={(e) => e.key === "Enter" && addEquipment()}
          />
          <Button size="sm" onClick={addEquipment}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
        </div>
      )}

      {equipment.length === 0 && !adding ? (
        <p className="text-sm text-muted-foreground">No equipment yet. Add the first one to start tracking.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {equipment.map((pe: any) => (
            <EquipmentCard
              key={pe.id}
              pe={pe}
              canEdit={canEdit}
              onChange={onChange}
              projectId={projectId}
              lineNumber={lineNumber}
              kind={kind}
            />
          ))}
        </div>
      )}
    </>
  );
}

function EquipmentCard({ pe, canEdit, onChange, projectId, lineNumber, kind }: any) {
  const items = (pe.equipment_groups ?? []).filter((eg: any) => !eg.deleted_at).flatMap((eg: any) =>
    (eg.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? [])
  );
  const prog = calcProgress(items);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(pe.name);

  const save = async () => {
    if (!name.trim()) return;
    const { error } = await supabase.from("plant_equipment").update({ name: name.trim() }).eq("id", pe.id);
    if (error) toast.error(error.message);
    else { setEditing(false); onChange(); }
  };

  const remove = async () => {
    const { error } = await supabase.from("plant_equipment").update({ deleted_at: new Date().toISOString() }).eq("id", pe.id);
    if (error) toast.error(error.message);
    else { toast.success("Equipment removed"); onChange(); }
  };

  return (
    <Card className="transition hover:border-primary/40">
      <CardContent className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          {editing ? (
            <div className="flex flex-1 items-center gap-2">
              <Input value={name} autoFocus onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && save()} />
              <Button size="icon" variant="ghost" onClick={save}><Check className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => { setEditing(false); setName(pe.name); }}><X className="h-4 w-4" /></Button>
            </div>
          ) : (
            <Link
              to="/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId"
              params={{ projectId, lineNumber, kind, equipmentId: pe.id }}
              className="group flex flex-1 items-center gap-2"
            >
              <Cog className="h-5 w-5 text-muted-foreground" />
              <h3 className="text-lg font-semibold group-hover:underline">{pe.name}</h3>
              <ChevronRight className="ml-auto h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
            </Link>
          )}
          {canEdit && !editing && (
            <div className="flex items-center gap-1">
              <Button size="icon" variant="ghost" onClick={() => setEditing(true)} title="Rename">
                <Pencil className="h-4 w-4" />
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button size="icon" variant="ghost" title="Delete">
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Delete "{pe.name}"?</AlertDialogTitle>
                    <AlertDialogDescription>All sections and items inside will be hidden.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction onClick={remove}>Delete</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          )}
        </div>
        <div className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
          <span>{prog.done}/{prog.total} items</span>
          <span className="font-mono tabular-nums">{prog.pct}%</span>
        </div>
        <ProgressBar value={prog.pct} size="sm" />
      </CardContent>
    </Card>
  );
}
