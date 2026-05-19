import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import { LineBreadcrumb } from "@/components/LineBreadcrumb";
import {
  ActivityPlanner,
  type LineActivity,
  type LineInfo,
  type LineLite,
} from "@/components/ActivityPlanner";
import { ProjectHotCalendarButton } from "@/components/ProjectHotCalendarButton";
import { CalendarNotesList } from "@/components/CalendarNotesList";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/calendar")({
  component: LineCalendarPage,
});

function LineCalendarPage() {
  const { projectId, lineNumber } = Route.useParams();
  const { session, loading, canEdit, user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !session) navigate({ to: "/login" });
  }, [session, loading, navigate]);

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
        supabase
          .from("lines")
          .select("id, number, name")
          .eq("project_id", projectId)
          .order("number"),
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
  const title = "Hot commissioning planner";

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        {isLoading || !data ? (
          <Skeleton className="h-64" />
        ) : (
          <>
            <div className="mb-6 border-b pb-4">
              <Button
                asChild
                variant="ghost"
                size="sm"
                className="mb-2 -ml-2 h-7 gap-1 text-muted-foreground"
              >
                <Link to="/p/$projectId/lines/$lineNumber" params={{ projectId, lineNumber }}>
                  <ChevronLeft className="h-4 w-4" /> Back to line
                </Link>
              </Button>
              <LineBreadcrumb
                projectId={projectId}
                lineNumber={lineNumber}
                segments={[title]}
                currentTitle={title}
              />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h1 className="text-3xl font-semibold">{title}</h1>
                <ProjectHotCalendarButton projectId={projectId} />
              </div>
            </div>
            <ActivityPlanner
              line={data.line}
              allLines={data.allLines}
              activities={data.activities}
              canEdit={canEdit}
              onChange={refetch}
            />
            <div className="mt-6">
              <CalendarNotesList
                projectId={projectId}
                lineId={data.line.id}
                scope="line"
                canEdit={canEdit}
                userId={user?.id}
              />
            </div>
          </>
        )}
      </main>
    </div>
  );
}
