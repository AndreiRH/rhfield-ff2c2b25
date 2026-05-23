import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { lineOverallPct, flaggedInProject } from "@/lib/progress";
import { FlagBadge } from "@/components/FlagBadge";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportProjectButton } from "@/components/ImportProjectButton";
import { DeleteProjectButton } from "@/components/DeleteProjectButton";
import { ExportProjectButton } from "@/components/ExportProjectButton";

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
        .select(`
          id, name,
          lines(
            id,
            plant_equipment(
              id, deleted_at, mech_mode, mech_manual_pct,
              equipment_groups(
                id, chapter, deleted_at,
                components(id, deleted_at, checklist_items(id, done, flagged, deleted_at, parent_item_id)),
                component_types(
                  id, deleted_at,
                  checklist_items(id, done, flagged, deleted_at, parent_item_id),
                  components(id, deleted_at, checklist_items(id, done, flagged, deleted_at, parent_item_id))
                )
              )
            ),
            equipment_groups(
              id, kind, deleted_at,
              components(id, deleted_at, checklist_items(id, done, flagged, deleted_at, parent_item_id))
            )
          )
        `)
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
              const lineParts = (p.lines ?? []).map((l: any) => lineOverallPct(l));
              const pct = lineParts.length === 0
                ? 0
                : Math.round(lineParts.reduce((s: number, n: number) => s + n, 0) / lineParts.length);
              return (
                <div key={p.id} className="relative">
                  <Link to="/p/$projectId" params={{ projectId: p.id }}>
                    <Card className="transition-all hover:border-primary/40 hover:shadow-md">
                      <CardContent className="p-5">
                        <div className="mb-3 flex items-center justify-between gap-2">
                          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Project</span>
                          <span className={`text-xs tabular-nums text-muted-foreground ${isAdmin ? "mr-20" : ""}`}>{p.lines?.length ?? 0} lines</span>
                        </div>
                        <h2 className="mb-3 text-2xl font-semibold">{p.name}</h2>
                        <ProgressBar value={pct} size="md" />
                        <div className="mt-2 text-sm tabular-nums">{pct}% complete</div>
                      </CardContent>
                    </Card>
                  </Link>
                  {isAdmin && (
                    <div className="absolute right-2 top-2 flex items-center gap-1"
                      onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}>
                      <ExportProjectButton projectId={p.id} />
                      <DeleteProjectButton projectId={p.id} projectName={p.name} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
