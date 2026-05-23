import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  const [viewDialog, setViewDialog] = useState(false);
  const [mode, setMode] = useState<"current" | "custom">("current");
  const [viewFormat, setViewFormat] = useState<"pdf" | "xlsx" | "csv" | "ics">("pdf");
  const today = format(new Date(), "yyyy-MM-dd");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const runCalendarExport = () => {
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
    if (!range) return;
    const fmtMap = {
      pdf: "calendar-pdf",
      xlsx: "calendar-xlsx",
      csv: "calendar-csv",
      ics: "calendar-ics",
    } as const;
    runExport(fmtMap[viewFormat], opts, range);
    setViewDialog(false);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2"
            disabled={disabled || activities.length === 0}
          >
            <Download className="h-4 w-4" />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>Activity list</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => runExport("pdf", opts)}>
            PDF document
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runExport("xlsx", opts)}>
            Excel (.xlsx)
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runExport("csv", opts)}>
            CSV
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => runExport("ics", opts)}>
            Calendar feed (.ics)
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Calendar view</DropdownMenuLabel>
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              const cur = getCurrentRange?.();
              if (cur) {
                setStartDate(format(cur.start, "yyyy-MM-dd"));
                setEndDate(format(cur.end, "yyyy-MM-dd"));
              }
              setMode("current");
              setViewDialog(true);
            }}
          >
            Calendar view…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={viewDialog} onOpenChange={setViewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export calendar view</DialogTitle>
            <DialogDescription>
              Pick a date range and a format.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Date range</div>
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

          <div className="space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Format</div>
            <RadioGroup
              value={viewFormat}
              onValueChange={(v) => setViewFormat(v as typeof viewFormat)}
              className="grid grid-cols-2 gap-2"
            >
              {[
                { v: "pdf", label: "PDF", hint: "Printable timeline" },
                { v: "xlsx", label: "Excel", hint: "Colored gantt grid" },
                { v: "csv", label: "CSV", hint: "Plain grid (no colors)" },
                { v: "ics", label: "Calendar (.ics)", hint: "Events in range" },
              ].map((f) => (
                <div key={f.v} className="flex items-start gap-2 rounded-md border p-2">
                  <RadioGroupItem value={f.v} id={`fmt-${f.v}`} className="mt-1" />
                  <Label htmlFor={`fmt-${f.v}`} className="font-normal">
                    <div className="font-medium text-sm">{f.label}</div>
                    <div className="text-[11px] text-muted-foreground">{f.hint}</div>
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={runCalendarExport}>Export</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
