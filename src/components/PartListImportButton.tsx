import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Download,
  Factory,
  FileSpreadsheet,
  GitBranch,
  ListChecks,
  Loader2,
  MapPinned,
  Network,
  WandSparkles,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PartListConfidence, PartListDevice, PartListPreview } from "@/lib/part-list-import";

type PlantKind = "kiln" | "shs";
type PropagationMode = "all_equal" | "line_groups" | "independent";
type PhaseKey = "assembly" | "wiring" | "cold_comm";

type LineContext = {
  id: string;
  number: number;
  name: string | null;
};

type EquipmentAreaContext = {
  id: string;
  line_id: string;
  name: string;
  sort_order: number | null;
};

type AreaSuggestion = {
  areaName: string;
  confidence: PartListConfidence;
  reason: string;
};

type AreaBucket = {
  areaName: string;
  confidence: PartListConfidence;
  count: number;
  examples: PartListDevice[];
};

const PLANT_OPTIONS: Array<{ value: PlantKind; label: string; detail: string }> = [
  { value: "kiln", label: "Kiln", detail: "Use kiln equipment areas and PID part list" },
  { value: "shs", label: "SHS", detail: "Use SHS equipment areas and documents" },
];

const PROPAGATION_OPTIONS: Array<{ value: PropagationMode; label: string; detail: string }> = [
  { value: "all_equal", label: "All lines equal", detail: "Create one line template and propagate it to every line" },
  { value: "line_groups", label: "Line groups", detail: "Use the same setup only for selected groups of lines" },
  { value: "independent", label: "Independent lines", detail: "Review/import a separate part list per line" },
];

const DEFAULT_AREAS: Record<PlantKind, string[]> = {
  kiln: ["Entrance Table", "Kiln modules", "Cooling modules", "Fans & HeatEx", "Switchboards", "Other instrumentation"],
  shs: ["Main", "Switchboards", "Other instrumentation"],
};

const PHASE_LABELS: Record<PhaseKey, string> = {
  assembly: "Assembly",
  wiring: "Wiring",
  cold_comm: "Commissioning",
};

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  Thermocouple: "Thermocouples",
  Flowmeter: "Flowmeters",
  "Pressure switch": "Pressure switches",
  "Pressure instrument": "Pressure instruments",
  "Heating group": "Heating groups",
  "Heating element": "Heating elements",
  "Emergency stop": "Emergency stops",
  "Motor or fan": "Motors / fans",
  "Valve or actuator": "Valves / actuators",
  "Limit switch": "Limit switches",
  "Actor or part": "Actors / parts",
  "General device": "General devices",
};

function confidenceClass(confidence: string) {
  if (confidence === "high") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (confidence === "medium") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-rose-200 bg-rose-50 text-rose-700";
}

function toneClass(tone: string) {
  if (tone === "danger") return "border-rose-200 bg-rose-50";
  if (tone === "warning") return "border-amber-200 bg-amber-50";
  return "border-border bg-muted/30";
}

