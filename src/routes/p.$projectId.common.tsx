import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { ChevronLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CommonFoldersList } from "@/components/CommonFoldersList";

export const Route = createFileRoute("/p/$projectId/common")({ component: CommonPage });

function CommonPage() {
  const { projectId } = Route.useParams();
  const { session, loading, canEdit, user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["common-project", projectId],
    queryFn: async () => {
      const { data: project } = await supabase.from("projects").select("name").eq("id", projectId).single();
      return { project };
    },
  });

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Link to="/p/$projectId" params={{ projectId }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Project dashboard
        </Link>

        {isLoading ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="mb-6 border-b pb-4">
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                {data?.project?.name ?? ""}
              </span>
              <h1 className="text-3xl font-semibold">Common</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                Plant-wide folders with photos, files and notes (not tied to a specific line).
              </p>
            </div>
            <CommonFoldersList projectId={projectId} canEdit={canEdit} userId={user?.id} />
          </>
        )}
      </main>
    </div>
  );
}
