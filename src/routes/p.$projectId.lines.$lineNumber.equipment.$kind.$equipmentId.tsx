import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Plus } from "lucide-react";
import { toast } from "sonner";
import { ComponentsList } from "@/components/ExtraWorkChapterView";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/equipment/$kind/$equipmentId")({
  component: EquipmentDetail,
});

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
        .select("id, number, project_id")
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

      // Get or lazily create the single default group for this equipment
      const { data: groups, error: gErr } = await supabase
        .from("equipment_groups")
        .select(`
          id, name, sort_order,
          components(
            id, name, sort_order, deleted_at,
            checklist_items(id, label, done, note, sort_order, deleted_at, completed_at, parent_item_id,
              item_photos(id, storage_path))
          )
        `)
        .eq("plant_equipment_id", equipmentId)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      if (gErr) throw gErr;

      let canonical = groups?.[0] ?? null;
      if (!canonical) {
        const { data: newGroup, error: insErr } = await supabase
          .from("equipment_groups")
          .insert({
            line_id: line.id, chapter: "assembly", kind: kind as any,
            name: pe.name, sort_order: 0, plant_equipment_id: equipmentId,
          })
          .select(`
            id, name, sort_order,
            components(
              id, name, sort_order, deleted_at,
              checklist_items(id, label, done, note, sort_order, deleted_at, completed_at, parent_item_id,
                item_photos(id, storage_path))
            )
          `)
          .single();
        if (insErr) throw insErr;
        canonical = newGroup;
      }

      // Merge components from any legacy sibling groups so nothing is hidden.
      const mergedComponents = (groups ?? []).flatMap((g: any) => g.components ?? []);
      const group = { ...canonical, components: mergedComponents.length ? mergedComponents : canonical.components };

      return { line, pe, group };
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["equipment-detail", projectId, lineNumber, kind, equipmentId] });

  const allItems = useMemo(() => {
    return (data?.group?.components ?? [])
      .filter((c: any) => !c.deleted_at)
      .flatMap((c: any) => c.checklist_items ?? []);
  }, [data]);
  const overall = calcProgress(allItems);

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
            <div className="mb-6 border-b pb-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Line {data.line.number} · {plantLabel}</span>
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

            <ComponentsList group={data.group} canEdit={canEdit} onChange={invalidate} />
          </>
        )}
      </main>
    </div>
  );
}
