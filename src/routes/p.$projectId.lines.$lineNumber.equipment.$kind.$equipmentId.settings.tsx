import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft } from "lucide-react";
import { SettingsList } from "@/components/SettingsList";

export const Route = createFileRoute(
  "/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId/settings",
)({
  component: EquipmentSettingsPage,
});

function EquipmentSettingsPage() {
  const { projectId, lineNumber, kind, equipmentId } = Route.useParams();
  const { session, loading, canEdit, user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["equipment-settings-page", equipmentId],
    queryFn: async () => {
      const { data: pe, error } = await supabase
        .from("plant_equipment").select("id, name").eq("id", equipmentId).single();
      if (error) throw error;
      return { pe };
    },
  });

  if (!session) return null;
  const plantLabel = kind === "kiln" ? "Kiln" : "SHS";

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Link
          to="/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId"
          params={{ projectId, lineNumber, kind, equipmentId }}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> {data?.pe?.name ?? plantLabel}
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="mb-4 border-b pb-4">
              <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                Production line {lineNumber} · {plantLabel} · {data.pe.name}
              </span>
              <h1 className="text-3xl font-semibold">Settings</h1>
            </div>
            <SettingsList
              equipmentId={equipmentId}
              canEdit={canEdit}
              userId={user?.id}
              logHref="/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId/settings/log"
              logParams={{ projectId, lineNumber, kind, equipmentId }}
            />
          </>
        )}
      </main>
    </div>
  );
}
