import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress, equipmentProgress, liveChecklistItems } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ChevronLeft, ChevronRight, Plus, Cog, CalendarDays, Trash2 } from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { HotCalendar } from "@/components/HotCalendar";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/")({ component: LineOverview });

function LineOverview() {
  const { projectId, lineNumber } = Route.useParams();
  const { session, loading, canEdit, isAdmin } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["line-overview", projectId, lineNumber],
    queryFn: async () => {
      const { data: line, error } = await supabase
        .from("lines")
        .select(`
          id, number, name, project_id, hot_planned_start, hot_planned_end,
          plant_equipment(
            id, name, kind, sort_order, deleted_at, mech_mode, mech_manual_pct,
            equipment_groups(
              id, chapter, deleted_at,
              components(id, deleted_at, checklist_items(id, done, deleted_at)),
              component_types(
                id, deleted_at,
                components(id, deleted_at, checklist_items(id, done, deleted_at))
              )
            )
          ),
          equipment_groups(
            id, chapter, kind, name, sort_order, deleted_at, plant_equipment_id,
            components(id, deleted_at, checklist_items(id, done, deleted_at))
          )
        `)
        .eq("project_id", projectId)
        .eq("number", Number(lineNumber))
        .single();
      if (error) throw error;
      return line;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["line-overview", projectId, lineNumber] });

  // Group plant_equipment by kind (kiln, shs)
  const equipmentByKind = useMemo(() => {
    const map = new Map<string, { kind: string; name: string; equipment: any[] }>();
    for (const pe of (data?.plant_equipment ?? [])) {
      if (pe.deleted_at) continue;
      const cur = map.get(pe.kind) ?? { kind: pe.kind, name: kindLabel(pe.kind), equipment: [] };
      cur.equipment.push(pe);
      map.set(pe.kind, cur);
    }
    const order = ["kiln", "shs"];
    return Array.from(map.values()).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  }, [data]);

  // Line overall = average of every plant_equipment's overall%
  const lineProgressPct = useMemo(() => {
    const peList = (data?.plant_equipment ?? []).filter((p: any) => !p.deleted_at);
    if (peList.length === 0) return 0;
    const total = peList.reduce((s: number, pe: any) => s + equipmentProgress(pe).overall, 0);
    return Math.round(total / peList.length);
  }, [data]);

  const extraWorks = (data?.equipment_groups ?? []).filter((eg: any) => eg.kind === "extra_work" && !eg.deleted_at);

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Link to="/p/$projectId" params={{ projectId }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Project dashboard
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="mb-6 border-b pb-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Production line</span>
                  <h1 className="text-3xl font-semibold tabular-nums">
                    {data.number.toString().padStart(2, "0")}
                    <span className="ml-3 text-base font-normal text-muted-foreground">{lineProgressPct}%</span>
                  </h1>
                </div>
                <div className="flex items-center gap-3">
                  <div className="min-w-[200px] sm:min-w-[280px]">
                    <ProgressBar value={lineProgressPct} size="md" />
                  </div>
                  <HotCommissioningButton line={data} canEdit={canEdit} onChange={invalidate} />
                </div>
              </div>
            </div>

            <h2 className="mb-3 text-lg font-semibold">Plants</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {equipmentByKind.map((eq) => {
                const overallPct = eq.equipment.length === 0
                  ? 0
                  : Math.round(eq.equipment.reduce((s: number, pe: any) => s + equipmentProgress(pe).overall, 0) / eq.equipment.length);
                return (
                  <Link
                    key={eq.kind}
                    to="/p/$projectId/lines/$lineNumber/equipment/$kind"
                    params={{ projectId, lineNumber, kind: eq.kind }}
                    className="group block"
                  >
                    <Card className="transition hover:border-primary/40 hover:shadow-sm">
                      <CardContent className="p-5">
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Cog className="h-5 w-5 text-muted-foreground" />
                            <h3 className="text-lg font-semibold">{eq.name}</h3>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                        </div>
                        <div className="mb-2 flex items-baseline justify-between text-xs text-muted-foreground">
                          <span>{eq.equipment.length} equipment</span>
                          <span className="font-mono tabular-nums">{overallPct}%</span>
                        </div>
                        <ProgressBar value={overallPct} size="sm" />
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>

            <ExtraWorksSection
              line={data}
              works={extraWorks}
              canEdit={canEdit} isAdmin={isAdmin}
              onChange={invalidate}
            />
          </>
        )}
      </main>
    </div>
  );
}

function kindLabel(kind: string) {
  if (kind === "kiln") return "Kiln";
  if (kind === "shs") return "SHS";
  return kind;
}

function HotCommissioningButton({ line, canEdit, onChange }: any) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <CalendarDays className="h-4 w-4" />
          <span>Hot Comm</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Hot Comm · Production line {String(line.number).padStart(2, "0")}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[75vh] overflow-y-auto">
          <HotCalendar
            lineId={line.id}
            plannedStart={line.hot_planned_start}
            plannedEnd={line.hot_planned_end}
            canEdit={canEdit}
            onChange={onChange}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ExtraWorksSection({ line, works, canEdit, isAdmin, onChange }: any) {
  const { projectId, lineNumber } = Route.useParams();
  const [newWork, setNewWork] = useState("");
  const addWork = async () => {
    if (!newWork.trim()) return;
    const { data: eg, error } = await supabase.from("equipment_groups").insert({
      line_id: line.id, chapter: "after_sales", kind: "extra_work",
      name: newWork.trim(), sort_order: works.length,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    await supabase.from("components").insert({ equipment_id: eg.id, name: "Tasks", sort_order: 0 });
    setNewWork("");
    onChange();
  };
  return (
    <div className="mt-8">
      <h2 className="mb-3 text-lg font-semibold">After-sales / extra works</h2>
      {works.length === 0 && <p className="mb-3 text-sm text-muted-foreground">No extra paid works yet.</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {works.map((w: any) => {
          const items = (w.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => liveChecklistItems(c.checklist_items ?? []));
          const prog = calcProgress(items);
          return (
            <Card key={w.id} className="relative transition hover:border-primary/40">
              <Link
                to="/p/$projectId/lines/$lineNumber/equipment/$kind"
                params={{ projectId, lineNumber, kind: w.id }}
                className="block"
              >
                <CardContent className="p-4 pr-12">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-medium">{w.name}</h3>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.pct}%</span>
                  </div>
                  <ProgressBar value={prog.pct} size="sm" />
                </CardContent>
              </Link>
              {isAdmin && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="absolute right-2 top-2 h-8 w-8"
                      title="Delete extra work"
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete "{w.name}"?</AlertDialogTitle>
                      <AlertDialogDescription>This removes the extra work and all its tasks from this production line.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={async () => {
                          const { error } = await supabase
                            .from("equipment_groups")
                            .update({ deleted_at: new Date().toISOString() })
                            .eq("id", w.id);
                          if (error) toast.error(error.message);
                          else { toast.success("Extra work deleted"); onChange(); }
                        }}
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </Card>
          );
        })}
      </div>
      {canEdit && (
        <div className="mt-4 flex max-w-md items-center gap-2">
          <Input value={newWork} onChange={(e) => setNewWork(e.target.value)} placeholder="Extra work name" />
          <Button onClick={addWork}><Plus className="mr-1 h-4 w-4" /> Add</Button>
        </div>
      )}
    </div>
  );
}
