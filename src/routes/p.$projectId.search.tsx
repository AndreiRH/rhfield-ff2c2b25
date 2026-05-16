import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronLeft,
  Sparkles,
  Search,
  Download,
  FileText,
  FileSpreadsheet,
  File as FileIcon,
  Loader2,
  CheckCircle2,
  Circle,
  RefreshCw,
  WifiOff,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";
import { StoragePhoto, openStorageFile } from "@/components/StoragePhoto";
import { runAiSearch, type SearchResult, type SearchResponse } from "@/lib/aiSearch.functions";
import { runOfflineSearch } from "@/lib/offlineSearch";
import { syncProject, scheduleBackgroundSync } from "@/lib/offlineSync";
import { offlineDB, getCacheSize, clearProjectCache } from "@/lib/offlineCache";

export const Route = createFileRoute("/p/$projectId/search")({
  component: AiSearchPage,
});

const EXAMPLES = [
  "All settings with 'flow' in the title from every kiln on line 3",
  "Every checklist item labelled 'temperature sensor', show which are done",
  "All photos and files mentioning 'burner control'",
  "Equipment notes about 'vibration' on SHS units",
];

function sourceLabel(s: SearchResult["source"]) {
  switch (s) {
    case "settings": return "Setting";
    case "checklist_items": return "Checklist";
    case "equipment_notes": return "Eq. note";
    case "pa_notes": return "PA note";
    case "common_notes": return "Common note";
    case "component_files": return "Comp. file";
    case "component_photos": return "Comp. photo";
  }
}

function AiSearchPage() {
  const { projectId } = Route.useParams();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);

  const projectQ = useQuery({
    enabled: !!session,
    queryKey: ["search-project", projectId],
    queryFn: async () => {
      const { data: p } = await supabase.from("projects").select("id, name").eq("id", projectId).single();
      const { data: ls } = await supabase
        .from("lines")
        .select("id, number, name")
        .eq("project_id", projectId)
        .order("number");
      return { project: p, lines: ls ?? [] };
    },
  });

  const [question, setQuestion] = useState("");
  const [scopeLineId, setScopeLineId] = useState<string>("all");
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [usedOffline, setUsedOffline] = useState(false);
  const [syncing, setSyncing] = useState<null | { phase: string; done: number; total: number }>(null);
  const [lastSync, setLastSync] = useState<number | null>(null);
  const [cacheInfo, setCacheInfo] = useState<{ rows: number; bytes: number } | null>(null);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);

  const refreshCacheInfo = async () => {
    setCacheInfo(await getCacheSize(projectId));
    const s = await offlineDB.sync_state.get(projectId);
    setLastSync(s?.last_full_sync_at ?? null);
  };

  useEffect(() => { refreshCacheInfo(); }, [projectId]);

  // Auto-sync on mount + when coming online
  useEffect(() => {
    if (!session) return;
    if (navigator.onLine) scheduleBackgroundSync(projectId);
    const onOnline = () => scheduleBackgroundSync(projectId);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [session, projectId]);

  const doSync = async () => {
    if (!navigator.onLine) {
      toast.error("You're offline. Connect to sync.");
      return;
    }
    setSyncing({ phase: "starting", done: 0, total: 0 });
    try {
      await syncProject(projectId, (info) => setSyncing(info));
      toast.success("Cache up to date.");
      await refreshCacheInfo();
    } catch (e: any) {
      toast.error(e?.message ?? "Sync failed");
    } finally {
      setSyncing(null);
    }
  };

  const search = useServerFn(runAiSearch);
  const mutation = useMutation<SearchResponse>({
    mutationFn: async () => {
      const params = {
        projectId,
        question: question.trim(),
        scope: scopeLineId === "all" ? {} : { lineId: scopeLineId },
      };
      if (!navigator.onLine) {
        setUsedOffline(true);
        return await runOfflineSearch(projectId, params.question, params.scope);
      }
      try {
        const r = await search({ data: params });
        setUsedOffline(false);
        return r;
      } catch (err) {
        // Online RPC failed — fall back to local cache.
        setUsedOffline(true);
        toast.message("Online search failed — using offline cache.");
        return await runOfflineSearch(projectId, params.question, params.scope);
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Search failed"),
  });

  const results = mutation.data?.results ?? [];
  const plan = mutation.data?.plan ?? null;

  const onRun = () => {
    if (question.trim().length < 2) {
      toast.error("Type a question first.");
      return;
    }
    mutation.mutate();
  };

  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <Link
          to="/p/$projectId"
          params={{ projectId }}
          className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" /> {projectQ.data?.project?.name ?? "Project"}
        </Link>

        <div className="mb-6 flex items-start justify-between gap-3 border-b pb-4">
          <div>
            <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              {projectQ.data?.project?.name ?? ""}
            </span>
            <h1 className="flex items-center gap-2 text-3xl font-semibold">
              <Sparkles className="h-7 w-7 text-primary" /> AI Search
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask in plain language. Find and export settings, checklists, notes and attachments across the project.
            </p>
          </div>
        </div>

        <Card className="mb-4">
          <CardContent className="space-y-3 p-4">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={scopeLineId} onValueChange={setScopeLineId}>
                <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Scope" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Whole project</SelectItem>
                  {(projectQ.data?.lines ?? []).map((l) => (
                    <SelectItem key={l.id} value={l.id}>Line {l.number} — {l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !mutation.isPending) onRun(); }}
                placeholder="e.g. all flow settings from kilns on line 3"
                className="flex-1"
              />
              <Button onClick={onRun} disabled={mutation.isPending} className="gap-2">
                {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                Search
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setQuestion(ex)}
                  className="rounded-full border border-dashed px-3 py-1 text-xs text-muted-foreground hover:border-primary hover:text-foreground"
                >
                  {ex}
                </button>
              ))}
            </div>
            {plan && (
              <div className="rounded-md border bg-muted/30 p-2 text-xs text-muted-foreground">
                <span className="font-mono uppercase">Interpreted:</span>{" "}
                sources: {plan.sources.join(", ")}
                {plan.keywords.length > 0 && <> · keywords: {plan.keywords.join(", ")}</>}
                {plan.equipmentKinds && plan.equipmentKinds.length > 0 && <> · kinds: {plan.equipmentKinds.join(", ")}</>}
                {plan.lineNumbers && plan.lineNumbers.length > 0 && <> · lines: {plan.lineNumbers.join(", ")}</>}
                {plan.equipmentNameLike && <> · equipment~{plan.equipmentNameLike}</>}
                {plan.componentTypeLike && <> · component-type~{plan.componentTypeLike}</>}
                {plan.doneFilter !== "any" && <> · {plan.doneFilter}</>}
              </div>
            )}
          </CardContent>
        </Card>

        {mutation.isPending && <Skeleton className="h-64" />}

        {mutation.isSuccess && (
          <ResultsView
            projectName={projectQ.data?.project?.name ?? "project"}
            question={question}
            results={results}
            truncated={!!mutation.data?.truncated}
          />
        )}
      </main>
    </div>
  );
}

