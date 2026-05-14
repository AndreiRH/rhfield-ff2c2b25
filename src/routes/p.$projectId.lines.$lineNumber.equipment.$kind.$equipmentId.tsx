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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft } from "lucide-react";
import { toast } from "sonner";
import { ComponentTypesTree } from "@/components/ComponentTypesTree";
import { FlatChecklist } from "@/components/FlatChecklist";
import { NotesBoard } from "@/components/NotesBoard";

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

      const { data: groups, error: gErr } = await supabase
        .from("equipment_groups")
        .select(`
          id, chapter, name, plant_equipment_id,
          component_types(
            id, name, sort_order, deleted_at,
            components(
              id, name, sort_order, deleted_at,
              checklist_items(id, label, done, note, sort_order, deleted_at, completed_at, parent_item_id,
                item_photos(id, storage_path))
            )
          )
        `)
        .eq("plant_equipment_id", equipmentId)
        .is("deleted_at", null);
      if (gErr) throw gErr;

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
                <TabsTrigger value="mechanical">Mechanical status</TabsTrigger>
                <TabsTrigger value="electrical">Electrical status</TabsTrigger>
              </TabsList>

              <TabsContent value="mechanical" className="mt-4">
                <MechanicalView
                  pe={data.pe}
                  assemblyGroup={data.assembly}
                  photos={data.photos}
                  canEdit={canEdit}
                  userId={user?.id}
                  onChange={invalidate}
                />
              </TabsContent>

              <TabsContent value="electrical" className="mt-4">
                <ElectricalView
                  wiring={data.wiring}
                  cold={data.cold}
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
  const { mech, wiring, cold, overall } = equipmentProgress(pe);
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
      <div className="mt-3 grid grid-cols-3 gap-3">
        <Mini label="Assembly" pct={mech} />
        <Mini label="Wiring" pct={wiring} />
        <Mini label="Cold commissioning" pct={cold} />
      </div>
    </div>
  );
}
function Mini({ label, pct }: { label: string; pct: number }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-1 flex items-baseline justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="font-mono text-xs tabular-nums">{pct}%</span>
      </div>
      <ProgressBar value={pct} size="sm" />
    </div>
  );
}

