import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { equipmentProgress } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { ComponentTypesTree } from "@/components/ComponentTypesTree";
import { FlatChecklist } from "@/components/FlatChecklist";
import { NotesList } from "@/components/NotesList";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId")({
  component: EquipmentDetail,
});

function EquipmentDetail() {
  const { projectId, lineNumber, kind, equipmentId } = Route.useParams();
  const { session, loading, canEdit, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["equipment-detail", projectId, lineNumber, kind, equipmentId],
    queryFn: async () => {
      const { data: line, error } = await supabase
        .from("lines").select("id, number, project_id")
        .eq("project_id", projectId).eq("number", Number(lineNumber)).single();
      if (error) throw error;

      const { data: pe, error: peErr } = await supabase
        .from("plant_equipment")
        .select("id, name, kind, mech_mode, mech_manual_pct, mech_notes")
        .eq("id", equipmentId).single();
      if (peErr) throw peErr;

      const groupsSelect = `
          id, chapter, name, plant_equipment_id,
          components(
            id, name, sort_order, deleted_at, note,
            component_photos(id, storage_path),
            component_files(id, storage_path, file_name),
            checklist_items(id, label, done, note, sort_order, deleted_at, completed_at, parent_item_id, component_id,
              item_photos(id, storage_path), item_files(id, storage_path, file_name))
          ),
          component_types(
            id, name, sort_order, deleted_at,
            components(
              id, name, sort_order, deleted_at, note,
              component_photos(id, storage_path),
              component_files(id, storage_path, file_name),
              checklist_items(id, label, done, note, sort_order, deleted_at, completed_at, parent_item_id, component_id,
                item_photos(id, storage_path), item_files(id, storage_path, file_name))
            )
          )
        `;
      let { data: groups, error: gErr } = await supabase
        .from("equipment_groups")
        .select(groupsSelect)
        .eq("plant_equipment_id", equipmentId)
        .is("deleted_at", null);
      if (gErr) throw gErr;

      // Backfill any missing default chapters (assembly/wiring/cold_comm)
      const chapters = ["assembly", "wiring", "cold_comm"] as const;
      const missing = chapters.filter((ch) => !(groups ?? []).some((g: any) => g.chapter === ch));
      if (missing.length > 0) {
        const { error: insErr } = await supabase.from("equipment_groups").insert(
          missing.map((ch) => ({
            line_id: line.id,
            chapter: ch,
            kind: pe.kind,
            name: pe.name,
            sort_order: 0,
            plant_equipment_id: equipmentId,
          })),
        );
        if (insErr) throw insErr;
        const refetched = await supabase
          .from("equipment_groups")
          .select(groupsSelect)
          .eq("plant_equipment_id", equipmentId)
          .is("deleted_at", null);
        if (refetched.error) throw refetched.error;
        groups = refetched.data;
      }

      const { data: photos, error: phErr } = await supabase
        .from("equipment_photos").select("*").eq("equipment_id", equipmentId).order("uploaded_at");
      if (phErr) throw phErr;

      const byChapter = (ch: string) => (groups ?? []).find((g: any) => g.chapter === ch) ?? null;
      return {
        line, pe, photos: photos ?? [],
        assembly: byChapter("assembly"),
        wiring: byChapter("wiring"),
        cold: byChapter("cold_comm"),
        // shape progress fn expects
        peWithGroups: { ...pe, equipment_groups: groups ?? [] },
      };
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["equipment-detail", projectId, lineNumber, kind, equipmentId] });

  if (!session) return null;
  const plantLabel = kind === "kiln" ? "Kiln" : "SHS";

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Link
          to="/p/$projectId/lines/$lineNumber/equipment/$kind"
          params={{ projectId, lineNumber, kind }}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> {plantLabel}
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <EquipmentHeader pe={data.peWithGroups} lineNumber={data.line.number} plantLabel={plantLabel} />

            <Tabs defaultValue="mechanical" className="mt-6">
              <TabsList>
                <TabsTrigger value="mechanical">Mechanical</TabsTrigger>
                <TabsTrigger value="electrical">Electrical</TabsTrigger>
              </TabsList>

              <TabsContent value="mechanical" className="mt-4">
                <MechanicalView
                  pe={data.pe}
                  assemblyGroup={data.assembly}
                  canEdit={canEdit}
                  userId={user?.id}
                  onChange={invalidate}
                />
              </TabsContent>

              <TabsContent value="electrical" className="mt-4">
                <ElectricalView
                  wiring={data.wiring}
                  canEdit={canEdit}
                  onChange={invalidate}
                />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}

function EquipmentHeader({ pe, lineNumber, plantLabel }: any) {
  const { mech, wiring, overall } = equipmentProgress(pe);
  return (
    <div className="border-b pb-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Line {lineNumber} · {plantLabel}</span>
          <h1 className="text-3xl font-semibold">
            {pe.name}
            <span className="ml-3 text-base font-normal text-muted-foreground">{overall}%</span>
          </h1>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Mini label="Assembly" pct={mech} />
        <Mini label="Electrical" pct={wiring} />
      </div>
    </div>
  );
}
function Mini({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="min-w-0 rounded-md border bg-card p-2">
      <div className="mb-1 flex items-baseline justify-between gap-1">
        <span className="truncate text-[11px] text-muted-foreground">{label}</span>
        <span className="font-mono text-[11px] tabular-nums">{pct}%</span>
      </div>
      <ProgressBar value={pct} size="sm" />
    </div>
  );
}

function MechanicalView({ pe, assemblyGroup, canEdit, userId, onChange }: any) {
  const [mode, setMode] = useState<string>(pe.mech_mode ?? "manual");
  const [pct, setPct] = useState<string>(pe.mech_manual_pct?.toString() ?? "");

  const switchMode = async (m: string) => {
    setMode(m);
    const { error } = await supabase.from("plant_equipment").update({ mech_mode: m }).eq("id", pe.id);
    if (error) toast.error(error.message); else onChange();
  };

  const savePct = async () => {
    const n = pct === "" ? null : Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
    const { error } = await supabase.from("plant_equipment")
      .update({ mech_manual_pct: n }).eq("id", pe.id);
    if (error) toast.error(error.message); else { toast.success("Saved"); onChange(); }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="inline-flex rounded-md border p-1">
            <button
              disabled={!canEdit}
              onClick={() => switchMode("manual")}
              className={`rounded px-3 py-1 text-xs ${mode === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >Manual %</button>
            <button
              disabled={!canEdit}
              onClick={() => switchMode("checklist")}
              className={`rounded px-3 py-1 text-xs ${mode === "checklist" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >Checklist</button>
          </div>

          {mode === "manual" ? (
            <div className="flex items-center gap-2">
              <Input
                type="number" min={0} max={100} value={pct}
                disabled={!canEdit}
                onChange={(e) => setPct(e.target.value)}
                className="w-24"
              />
              <span className="text-sm text-muted-foreground">%</span>
              {canEdit && <Button size="sm" onClick={savePct}>Save</Button>}
            </div>
          ) : (
            <FlatChecklist group={assemblyGroup} canEdit={canEdit} onChange={onChange} />
          )}
        </CardContent>
      </Card>

      <NotesList equipmentId={pe.id} canEdit={canEdit} userId={userId} />
    </div>
  );
}

function ElectricalView({ wiring, canEdit, onChange }: any) {
  return (
    <ComponentTypesTree group={wiring} canEdit={canEdit} onChange={onChange}
      emptyHint="No electrical types yet. Add categories like 'Sensors', 'Cabling', 'Junction boxes', 'Loops'…" />
  );
}
