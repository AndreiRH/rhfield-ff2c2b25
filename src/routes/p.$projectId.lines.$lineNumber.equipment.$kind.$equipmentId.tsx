import { createFileRoute, Link, useNavigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
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
import { ChevronLeft, Settings as SettingsIcon, Wrench, Cable, Snowflake } from "lucide-react";

const PHASE_META: Record<Section, { label: string; icon: typeof Wrench; tab: string; tabActive: string; header: string; accent: string; tint: string }> = {
  assembly: {
    label: "Assembly",
    icon: Wrench,
    tab: "border-amber-300/60 bg-amber-50 hover:bg-amber-100 text-amber-900",
    tabActive: "border-white bg-white text-amber-700 shadow-md ring-2 ring-white/60",
    header: "bg-gradient-to-r from-amber-500 to-orange-500 text-white border-amber-500",
    accent: "text-white/90",
    tint: "bg-amber-100/50",
  },
  wiring: {
    label: "Wiring",
    icon: Cable,
    tab: "border-violet-300/60 bg-violet-50 hover:bg-violet-100 text-violet-900",
    tabActive: "border-white bg-white text-violet-700 shadow-md ring-2 ring-white/60",
    header: "bg-gradient-to-r from-violet-600 to-fuchsia-600 text-white border-violet-600",
    accent: "text-white/90",
    tint: "bg-violet-100/50",
  },
  cold_comm: {
    label: "Cold commissioning",
    icon: Snowflake,
    tab: "border-cyan-300/60 bg-cyan-50 hover:bg-cyan-100 text-cyan-900",
    tabActive: "border-white bg-white text-cyan-700 shadow-md ring-2 ring-white/60",
    header: "bg-gradient-to-r from-cyan-600 to-teal-500 text-white border-cyan-600",
    accent: "text-white/90",
    tint: "bg-cyan-100/50",
  },
};
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
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChildRoute = pathname.includes(`/${equipmentId}/settings`);
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session && !isChildRoute,
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
            id, name, sort_order, deleted_at, note, note_shared,
            component_photos(id, storage_path),
            component_files(id, storage_path, file_name),
            checklist_items(id, label, done, note, note_shared, sort_order, deleted_at, completed_at, parent_item_id, component_id,
              item_photos(id, storage_path), item_files(id, storage_path, file_name))
          ),
          component_types(
            id, name, sort_order, deleted_at,
            components(
              id, name, sort_order, deleted_at, note, note_shared,
              component_photos(id, storage_path),
              component_files(id, storage_path, file_name),
              checklist_items(id, label, done, note, note_shared, sort_order, deleted_at, completed_at, parent_item_id, component_id,
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

      const { count: lineCount } = await supabase
        .from("lines").select("id", { count: "exact", head: true })
        .eq("project_id", projectId);

      const byChapter = (ch: string) => (groups ?? []).find((g: any) => g.chapter === ch) ?? null;
      return {
        line, pe, photos: photos ?? [],
        lineCount: lineCount ?? 1,
        assembly: byChapter("assembly"),
        wiring: byChapter("wiring"),
        cold: byChapter("cold_comm"),
        // shape progress fn expects
        peWithGroups: { ...pe, equipment_groups: groups ?? [] },
      };
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["equipment-detail", projectId, lineNumber, kind, equipmentId] });

  if (isChildRoute) return <Outlet />;

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
          <EquipmentBody data={data} canEdit={canEdit} userId={user?.id} plantLabel={plantLabel} onChange={invalidate} />
        )}
      </main>
    </div>
  );
}

type Section = "assembly" | "wiring" | "cold_comm";
const SECTION_ORDER: Section[] = ["assembly", "wiring", "cold_comm"];

