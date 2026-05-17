import { createFileRoute, Link, Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ScrollText } from "lucide-react";
import { SettingsList } from "@/components/SettingsList";
import { Button } from "@/components/ui/button";
import { LineBreadcrumb } from "@/components/LineBreadcrumb";
import { PillSwitcher } from "@/components/PillSwitcher";
import { CurrentLineProvider } from "@/lib/current-line";

export const Route = createFileRoute(
  "/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId/settings",
)({
  component: EquipmentSettingsPage,
});

function EquipmentSettingsPage() {
  const { projectId, lineNumber, kind, equipmentId } = Route.useParams();
  const { session, loading, canEdit, user } = useAuth();
  const navigate = useNavigate();
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isLogRoute = pathname.includes(`/${equipmentId}/settings/log`);
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session && !isLogRoute,
    queryKey: ["equipment-settings-page", equipmentId, projectId, lineNumber, kind],
    queryFn: async () => {
      const { data: pe, error } = await supabase
        .from("plant_equipment").select("id, name, line_id").eq("id", equipmentId).single();
      if (error) throw error;
      const { data: lineRow } = await supabase
        .from("lines").select("id")
        .eq("project_id", projectId).eq("number", Number(lineNumber)).single();
      const { count: lineCount } = await supabase
        .from("lines")
        .select("id", { count: "exact", head: true })
        .eq("project_id", projectId);
      const { data: siblings } = await supabase
        .from("plant_equipment")
        .select("id, name, sort_order")
        .eq("line_id", pe.line_id)
        .eq("kind", kind)
        .is("deleted_at", null)
        .order("sort_order");
      return { pe, lineId: lineRow?.id ?? null, lineCount: lineCount ?? 10, siblings: siblings ?? [] };
    },
  });

  if (isLogRoute) return <Outlet />;

  if (!session) return null;
  const plantLabel = kind === "kiln" ? "Kiln" : "SHS";

  const equipmentPill = data ? (
    <PillSwitcher
      label={data.pe.name}
      currentKey={equipmentId}
      items={data.siblings.map((s) => ({ id: s.id, key: s.id, label: s.name }))}
      onPick={(item) => {
        if (item.id === equipmentId) return;
        const newPath = pathname.replace(
          /(\/equipment\/[^/]+\/)[0-9a-f-]{36}(\/settings.*)?$/i,
          `$1${item.id}/settings`,
        );
        router.history.push(newPath);
      }}
    />
  ) : null;

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
            <div className="mb-6 border-b pb-4">
              <LineBreadcrumb
                projectId={projectId}
                lineNumber={lineNumber}
                segments={[plantLabel, equipmentPill, "Settings"]}
                currentTitle="Settings"
              />
              <div className="mt-2 flex items-center justify-between gap-3">
                <h1 className="text-3xl font-semibold">Settings</h1>
                <Button asChild size="sm" variant="outline" className="shrink-0" title="View log" aria-label="View log">
                  <Link
                    to="/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId/settings/log"
                    params={{ projectId, lineNumber, kind, equipmentId }}
                  >
                    <ScrollText className="h-4 w-4" />
                    <span className="ml-1 text-xs">Log</span>
                  </Link>
                </Button>
              </div>
            </div>
            <CurrentLineProvider value={{ lineId: data.lineId ?? "", lineNumber: Number(lineNumber), equipmentId }}>
              <SettingsList
                equipmentId={equipmentId}
                canEdit={canEdit}
                userId={user?.id}
                lineCount={data.lineCount}
              />
            </CurrentLineProvider>
          </>
        )}
      </main>
    </div>
  );
}
