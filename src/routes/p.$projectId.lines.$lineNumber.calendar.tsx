import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft } from "lucide-react";
import { ActivityPlanner, type LineActivity, type LineInfo, type LineLite } from "@/components/ActivityPlanner";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/calendar")({
  component: LineCalendarPage,
});

function LineCalendarPage() {
  const { projectId, lineNumber } = Route.useParams();
  const { session, loading, canEdit } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading, refetch } = useQuery({
    enabled: !!session,
    queryKey: ["line-calendar", projectId, lineNumber],
    queryFn: async () => {
      const { data: line, error } = await supabase
        .from("lines")
        .select("id, number, name, hot_planned_start, hot_planned_end")
        .eq("project_id", projectId)
        .eq("number", Number(lineNumber))
        .single();
      if (error) throw error;

      const [{ data: allLines }, { data: activities }] = await Promise.all([
        supabase.from("lines").select("id, number, name").eq("project_id", projectId).order("number"),
        supabase.from("line_activities").select("*").eq("line_id", line.id).order("start_date"),
      ]);

      return {
        line: line as LineInfo,
        allLines: (allLines ?? []) as LineLite[],
        activities: (activities ?? []) as LineActivity[],
      };
    },
  });

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Link
          to="/p/$projectId/lines/$lineNumber"
          params={{ projectId, lineNumber }}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Line {lineNumber}
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <div className="mb-6 border-b pb-4">
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Production line {String(data.line.number).padStart(2, "0")}
              </span>
              <h1 className="text-3xl font-semibold">Hot commissioning planner</h1>
            </div>
            <ActivityPlanner
              line={data.line}
              allLines={data.allLines}
              activities={data.activities}
              canEdit={canEdit}
              onChange={refetch}
            />
          </>
        )}
      </main>
    </div>
  );
}