function EquipmentBody({ data, canEdit, userId, plantLabel, onChange }: any) {
  const [section, setSection] = useState<Section>("assembly");
  const { mech, wiring, cold, overall } = equipmentProgress(data.peWithGroups);
  const touchRef = useRef<{ x: number; y: number } | null>(null);

  const goRelative = (delta: number) => {
    const i = SECTION_ORDER.indexOf(section);
    const next = SECTION_ORDER[i + delta];
    if (next) setSection(next);
  };

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchRef.current = { x: t.clientX, y: t.clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchRef.current;
    touchRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    goRelative(dx < 0 ? 1 : -1);
  };

  const meta = PHASE_META[section];
  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      <div className={`pointer-events-none fixed inset-0 -z-10 transition-colors ${meta.tint}`} aria-hidden />
      <div className={`rounded-lg border ${meta.header} px-3 pb-4 pt-3 transition-colors`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <span className="font-mono text-xs uppercase tracking-widest text-white/80">Production line {data.line.number} · {plantLabel}</span>
            <h1 className="text-3xl font-semibold">
              {data.pe.name}
              <span className={`ml-3 text-base font-normal ${meta.accent}`}>{overall}%</span>
            </h1>
          </div>
          <Link
            to="/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId/settings"
            params={{
              projectId: data.line.project_id,
              lineNumber: String(data.line.number),
              kind: data.pe.kind,
              equipmentId: data.pe.id,
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-sky-200 bg-white/70 px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-white"
          >
            <SettingsIcon className="h-3.5 w-3.5" /> Settings
          </Link>
        </div>
        <div className="mt-3 flex items-stretch gap-2">
          <SectionTab phase="assembly" pct={mech} active={section === "assembly"} onClick={() => setSection("assembly")} />
          <SectionTab phase="wiring" pct={wiring} active={section === "wiring"} onClick={() => setSection("wiring")} />
          <SectionTab phase="cold_comm" pct={cold} active={section === "cold_comm"} onClick={() => setSection("cold_comm")} />
        </div>
      </div>

      <div className="mt-6">
        {section === "assembly" && (
          <MechanicalView pe={data.pe} assemblyGroup={data.assembly} canEdit={canEdit} userId={userId} onChange={onChange} lineCount={data.lineCount} />
        )}
        {section === "wiring" && (
          <ComponentTypesTree group={data.wiring} canEdit={canEdit} onChange={onChange} lineCount={data.lineCount}
            emptyHint="No wiring categories yet. Add types like 'Sensors', 'Cabling', 'Junction boxes', 'Loops'…" />
        )}
        {section === "cold_comm" && (
          <ComponentTypesTree group={data.cold} canEdit={canEdit} onChange={onChange} lineCount={data.lineCount}
            emptyHint="No cold commissioning categories yet. Add types like 'Loops', 'Drives', 'Interlocks'…" />
        )}
      </div>
    </div>
  );
}

function SectionTab({ phase, pct, active, onClick }: { phase: Section; pct: number; active: boolean; onClick: () => void }) {
  const meta = PHASE_META[phase];
  const Icon = meta.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={meta.label}
      title={meta.label}
      className={`min-w-0 cursor-pointer overflow-hidden rounded-md border transition-all duration-300 ease-out ${active ? `${meta.tabActive} flex-1 p-2 text-left` : `${meta.tab} flex-none px-3 py-2 flex flex-col items-center justify-center`}`}
    >
      {active ? (
        <>
          <div className="mb-1 flex items-center justify-between gap-1">
            <span className="inline-flex min-w-0 items-center gap-1">
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate text-[11px] font-medium">{meta.label}</span>
            </span>
            <span className="font-mono text-[11px] tabular-nums opacity-80">{pct}%</span>
          </div>
          <ProgressBar value={pct} size="sm" />
        </>
      ) : (
        <>
          <Icon className="h-4 w-4 shrink-0" />
          <span className="mt-0.5 font-mono text-[10px] tabular-nums opacity-70">{pct}%</span>
        </>
      )}
    </button>
  );
}

function MechanicalView({ pe, assemblyGroup, canEdit, userId, onChange, lineCount }: any) {
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

  const modeToggle = (
    <div className="inline-flex rounded-md border p-1">
      <button
        disabled={!canEdit}
        onClick={() => switchMode("manual")}
        className={`rounded px-3 py-1 text-xs ${mode === "manual" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
      >Man %</button>
      <button
        disabled={!canEdit}
        onClick={() => switchMode("checklist")}
        className={`rounded px-3 py-1 text-xs ${mode === "checklist" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
      >Items</button>
    </div>
  );

  return (
    <div className="space-y-6">
      {mode === "manual" ? (
        <Card>
          <CardContent className="space-y-3 p-4">
            {modeToggle}
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
          </CardContent>
        </Card>
      ) : (
        <FlatChecklist group={assemblyGroup} canEdit={canEdit} onChange={onChange} lineCount={lineCount} headerLeading={modeToggle} />
      )}

      <NotesList equipmentId={pe.id} canEdit={canEdit} userId={userId} />
    </div>
  );
}
