import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar } from "@/components/ui/calendar";
import { CalendarDays } from "lucide-react";
import { format, parseISO } from "date-fns";
import { cn } from "@/lib/utils";

interface LineLite { id: string; number: number; name: string | null }
interface Activity { id: string; line_id: string; start_date: string; end_date: string; name: string; color: string }

// 10 visually distinct hues for line color coding.
const LINE_HUES = [
  "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
  "#0ea5e9", "#6366f1", "#a855f7", "#ec4899", "#64748b",
];
function lineColor(idx: number) { return LINE_HUES[idx % LINE_HUES.length]; }

export function ProjectHotCalendarButton({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 w-full sm:w-auto">
          <CalendarDays className="h-4 w-4" /> Global activity calendar
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Global activity calendar</DialogTitle>
        </DialogHeader>
        <div className="max-h-[75vh] overflow-y-auto">
          {open && <CombinedCalendar projectId={projectId} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CombinedCalendar({ projectId }: { projectId: string }) {
  const [lines, setLines] = useState<LineLite[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [month, setMonth] = useState<Date>(new Date());

  useEffect(() => {
    (async () => {
      const { data: ls } = await supabase
        .from("lines").select("id, number, name").eq("project_id", projectId).order("number");
      const list = (ls ?? []) as LineLite[];
      setLines(list);
      if (list.length === 0) { setActivities([]); return; }
      const { data: acts } = await supabase
        .from("line_activities").select("id, line_id, start_date, end_date, name, color")
        .in("line_id", list.map((l) => l.id))
        .order("start_date");
      setActivities((acts ?? []) as Activity[]);
    })();
  }, [projectId]);

  const colorByLine = useMemo(() => {
    const m = new Map<string, string>();
    lines.forEach((l, i) => m.set(l.id, lineColor(i)));
    return m;
  }, [lines]);

  const markerDates = useMemo(() => {
    const out: Date[] = [];
    for (const a of activities) {
      const s = parseISO(a.start_date);
      const e = parseISO(a.end_date);
      const cur = new Date(s);
      while (cur <= e) { out.push(new Date(cur)); cur.setDate(cur.getDate() + 1); }
    }
    return out;
  }, [activities]);

  return (
    <div className="space-y-4 p-1">
      <div className="flex flex-wrap gap-2">
        {lines.map((l, i) => (
          <span key={l.id} className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: lineColor(i) }} />
            Production line {String(l.number).padStart(2, "0")}
          </span>
        ))}
      </div>

      <Calendar
        mode="single"
        month={month}
        onMonthChange={setMonth}
        selected={undefined}
        modifiers={{ activity: markerDates }}
        modifiersClassNames={{ activity: "ring-2 ring-primary ring-offset-1 rounded-md" }}
        className={cn("rounded-md border p-3 pointer-events-auto")}
      />

      <div>
        <h4 className="mb-2 text-sm font-semibold">All activities</h4>
        {activities.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activities scheduled yet.</p>
        ) : (
          <ul className="space-y-1">
            {activities.map((a) => {
              const line = lines.find((l) => l.id === a.line_id);
              return (
                <li key={a.id} className="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorByLine.get(a.line_id) }} />
                  <span className="font-mono text-xs text-muted-foreground">
                    {format(parseISO(a.start_date), "d MMM")} → {format(parseISO(a.end_date), "d MMM")}
                  </span>
                  <span className="font-medium">Production line {String(line?.number).padStart(2, "0")}</span>
                  <span className="text-muted-foreground">·</span>
                  <span>{a.name}</span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
