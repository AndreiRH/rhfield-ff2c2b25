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
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, Plus, Trash2, Camera, X, CornerDownRight } from "lucide-react";
import { toast } from "sonner";
import { HotCalendar } from "@/components/HotCalendar";

export const Route = createFileRoute("/p/$projectId/lines/$lineNumber/equipment/$kind")({
  component: EquipmentDetail,
});

const CHAPTER_TABS = ["assembly", "wiring", "cold_comm", "hot_comm"] as const;
type ChapterKey = (typeof CHAPTER_TABS)[number];

function EquipmentDetail() {
  const { projectId, lineNumber, kind } = Route.useParams();
  const { session, loading, canEdit } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const isExtra = kind !== "kiln" && kind !== "shs";

  const { data, isLoading } = useQuery({
    enabled: !!session,
    queryKey: ["equipment", projectId, lineNumber, kind],
    queryFn: async () => {
      const { data: line, error } = await supabase
        .from("lines")
        .select("id, number, hot_planned_start, hot_planned_end, project_id")
        .eq("project_id", projectId)
        .eq("number", Number(lineNumber))
        .single();
      if (error) throw error;

      let q = supabase
        .from("equipment_groups")
        .select(`
          id, chapter, kind, name, sort_order, deleted_at,
          components(
            id, name, sort_order, deleted_at,
            checklist_items(id, label, done, note, sort_order, deleted_at, completed_at, parent_item_id,
              item_photos(id, storage_path))
          )
        `)
        .eq("line_id", line.id)
        .is("deleted_at", null);
      q = isExtra ? q.eq("id", kind) : q.eq("kind", kind);
      const { data: groups, error: gErr } = await q;
      if (gErr) throw gErr;
      return { line, groups: groups ?? [] };
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["equipment", projectId, lineNumber, kind] });

  const title = isExtra ? (data?.groups[0]?.name ?? "Extra work") : (kind === "kiln" ? "Kiln" : "SHS");

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

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Link to="/p/$projectId/lines/$lineNumber" params={{ projectId, lineNumber }} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="h-4 w-4" /> Line {lineNumber}
        </Link>

        {isLoading || !data ? (
          <Skeleton className="h-40" />
        ) : (
          <>
            <div className="sticky top-0 z-10 -mx-4 mb-6 border-b bg-background/95 px-4 py-4 backdrop-blur">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">Line {data.line.number} · Equipment</span>
                  <h1 className="text-3xl font-semibold">
                    {title}
                    <span className="ml-3 text-base font-normal text-muted-foreground">{overall.pct}%</span>
                  </h1>
                </div>
                <div className="min-w-[240px] flex-1 sm:max-w-md">
                  <ProgressBar value={overall.pct} size="md" />
                </div>
              </div>
            </div>

            {isExtra ? (
              <ExtraWorkView group={data.groups[0]} canEdit={canEdit} onChange={invalidate} />
            ) : (
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
                          name={title}
                          canEdit={canEdit}
                          onChange={invalidate}
                        />
                      )}
                    </TabsContent>
                  );
                })}
              </Tabs>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function CreateGroupPrompt({ lineId, chapter, kind, name, canEdit, onChange }: any) {
  const create = async () => {
    const { error } = await supabase.from("equipment_groups").insert({
      line_id: lineId, chapter, kind, name, sort_order: 0,
    });
    if (error) toast.error(error.message);
    else onChange();
  };
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-6">
        <p className="text-sm text-muted-foreground">No {CHAPTER_LABELS[chapter as ChapterKey]} section yet for this equipment.</p>
        {canEdit && <Button size="sm" onClick={create}><Plus className="mr-1 h-4 w-4" /> Create section</Button>}
      </CardContent>
    </Card>
  );
}

function ExtraWorkView({ group, canEdit, onChange }: any) {
  return <ChapterGroupCard group={group} canEdit={canEdit} onChange={onChange} />;
}

