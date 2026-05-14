import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calcProgress, CHAPTER_LABELS, CHAPTER_ORDER } from "@/lib/progress";
import { ProgressBar } from "@/components/ProgressBar";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Plus, Trash2, Camera, X } from "lucide-react";
import { toast } from "sonner";
import { HotCalendar } from "@/components/HotCalendar";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber")({ component: LineDetail });

type ChapterKey = (typeof CHAPTER_ORDER)[number];

function LineDetail() {
  const { projectId, lineNumber } = Route.useParams();
  const { session, loading, canEdit } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["line", projectId, lineNumber],
    queryFn: async () => {
      const { data: line, error } = await supabase
        .from("lines")
        .select(`
          id, number, name, hot_planned_start, hot_planned_end, project_id,
          equipment_groups(
            id, chapter, kind, name, sort_order, deleted_at,
            components(
              id, name, sort_order, deleted_at,
              checklist_items(id, label, done, note, sort_order, deleted_at, completed_at,
                item_photos(id, storage_path))
            )
          )
        `)
        .eq("project_id", projectId)
        .eq("number", Number(lineNumber))
        .single();
      if (error) throw error;
      return line;
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["line", projectId, lineNumber] });

  const chapterProgress = useMemo(() => {
    const out: Record<string, ReturnType<typeof calcProgress>> = {};
    for (const ch of CHAPTER_ORDER) {
      const items = (data?.equipment_groups ?? [])
        .filter((eg: any) => eg.chapter === ch && !eg.deleted_at)
        .flatMap((eg: any) =>
          (eg.components ?? []).filter((c: any) => !c.deleted_at)
            .flatMap((c: any) => c.checklist_items ?? [])
        );
      out[ch] = calcProgress(items);
    }
    return out;
  }, [data]);

  const lineProgress = useMemo(() => {
    const items = (data?.equipment_groups ?? []).filter((eg: any) => !eg.deleted_at).flatMap((eg: any) =>
      (eg.components ?? []).filter((c: any) => !c.deleted_at).flatMap((c: any) => c.checklist_items ?? [])
    );
    return calcProgress(items);
  }, [data]);

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Link to="/p/$projectId" params={{ projectId }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Project dashboard
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="sticky top-0 z-10 -mx-4 mb-6 border-b bg-background/95 px-4 py-4 backdrop-blur">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Line</span>
                  <h1 className="text-3xl font-semibold tabular-nums">
                    {data.number.toString().padStart(2, "0")}
                    <span className="ml-3 text-base font-normal text-muted-foreground">{lineProgress.pct}%</span>
                  </h1>
                </div>
                <div className="min-w-[240px] flex-1 sm:max-w-md">
                  <ProgressBar value={lineProgress.pct} size="md" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {CHAPTER_ORDER.map((ch) => (
                  <a
                    href={`#${ch}`}
                    key={ch}
                    className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs hover:border-primary/40"
                  >
                    <span>{CHAPTER_LABELS[ch]}</span>
                    <span className="font-mono tabular-nums text-muted-foreground">{chapterProgress[ch].pct}%</span>
                  </a>
                ))}
              </div>
            </div>

            <Tabs defaultValue="assembly" className="space-y-4">
              <TabsList className="flex h-auto w-full flex-wrap">
                {CHAPTER_ORDER.map((ch) => (
                  <TabsTrigger key={ch} value={ch} className="flex-1 min-w-[120px]">
                    {CHAPTER_LABELS[ch]}
                  </TabsTrigger>
                ))}
              </TabsList>

              {(["assembly", "wiring", "cold_comm", "hot_comm"] as const).map((ch) => (
                <TabsContent key={ch} value={ch} id={ch} className="space-y-4">
                  {ch === "hot_comm" && (
                    <HotCalendar lineId={data.id} plannedStart={data.hot_planned_start} plannedEnd={data.hot_planned_end} canEdit={canEdit} onChange={invalidate} />
                  )}
                  <ChapterSection
                    line={data}
                    chapter={ch}
                    canEdit={canEdit}
                    onChange={invalidate}
                  />
                </TabsContent>
              ))}

              <TabsContent value="after_sales" id="after_sales" className="space-y-4">
                <AfterSalesSection line={data} canEdit={canEdit} onChange={invalidate} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </main>
    </div>
  );
}

