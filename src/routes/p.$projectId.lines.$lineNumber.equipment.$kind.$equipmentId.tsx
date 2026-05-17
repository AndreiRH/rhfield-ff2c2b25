import { createFileRoute, Link, useNavigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { localUuid } from "@/lib/local-id";
import { equipmentProgress } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Settings as SettingsIcon, Wrench, Cable, Snowflake } from "lucide-react";
import { LineBreadcrumb } from "@/components/LineBreadcrumb";

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

function groupWeight(group: any) {
  return (group?.components?.length ?? 0) + (group?.component_types?.length ?? 0);
}
import { toast } from "sonner";
import { ComponentTypesTree } from "@/components/ComponentTypesTree";
import { FlatChecklist } from "@/components/FlatChecklist";
import { NotesList } from "@/components/NotesList";
import { CurrentLineProvider } from "@/lib/current-line";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId")({
  component: EquipmentDetail,
});

async function fetchEquipmentDetail(
  projectId: string,
  lineNumber: string,
  kind: string,
  equipmentId: string,
) {
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
          item_photos(id, storage_path, is_shared, origin_line_id), item_files(id, storage_path, file_name, is_shared, origin_line_id))
      ),
      component_types(
        id, name, sort_order, deleted_at,
        checklist_items(id, label, done, note, note_shared, sort_order, deleted_at, completed_at, parent_item_id, component_id, component_type_id,
          item_photos(id, storage_path, is_shared, origin_line_id), item_files(id, storage_path, file_name, is_shared, origin_line_id)),
        components(
          id, name, sort_order, deleted_at, note, note_shared,
          component_photos(id, storage_path),
          component_files(id, storage_path, file_name),
          checklist_items(id, label, done, note, note_shared, sort_order, deleted_at, completed_at, parent_item_id, component_id,
            item_photos(id, storage_path, is_shared, origin_line_id), item_files(id, storage_path, file_name, is_shared, origin_line_id))
        )
      )
    `;
  let { data: groups, error: gErr } = await supabase
    .from("equipment_groups")
    .select(groupsSelect)
    .eq("plant_equipment_id", equipmentId)
    .is("deleted_at", null);
  if (gErr) throw gErr;

  const stripDeleted = (gs: any[] | null | undefined): any[] =>
    (gs ?? []).map((g) => ({
      ...g,
      components: (g.components ?? [])
        .filter((c: any) => !c.deleted_at)
        .map((c: any) => ({
          ...c,
          checklist_items: (c.checklist_items ?? []).filter((i: any) => !i.deleted_at),
        })),
      component_types: (g.component_types ?? [])
        .filter((t: any) => !t.deleted_at)
        .map((t: any) => ({
          ...t,
          checklist_items: (t.checklist_items ?? []).filter((i: any) => !i.deleted_at),
          components: (t.components ?? [])
            .filter((c: any) => !c.deleted_at)
            .map((c: any) => ({
              ...c,
              checklist_items: (c.checklist_items ?? []).filter((i: any) => !i.deleted_at),
            })),
        })),
    }));
  groups = stripDeleted(groups);

  const chapters = ["assembly", "wiring", "cold_comm"] as const;
  const missing = chapters.filter((ch) => !(groups ?? []).some((g: any) => g.chapter === ch));
  if (missing.length > 0) {
    const { error: insErr } = await supabase.from("equipment_groups").insert(
      missing.map((ch) => ({
        id: localUuid(),
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
    groups = stripDeleted(refetched.data);
  }

  const { data: photos, error: phErr } = await supabase
    .from("equipment_photos").select("*").eq("equipment_id", equipmentId).order("uploaded_at");
  if (phErr) throw phErr;

  const { count: lineCount } = await supabase
    .from("lines").select("id", { count: "exact", head: true })
    .eq("project_id", projectId);

  const { data: siblings } = await supabase
    .from("plant_equipment")
    .select("id, name, sort_order")
    .eq("line_id", line.id)
    .eq("kind", pe.kind)
    .is("deleted_at", null)
    .order("sort_order").order("name");

  const byChapter = (ch: string) => {
    const matches = (groups ?? []).filter((g: any) => g.chapter === ch);
    return matches.sort((a: any, b: any) => groupWeight(b) - groupWeight(a))[0] ?? null;
  };
  return {
    line, pe, photos: photos ?? [],
    lineCount: lineCount ?? 1,
    siblings: (siblings ?? []) as { id: string; name: string; sort_order: number }[],
    assembly: byChapter("assembly"),
    wiring: byChapter("wiring"),
    cold: byChapter("cold_comm"),
    peWithGroups: { ...pe, equipment_groups: groups ?? [] },
  };
}

function EquipmentDetail() {
  const { projectId, lineNumber, kind, equipmentId } = Route.useParams();
  const { session, loading, canEdit, user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isChildRoute = pathname.includes(`/${equipmentId}/settings`);
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  // When the user leaves this equipment page, clear any "locked" clipboard
  // so the lingering single-location paste button doesn't follow them.
  useEffect(() => {
    return () => {
      try {
        const raw = localStorage.getItem("lov.clipboard.v1");
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.lockedAt) {
            localStorage.removeItem("lov.clipboard.v1");
            window.dispatchEvent(new Event("lov-clipboard-change"));
          }
        }
      } catch {}
    };
  }, []);

  const { data, isLoading } = useQuery({
    enabled: !!session && !isChildRoute,
    queryKey: ["equipment-detail", projectId, lineNumber, kind, equipmentId],
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    queryFn: () => fetchEquipmentDetail(projectId, lineNumber, kind, equipmentId),
    placeholderData: undefined,
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
          <CurrentLineProvider value={{ lineId: data.line.id, lineNumber: data.line.number, equipmentId: data.pe.id }}>
            <EquipmentBody key={data.pe.id} data={data} canEdit={canEdit} userId={user?.id} plantLabel={plantLabel} onChange={invalidate} />
          </CurrentLineProvider>
        )}
      </main>
    </div>
  );
}

type Section = "assembly" | "wiring" | "cold_comm";
const SECTION_ORDER: Section[] = ["assembly", "wiring", "cold_comm"];

const LAST_TAB_KEY = "equipment_last_tab";
function readLastTab(): Section {
  if (typeof window === "undefined") return "assembly";
  const v = window.localStorage.getItem(LAST_TAB_KEY);
  return v === "wiring" || v === "cold_comm" || v === "assembly" ? v : "assembly";
}

function EquipmentBody({ data, canEdit, userId, plantLabel, onChange }: any) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [section, setSectionState] = useState<Section>(() => readLastTab());
  const setSection = (s: Section) => {
    setSectionState(s);
    try { window.localStorage.setItem(LAST_TAB_KEY, s); } catch {}
  };
  const { mech, wiring, cold, overall } = equipmentProgress(data.peWithGroups);
  const startRef = useRef<{ x: number; y: number; decided: "h" | "v" | null; mode: "section" | "equipment" } | null>(null);
  const widthRef = useRef(
    typeof window !== "undefined" ? window.innerWidth : 390
  );
  useEffect(() => {
    const onResize = () => { widthRef.current = window.innerWidth; };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const [swipeDx, setSwipeDx] = useState(0);
  const [swipeState, setSwipeState] = useState<"idle" | "dragging" | "animating">("idle");
  const commitTimeoutRef = useRef<number | null>(null);

  const siblings: { id: string; name: string }[] = data.siblings ?? [];
  const curEqIdx = siblings.findIndex((s) => s.id === data.pe.id);
  const prevEq = curEqIdx > 0 ? siblings[curEqIdx - 1] : null;
  const nextEq = curEqIdx >= 0 && curEqIdx < siblings.length - 1 ? siblings[curEqIdx + 1] : null;
  const [eqDx, setEqDx] = useState(0);
  const eqDxRef = useRef(0);
  const setEqDxSync = (val: number) => {
    eqDxRef.current = val;
    setEqDx(val);
  };
  const [eqState, setEqState] = useState<"idle" | "dragging" | "animating">("idle");
  const eqCommitRef = useRef<number | null>(null);

  const sectionIdx = SECTION_ORDER.indexOf(section);
  const dir = swipeDx === 0 ? 0 : swipeDx < 0 ? 1 : -1;
  const targetSection: Section | null = dir !== 0 ? (SECTION_ORDER[sectionIdx + dir] ?? null) : null;
  const progress = targetSection ? Math.min(1, Math.abs(swipeDx) / widthRef.current) : 0;

  const weights: Record<Section, number> = { assembly: 0, wiring: 0, cold_comm: 0 };
  weights[section] = 1 - progress;
  if (targetSection) weights[targetSection] = progress;

  // Mounted guard — prevents state updates after navigation unmounts the component.
  const isMounted = useRef(true);
  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Refs mirror mutable values so the gesture effect can register listeners once.
  const sectionRef = useRef(section);
  const prevEqRef = useRef(prevEq);
  const nextEqRef = useRef(nextEq);
  const navigateRef = useRef(navigate);
  const dataRef = useRef(data);
  useEffect(() => { sectionRef.current = section; }, [section]);
  useEffect(() => { prevEqRef.current = prevEq; }, [prevEq]);
  useEffect(() => { nextEqRef.current = nextEq; }, [nextEq]);
  useEffect(() => { navigateRef.current = navigate; }, [navigate]);
  useEffect(() => { dataRef.current = data; }, [data]);

  // Prefetch prev/next equipment so the swipe-in pane shows real data instantly.
  useEffect(() => {
    const toFetch = [prevEq, nextEq].filter(Boolean) as { id: string }[];
    for (const sibling of toFetch) {
      qc.prefetchQuery({
        queryKey: [
          "equipment-detail",
          data.line.project_id,
          String(data.line.number),
          data.pe.kind,
          sibling.id,
        ],
        staleTime: 30_000,
        queryFn: () =>
          fetchEquipmentDetail(
            data.line.project_id,
            String(data.line.number),
            data.pe.kind,
            sibling.id,
          ),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevEq?.id, nextEq?.id]);

  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      if (commitTimeoutRef.current) {
        window.clearTimeout(commitTimeoutRef.current);
        commitTimeoutRef.current = null;
      }
      if (eqCommitRef.current) {
        window.clearTimeout(eqCommitRef.current);
        eqCommitRef.current = null;
      }
      const t = e.touches[0];
      // Ignore touches starting within 20px of either screen edge —
      // reserved for the Android system back gesture.
      if (t.clientX < 20 || t.clientX > window.innerWidth - 20) return;
      const target = e.target as HTMLElement | null;
      const inHeader = !!target?.closest?.("[data-equipment-header]");
      startRef.current = { x: t.clientX, y: t.clientY, decided: null, mode: inHeader ? "equipment" : "section" };
      widthRef.current = window.innerWidth;
    };
    const onMove = (e: TouchEvent) => {
      const start = startRef.current;
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (start.decided === null) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        // Require dx clearly dominant — diagonal/vertical resolves as scroll.
        start.decided = Math.abs(dx) >= Math.abs(dy) * 1.5 ? "h" : "v";
        if (start.decided === "h") {
          if (start.mode === "equipment") setEqState("dragging");
          else setSwipeState("dragging");
        }
      }
      if (start.decided !== "h") return;
      // Block native vertical scroll once we own the gesture.
      if (e.cancelable) e.preventDefault();
      if (start.mode === "equipment") {
        let val = dx;
        if ((dx < 0 && !nextEqRef.current) || (dx > 0 && !prevEqRef.current)) val = dx * 0.25;
        setEqDxSync(val);
      } else {
        const cur = SECTION_ORDER.indexOf(sectionRef.current);
        let val = dx;
        if ((dx < 0 && cur === SECTION_ORDER.length - 1) || (dx > 0 && cur === 0)) {
          val = dx * 0.25;
        }
        setSwipeDx(val);
      }
    };
    const onEnd = () => {
      const start = startRef.current;
      const decided = start?.decided;
      const mode = start?.mode ?? "section";
      startRef.current = null;
      if (decided !== "h") {
        setSwipeState("idle"); setSwipeDx(0);
        setEqState("idle"); setEqDxSync(0);
        return;
      }
      if (mode === "equipment") {
        const dx = eqDxRef.current;
        const w = widthRef.current;
        const ratio = dx / w;
        const goingNext = dx < 0;
        const target = goingNext ? nextEqRef.current : prevEqRef.current;
        if (Math.abs(ratio) > 0.28 && target) {
          // Animate the slide-off first, then navigate.
          const slideTarget = goingNext ? -w : w;
          setEqState("animating");
          setEqDxSync(slideTarget);
          eqCommitRef.current = window.setTimeout(() => {
            eqCommitRef.current = null;
            if (!isMounted.current) return;
            const d = dataRef.current;
            navigateRef.current({
              to: "/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId",
              params: {
                projectId: d.line.project_id,
                lineNumber: String(d.line.number),
                kind: d.pe.kind,
                equipmentId: target.id,
              },
            });
          }, 340);
          return;
        }
        // Cancelled swipe — snap back.
        setEqState("animating");
        setEqDxSync(0);
        eqCommitRef.current = window.setTimeout(() => {
          eqCommitRef.current = null;
          if (!isMounted.current) return;
          setEqState("idle");
        }, 340);
        return;
      }
      setSwipeDx((dx) => {
        const w = widthRef.current;
        const ratio = dx / w;
        const localDir = dx < 0 ? 1 : -1;
        const curSection = sectionRef.current;
        const localTarget = SECTION_ORDER[SECTION_ORDER.indexOf(curSection) + localDir];
        if (Math.abs(ratio) > 0.22 && localTarget) {
          setSwipeState("animating");
          commitTimeoutRef.current = window.setTimeout(() => {
            commitTimeoutRef.current = null;
            if (!isMounted.current) return;
            setSwipeState("idle");
            setSection(localTarget);
            setSwipeDx(0);
          }, 340);
          return localDir === 1 ? -w : w;
        }
        setSwipeState("animating");
        commitTimeoutRef.current = window.setTimeout(() => {
          commitTimeoutRef.current = null;
          if (!isMounted.current) return;
          setSwipeState("idle");
        }, 340);
        return 0;
      });
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd);
    window.addEventListener("touchcancel", onEnd);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
      if (commitTimeoutRef.current) {
        window.clearTimeout(commitTimeoutRef.current);
        commitTimeoutRef.current = null;
      }
      if (eqCommitRef.current) {
        window.clearTimeout(eqCommitRef.current);
        eqCommitRef.current = null;
      }
    };
  }, []);

  const dragging = swipeState === "dragging";
  const transformTransition = swipeState === "animating" ? "transform 340ms cubic-bezier(0.25, 1, 0.5, 1)" : "none";
  const colorTransition = "opacity 180ms linear";

  const meta = PHASE_META[section];
  const targetMeta = targetSection ? PHASE_META[targetSection] : null;
  const w = widthRef.current;
  const PANE_GAP = 32;
  const tapNav = (s: Section) => {
    if (s === sectionRef.current) return;
    if (commitTimeoutRef.current) {
      window.clearTimeout(commitTimeoutRef.current);
      commitTimeoutRef.current = null;
    }
    const cur = SECTION_ORDER.indexOf(sectionRef.current);
    const next = SECTION_ORDER.indexOf(s);
    const direction = next > cur ? 1 : -1;
    const w = widthRef.current;
    setSwipeDx(direction === 1 ? -w : w);
    setSwipeState("animating");
    commitTimeoutRef.current = window.setTimeout(() => {
      commitTimeoutRef.current = null;
      if (!isMounted.current) return;
      setSwipeState("idle");
      setSection(s);
      setSwipeDx(0);
    }, 340);
  };

  const eqTransformTransition = eqState === "animating" ? "transform 340ms cubic-bezier(0.25, 1, 0.5, 1)" : "none";

  return (
    <div>
      {/* Background tint: current layer + target layer fading in with progress */}
      <div className="pointer-events-none fixed inset-0 -z-10" aria-hidden>
        <div className={`absolute inset-0 ${meta.tint}`} />
        {targetMeta && (
          <div
            className={`absolute inset-0 ${targetMeta.tint}`}
            style={{ opacity: progress, transition: colorTransition }}
          />
        )}
      </div>

      {/* Equipment swipe viewport — current pane + incoming neighbour pane. */}
      <div style={{ overflow: "hidden" }}>
        <div
          style={{
            transform: `translateX(${eqDx}px)`,
            transition: eqTransformTransition,
            position: "relative",
            ...(eqState === "dragging" ? { willChange: "transform" } : {}),
          }}
        >
          {/* ── CURRENT EQUIPMENT PANE ── */}
          <div>
            {/* HEADER ZONE — equipment-swipe gesture starts here. */}
            <div className="relative" data-equipment-header>
              <div className={`rounded-lg border ${meta.header} px-3 pb-4 pt-3`}>
                <HeaderInner
                  data={data}
                  plantLabel={plantLabel}
                  overall={overall}
                  accent={meta.accent}
                />
              </div>
              {targetMeta && (
                <div
                  className={`pointer-events-none absolute inset-0 rounded-lg border ${targetMeta.header} px-3 pb-4 pt-3`}
                  style={{ opacity: progress, transition: colorTransition }}
                  aria-hidden
                >
                  <HeaderInner
                    data={data}
                    plantLabel={plantLabel}
                    overall={overall}
                    accent={targetMeta.accent}
                  />
                </div>
              )}
            </div>

            {/* TABS */}
            <div className="mt-3 flex items-stretch gap-2">
              <SectionTab phase="assembly" pct={mech} weight={weights.assembly} dragging={dragging} onClick={() => tapNav("assembly")} />
              <SectionTab phase="wiring" pct={wiring} weight={weights.wiring} dragging={dragging} onClick={() => tapNav("wiring")} />
              <SectionTab phase="cold_comm" pct={cold} weight={weights.cold_comm} dragging={dragging} onClick={() => tapNav("cold_comm")} />
            </div>

            {/* SECTION CONTENT */}
            <div className="relative mt-6 overflow-hidden">
              <div style={{ transform: `translateX(${swipeDx}px)`, transition: transformTransition }}>
                {renderSection(section, data, canEdit, userId, onChange)}
              </div>
              {targetSection && (
                <div
                  className="absolute inset-0"
                  style={{
                    transform: `translateX(${swipeDx + (dir === 1 ? w + PANE_GAP : -w - PANE_GAP)}px)`,
                    transition: transformTransition,
                  }}
                  aria-hidden
                >
                  {renderSection(targetSection, data, canEdit, userId, onChange)}
                </div>
              )}
            </div>
          </div>

          {/* ── NEIGHBOUR EQUIPMENT PANE ── */}
          {(eqState === "dragging" || eqState === "animating") && eqDx !== 0 && (() => {
            const goingNext = eqDx < 0;
            const neighbour = goingNext ? nextEq : prevEq;
            if (!neighbour) return null;
            const neighbourData = qc.getQueryData<any>([
              "equipment-detail",
              data.line.project_id,
              String(data.line.number),
              data.pe.kind,
              neighbour.id,
            ]);
            const offset = goingNext ? w : -w;
            const { mech: nMech, wiring: nWiring, cold: nCold, overall: nOverall } =
              neighbourData
                ? equipmentProgress(neighbourData.peWithGroups)
                : { mech: 0, wiring: 0, cold: 0, overall: 0 };
            return (
              <div
                aria-hidden
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateX(${offset}px)`,
                  pointerEvents: "none",
                }}
              >
                {/* Neighbour header */}
                <div className={`rounded-lg border ${meta.header} px-3 pb-4 pt-3`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <div>
                      <div className="mb-1 h-3 w-20 rounded bg-white/20" />
                      <h1 className="text-3xl font-semibold">
                        {neighbour.name}
                        {neighbourData && (
                          <span className={`ml-3 text-base font-normal ${meta.accent}`}>
                            {nOverall}%
                          </span>
                        )}
                      </h1>
                    </div>
                  </div>
                </div>

                {/* Neighbour tabs — real data if cached, ghost if not */}
                <div className="mt-3 flex items-stretch gap-2">
                  {neighbourData ? (
                    <>
                      <SectionTab phase="assembly" pct={nMech} weight={1} dragging={false} onClick={() => {}} />
                      <SectionTab phase="wiring" pct={nWiring} weight={0} dragging={false} onClick={() => {}} />
                      <SectionTab phase="cold_comm" pct={nCold} weight={0} dragging={false} onClick={() => {}} />
                    </>
                  ) : (
                    <>
                      <div className="h-12 flex-1 rounded-md border bg-muted/30" />
                      <div className="h-12 flex-1 rounded-md border bg-muted/20" />
                      <div className="h-12 flex-1 rounded-md border bg-muted/10" />
                    </>
                  )}
                </div>

                {/* Neighbour content — ghost skeleton */}
                <div className="mt-6 space-y-3">
                  <div className="h-20 rounded-lg bg-muted/30" />
                  <div className="h-10 rounded-lg bg-muted/20" />
                  <div className="h-10 rounded-lg bg-muted/15" />
                </div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function renderSection(s: Section, data: any, canEdit: boolean, userId: string | undefined, onChange: () => void) {
  if (s === "assembly") {
    return <MechanicalView pe={data.pe} assemblyGroup={data.assembly} canEdit={canEdit} userId={userId} onChange={onChange} lineCount={data.lineCount} lineNumber={data.line.number} equipmentId={data.pe.id} />;
  }
  if (s === "wiring") {
    return <ComponentTypesTree group={data.wiring} canEdit={canEdit} onChange={onChange} lineCount={data.lineCount}
      emptyHint="No wiring categories yet. Add types like 'Sensors', 'Cabling', 'Junction boxes', 'Loops'…" />;
  }
  return <ComponentTypesTree group={data.cold} canEdit={canEdit} onChange={onChange} lineCount={data.lineCount}
    emptyHint="No cold commissioning categories yet. Add types like 'Loops', 'Drives', 'Interlocks'…" />;
}

function HeaderInner({ data, plantLabel, overall, accent }: any) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-3">
      <div>
        <LineBreadcrumb
          projectId={data.line.project_id}
          lineNumber={data.line.number}
          segments={[plantLabel, data.pe.name]}
          currentTitle={data.pe.name}
          className="text-white/80"
        />
        <h1 className="text-3xl font-semibold">
          {data.pe.name}
          <span className={`ml-3 text-base font-normal ${accent}`}>{overall}%</span>
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
  );
}

