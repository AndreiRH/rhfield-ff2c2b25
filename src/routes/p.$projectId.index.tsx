import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Folder, ChevronLeft } from "lucide-react";
import { ProjectHotCalendarButton } from "@/components/ProjectHotCalendarButton";


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
        .select("id, number, name")
        .eq("project_id", projectId)
        .order("number");
      if (le) throw le;
      return { project, lines };
    },
  });

  if (!session) return null;

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
                <p className="mt-1 text-sm text-muted-foreground">{data?.lines?.length ?? 0} production lines</p>
              </div>
              <div className="flex w-full flex-col items-stretch gap-2 sm:w-auto sm:items-end">
                <ProjectHotCalendarButton projectId={projectId} />
                {/* AI Search hidden until the feature is ready.
                <Link
                  to="/p/$projectId/search"
                  params={{ projectId }}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10"
                >
                  ✨ AI Search
                </Link>
                */}
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {(data?.lines ?? []).map((l: any) => {
            return (
              <Link key={l.id} to="/p/$projectId/lines/$lineNumber" params={{ projectId, lineNumber: String(l.number) }}>
                <Card className="h-full transition-all hover:border-primary/40 hover:shadow-md">
                  <CardContent className="p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Production line</span>
                      <span className="text-xs text-muted-foreground">Open</span>
                    </div>
                    <div className="mt-1 flex items-center gap-2">
                      <div className="text-3xl font-semibold tabular-nums">{l.number.toString().padStart(2, "0")}</div>
                    </div>
                    {l.name && <p className="mt-2 text-xs text-muted-foreground">{l.name}</p>}
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
