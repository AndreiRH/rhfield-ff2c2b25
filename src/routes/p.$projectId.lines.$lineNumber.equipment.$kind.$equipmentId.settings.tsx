import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ScrollText } from "lucide-react";
import { SettingsList } from "@/components/SettingsList";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute(
  "/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId/settings",
)({
  component: EquipmentSettingsPage,
});

function EquipmentSettingsPage() {
  const { projectId, lineNumber, kind, equipmentId } = Route.useParams();
  const { session, loading, canEdit, user } = useAuth();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLogRoute = pathname.includes(`/${equipmentId}/settings/log`);
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session && !isLogRoute,
    queryKey: ["equipment-settings-page", equipmentId],
    queryFn: async () => {
      const { data: pe, error } = await supabase
        .from("plant_equipment").select("id, name").eq("id", equipmentId).single();
      if (error) throw error;
      return { pe };
    },
  });

  if (isLogRoute) return <Outlet />;

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
            <div className="mb-4 flex items-end justify-between gap-2 border-b pb-4">
              <div>
                <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Production line {lineNumber} · {plantLabel} · {data.pe.name}
                </span>
                <h1 className="text-3xl font-semibold">Settings</h1>
              </div>
              <Button asChild size="sm" variant="outline" title="View log" aria-label="View log">
                <Link
                  to="/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId/settings/log"
                  params={{ projectId, lineNumber, kind, equipmentId }}
                >
                  <ScrollText className="h-4 w-4" />
                  <span className="ml-1 text-xs">Log</span>
                </Link>
              </Button>
            </div>
            <SettingsList
              equipmentId={equipmentId}
              canEdit={canEdit}
              userId={user?.id}
            />
          </>
        )}
      </main>
    </div>
  );
}
