import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Download, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { runPlantExport, type PlantExportFormat } from "@/lib/plant-export";
import { toUserMessage } from "@/lib/errors";

interface Props {
  projectId: string;
  lineNumber: string;
  kind: string;
  plantLabel: string;
  equipment: { id: string; name: string }[];
}

export function PlantExportButton({ projectId, lineNumber, kind, plantLabel, equipment }: Props) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(equipment.map((e) => e.id)));
  const [format, setFormat] = useState<PlantExportFormat>("pdf");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ msg: string; cur: number; tot: number } | null>(null);

  const allChecked = selected.size === equipment.length;
  const noneChecked = selected.size === 0;

  const toggleAll = () => {
    setSelected(allChecked ? new Set() : new Set(equipment.map((e) => e.id)));
  };
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const orderedSelectedIds = useMemo(
    () => equipment.filter((e) => selected.has(e.id)).map((e) => e.id),
    [equipment, selected],
  );

  const start = async () => {
    if (noneChecked) return;
    setRunning(true);
    try {
      await runPlantExport(
        {
          projectId, lineNumber, kind, plantLabel,
          equipmentIds: orderedSelectedIds,
          allEquipmentCount: equipment.length,
          format,
        },
        (msg, cur, tot) => setProgress({ msg, cur, tot }),
      );
      toast.success("Export downloaded");
      setOpen(false);
    } catch (e: any) {
      toast.error(toUserMessage(e, "Export failed"));
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  if (equipment.length === 0) return null;

  return (
    <>
      <Button
        size="icon"
        variant="outline"
        onClick={() => setOpen(true)}
        title="Export"
        aria-label="Export"
      >
        <Download className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={(o) => !running && setOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>Export {plantLabel} — Line {lineNumber}</DialogTitle>
            <DialogDescription>
              Pick the equipment and format. Each section (Assembly, Wiring, Cold comm.)
              is shown with its checklist, marks, flags, notes and photo previews.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 overflow-hidden">
            {/* Equipment list */}
            <div className="space-y-2 overflow-hidden">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Equipment</Label>
                <Button size="sm" variant="ghost" onClick={toggleAll} disabled={running}>
                  {allChecked ? "Clear all" : "Select all"}
                </Button>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border divide-y">
                {equipment.map((e) => (
                  <label
                    key={e.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 hover:bg-muted/50"
                  >
                    <Checkbox
                      checked={selected.has(e.id)}
                      onCheckedChange={() => toggle(e.id)}
                      disabled={running}
                    />
                    <span className="text-sm">{e.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {selected.size}/{equipment.length} selected{allChecked && equipment.length > 1 ? " — plant totals will be included" : ""}
              </p>
            </div>

            {/* Format */}
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Format</Label>
              <RadioGroup
                value={format}
                onValueChange={(v) => setFormat(v as PlantExportFormat)}
                className="grid grid-cols-3 gap-2"
                disabled={running}
              >
                {(["pdf", "xlsx", "csv"] as const).map((f) => (
                  <label
                    key={f}
                    className={`flex cursor-pointer items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm ${format === f ? "border-primary bg-primary/5 font-medium" : ""}`}
                  >
                    <RadioGroupItem value={f} />
                    {f === "pdf" ? "PDF" : f === "xlsx" ? "Excel" : "CSV"}
                  </label>
                ))}
              </RadioGroup>
              {format === "csv" && (
                <p className="text-xs text-muted-foreground">CSV is plain text — no colors or photo previews.</p>
              )}
              {format === "xlsx" && (
                <p className="text-xs text-muted-foreground">
                  Excel includes colored sections and a Mark column. Photo previews are listed as counts (use PDF to see them inline).
                </p>
              )}
            </div>

            {running && progress && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="mb-2 flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <span>{progress.msg}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary transition-all"
                    style={{ width: `${Math.round((progress.cur / Math.max(progress.tot, 1)) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={running}>Cancel</Button>
            <Button onClick={start} disabled={running || noneChecked} className="gap-2">
              <Download className="h-4 w-4" />
              {running ? "Exporting…" : `Export ${selected.size || ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
