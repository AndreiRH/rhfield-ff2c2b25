import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportProjectButton } from "@/components/ImportProjectButton";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";

export const Route = createFileRoute("/")({ component: ProjectsPage });

function ProjectsPage() {
  const { session, loading, isAdmin } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [session, loading, navigate]);

  const { data: projects, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["projects"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("projects")
        .select("id, name, lines(id, equipment_groups(id, components(id, checklist_items(done, deleted_at))))")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-8">
        <div className="mb-6 flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Projects</h1>
            <p className="text-sm text-muted-foreground">Active commissioning projects.</p>
          </div>
          {isAdmin && <ImportProjectButton />}
        </div>
        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Skeleton className="h-36" /><Skeleton className="h-36" /><Skeleton className="h-36" />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(projects ?? []).map((p) => {
              const items = (p.lines ?? []).flatMap((l: any) =>
                (l.equipment_groups ?? []).flatMap((eg: any) =>
                  (eg.components ?? []).flatMap((c: any) => c.checklist_items ?? [])
                )
              );
              const prog = calcProgress(items);
              return (
                <Link key={p.id} to="/p/$projectId" params={{ projectId: p.id }}>
                  <Card className="transition-all hover:border-primary/40 hover:shadow-md">
                    <CardContent className="p-5">
                      <div className="mb-3 flex items-center justify-between">
                        <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Project</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total}</span>
                      </div>
                      <h2 className="mb-3 text-2xl font-semibold">{p.name}</h2>
                      <ProgressBar value={prog.pct} size="md" />
                      <div className="mt-2 text-sm tabular-nums">{prog.pct}% complete</div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
