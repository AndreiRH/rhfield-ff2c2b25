import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress, CHAPTER_LABELS, CHAPTER_ORDER } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Plus, Cog } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/")({ component: LineOverview });

function LineOverview() {
  const { projectId, lineNumber } = Route.useParams();
  const { session, loading, canEdit } = useAuth();
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
          id, number, name, project_id,
          equipment_groups(
            id, chapter, kind, name, sort_order, deleted_at,
            components(
              id, deleted_at,
              checklist_items(id, done, deleted_at)
            )
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

  const allItems = useMemo(() => {
    return (data?.equipment_groups ?? []).filter((eg: any) => !eg.deleted_at).flatMap((eg: any) =>
      (eg.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? [])
    );
  }, [data]);
  const lineProgress = calcProgress(allItems);

  const chapterProgress = useMemo(() => {
    const out: Record<string, ReturnType<typeof calcProgress>> = {};
    for (const ch of CHAPTER_ORDER) {
      const items = (data?.equipment_groups ?? [])
        .filter((eg: any) => eg.chapter === ch && !eg.deleted_at)
        .flatMap((eg: any) =>
          (eg.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? [])
        );
      out[ch] = calcProgress(items);
    }
    return out;
  }, [data]);

  // Group equipment_groups by kind (kiln, shs) — aggregated across chapters
  const equipmentByKind = useMemo(() => {
    const map = new Map<string, { kind: string; name: string; items: any[] }>();
    for (const eg of (data?.equipment_groups ?? [])) {
      if (eg.deleted_at) continue;
      if (eg.kind === "extra_work") continue;
      const cur = map.get(eg.kind) ?? { kind: eg.kind, name: kindLabel(eg.kind), items: [] };
      const items = (eg.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? []);
      cur.items.push(...items);
      map.set(eg.kind, cur);
    }
    const order = ["kiln", "shs"];
    return Array.from(map.values()).sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind),
    );
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
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Line</span>
                  <h1 className="text-3xl font-semibold tabular-nums">
                    {data.number.toString().padStart(2, "0")}
                    <span className="ml-3 text-base font-normal text-muted-foreground">{lineProgress.pct}%</span>
                  </h1>
                </div>
                <div className="min-w-[240px] flex-1 sm:max-w-md">
                  <ProgressBar value={lineProgress.pct} size="md" />
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
                {CHAPTER_ORDER.map((ch) => (
                  <div key={ch} className="rounded-md border bg-card p-3">
                    <div className="mb-1 flex items-baseline justify-between">
                      <span className="text-xs text-muted-foreground">{CHAPTER_LABELS[ch]}</span>
                      <span className="font-mono text-xs tabular-nums">{chapterProgress[ch].pct}%</span>
                    </div>
                    <ProgressBar value={chapterProgress[ch].pct} size="sm" />
                  </div>
                ))}
              </div>
            </div>

            <h2 className="mb-3 text-lg font-semibold">Plants</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {equipmentByKind.map((eq) => {
                const prog = calcProgress(eq.items);
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
                          <span>{prog.done}/{prog.total} items</span>
                          <span className="font-mono tabular-nums">{prog.pct}%</span>
                        </div>
                        <ProgressBar value={prog.pct} size="sm" />
                      </CardContent>
                    </Card>
                  </Link>
                );
              })}
            </div>

            <ExtraWorksSection
              line={data}
              works={extraWorks}
              canEdit={canEdit}
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

function ExtraWorksSection({ line, works, canEdit, onChange }: any) {
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
          const items = (w.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? []);
          const prog = calcProgress(items);
          return (
            <Link
              key={w.id}
              to="/p/$projectId/lines/$lineNumber/equipment/$kind"
              params={{ projectId, lineNumber, kind: w.id }}
              className="block"
            >
              <Card className="transition hover:border-primary/40">
                <CardContent className="p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="font-medium">{w.name}</h3>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.pct}%</span>
                  </div>
                  <ProgressBar value={prog.pct} size="sm" />
                </CardContent>
              </Card>
            </Link>
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
