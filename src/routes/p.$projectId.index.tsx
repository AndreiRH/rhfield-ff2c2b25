import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress, equipmentProgress } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Folder, ChevronLeft } from "lucide-react";
import { ProjectHotCalendarButton } from "@/components/ProjectHotCalendarButton";

export const Route = createFileRoute("/p/$projectId/")({ component: ProjectDashboard });

function lineProgress(line: any): number {
  const peList = (line.plant_equipment ?? []).filter((p: any) => !p.deleted_at);
  const peParts = peList.map((pe: any) => equipmentProgress(pe).overall);

  const extraGroups = (line.equipment_groups ?? []).filter((eg: any) => eg.kind === "extra_work" && !eg.deleted_at);
  const extraParts = extraGroups.map((eg: any) => {
    const items = (eg.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? []);
    return calcProgress(items).pct;
  });

  const all = [...peParts, ...extraParts];
  if (all.length === 0) return 0;
  return Math.round(all.reduce((s, n) => s + n, 0) / all.length);
}

function ProjectDashboard() {
  const { projectId } = Route.useParams();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["project-dashboard", projectId],
    queryFn: async () => {
      const { data: project, error: pe } = await supabase
        .from("projects").select("id, name").eq("id", projectId).single();
      if (pe) throw pe;
      const { data: lines, error: le } = await supabase
        .from("lines")
        .select(`
          id, number, name,
          plant_equipment(
            id, deleted_at, mech_mode, mech_manual_pct,
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
            id, kind, deleted_at,
            components(id, deleted_at, checklist_items(id, done, deleted_at))
          )
        `)
        .eq("project_id", projectId)
        .order("number");
      if (le) throw le;
      return { project, lines };
    },
  });

  if (!session) return null;

  const lineProgresses = (data?.lines ?? []).map(lineProgress);
  const overallPct = lineProgresses.length === 0 ? 0
    : Math.round(lineProgresses.reduce((s, n) => s + n, 0) / lineProgresses.length);

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> All projects
        </Link>

        {isLoading ? (
          <Skeleton className="mb-8 h-32" />
        ) : (
          <Card className="mb-8 overflow-hidden border-primary/20 bg-gradient-to-br from-card to-secondary/40">
            <CardContent className="flex flex-col gap-6 p-6 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Project</div>
                <h1 className="mt-1 text-3xl font-semibold">{data?.project?.name}</h1>
                <p className="mt-1 text-sm text-muted-foreground">{data?.lines?.length ?? 0} production lines · {overallPct}% overall</p>
                <div className="mt-4 max-w-md"><ProgressBar value={overallPct} size="lg" /></div>
              </div>
              <ProjectHotCalendarButton projectId={projectId} />
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(data?.lines ?? []).map((l: any, i: number) => {
            const pct = lineProgresses[i];
            return (
              <Link key={l.id} to="/p/$projectId/lines/$lineNumber" params={{ projectId, lineNumber: String(l.number) }}>
                <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Line</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="mt-1 text-3xl font-semibold tabular-nums">{l.number.toString().padStart(2, "0")}</div>
                    <div className="mt-3"><ProgressBar value={pct} size="sm" /></div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}

          <Link to="/p/$projectId/common" params={{ projectId }}>
            <Card className="h-full border-dashed transition-all hover:border-primary/40 hover:shadow-md">
              <CardContent className="flex h-full flex-col justify-between p-4">
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Plant</span>
                  <Folder className="h-4 w-4 text-muted-foreground" />
                </div>
                <div>
                  <div className="mt-1 text-2xl font-semibold">Common</div>
                  <p className="mt-2 text-xs text-muted-foreground">Notes & shared files</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </main>
    </div>
  );
}
