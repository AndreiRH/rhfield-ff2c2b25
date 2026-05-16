import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChevronLeft, Download } from "lucide-react";
import ExcelJS from "exceljs";

export const Route = createFileRoute(
  "/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId/settings/log",
)({
  component: SettingsLogPage,
});

const ACTION_LABEL: Record<string, string> = {
  created: "Created",
  title_changed: "Renamed",
  value_changed: "Value changed",
  deleted: "Deleted",
  photo_added: "Photo added",
  photo_deleted: "Photo deleted",
  file_added: "File added",
  file_deleted: "File deleted",
};

function SettingsLogPage() {
  const { projectId, lineNumber, kind, equipmentId } = Route.useParams();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["equipment-settings-log", equipmentId],
    queryFn: async () => {
      const { data: pe } = await supabase
        .from("plant_equipment").select("id, name").eq("id", equipmentId).single();
      const { data: logs } = await supabase
        .from("setting_logs")
        .select("id, created_at, action, setting_title, old_value, new_value, user_id")
        .eq("plant_equipment_id", equipmentId)
        .order("created_at", { ascending: false })
        .limit(5000);
      const userIds = Array.from(new Set((logs ?? []).map((l: any) => l.user_id).filter(Boolean)));
      const profiles = userIds.length
        ? (await supabase.from("profiles").select("id, display_name").in("id", userIds)).data ?? []
        : [];
      const nameById = new Map(profiles.map((p: any) => [p.id, p.display_name as string]));
      return { pe, logs: logs ?? [], nameById };
    },
  });

  if (!session) return null;
  const plantLabel = kind === "kiln" ? "Kiln" : "SHS";

  const exportXlsx = async () => {
    if (!data?.logs?.length) return;
    const rows = data.logs.map((l: any) => ({
      "When": new Date(l.created_at).toLocaleString(),
      "User": data.nameById.get(l.user_id) ?? l.user_id ?? "",
      "Setting": l.setting_title,
      "Action": ACTION_LABEL[l.action] ?? l.action,
      "Old value": l.old_value ?? "",
      "New value": l.new_value ?? "",
    }));
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Settings log");
    const headers = Object.keys(rows[0]);
    ws.columns = headers.map((h, i) => ({
      header: h,
      key: h,
      width: [20, 18, 24, 16, 40, 40][i] ?? 20,
    }));
    rows.forEach((r) => ws.addRow(r));
    const buf = await wb.xlsx.writeBuffer();
    const eqName = (data.pe?.name ?? "equipment").replace(/[^\w-]+/g, "_");
    const blob = new Blob([buf], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `settings-log_${eqName}_line${lineNumber}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Link
          to="/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId/settings"
          params={{ projectId, lineNumber, kind, equipmentId }}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> Settings
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="mb-4 flex items-end justify-between gap-2 border-b pb-4">
              <div>
                <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                  Production line {lineNumber} · {plantLabel} · {data.pe?.name}
                </span>
                <h1 className="text-3xl font-semibold">Settings log</h1>
              </div>
              <Button size="sm" onClick={exportXlsx} disabled={!data.logs.length}>
                <Download className="mr-1 h-4 w-4" /> Export
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {data.logs.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No log entries yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium">When</th>
                          <th className="px-3 py-2 text-left font-medium">User</th>
                          <th className="px-3 py-2 text-left font-medium">Setting</th>
                          <th className="px-3 py-2 text-left font-medium">Action</th>
                          <th className="px-3 py-2 text-left font-medium">Change</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.logs.map((l: any) => (
                          <tr key={l.id} className="border-t">
                            <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">
                              {new Date(l.created_at).toLocaleString()}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2">
                              {data.nameById.get(l.user_id) ?? "—"}
                            </td>
                            <td className="px-3 py-2 font-medium">{l.setting_title || "—"}</td>
                            <td className="whitespace-nowrap px-3 py-2">
                              {ACTION_LABEL[l.action] ?? l.action}
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {l.action === "value_changed" || l.action === "title_changed" ? (
                                <span>
                                  <span className="line-through opacity-70">{l.old_value || "—"}</span>
                                  {" → "}
                                  <span className="text-foreground">{l.new_value || "—"}</span>
                                </span>
                              ) : (
                                <span>{l.new_value ?? l.old_value ?? ""}</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
