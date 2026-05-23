import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Download } from "lucide-react";
import { format, parseISO } from "date-fns";
import {
  runExport,
  type CalendarRange,
  type ExportActivity,
  type ExportFormat,
  type ExportLine,
} from "@/lib/calendar-export";

interface ExportMenuProps {
  activities: ExportActivity[];
  lines?: ExportLine[];
  projectName: string;
  scopeLabel: string;
  disabled?: boolean;
  getCurrentRange?: () => CalendarRange | null;
}

export function ExportMenu({
  activities,
  lines,
  projectName,
  scopeLabel,
  disabled,
  getCurrentRange,
}: ExportMenuProps) {
  const opts = { activities, lines, projectName, scopeLabel };
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"current" | "custom">("current");
  const [fmt, setFmt] = useState<ExportFormat>("pdf");
  const today = format(new Date(), "yyyy-MM-dd");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const openDialog = () => {
    const cur = getCurrentRange?.();
    if (cur) {
      setStartDate(format(cur.start, "yyyy-MM-dd"));
      setEndDate(format(cur.end, "yyyy-MM-dd"));
    } else if (activities.length > 0) {
      const dates = activities.flatMap((a) => [a.start_date, a.end_date]).sort();
      setStartDate(dates[0]);
      setEndDate(dates[dates.length - 1]);
    }
    setMode("current");
    setOpen(true);
  };

  const run = () => {
    let range: CalendarRange | null = null;
    if (mode === "current") {
      range = getCurrentRange?.() ?? null;
      if (!range && activities.length > 0) {
        const dates = activities.flatMap((a) => [a.start_date, a.end_date]).sort();
        range = { start: parseISO(dates[0]), end: parseISO(dates[dates.length - 1]) };
      }
    } else {
      try {
        const s = parseISO(startDate);
        const e = parseISO(endDate);
        if (e >= s) range = { start: s, end: e };
      } catch {
        /* ignore */
      }
    }
    if (fmt !== "ics" && !range) return;
    runExport(fmt, opts, range ?? undefined);
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        disabled={disabled || activities.length === 0}
        onClick={openDialog}
      >
        <Download className="h-4 w-4" />
        Export
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export calendar</DialogTitle>
            <DialogDescription>
              Each file includes the full activity list plus a calendar view for the selected range.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Format</div>
            <RadioGroup
              value={fmt}
              onValueChange={(v) => setFmt(v as ExportFormat)}
              className="grid grid-cols-2 gap-2"
            >
              {[
                { v: "pdf" as ExportFormat, label: "PDF", hint: "List + printable timeline" },
                { v: "xlsx" as ExportFormat, label: "Excel", hint: "List + colored gantt" },
                { v: "csv" as ExportFormat, label: "CSV", hint: "List + plain grid" },
                { v: "ics" as ExportFormat, label: "Calendar (.ics)", hint: "All activities as events" },
              ].map((f) => (
                <div key={f.v} className="flex items-start gap-2 rounded-md border p-2">
                  <RadioGroupItem value={f.v} id={`fmt-${f.v}`} className="mt-1" />
                  <Label htmlFor={`fmt-${f.v}`} className="font-normal cursor-pointer">
                    <div className="font-medium text-sm">{f.label}</div>
                    <div className="text-[11px] text-muted-foreground">{f.hint}</div>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          {fmt !== "ics" && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-muted-foreground">
                Calendar view range
              </div>
              <div className="text-[11px] text-muted-foreground -mt-1">
                The activity list always includes every activity. The range only affects the calendar view section.
              </div>
              <RadioGroup
                value={mode}
                onValueChange={(v) => setMode(v as "current" | "custom")}
                className="space-y-3"
              >
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="current" id="r-current" className="mt-1" />
                  <Label htmlFor="r-current" className="font-normal">
                    <div className="font-medium">Current view</div>
                    <div className="text-xs text-muted-foreground">
                      Use the date range currently visible on screen.
                    </div>
                  </Label>
                </div>
                <div className="flex items-start gap-2">
                  <RadioGroupItem value="custom" id="r-custom" className="mt-1" />
                  <Label htmlFor="r-custom" className="font-normal flex-1">
                    <div className="font-medium">Custom date range</div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <div>
                        <Label htmlFor="d-start" className="text-xs">Start</Label>
                        <Input
                          id="d-start"
                          type="date"
                          value={startDate}
                          onChange={(e) => {
                            setStartDate(e.target.value);
                            setMode("custom");
                          }}
                        />
                      </div>
                      <div>
                        <Label htmlFor="d-end" className="text-xs">End</Label>
                        <Input
                          id="d-end"
                          type="date"
                          value={endDate}
                          onChange={(e) => {
                            setEndDate(e.target.value);
                            setMode("custom");
                          }}
                        />
                      </div>
                    </div>
                  </Label>
                </div>
              </RadioGroup>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={run}>Export</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