function normalize(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function displayComponentType(deviceClass: string): string {
  return COMPONENT_TYPE_LABELS[deviceClass] ?? deviceClass;
}

function deviceLabel(device: PartListDevice): string {
  return device.tag || device.customerTag || device.rhTagNo || `Row ${device.sourceRow}`;
}

function deviceSearchText(device: PartListDevice): string {
  return normalize([
    device.sheetName,
    device.category,
    device.tag,
    device.customerTag,
    device.rhTagNo,
    device.rhDescription,
    device.description,
    device.position,
    device.type,
    device.supplier,
    device.softwareDb,
    device.softwareIndex,
    device.comment,
    device.deviceClass,
  ].join(" "));
}

function areaScore(device: PartListDevice, areaName: string): { score: number; reason: string } {
  const text = deviceSearchText(device);
  const area = normalize(areaName);
  const areaWords = area.split(" ").filter((word) => word.length > 2);
  let score = 0;
  const reasons: string[] = [];

  areaWords.forEach((word) => {
    if (text.includes(word)) {
      score += 2;
      reasons.push(`${word} matched`);
    }
  });

  const has = (...words: string[]) => words.some((word) => text.includes(word));
  if (area.includes("entrance") && has("entrance", "inlet", "charge", "loading")) {
    score += 10;
    reasons.push("entrance wording");
  }
  if (area.includes("exit") && has("exit", "outlet", "discharge", "unloading")) {
    score += 10;
    reasons.push("exit wording");
  }
  if (area.includes("cool") && has("cool", "cooling", "cooler")) {
    score += 10;
    reasons.push("cooling wording");
  }
  if ((area.includes("fan") || area.includes("heat")) && has("fan", "blower", "heat exchanger", "heatex", "motor")) {
    score += 8;
    reasons.push("fan or heat exchanger wording");
  }
  if ((area.includes("switch") || area.includes("cabinet") || area.includes("electrical")) && has("switchboard", "cabinet", "terminal", "safe plc", "software", "emergency")) {
    score += 8;
    reasons.push("electrical/safety wording");
  }
  if (area.includes("kiln") && has("kiln", "heater", "heating", "temperature", "thermocouple")) {
    score += 5;
    reasons.push("kiln/heating wording");
  }
  if ((area.includes("instrument") || area.includes("other")) && has("thermocouple", "pressure", "flow", "sensor", "instrument")) {
    score += 2;
    reasons.push("instrument wording");
  }

  return { score, reason: reasons[0] ?? "no strong match" };
}

function suggestEquipmentArea(device: PartListDevice, areaNames: string[]): AreaSuggestion {
  if (areaNames.length === 0) {
    return { areaName: "Unassigned", confidence: "low", reason: "no equipment areas available" };
  }

  const ranked = areaNames
    .map((areaName) => ({ areaName, ...areaScore(device, areaName) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  if (!best || best.score < 3) {
    return { areaName: "Unassigned", confidence: "low", reason: "needs engineer assignment" };
  }

  return {
    areaName: best.areaName,
    confidence: best.score >= 9 ? "high" : "medium",
    reason: best.reason,
  };
}

function uniqueAreaNames(areas: EquipmentAreaContext[], plantKind: PlantKind): string[] {
  const seen = new Set<string>();
  const names: string[] = [];

  areas
    .slice()
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name))
    .forEach((area) => {
      const key = normalize(area.name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      names.push(area.name);
    });

  return names.length ? names : DEFAULT_AREAS[plantKind];
}

function buildAreaBuckets(preview: PartListPreview | null, areaNames: string[]): AreaBucket[] {
  if (!preview) return [];
  const buckets = new Map<string, AreaBucket>();

  [...areaNames, "Unassigned"].forEach((areaName) => {
    buckets.set(areaName, { areaName, confidence: "low", count: 0, examples: [] });
  });

  preview.devices.forEach((device) => {
    const suggestion = suggestEquipmentArea(device, areaNames);
    const bucket = buckets.get(suggestion.areaName) ?? buckets.get("Unassigned");
    if (!bucket) return;
    bucket.count += 1;
    if (bucket.examples.length < 5) bucket.examples.push(device);
    if (suggestion.confidence === "high" || (suggestion.confidence === "medium" && bucket.confidence === "low")) {
      bucket.confidence = suggestion.confidence;
    }
  });

  return Array.from(buckets.values()).filter((bucket) => bucket.count > 0 || bucket.areaName !== "Unassigned");
}

function phaseCountsForClass(item: any): Record<PhaseKey, number> {
  if (item.phaseCounts) return item.phaseCounts;
  const total = Number(item.estimatedChecklistItems ?? 0);
  const assembly = Math.round(total * 0.35);
  const wiring = Math.round(total * 0.25);
  return {
    assembly,
    wiring,
    cold_comm: Math.max(0, total - assembly - wiring),
  };
}

function SummaryNumber({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function OptionButton<T extends string>({
  selected,
  value,
  label,
  detail,
  onSelect,
}: {
  selected: boolean;
  value: T;
  label: string;
  detail: string;
  onSelect: (value: T) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={`rounded-md border p-3 text-left transition-colors ${
        selected ? "border-primary bg-primary/5 text-primary" : "bg-card hover:bg-muted/40"
      }`}
    >
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </button>
  );
}

export function PartListImportButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PartListPreview | null>(null);
  const [plantKind, setPlantKind] = useState<PlantKind>("kiln");
  const [propagationMode, setPropagationMode] = useState<PropagationMode>("all_equal");

  const { data: setupContext, isLoading: loadingContext } = useQuery({
    enabled: open,
    queryKey: ["setup-wizard-context", projectId, plantKind],
    queryFn: async () => {
      const { data: lines, error: linesError } = await supabase
        .from("lines")
        .select("id, number, name")
        .eq("project_id", projectId)
        .order("number");
      if (linesError) throw linesError;

      const lineRows = (lines ?? []) as LineContext[];
      const lineIds = lineRows.map((line) => line.id);
      if (lineIds.length === 0) return { lines: lineRows, plantEquipment: [] as EquipmentAreaContext[] };

      const { data: plantEquipment, error: equipmentError } = await supabase
        .from("plant_equipment")
        .select("id, line_id, name, sort_order")
        .in("line_id", lineIds)
        .eq("kind", plantKind)
        .is("deleted_at", null)
        .order("sort_order", { ascending: true });
      if (equipmentError) throw equipmentError;

      return {
        lines: lineRows,
        plantEquipment: (plantEquipment ?? []) as EquipmentAreaContext[],
      };
    },
  });

  const reset = () => {
    setBusy(false);
    setError(null);
    setPreview(null);
  };

  const handleOpen = (next: boolean) => {
    setOpen(next);
    if (!next) reset();
  };

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const { previewPartList } = await import("@/lib/part-list-import");
      const result = await previewPartList(file);
      setPreview(result);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  };

  const areaNames = useMemo(
    () => uniqueAreaNames(setupContext?.plantEquipment ?? [], plantKind),
    [setupContext?.plantEquipment, plantKind],
  );

  const areaBuckets = useMemo(() => buildAreaBuckets(preview, areaNames), [preview, areaNames]);

  const componentRows = useMemo(() => {
    if (!preview) return [];
    return preview.classes.map((item: any) => {
      const sampleTags = preview.devices
        .filter((device) => device.deviceClass === item.deviceClass)
        .slice(0, 6)
        .map(deviceLabel);
      return {
        ...item,
        displayName: displayComponentType(item.deviceClass),
        phaseCounts: phaseCountsForClass(item),
        sampleTags,
      };
    });
  }, [preview]);

  const shownDevices = preview?.devices.slice(0, 50) ?? [];
  const lineCount = setupContext?.lines.length ?? 0;
  const existingAreaCount = setupContext?.plantEquipment.length ?? 0;
  const estimatedPropagatedItems = preview && propagationMode === "all_equal"
    ? preview.totals.estimatedChecklistItems * Math.max(1, lineCount)
    : preview?.totals.estimatedChecklistItems ?? 0;

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <WandSparkles className="h-4 w-4" />
          Setup wizard
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-6xl">
        <DialogHeader>
          <DialogTitle>Plant setup wizard</DialogTitle>
          <DialogDescription>
            Build a reviewable commissioning structure from a plant part list before creating anything in the database.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <section className="space-y-3 rounded-md border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <Factory className="h-4 w-4" />
              Plant scope
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {PLANT_OPTIONS.map((option) => (
                <OptionButton
                  key={option.value}
                  selected={plantKind === option.value}
                  value={option.value}
                  label={option.label}
                  detail={option.detail}
                  onSelect={setPlantKind}
                />
              ))}
            </div>
          </section>

          <section className="space-y-3 rounded-md border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <GitBranch className="h-4 w-4" />
              Line propagation
            </div>
            <div className="grid gap-2 lg:grid-cols-3">
              {PROPAGATION_OPTIONS.map((option) => (
                <OptionButton
                  key={option.value}
                  selected={propagationMode === option.value}
                  value={option.value}
                  label={option.label}
                  detail={option.detail}
                  onSelect={setPropagationMode}
                />
              ))}
            </div>
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              <SummaryNumber label="Lines found" value={loadingContext ? "..." : lineCount} />
              <SummaryNumber label={`${plantKind.toUpperCase()} areas`} value={loadingContext ? "..." : existingAreaCount || areaNames.length} />
              <SummaryNumber label="Area names" value={areaNames.length} />
            </div>
          </section>

          <section className="rounded-md border bg-muted/30 p-4">
            <Label htmlFor={`part-list-${projectId}`} className="flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Excel part list
            </Label>
            <Input
              id={`part-list-${projectId}`}
              type="file"
              accept=".xlsx,.xls"
              className="mt-2"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </section>

          {busy && (
            <div className="flex items-center gap-2 rounded-md border p-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading workbook and building draft hierarchy
            </div>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {preview && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <SummaryNumber label="Items/devices" value={preview.totals.devices} />
                <SummaryNumber label="One-line checks" value={preview.totals.estimatedChecklistItems} />
                <SummaryNumber label="Projected checks" value={estimatedPropagatedItems} />
                <SummaryNumber label="Review needed" value={preview.totals.lowConfidence} />
              </div>

              <section className="space-y-3 rounded-md border p-4">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Network className="h-4 w-4" />
                  Generated structure
                </div>
                <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <div className="text-xs text-muted-foreground">Project hint</div>
                    <div className="font-medium">{preview.projectHint.customer || "Unknown customer"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Plant</div>
                    <div className="font-medium">{plantKind.toUpperCase()} {preview.projectHint.kilnNumber || ""}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Equipment no.</div>
                    <div className="font-medium">{preview.projectHint.equipmentNumber || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">PID drawing</div>
                    <div className="font-medium">{preview.projectHint.pidDrawing || "-"}</div>
                  </div>
                </div>
                <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
                  Project &gt; {lineCount || "selected"} production line(s) &gt; {plantKind.toUpperCase()} &gt; equipment areas &gt; component types &gt; tagged items &gt; assembly, wiring, and commissioning checks.
                </div>
              </section>

              <div className="grid gap-3 lg:grid-cols-2">
                <section className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-semibold">
                    <MapPinned className="h-4 w-4" />
                    Equipment-area assignment
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {areaBuckets.map((bucket) => (
                      <div key={bucket.areaName} className="rounded-md border p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-sm font-semibold">{bucket.areaName}</div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {bucket.examples.map(deviceLabel).join(", ") || "No matched items yet"}
                            </div>
                          </div>
                          <Badge variant="outline" className={confidenceClass(bucket.confidence)}>
                            {bucket.count}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Review queue</h3>
                  <div className="space-y-2">
                    {preview.reviewItems.map((item) => (
                      <div key={item.title} className={`rounded-md border p-3 ${toneClass(item.tone)}`}>
                        <div className="text-sm font-medium">{item.title}</div>
                        <div className="mt-1 text-xs text-muted-foreground">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="space-y-2">
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <ListChecks className="h-4 w-4" />
                  Component types and generated checklist packs
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {componentRows.map((item) => (
                    <div key={item.deviceClass} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{item.displayName}</div>
                          <div className="text-xs text-muted-foreground">{item.checklistPack}</div>
                        </div>
                        <div className="text-right text-xs tabular-nums text-muted-foreground">
                          <div>{item.devices} items</div>
                          <div>{item.estimatedChecklistItems} checks</div>
                        </div>
                      </div>
                      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
                        {(Object.keys(PHASE_LABELS) as PhaseKey[]).map((phase) => (
                          <div key={phase} className="rounded border bg-muted/30 px-2 py-1">
                            <div className="text-muted-foreground">{PHASE_LABELS[phase]}</div>
                            <div className="font-mono tabular-nums">{item.phaseCounts[phase]}</div>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.sampleTags.map((tag: string) => (
                          <Badge key={tag} variant="outline" className="max-w-full border-muted text-[10px] font-normal">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.sampleTasks.slice(0, 3).map((task: string) => (
                          <Badge key={task} variant="secondary" className="max-w-full text-[10px] font-normal">
                            {task}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold">Parsed items</h3>
                  <div className="text-xs text-muted-foreground tabular-nums">Showing {shownDevices.length} of {preview.devices.length}</div>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[980px] text-left text-xs">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Tag</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 font-medium">Component type</th>
                        <th className="px-3 py-2 font-medium">Equipment area</th>
                        <th className="px-3 py-2 font-medium">Checks</th>
                        <th className="px-3 py-2 font-medium">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownDevices.map((device) => {
                        const area = suggestEquipmentArea(device, areaNames);
                        return (
                          <tr key={device.id} className="border-t">
                            <td className="px-3 py-2 font-mono">{deviceLabel(device)}</td>
                            <td className="px-3 py-2">
                              <div className="font-medium">{device.rhDescription || device.description || "-"}</div>
                              <div className="text-muted-foreground">{device.position}</div>
                            </td>
                            <td className="px-3 py-2">{displayComponentType(device.deviceClass)}</td>
                            <td className="px-3 py-2">
                              <div>{area.areaName}</div>
                              <div className="text-muted-foreground">{area.reason}</div>
                            </td>
                            <td className="px-3 py-2 tabular-nums">{device.suggestedTaskCount}</td>
                            <td className="px-3 py-2">
                              <Badge variant="outline" className={confidenceClass(device.confidence)}>
                                {device.confidence}
                              </Badge>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          {preview && (
            <Button
              variant="outline"
              onClick={() => {
                const plan = {
                  plantKind,
                  propagationMode,
                  areaNames,
                  areaBuckets: areaBuckets.map((bucket) => ({
                    areaName: bucket.areaName,
                    count: bucket.count,
                    examples: bucket.examples.map(deviceLabel),
                  })),
                  preview,
                };
                const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `${preview.fileName.replace(/\.[^.]+$/, "")}-setup-plan.json`;
                document.body.appendChild(link);
                link.click();
                link.remove();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="h-4 w-4" />
              Download plan
            </Button>
          )}
          {preview && (
            <Button disabled>
              <WandSparkles className="h-4 w-4" />
              Create draft after review
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
