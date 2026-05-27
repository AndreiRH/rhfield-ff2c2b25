import { useState } from "react";
import { AlertCircle, Download, FileSpreadsheet, Loader2, WandSparkles } from "lucide-react";
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
import type { PartListPreview } from "@/lib/part-list-import";

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

function SummaryNumber({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function PartListImportButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PartListPreview | null>(null);

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

  const shownDevices = preview?.devices.slice(0, 40) ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <FileSpreadsheet className="h-4 w-4" />
          Import part list
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Part list import preview</DialogTitle>
          <DialogDescription>Read an Excel PID part list and prepare a generated commissioning draft.</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-md border bg-muted/30 p-4">
            <Label htmlFor={`part-list-${projectId}`}>Excel file</Label>
            <Input
              id={`part-list-${projectId}`}
              type="file"
              accept=".xlsx,.xls"
              className="mt-2"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {busy && (
            <div className="flex items-center gap-2 rounded-md border p-4 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Reading workbook
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
                <SummaryNumber label="Devices" value={preview.totals.devices} />
                <SummaryNumber label="Checklist items" value={preview.totals.estimatedChecklistItems} />
                <SummaryNumber label="High confidence" value={preview.totals.highConfidence} />
                <SummaryNumber label="Review needed" value={preview.totals.lowConfidence} />
              </div>

              <div className="grid gap-3 rounded-md border p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <div className="text-xs text-muted-foreground">Customer</div>
                  <div className="font-medium">{preview.projectHint.customer || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Kiln</div>
                  <div className="font-medium">{preview.projectHint.kilnNumber || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Project no.</div>
                  <div className="font-medium">{preview.projectHint.projectNumber || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">PID drawing</div>
                  <div className="font-medium">{preview.projectHint.pidDrawing || "-"}</div>
                </div>
                <div className="sm:col-span-2">
                  <div className="text-xs text-muted-foreground">Equipment</div>
                  <div className="font-medium">{preview.projectHint.equipmentNumber || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Driven side</div>
                  <div className="font-medium">{preview.projectHint.drivenSide || "-"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Date</div>
                  <div className="font-medium">{preview.projectHint.date || "-"}</div>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-2">
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

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">Sheets</h3>
                  <div className="space-y-2">
                    {preview.sheets.map((sheet) => (
                      <div key={sheet.name} className="rounded-md border p-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <div className="text-sm font-medium">{sheet.category}</div>
                            <div className="text-xs text-muted-foreground">{sheet.name}</div>
                          </div>
                          <Badge variant="outline" className="shrink-0 tabular-nums">{sheet.devices}</Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Checklist packs</h3>
                <div className="grid gap-3 md:grid-cols-2">
                  {preview.classes.map((item) => (
                    <div key={item.deviceClass} className="rounded-md border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold">{item.deviceClass}</div>
                          <div className="text-xs text-muted-foreground">{item.checklistPack}</div>
                        </div>
                        <div className="text-right text-xs tabular-nums text-muted-foreground">
                          <div>{item.devices} devices</div>
                          <div>{item.estimatedChecklistItems} items</div>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {item.sampleTasks.slice(0, 4).map((task) => (
                          <Badge key={task} variant="outline" className="max-w-full border-muted text-[10px] font-normal">
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
                  <h3 className="text-sm font-semibold">Parsed devices</h3>
                  <div className="text-xs text-muted-foreground tabular-nums">Showing {shownDevices.length} of {preview.devices.length}</div>
                </div>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full min-w-[900px] text-left text-xs">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">Row</th>
                        <th className="px-3 py-2 font-medium">Tag</th>
                        <th className="px-3 py-2 font-medium">Description</th>
                        <th className="px-3 py-2 font-medium">Class</th>
                        <th className="px-3 py-2 font-medium">Pack</th>
                        <th className="px-3 py-2 font-medium">Confidence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownDevices.map((device) => (
                        <tr key={device.id} className="border-t">
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">{device.sourceRow}</td>
                          <td className="px-3 py-2 font-mono">{device.tag || device.rhTagNo || "-"}</td>
                          <td className="px-3 py-2">
                            <div className="font-medium">{device.rhDescription || device.description || "-"}</div>
                            <div className="text-muted-foreground">{device.position}</div>
                          </td>
                          <td className="px-3 py-2">{device.deviceClass}</td>
                          <td className="px-3 py-2">{device.checklistPack}</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className={confidenceClass(device.confidence)}>
                              {device.confidence}
                            </Badge>
                          </td>
                        </tr>
                      ))}
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
              onClick={async () => {
                const { downloadPartListPreview } = await import("@/lib/part-list-import");
                downloadPartListPreview(preview);
              }}
            >
              <Download className="h-4 w-4" />
              Download JSON
            </Button>
          )}
          {preview && (
            <Button disabled>
              <WandSparkles className="h-4 w-4" />
              Generate draft
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
