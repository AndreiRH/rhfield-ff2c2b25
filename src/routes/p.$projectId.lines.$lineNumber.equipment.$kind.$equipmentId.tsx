import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress, CHAPTER_LABELS } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { HotCalendar } from "@/components/HotCalendar";
import { ChapterGroupCard } from "@/components/ExtraWorkChapterView";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId")({
  component: EquipmentDetail,
});

const CHAPTER_TABS = ["assembly", "wiring", "cold_comm", "hot_comm"] as const;

function EquipmentDetail() {
  const { projectId, lineNumber, kind, equipmentId } = Route.useParams();
  const { session, loading, canEdit } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["equipment-detail", projectId, lineNumber, kind, equipmentId],
    queryFn: async () => {
      const { data: line, error } = await supabase
        .from("lines")
        .select("id, number, hot_planned_start, hot_planned_end, project_id")
        .eq("project_id", projectId)
        .eq("number", Number(lineNumber))
        .single();
      if (error) throw error;

      const { data: pe, error: peErr } = await supabase
        .from("plant_equipment")
        .select("id, name, kind")
        .eq("id", equipmentId)
        .single();
      if (peErr) throw peErr;

      const { data: groups, error: gErr } = await supabase
        .from("equipment_groups")
        .select(`
          id, chapter, kind, name, sort_order, deleted_at,
          components(
            id, name, sort_order, deleted_at,
            checklist_items(id, label, done, note, sort_order, deleted_at, completed_at, parent_item_id,
              item_photos(id, storage_path))
          )
        `)
        .eq("plant_equipment_id", equipmentId)
        .is("deleted_at", null);
      if (gErr) throw gErr;
      return { line, pe, groups: groups ?? [] };
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["equipment-detail", projectId, lineNumber, kind, equipmentId] });

  const allItems = useMemo(() => {
    return (data?.groups ?? []).flatMap((eg: any) =>
      (eg.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? [])
    );
  }, [data]);
  const overall = calcProgress(allItems);

  const chapterProgress = useMemo(() => {
    const out: Record<string, ReturnType<typeof calcProgress>> = {};
    for (const ch of CHAPTER_TABS) {
      const items = (data?.groups ?? []).filter((eg: any) => eg.chapter === ch).flatMap((eg: any) =>
        (eg.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? [])
      );
      out[ch] = calcProgress(items);
    }
    return out;
  }, [data]);

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
            <div className="sticky top-0 z-10 -mx-4 mb-6 border-b bg-background/95 px-4 py-4 backdrop-blur">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Line {data.line.number} · {plantLabel} · Equipment</span>
                  <h1 className="text-3xl font-semibold">
                    {data.pe.name}
                    <span className="ml-3 text-base font-normal text-muted-foreground">{overall.pct}%</span>
                  </h1>
                </div>
                <div className="min-w-[240px] flex-1 sm:max-w-md">
                  <ProgressBar value={overall.pct} size="md" />
                </div>
              </div>
            </div>

            <Tabs defaultValue="assembly" className="space-y-4">
              <TabsList className="flex h-auto w-full flex-wrap">
                {CHAPTER_TABS.map((ch) => (
                  <TabsTrigger key={ch} value={ch} className="flex-1 min-w-[120px]">
                    <span>{CHAPTER_LABELS[ch]}</span>
                    <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">{chapterProgress[ch].pct}%</span>
                  </TabsTrigger>
                ))}
              </TabsList>

              {CHAPTER_TABS.map((ch) => {
                const group = (data.groups ?? []).find((g: any) => g.chapter === ch);
                return (
                  <TabsContent key={ch} value={ch} className="space-y-4">
                    {ch === "hot_comm" && (
                      <HotCalendar lineId={data.line.id} plannedStart={data.line.hot_planned_start} plannedEnd={data.line.hot_planned_end} canEdit={canEdit} onChange={invalidate} />
                    )}
                    {group ? (
                      <ChapterGroupCard group={group} canEdit={canEdit} onChange={invalidate} />
                    ) : (
                      <CreateGroupPrompt
                        lineId={data.line.id}
                        chapter={ch}
                        kind={kind}
                        plantEquipmentId={equipmentId}
                        name={data.pe.name}
                        canEdit={canEdit}
                        onChange={invalidate}
                      />
                    )}
                  </TabsContent>
                );
              })}
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}

function CreateGroupPrompt({ lineId, chapter, kind, plantEquipmentId, name, canEdit, onChange }: any) {
  const create = async () => {
    const { error } = await supabase.from("equipment_groups").insert({
      line_id: lineId, chapter, kind, name, sort_order: 0, plant_equipment_id: plantEquipmentId,
    });
    if (error) toast.error(error.message);
    else onChange();
  };
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">No {CHAPTER_LABELS[chapter]} section yet for this equipment.</p>
        {canEdit && <Button size="sm" onClick={create}><Plus className="mr-1 h-4 w-4" /> Create section</Button>}
      </CardContent>
    </Card>
  );
}
