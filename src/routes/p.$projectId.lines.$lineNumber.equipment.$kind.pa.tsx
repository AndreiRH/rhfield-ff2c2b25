import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft } from "lucide-react";
import { PAFoldersList } from "@/components/PAFoldersList";
import { PANotesList } from "@/components/PANotesList";
import { LineBreadcrumb } from "@/components/LineBreadcrumb";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/equipment/$kind/pa")({
  component: PAPage,
});

function PAPage() {
  const { projectId, lineNumber, kind } = Route.useParams();
  const { session, loading, canEdit, user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["pa-line", projectId, lineNumber],
    queryFn: async () => {
      const { data: line, error } = await supabase
        .from("lines")
        .select("id, number")
        .eq("project_id", projectId)
        .eq("number", Number(lineNumber))
        .single();
      if (error) throw error;
      return line;
    },
  });

  if (!session) return null;
  const title = kind === "kiln" ? "Kiln" : kind === "shs" ? "SHS" : kind;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Link
          to="/p/$projectId/lines/$lineNumber/equipment/$kind"
          params={{ projectId, lineNumber, kind }}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> {title}
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="mb-6 border-b pb-4">
              <LineBreadcrumb
                projectId={projectId}
                lineNumber={lineNumber}
                segments={[title, "Provisional Acceptance"]}
                currentTitle="Provisional Acceptance"
              />
              <h1 className="text-3xl font-semibold">Provisional Acceptance</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Photos, files and notes from PA measurements.
              </p>
            </div>
            <PAFoldersList lineId={data.id} kind={kind} canEdit={canEdit} userId={user?.id} />
          </>
        )}
      </main>
    </div>
  );
}