// ---------- Chapter section (Kiln + SHS) ----------
function ChapterSection({ line, chapter, canEdit, onChange }: { line: any; chapter: ChapterKey; canEdit: boolean; onChange: () => void }) {
  const groups = (line.equipment_groups ?? [])
    .filter((eg: any) => eg.chapter === chapter && !eg.deleted_at && eg.kind !== "extra_work")
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {groups.map((eg: any) => (
        <EquipmentCard key={eg.id} equipment={eg} canEdit={canEdit} onChange={onChange} />
      ))}
    </div>
  );
}

function EquipmentCard({ equipment, canEdit, onChange }: { equipment: any; canEdit: boolean; onChange: () => void }) {
  const components = (equipment.components ?? []).filter((c: any) => !c.deleted_at).sort((a: any, b: any) => a.sort_order - b.sort_order);
  const allItems = components.flatMap((c: any) => c.checklist_items ?? []);
  const prog = calcProgress(allItems);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const addComponent = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from("components").insert({
      equipment_id: equipment.id,
      name: newName.trim(),
      sort_order: components.length,
    });
    if (error) toast.error(error.message);
    else { setNewName(""); setAdding(false); onChange(); }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold">{equipment.name}</h3>
          <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total} · {prog.pct}%</span>
        </div>
        <ProgressBar value={prog.pct} size="sm" className="mb-4" />
        <Accordion type="multiple" className="w-full">
          {components.map((c: any) => (
            <ComponentBlock key={c.id} component={c} canEdit={canEdit} onChange={onChange} />
          ))}
        </Accordion>
        {canEdit && (
          <div className="mt-3">
            {adding ? (
              <div className="flex gap-2">
                <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Component name" autoFocus />
                <Button size="sm" onClick={addComponent}>Add</Button>
                <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setNewName(""); }}>Cancel</Button>
              </div>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                <Plus className="mr-1 h-4 w-4" /> Add component
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ComponentBlock({ component, canEdit, onChange }: { component: any; canEdit: boolean; onChange: () => void }) {
  const items = (component.checklist_items ?? []).filter((i: any) => !i.deleted_at).sort((a: any, b: any) => a.sort_order - b.sort_order);
  const prog = calcProgress(items);
  const [newItem, setNewItem] = useState("");

  const addItem = async () => {
    if (!newItem.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      component_id: component.id,
      label: newItem.trim(),
      sort_order: items.length,
    });
    if (error) toast.error(error.message);
    else { setNewItem(""); onChange(); }
  };

  const deleteComponent = async () => {
    const { error } = await supabase.from("components").update({ deleted_at: new Date().toISOString() }).eq("id", component.id);
    if (error) toast.error(error.message);
    else { toast.success("Component removed"); onChange(); }
  };

  return (
    <AccordionItem value={component.id}>
      <AccordionTrigger className="hover:no-underline">
        <div className="flex w-full items-center justify-between gap-3 pr-2">
          <span className="text-left font-medium">{component.name}</span>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{prog.done}/{prog.total}</span>
            <div className="hidden w-24 sm:block"><ProgressBar value={prog.pct} size="sm" /></div>
            <span className="w-10 text-right font-mono text-xs tabular-nums">{prog.pct}%</span>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent>
        <ul className="space-y-1">
          {items.map((it: any) => (
            <ChecklistRow key={it.id} item={it} canEdit={canEdit} onChange={onChange} />
          ))}
        </ul>
        {canEdit && (
          <div className="mt-3 flex items-center gap-2 border-t pt-3">
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="New checklist item"
              onKeyDown={(e) => e.key === "Enter" && addItem()}
            />
            <Button size="sm" onClick={addItem}><Plus className="h-4 w-4" /></Button>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="ghost"><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete "{component.name}"?</AlertDialogTitle>
                  <AlertDialogDescription>All checklist items in this component will be hidden. This cannot be undone from the UI.</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={deleteComponent}>Delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}

function ChecklistRow({ item, canEdit, onChange }: { item: any; canEdit: boolean; onChange: () => void }) {
  const { user } = useAuth();
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<any[]>(item.item_photos ?? []);

  const toggleDone = async (val: boolean) => {
    const { error } = await supabase.from("checklist_items").update({
      done: val,
      completed_at: val ? new Date().toISOString() : null,
      completed_by: val ? user?.id : null,
    }).eq("id", item.id);
    if (error) toast.error(error.message);
    else onChange();
  };

  const saveNote = async () => {
    const { error } = await supabase.from("checklist_items").update({ note }).eq("id", item.id);
    if (error) toast.error(error.message);
    else { setShowNote(false); onChange(); }
  };

  const softDelete = async () => {
    const { error } = await supabase.from("checklist_items").update({ deleted_at: new Date().toISOString() }).eq("id", item.id);
    if (error) toast.error(error.message);
    else {
      toast("Item removed", {
        action: {
          label: "Undo",
          onClick: async () => {
            await supabase.from("checklist_items").update({ deleted_at: null }).eq("id", item.id);
            onChange();
          },
        },
      });
      onChange();
    }
  };

  const uploadPhoto = async (file: File) => {
    setBusy(true);
    const path = `${item.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from("photos").upload(path, file);
    if (upErr) { toast.error(upErr.message); setBusy(false); return; }
    const { data: ins, error: insErr } = await supabase.from("item_photos").insert({
      item_id: item.id, storage_path: path, uploaded_by: user?.id,
    }).select().single();
    setBusy(false);
    if (insErr) toast.error(insErr.message);
    else { setPhotos([...photos, ins]); onChange(); }
  };

  return (
    <li className="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-muted/40">
      <div className="flex items-start gap-3">
        <Checkbox
          checked={item.done}
          disabled={!canEdit}
          onCheckedChange={(v) => toggleDone(!!v)}
          className="mt-1"
        />
        <div className="flex-1">
          <div className={`text-sm ${item.done ? "text-muted-foreground line-through" : ""}`}>{item.label}</div>
          {item.note && !showNote && <div className="text-xs text-muted-foreground">{item.note}</div>}
        </div>
        {canEdit && (
          <div className="flex items-center gap-1">
            <label className="cursor-pointer">
              <input type="file" accept="image/*" capture="environment" className="hidden" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ""; }} />
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent">
                <Camera className="h-4 w-4 text-muted-foreground" />
              </span>
            </label>
            <button className="inline-flex h-7 px-2 text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowNote((s) => !s)}>note</button>
            <button className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent" onClick={softDelete}>
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        )}
      </div>
      {showNote && (
        <div className="ml-7 flex gap-2">
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} className="min-h-[60px] flex-1" />
          <Button size="sm" onClick={saveNote}>Save</Button>
        </div>
      )}
      {photos.length > 0 && (
        <div className="ml-7 flex flex-wrap gap-2">
          {photos.map((p) => <PhotoThumb key={p.id} path={p.storage_path} />)}
        </div>
      )}
    </li>
  );
}

function PhotoThumb({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    supabase.storage.from("photos").createSignedUrl(path, 3600).then(({ data }) => {
      if (data?.signedUrl) setUrl(data.signedUrl);
    });
  }, [path]);
  if (!url) return <div className="h-12 w-12 animate-pulse rounded bg-muted" />;
  return <a href={url} target="_blank" rel="noreferrer"><img src={url} alt="" className="h-12 w-12 rounded border object-cover" /></a>;
}

// ---------- After-sales (extra works) ----------
function AfterSalesSection({ line, canEdit, onChange }: { line: any; canEdit: boolean; onChange: () => void }) {
  const works = (line.equipment_groups ?? [])
    .filter((eg: any) => eg.chapter === "after_sales" && !eg.deleted_at && eg.kind === "extra_work")
    .sort((a: any, b: any) => a.sort_order - b.sort_order);

  const [newWork, setNewWork] = useState("");

  const addWork = async () => {
    if (!newWork.trim()) return;
    const { data: eg, error } = await supabase.from("equipment_groups").insert({
      line_id: line.id, chapter: "after_sales", kind: "extra_work",
      name: newWork.trim(), sort_order: works.length,
    }).select().single();
    if (error) { toast.error(error.message); return; }
    // create a default General component
    await supabase.from("components").insert({ equipment_id: eg.id, name: "Tasks", sort_order: 0 });
    setNewWork("");
    onChange();
  };

  return (
    <div className="space-y-4">
      {works.length === 0 && (
        <p className="text-sm text-muted-foreground">No extra paid works yet.</p>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        {works.map((w: any) => <EquipmentCard key={w.id} equipment={w} canEdit={canEdit} onChange={onChange} />)}
      </div>
      {canEdit && (
        <div className="flex max-w-md items-center gap-2">
          <Input value={newWork} onChange={(e) => setNewWork(e.target.value)} placeholder="Extra work name (e.g. Add second SHS line)" />
          <Button onClick={addWork}><Plus className="mr-1 h-4 w-4" /> Add work</Button>
        </div>
      )}
    </div>
  );
}
