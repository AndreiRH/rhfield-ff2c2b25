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
  const today = format(new Date(), "yyyy-MM-dd");
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);

  const runCalendarPdf = () => {
    let range: CalendarRange | null = null;
    if (mode === "current") {
      range = getCurrentRange?.() ?? null;
      if (!range) {
        // Fallback: derive from activity bounds
        if (activities.length > 0) {
          const dates = activities.flatMap((a) => [a.start_date, a.end_date]);
          dates.sort();
          range = { start: parseISO(dates[0]), end: parseISO(dates[dates.length - 1]) };
        }
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
    runExport("calendar-pdf", opts, range);
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
              // Pre-fill custom range with current view if available
              const cur = getCurrentRange?.();
              if (cur) {
                setStartDate(format(cur.start, "yyyy-MM-dd"));
                setEndDate(format(cur.end, "yyyy-MM-dd"));
              }
              setMode("current");
              setViewDialog(true);
            }}
          >
            Calendar view (PDF)
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={viewDialog} onOpenChange={setViewDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Export calendar view</DialogTitle>
            <DialogDescription>
              Choose which date range to render in the PDF.
            </DialogDescription>
          </DialogHeader>
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewDialog(false)}>
              Cancel
            </Button>
            <Button onClick={runCalendarPdf}>Export PDF</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