function MechanicalView({ pe, assemblyGroup, photos, canEdit, userId, onChange }: any) {
  const [mode, setMode] = useState<string>(pe.mech_mode ?? "manual");
  const [pct, setPct] = useState<string>(pe.mech_manual_pct?.toString() ?? "");
  const [notes, setNotes] = useState<string>(pe.mech_notes ?? "");
  const [busy, setBusy] = useState(false);

  const switchMode = async (m: string) => {
    setMode(m);
    const { error } = await supabase.from("plant_equipment").update({ mech_mode: m }).eq("id", pe.id);
    if (error) toast.error(error.message);
    else { toast.success(`Switched to ${m === "manual" ? "manual %" : "checklist"}`); onChange(); }
  };

  const savePct = async () => {
    const n = pct === "" ? null : Math.max(0, Math.min(100, parseInt(pct, 10) || 0));
    const { error } = await supabase.from("plant_equipment")
      .update({ mech_manual_pct: n }).eq("id", pe.id);
    if (error) toast.error(error.message);
    else { toast.success("Saved"); onChange(); }
  };

  const saveNotes = async () => {
    const { error } = await supabase.from("plant_equipment").update({ mech_notes: notes }).eq("id", pe.id);
    if (error) toast.error(error.message);
    else { toast.success("Notes saved"); onChange(); }
  };

  const uploadPhoto = async (file: File) => {
    setBusy(true);
    const path = `equipment/${pe.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("photos").upload(path, file);
    if (upErr) { toast.error(upErr.message); setBusy(false); return; }
    const { error: insErr } = await supabase.from("equipment_photos").insert({
      equipment_id: pe.id, storage_path: path, uploaded_by: userId,
    });
    setBusy(false);
    if (insErr) toast.error(insErr.message);
    else onChange();
  };

  const deletePhoto = async (id: string, path: string) => {
    await supabase.storage.from("photos").remove([path]);
    await supabase.from("equipment_photos").delete().eq("id", id);
    onChange();
  };

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div>
            <div className="mb-2 text-sm font-medium">Tracking mode</div>
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
            <p className="mt-1 text-xs text-muted-foreground">
              Switching modes is synced across all 10 lines. Both manual % and checklist are kept — switch back any time.
            </p>
          </div>

          {mode === "manual" ? (
            <div>
              <label className="mb-1 block text-xs text-muted-foreground">Assembly %</label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={pct}
                  disabled={!canEdit}
                  onChange={(e) => setPct(e.target.value)}
                  className="w-24"
                />
                <span className="text-sm text-muted-foreground">%</span>
                {canEdit && <Button size="sm" onClick={savePct}>Save</Button>}
              </div>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">Assembly % is computed from the checklist below.</p>
          )}

          <div>
            <label className="mb-1 block text-xs text-muted-foreground">Notes</label>
            <Textarea
              value={notes}
              disabled={!canEdit}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Mechanical observations, issues, partial states…"
              className="min-h-[100px]"
            />
            {canEdit && <Button size="sm" className="mt-2" onClick={saveNotes}>Save notes</Button>}
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Photos ({photos.length})</span>
              {canEdit && (
                <label className="cursor-pointer">
                  <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
                  <span className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent">
                    <Camera className="h-3 w-3" /> Add photo
                  </span>
                </label>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {photos.map((p: any) => (
                <PhotoThumb key={p.id} photo={p} canEdit={canEdit} onDelete={() => deletePhoto(p.id, p.storage_path)} />
              ))}
              {photos.length === 0 && <span className="text-xs text-muted-foreground">No photos yet.</span>}
            </div>
          </div>
        </CardContent>
      </Card>

      <div>
        {mode === "checklist" ? (
          <ComponentTypesTree
            group={assemblyGroup}
            canEdit={canEdit}
            onChange={onChange}
            emptyHint="No assembly types yet. Add categories like 'Frames', 'Bolts'…"
          />
        ) : (
          <Card>
            <CardContent className="p-4 text-sm text-muted-foreground">
              Checklist hidden (manual mode active). Switch to <strong>Checklist</strong> mode to view or edit it.
              Existing items remain saved.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

function ElectricalView({ wiring, cold, canEdit, onChange }: any) {
  return (
    <Tabs defaultValue="wiring">
      <TabsList>
        <TabsTrigger value="wiring">Wiring</TabsTrigger>
        <TabsTrigger value="cold">Cold commissioning</TabsTrigger>
      </TabsList>
      <TabsContent value="wiring" className="mt-3">
        <ComponentTypesTree group={wiring} canEdit={canEdit} onChange={onChange}
          emptyHint="No wiring types yet. Add categories like 'Sensors', 'Cabling', 'Junction boxes'…" />
      </TabsContent>
      <TabsContent value="cold" className="mt-3">
        <ComponentTypesTree group={cold} canEdit={canEdit} onChange={onChange}
          emptyHint="No cold-commissioning types yet. Add categories like 'Loops', 'Interlocks'…" />
      </TabsContent>
    </Tabs>
  );
}

function PhotoThumb({ photo, canEdit, onDelete }: any) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("photos").createSignedUrl(photo.storage_path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  }, [photo.storage_path]);
  if (!url) return <div className="h-16 w-16 animate-pulse rounded bg-muted" />;
  return (
    <div className="group relative">
      <a href={url} target="_blank" rel="noreferrer">
        <img src={url} alt="" className="h-16 w-16 rounded border object-cover" />
      </a>
      {canEdit && (
        <button onClick={onDelete}
          className="absolute -right-1 -top-1 hidden h-5 w-5 items-center justify-center rounded-full border bg-background group-hover:inline-flex">
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}