function SectionTab({ phase, pct, weight, dragging, onClick }: { phase: Section; pct: number; weight: number; dragging: boolean; onClick: () => void }) {
  const meta = PHASE_META[phase];
  const Icon = meta.icon;
  const isActive = weight > 0.5;
  // Base 1, grows up to 5 when fully active — flex-grow follows the finger directly during drag.
  const grow = 1 + weight * 4;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={meta.label}
      title={meta.label}
      style={{
        flexGrow: grow,
        flexShrink: 1,
        flexBasis: 0,
        transition: dragging ? "none" : "flex-grow 340ms cubic-bezier(0.25, 1, 0.5, 1)",
      }}
      className={`min-w-0 cursor-pointer overflow-hidden rounded-md border ${isActive ? `${meta.tabActive} p-2 text-left` : `${meta.tab} flex flex-col items-center justify-center px-3 py-2`}`}
    >
      {isActive ? (
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

function MechanicalView({ pe, assemblyGroup, canEdit, userId, onChange, lineCount, lineNumber, equipmentId }: any) {
  const modeKey = `assembly_mode_${lineNumber}_${equipmentId}`;
  const [mode, setMode] = useState<string>(() => {
    if (typeof window !== "undefined") {
      const v = window.localStorage.getItem(modeKey);
      if (v === "manual" || v === "checklist") return v;
    }
    return pe.mech_mode ?? "manual";
  });
  const [pct, setPct] = useState<string>(pe.mech_manual_pct?.toString() ?? "");

  const switchMode = (m: string) => {
    setMode(m);
    if (typeof window !== "undefined") window.localStorage.setItem(modeKey, m);
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
