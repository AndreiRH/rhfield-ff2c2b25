import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress } from "@/lib/progress";
import { ProgressBar, ProgressRing } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Folder, ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/p/$projectId/")({ component: ProjectDashboard });

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
        .select("id, number, name, equipment_groups(id, components(id, checklist_items(done, deleted_at)))")
        .eq("project_id", projectId)
        .order("number");
      if (le) throw le;
      return { project, lines };
    },
  });

  if (!session) return null;

  const overall = (() => {
    if (!data?.lines) return { done: 0, total: 0, pct: 0 };
    const items = data.lines.flatMap((l: any) =>
      (l.equipment_groups ?? []).flatMap((eg: any) =>
        (eg.components ?? []).flatMap((c: any) => c.checklist_items ?? [])
      )
    );
    return calcProgress(items);
  })();

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
                <p className="mt-1 text-sm text-muted-foreground">{data?.lines?.length ?? 0} production lines · {overall.done} of {overall.total} checklist items complete</p>
                <div className="mt-4 max-w-md"><ProgressBar value={overall.pct} size="lg" /></div>
              </div>
              <ProgressRing value={overall.pct} size={120} />
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(data?.lines ?? []).map((l: any) => {
            const items = (l.equipment_groups ?? []).flatMap((eg: any) =>
              (eg.components ?? []).flatMap((c: any) => c.checklist_items ?? [])
            );
            const prog = calcProgress(items);
            return (
              <Link key={l.id} to="/p/$projectId/lines/$lineNumber" params={{ projectId, lineNumber: String(l.number) }}>
                <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-baseline justify-between">
                      <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Line</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total}</span>
                    </div>
                    <div className="mt-1 text-3xl font-semibold tabular-nums">{l.number.toString().padStart(2, "0")}</div>
                    <div className="mt-3"><ProgressBar value={prog.pct} size="sm" /></div>
                    <div className="mt-1 text-xs tabular-nums">{prog.pct}%</div>
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