function ResultsView({
  projectName, question, results, truncated,
}: {
  projectName: string;
  question: string;
  results: SearchResult[];
  truncated: boolean;
}) {
  const [exporting, setExporting] = useState<null | "csv" | "xlsx" | "pdf">(null);
  const fileName = useMemo(
    () => `${projectName.replace(/[^a-z0-9_-]+/gi, "_")}_search_${new Date().toISOString().slice(0, 10)}`,
    [projectName],
  );

  const rowsForExport = useMemo(
    () => results.map((r) => ({
      Source: sourceLabel(r.source),
      Line: r.line_number ?? "",
      Plant: r.plant_kind ?? "",
      Equipment: r.equipment_name ?? "",
      "Component type": r.component_type ?? "",
      Component: r.component_name ?? "",
      Title: r.title,
      Body: r.body,
      Done: r.done === null ? "" : r.done ? "yes" : "no",
      Attachments: r.attachments.map((a) => a.file_name ?? a.storage_path.split("/").pop()).join(" | "),
      Updated: r.updated_at ?? "",
    })),
    [results],
  );

  const downloadCSV = () => {
    setExporting("csv");
    try {
      const headers = Object.keys(rowsForExport[0] ?? { Source: "" });
      const escape = (v: any) => {
        const s = String(v ?? "");
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const csv = [headers.join(","), ...rowsForExport.map((r) => headers.map((h) => escape((r as any)[h])).join(","))].join("\n");
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      triggerDownload(blob, `${fileName}.csv`);
    } finally { setExporting(null); }
  };

  const downloadXLSX = async () => {
    setExporting("xlsx");
    try {
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(rowsForExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Results");
      const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
      triggerDownload(new Blob([out], { type: "application/octet-stream" }), `${fileName}.xlsx`);
    } finally { setExporting(null); }
  };

  const downloadPDF = async () => {
    setExporting("pdf");
    try {
      const { default: jsPDF } = await import("jspdf");
      const autoTableMod: any = await import("jspdf-autotable");
      const autoTable = autoTableMod.default ?? autoTableMod;
      const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
      doc.setFontSize(14);
      doc.text(`${projectName} — AI Search`, 40, 40);
      doc.setFontSize(10);
      doc.text(`Question: ${question}`, 40, 58);
      doc.text(`Generated: ${new Date().toLocaleString()} · ${results.length} results`, 40, 72);
      autoTable(doc, {
        startY: 90,
        head: [["Source", "Line", "Equipment", "Component", "Title", "Body", "Done"]],
        body: results.map((r) => [
          sourceLabel(r.source),
          r.line_number ?? "",
          [r.plant_kind, r.equipment_name].filter(Boolean).join(" · "),
          [r.component_type, r.component_name].filter(Boolean).join(" · "),
          r.title,
          r.body.length > 200 ? r.body.slice(0, 200) + "…" : r.body,
          r.done === null ? "" : r.done ? "yes" : "no",
        ]),
        styles: { fontSize: 8, cellPadding: 3, overflow: "linebreak" },
        headStyles: { fillColor: [80, 90, 130] },
        columnStyles: { 4: { cellWidth: 130 }, 5: { cellWidth: 240 } },
      });
      doc.save(`${fileName}.pdf`);
    } finally { setExporting(null); }
  };

  return (
    <Card>
      <CardContent className="p-0">
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3">
          <div className="text-sm">
            <span className="font-semibold">{results.length}</span>{" "}
            result{results.length === 1 ? "" : "s"}
            {truncated && <span className="ml-2 text-xs text-warning-foreground">(truncated)</span>}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="gap-2" disabled={results.length === 0 || !!exporting}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={downloadCSV}><FileText className="mr-2 h-4 w-4" /> CSV</DropdownMenuItem>
              <DropdownMenuItem onClick={downloadXLSX}><FileSpreadsheet className="mr-2 h-4 w-4" /> Excel (.xlsx)</DropdownMenuItem>
              <DropdownMenuItem onClick={downloadPDF}><FileIcon className="mr-2 h-4 w-4" /> PDF</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {results.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No matches. Try broader keywords or change the scope.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left font-mono text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Location</th>
                  <th className="px-3 py-2">Title / Label</th>
                  <th className="px-3 py-2">Body / Note</th>
                  <th className="px-3 py-2">Done</th>
                  <th className="px-3 py-2">Attachments</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr key={`${r.source}-${r.id}`} className="border-t align-top">
                    <td className="px-3 py-2 whitespace-nowrap text-xs">
                      <span className="rounded bg-secondary px-1.5 py-0.5">{sourceLabel(r.source)}</span>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      <div className="font-mono text-muted-foreground">
                        {r.line_number !== null && <>L{String(r.line_number).padStart(2, "0")}</>}
                        {r.plant_kind && <> · {r.plant_kind}</>}
                      </div>
                      <div>{r.equipment_name}</div>
                      {(r.component_type || r.component_name) && (
                        <div className="text-muted-foreground">
                          {[r.component_type, r.component_name].filter(Boolean).join(" › ")}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 font-medium">{r.title || <em className="text-muted-foreground">—</em>}</td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <div className="line-clamp-3 max-w-md whitespace-pre-wrap">{r.body}</div>
                    </td>
                    <td className="px-3 py-2">
                      {r.done === null ? "—" : r.done
                        ? <CheckCircle2 className="h-4 w-4 text-success" />
                        : <Circle className="h-4 w-4 text-muted-foreground" />}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {r.attachments.map((a, i) =>
                          a.kind === "photo" ? (
                            <div key={i} className="w-16">
                              <StoragePhoto
                                bucket="photos"
                                path={a.storage_path}
                                imgClassName="h-16 w-16 rounded border object-cover"
                              />
                            </div>
                          ) : (
                            <button
                              key={i}
                              onClick={() => openStorageFile("files", a.storage_path, a.file_name ?? "file")}
                              className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                            >
                              <FileIcon className="h-3 w-3" /> {a.file_name ?? a.storage_path.split("/").pop()}
                            </button>
                          ),
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