function ChapterGroupCard({ group, canEdit, onChange }: any) {
  const components = (group.components ?? []).filter((c: any) => !c.deleted_at).sort((a: any, b: any) => a.sort_order - b.sort_order);
  const allItems = components.flatMap((c: any) => c.checklist_items ?? []);
  const prog = calcProgress(allItems);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");

  const addComponent = async () => {
    if (!newName.trim()) return;
    const { error } = await supabase.from("components").insert({
      equipment_id: group.id, name: newName.trim(), sort_order: components.length,
    });
    if (error) toast.error(error.message);
    else { setNewName(""); setAdding(false); onChange(); }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h3 className="text-lg font-semibold">{group.name}</h3>
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

function ComponentBlock({ component, canEdit, onChange }: any) {
  const allItems = (component.checklist_items ?? []).filter((i: any) => !i.deleted_at);
  const topLevel = allItems.filter((i: any) => !i.parent_item_id).sort((a: any, b: any) => a.sort_order - b.sort_order);
  const childrenByParent = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const i of allItems) {
      if (i.parent_item_id) {
        const arr = map.get(i.parent_item_id) ?? [];
        arr.push(i);
        map.set(i.parent_item_id, arr);
      }
    }
    for (const arr of map.values()) arr.sort((a: any, b: any) => a.sort_order - b.sort_order);
    return map;
  }, [allItems]);

  const prog = calcProgress(allItems);
  const [newItem, setNewItem] = useState("");

  const addItem = async () => {
    if (!newItem.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      component_id: component.id, label: newItem.trim(), sort_order: topLevel.length,
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
          {topLevel.map((it: any) => (
            <ChecklistRow
              key={it.id}
              item={it}
              componentId={component.id}
              childrenByParent={childrenByParent}
              depth={0}
              canEdit={canEdit}
              onChange={onChange}
            />
          ))}
        </ul>
        {canEdit && (
          <div className="mt-3 flex items-center gap-2 border-t pt-3">
            <Input
              value={newItem}
              onChange={(e) => setNewItem(e.target.value)}
              placeholder="New item"
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
                  <AlertDialogDescription>All items inside will be hidden.</AlertDialogDescription>
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

function ChecklistRow({ item, componentId, childrenByParent, depth, canEdit, onChange }: any) {
  const { user } = useAuth();
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState(item.note ?? "");
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<any[]>(item.item_photos ?? []);
  const [addingChild, setAddingChild] = useState(false);
  const [childLabel, setChildLabel] = useState("");
  const children = childrenByParent.get(item.id) ?? [];

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

  const addChild = async () => {
    if (!childLabel.trim()) return;
    const { error } = await supabase.from("checklist_items").insert({
      component_id: componentId, parent_item_id: item.id,
      label: childLabel.trim(), sort_order: children.length,
    });
    if (error) toast.error(error.message);
    else { setChildLabel(""); setAddingChild(false); onChange(); }
  };

  return (
    <li className="flex flex-col gap-1 rounded-md px-2 py-1.5 hover:bg-muted/40" style={{ marginLeft: depth * 20 }}>
      <div className="flex items-start gap-3">
        {depth > 0 && <CornerDownRight className="mt-1 h-3 w-3 text-muted-foreground" />}
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
            <button title="Add subtask" className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-accent" onClick={() => setAddingChild((s) => !s)}>
              <Plus className="h-4 w-4 text-muted-foreground" />
            </button>
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
      {addingChild && (
        <div className="ml-7 flex gap-2">
          <Input
            value={childLabel}
            onChange={(e) => setChildLabel(e.target.value)}
            placeholder="Subtask"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && addChild()}
          />
          <Button size="sm" onClick={addChild}>Add</Button>
          <Button size="sm" variant="ghost" onClick={() => { setAddingChild(false); setChildLabel(""); }}>Cancel</Button>
        </div>
      )}
      {children.length > 0 && (
        <ul className="space-y-1">
          {children.map((c: any) => (
            <ChecklistRow
              key={c.id}
              item={c}
              componentId={componentId}
              childrenByParent={childrenByParent}
              depth={depth + 1}
              canEdit={canEdit}
              onChange={onChange}
            />
          ))}
        </ul>
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
