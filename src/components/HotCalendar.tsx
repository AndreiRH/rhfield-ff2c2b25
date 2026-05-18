import { useEffect, useState } from "react";
import { toUserMessage } from "@/lib/errors";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format, parseISO } from "date-fns";
import { CalendarIcon, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { HOT_MILESTONE_PRESETS } from "@/lib/progress";
import { cn } from "@/lib/utils";

interface Milestone {
  id: string;
  date: string;
  label: string;
  notes: string | null;
}

export function HotCalendar({
  lineId, plannedStart, plannedEnd, canEdit, onChange,
}: {
  lineId: string;
  plannedStart: string | null;
  plannedEnd: string | null;
  canEdit: boolean;
  onChange: () => void;
}) {
  const { user } = useAuth();
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [start, setStart] = useState<Date | undefined>(plannedStart ? parseISO(plannedStart) : undefined);
  const [end, setEnd] = useState<Date | undefined>(plannedEnd ? parseISO(plannedEnd) : undefined);
  const [newDate, setNewDate] = useState<Date | undefined>(undefined);
  const [newLabel, setNewLabel] = useState("");
  const [month, setMonth] = useState<Date>(new Date());

  useEffect(() => {
    refresh();
  }, [lineId]);

  const refresh = async () => {
    const { data } = await supabase.from("milestones").select("*").eq("line_id", lineId).order("date");
    setMilestones((data ?? []) as Milestone[]);
  };

  const savePlanned = async (which: "start" | "end", d: Date | undefined) => {
    const patch = which === "start" ? { hot_planned_start: d ? format(d, "yyyy-MM-dd") : null }
                                    : { hot_planned_end: d ? format(d, "yyyy-MM-dd") : null };
    const { error } = await supabase.from("lines").update(patch).eq("id", lineId);
    if (error) toast.error(toUserMessage(error));
    else onChange();
  };

  const addMilestone = async () => {
    if (!newDate || !newLabel.trim()) { toast.error("Pick a date and a label"); return; }
    const { error } = await supabase.from("milestones").insert({
      line_id: lineId,
      date: format(newDate, "yyyy-MM-dd"),
      label: newLabel.trim(),
      created_by: user?.id,
    });
    if (error) toast.error(toUserMessage(error));
    else { setNewDate(undefined); setNewLabel(""); refresh(); }
  };

  const deleteMilestone = async (id: string) => {
    const { error } = await supabase.from("milestones").delete().eq("id", id);
    if (error) toast.error(toUserMessage(error));
    else refresh();
  };

  const milestoneDates = milestones.map((m) => parseISO(m.date));
  const inRangeDates = (() => {
    if (!start || !end) return [];
    const out: Date[] = [];
    const cursor = new Date(start);
    while (cursor <= end) { out.push(new Date(cursor)); cursor.setDate(cursor.getDate() + 1); }
    return out;
  })();

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Line hot commissioning calendar</h3>
        </div>

        <div className="grid gap-6 lg:grid-cols-[auto_1fr]">
          <div>
            <Calendar
              mode="single"
              month={month}
              onMonthChange={setMonth}
              selected={undefined}
              modifiers={{ planned: inRangeDates, milestone: milestoneDates }}
              modifiersClassNames={{
                planned: "bg-primary/15 text-foreground",
                milestone: "ring-2 ring-success ring-offset-1 rounded-md",
              }}
              className={cn("rounded-md border p-3 pointer-events-auto")}
            />
            {canEdit && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <DatePickField label="Planned start" date={start} onChange={(d) => { setStart(d); savePlanned("start", d); }} />
                <DatePickField label="Planned end" date={end} onChange={(d) => { setEnd(d); savePlanned("end", d); }} />
              </div>
            )}
          </div>

          <div>
            <div className="mb-3 text-sm font-semibold text-muted-foreground">Milestones</div>
            <ul className="space-y-1">
              {milestones.length === 0 && <li className="text-sm text-muted-foreground">No milestones yet.</li>}
              {milestones.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
                  <div>
                    <div className="text-sm font-medium">{m.label}</div>
                    <div className="font-mono text-xs text-muted-foreground">{format(parseISO(m.date), "EEE, d MMM yyyy")}</div>
                  </div>
                  {canEdit && (
                    <Button size="sm" variant="ghost" onClick={() => deleteMilestone(m.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>

            {canEdit && (
              <div className="mt-4 space-y-2 rounded-md border border-dashed p-3">
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Add milestone</div>
                <div className="flex flex-wrap gap-1">
                  {HOT_MILESTONE_PRESETS.map((p) => (
                    <button key={p} type="button" onClick={() => setNewLabel(p)}
                      className="rounded-full border px-2 py-0.5 text-xs hover:border-primary/40">{p}</button>
                  ))}
                </div>
                <Input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="Milestone label" />
                <div className="flex gap-2">
                  <DatePickField label="" date={newDate} onChange={setNewDate} />
                  <Button onClick={addMilestone}><Plus className="mr-1 h-4 w-4" /> Add</Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DatePickField({ label, date, onChange }: { label: string; date: Date | undefined; onChange: (d: Date | undefined) => void }) {
  return (
    <div>
      {label && <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>}
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-left font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? format(date, "d MMM yyyy") : <span className="text-muted-foreground">Pick a date</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar mode="single" selected={date} onSelect={onChange} className={cn("p-3 pointer-events-auto")} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
