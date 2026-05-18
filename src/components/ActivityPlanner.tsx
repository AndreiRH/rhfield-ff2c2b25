import { useEffect, useMemo, useRef, useState } from "react";
import { format, parseISO, differenceInCalendarDays, endOfMonth, eachMonthOfInterval, startOfYear, eachDayOfInterval } from "date-fns";
import { Pencil, Copy, Globe, Lock, Trash2, Plus, CalendarIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toUserMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const DAY_WIDTH = 28;
const ROW_HEIGHT = 22;
const BAR_HEIGHT = 14;
const MONTH_LABEL_W = 78;
const YEAR_LABEL_W = 48;
export const PALETTE = [
  "#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6",
  "#06b6d4", "#f97316", "#84cc16", "#ec4899", "#14b8a6",
  "#a855f7", "#22c55e", "#eab308", "#dc2626", "#0ea5e9",
  "#d946ef", "#f43f5e", "#65a30d", "#0891b2", "#7c3aed",
];
export const RANGE_START = new Date(2026, 0, 1);
export const RANGE_END = new Date(2049, 11, 31);

export interface LineActivity {
  id: string;
  line_id: string;
  name: string;
  start_date: string;
  end_date: string;
  color: string;
  is_shared: boolean;
  shared_group_id: string | null;
  origin_line_id: string | null;
  created_by: string | null;
  created_at: string;
}

export interface LineLite { id: string; number: number; name?: string | null }
export interface LineInfo extends LineLite { hot_planned_start: string | null; hot_planned_end: string | null }

export function ActivityPlanner({
  line, allLines, activities, canEdit, onChange,
}: {
  line: LineInfo;
  allLines: LineLite[];
  activities: LineActivity[];
  canEdit: boolean;
  onChange: () => void;
}) {
  const { user } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<LineActivity | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<{ name: string; existingLineNumbers: number[]; existingColor: string; start: string; end: string } | null>(null);
  const [confirmShare, setConfirmShare] = useState<LineActivity | null>(null);
  const [confirmUnshare, setConfirmUnshare] = useState<LineActivity | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LineActivity | null>(null);

  const sorted = useMemo(
    () => [...activities].sort((a, b) => a.start_date.localeCompare(b.start_date)),
    [activities],
  );

  // Fixed timeline range: 01/01/2026 → 31/12/2049
  const rangeStart = RANGE_START;
  const rangeEnd = RANGE_END;
  const totalDays = differenceInCalendarDays(rangeEnd, rangeStart) + 1;

  const dayToX = (d: Date) => differenceInCalendarDays(d, rangeStart) * DAY_WIDTH;
  const todayX = dayToX(new Date());
  const timelineWidth = totalDays * DAY_WIDTH;

  // Months and years
  const months = useMemo(() => eachMonthOfInterval({ start: rangeStart, end: rangeEnd }), [rangeStart, rangeEnd]);
  const years = useMemo(() => {
    const map = new Map<number, { start: Date; end: Date }>();
    for (const m of months) {
      const y = m.getFullYear();
      if (!map.has(y)) map.set(y, { start: startOfYear(m), end: m });
      map.get(y)!.end = endOfMonth(m);
    }
    return [...map.entries()].map(([year, { start, end }]) => ({
      year,
      start: start < rangeStart ? rangeStart : start,
      end: end > rangeEnd ? rangeEnd : end,
    }));
  }, [months]);

  // Auto-scroll to today (or first activity) on mount
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const focusX = sorted.length > 0 ? dayToX(parseISO(sorted[0].start_date)) : todayX;
    const target = Math.max(0, focusX - el.clientWidth / 2);
    el.scrollLeft = target;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToActivity = (a: LineActivity) => {
    if (!scrollRef.current) return;
    const x = dayToX(parseISO(a.start_date));
    const w = (differenceInCalendarDays(parseISO(a.end_date), parseISO(a.start_date)) + 1) * DAY_WIDTH;
    const el = scrollRef.current;
    el.scrollTo({ left: Math.max(0, x + w / 2 - el.clientWidth / 2), behavior: "smooth" });
  };

  // Avoid color repeats on the same line — include shared + local activities.
  const usedColors = new Set(activities.map((a) => a.color));
  const nextColor = () => PALETTE.find((c) => !usedColors.has(c)) ?? PALETTE[activities.length % PALETTE.length];


  // ---------- handlers ----------
  const insertLocal = async (name: string, start: string, end: string, color?: string) => {
    const c = color ?? nextColor();
    const { error } = await supabase.from("line_activities").insert({
      line_id: line.id, name, start_date: start, end_date: end, color: c,
      is_shared: false, created_by: user?.id ?? null,
    });
    if (error) toast.error(toUserMessage(error));
    else { toast.success("Activity added"); onChange(); }
  };

  const insertSharedAcrossAll = async (name: string, start: string, end: string, color: string) => {
    const groupId = crypto.randomUUID();
    const rows = allLines.map((l) => ({
      line_id: l.id, name, start_date: start, end_date: end, color,
      is_shared: true, shared_group_id: groupId, origin_line_id: line.id,
      created_by: user?.id ?? null,
    }));
    const { error } = await supabase.from("line_activities").insert(rows);
    if (error) toast.error(toUserMessage(error));
    else { toast.success(`Shared "${name}" across ${allLines.length} lines`); onChange(); }
  };

  const checkDuplicateAndAdd = async (name: string, start: string, end: string) => {
    const trimmed = name.trim();
    if (!trimmed) { toast.error("Activity name required"); return; }
    if (!start || !end) { toast.error("Pick start and end dates"); return; }
    if (start > end) { toast.error("End date must be after start"); return; }
    const otherLineIds = allLines.filter((l) => l.id !== line.id).map((l) => l.id);
    if (otherLineIds.length > 0) {
      const { data } = await supabase
        .from("line_activities")
        .select("name, color, line_id")
        .in("line_id", otherLineIds)
        .ilike("name", trimmed);
      const dupes = (data ?? []).filter((r: any) => r.name.toLowerCase() === trimmed.toLowerCase());
      if (dupes.length > 0) {
        const lineNumbers = dupes
          .map((d: any) => allLines.find((l) => l.id === d.line_id)?.number)
          .filter((n): n is number => typeof n === "number");
        setDuplicateConflict({
          name: trimmed,
          existingLineNumbers: lineNumbers,
          existingColor: (dupes[0] as any).color,
          start, end,
        });
        return;
      }
    }
    await insertLocal(trimmed, start, end);
  };

  const doShare = async (a: LineActivity) => {
    const groupId = crypto.randomUUID();
    const { error: updErr } = await supabase
      .from("line_activities")
      .update({ is_shared: true, shared_group_id: groupId, origin_line_id: line.id })
      .eq("id", a.id);
    if (updErr) { toast.error(toUserMessage(updErr)); return; }
    const others = allLines.filter((l) => l.id !== line.id);
    if (others.length > 0) {
      const rows = others.map((l) => ({
        line_id: l.id, name: a.name, start_date: a.start_date, end_date: a.end_date,
        color: a.color, is_shared: true, shared_group_id: groupId, origin_line_id: line.id,
        created_by: user?.id ?? null,
      }));
      const { error } = await supabase.from("line_activities").insert(rows);
      if (error) { toast.error(toUserMessage(error)); return; }
    }
    toast.success("Shared across all lines");
    onChange();
  };

  const doUnshare = async (a: LineActivity) => {
    if (!a.shared_group_id) return;
    const { error: delErr } = await supabase
      .from("line_activities")
      .delete()
      .eq("shared_group_id", a.shared_group_id)
      .neq("line_id", line.id);
    if (delErr) { toast.error(toUserMessage(delErr)); return; }
    const { error: updErr } = await supabase
      .from("line_activities")
      .update({ is_shared: false, shared_group_id: null, origin_line_id: null })
      .eq("id", a.id);
    if (updErr) { toast.error(toUserMessage(updErr)); return; }
    toast.success("Now local to this line");
    onChange();
  };

  const doDelete = async (a: LineActivity) => {
    const { error } = await supabase.from("line_activities").delete().eq("id", a.id);
    if (error) toast.error(toUserMessage(error));
    else { toast.success("Activity deleted"); onChange(); }
  };

  const doDuplicate = async (a: LineActivity) => {
    await insertLocal(a.name, a.start_date, a.end_date);
  };

  return (
    <div className="space-y-6">
      {/* Gantt timeline */}
      <Card>
        <CardContent className="p-0">
          <div ref={scrollRef} className="overflow-x-auto">
            <div className="relative" style={{ width: timelineWidth, minWidth: "100%" }}>
              {/* Header */}
              <div className="sticky top-0 z-10 bg-card border-b">
                {/* Years */}
                <div className="flex border-b">
                  {years.map((y) => {
                    const left = dayToX(y.start);
                    const width = (differenceInCalendarDays(y.end, y.start) + 1) * DAY_WIDTH;
                    return (
                      <div
                        key={y.year}
                        className="text-xs font-semibold py-1 px-2 border-r"
                        style={{ width, position: "absolute", left, top: 0 }}
                      >
                        {y.year}
                      </div>
                    );
                  })}
                  <div style={{ height: 24 }} />
                </div>
                {/* Months */}
                <div className="relative border-b" style={{ height: 24 }}>
                  {months.map((m) => {
                    const mStart = m < rangeStart ? rangeStart : m;
                    const mEnd = endOfMonth(m) > rangeEnd ? rangeEnd : endOfMonth(m);
                    const left = dayToX(mStart);
                    const width = (differenceInCalendarDays(mEnd, mStart) + 1) * DAY_WIDTH;
                    return (
                      <div
                        key={m.toISOString()}
                        className="text-[11px] text-muted-foreground py-0.5 px-2 border-r absolute top-0 truncate"
                        style={{ width, left }}
                      >
                        {format(m, "MMM yyyy")}
                      </div>
                    );
                  })}
                </div>
                {/* Days */}
                <div className="relative" style={{ height: 22 }}>
                  {eachDayOfInterval({ start: rangeStart, end: rangeEnd }).map((d) => {
                    const isToday = format(d, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                    const isFirst = d.getDate() === 1;
                    return (
                      <div
                        key={d.toISOString()}
                        className={cn(
                          "absolute top-0 text-center text-[10px] tabular-nums border-r",
                          isFirst ? "border-border" : "border-border/30",
                          isToday ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground",
                        )}
                        style={{ left: dayToX(d), width: DAY_WIDTH, height: 22, lineHeight: "22px" }}
                      >
                        {d.getDate()}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Body */}
              <div className="relative" style={{ height: Math.max(sorted.length * ROW_HEIGHT, 120) }}>
                {/* Alternating month bands */}
                {months.map((m, i) => {
                  const mStart = m < rangeStart ? rangeStart : m;
                  const mEnd = endOfMonth(m) > rangeEnd ? rangeEnd : endOfMonth(m);
                  const left = dayToX(mStart);
                  const width = (differenceInCalendarDays(mEnd, mStart) + 1) * DAY_WIDTH;
                  return (
                    <div
                      key={`bg-${m.toISOString()}`}
                      className="absolute top-0 bottom-0"
                      style={{
                        left, width,
                        background: i % 2 === 0 ? "hsl(var(--muted) / 0.3)" : "transparent",
                      }}
                    />
                  );
                })}

                {/* Hot planned band */}
                {line.hot_planned_start && line.hot_planned_end && (
                  <div
                    className="absolute top-0 bottom-0"
                    style={{
                      left: dayToX(parseISO(line.hot_planned_start)),
                      width: (differenceInCalendarDays(parseISO(line.hot_planned_end), parseISO(line.hot_planned_start)) + 1) * DAY_WIDTH,
                      background: "hsl(var(--primary) / 0.08)",
                    }}
                    title="Hot commissioning planned window"
                  />
                )}

                {/* Today line */}
                {todayX >= 0 && todayX <= timelineWidth && (
                  <>
                    <div
                      className="absolute top-0 bottom-0 pointer-events-none"
                      style={{ left: todayX, width: 2, background: "hsl(var(--primary) / 0.6)" }}
                    />
                    <div
                      className="absolute top-0 text-[10px] px-1 rounded-sm bg-primary text-primary-foreground"
                      style={{ left: todayX + 4 }}
                    >
                      Today
                    </div>
                  </>
                )}

                {/* Activity bars */}
                {sorted.map((a, i) => {
                  const s = parseISO(a.start_date);
                  const e = parseISO(a.end_date);
                  const left = dayToX(s);
                  const width = Math.max((differenceInCalendarDays(e, s) + 1) * DAY_WIDTH, 8);
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => canEdit && setEditing(a)}
                      title={`${a.name} · ${format(s, "d MMM yyyy")} → ${format(e, "d MMM yyyy")}`}
                      className="absolute rounded-full flex items-center px-3 overflow-hidden hover:ring-2 hover:ring-foreground/30 transition"
                      style={{
                        left,
                        width,
                        top: i * ROW_HEIGHT + (ROW_HEIGHT - 24) / 2,
                        height: 24,
                        background: a.color,
                      }}
                    >
                      <span className="text-xs font-medium text-white truncate">{a.name}</span>
                    </button>
                  );
                })}

                {sorted.length === 0 && (
                  <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
                    No activities yet
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity list */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-muted-foreground">Activities</h3>
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activities scheduled.</p>
        ) : (
          <ul className="space-y-1.5">
            {sorted.map((a) => (
              <li
                key={a.id}
                className="flex flex-wrap items-center gap-2 rounded-md border-2 bg-card px-2 py-1 text-xs cursor-pointer transition hover:brightness-105"
                style={{ borderColor: a.color }}
                onClick={() => scrollToActivity(a)}
              >
                <span className="font-medium flex-1 min-w-[80px] truncate" style={{ color: a.color }}>{a.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">
                  {format(parseISO(a.start_date), "d MMM yy")} → {format(parseISO(a.end_date), "d MMM yy")}
                </span>
                {canEdit && (
                  <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setEditing(a)}
                      title="Edit"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => doDuplicate(a)}
                      title="Duplicate"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                    >
                      <Copy className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => a.is_shared ? setConfirmUnshare(a) : setConfirmShare(a)}
                      title={a.is_shared ? "Shared across all production lines — click to make local" : "Local to this production line — click to share across all production lines"}
                      className={`inline-flex h-6 w-6 items-center justify-center rounded ${a.is_shared ? "text-primary" : "text-muted-foreground hover:text-foreground"}`}
                    >
                      {a.is_shared ? <Globe className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(a)}
                      title="Delete"
                      className="inline-flex h-6 w-6 items-center justify-center rounded text-destructive hover:opacity-80"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add form */}
      {canEdit && <AddActivityForm onSubmit={checkDuplicateAndAdd} />}

      {/* Duplicate conflict dialog */}
      {duplicateConflict && (
        <Dialog open onOpenChange={(o) => !o && setDuplicateConflict(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Activity already exists on other lines</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              An activity named "{duplicateConflict.name}" already exists on{" "}
              {duplicateConflict.existingLineNumbers.length === 1
                ? `Line ${String(duplicateConflict.existingLineNumbers[0]).padStart(2, "0")}`
                : `${duplicateConflict.existingLineNumbers.length} other lines`}
              . Would you like to share it across all lines instead? Sharing will use the same color
              ({duplicateConflict.existingColor}) on all lines.
            </p>
            <DialogFooter className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={async () => {
                  await insertLocal(duplicateConflict.name, duplicateConflict.start, duplicateConflict.end);
                  setDuplicateConflict(null);
                }}
              >
                Keep local
              </Button>
              <Button
                onClick={async () => {
                  await insertSharedAcrossAll(
                    duplicateConflict.name,
                    duplicateConflict.start,
                    duplicateConflict.end,
                    duplicateConflict.existingColor,
                  );
                  setDuplicateConflict(null);
                }}
              >
                Share across all lines
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit dialog */}
      {editing && (
        <EditActivityDialog
          activity={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onChange(); }}
        />
      )}

      {/* Share confirm */}
      {confirmShare && (
        <AlertDialog open onOpenChange={(o) => !o && setConfirmShare(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Share this activity across all lines?</AlertDialogTitle>
              <AlertDialogDescription>
                "{confirmShare.name}" will be added to all {allLines.length} lines in this project.
                Each line will keep independent dates. The same color will be used everywhere.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={async () => { const a = confirmShare; setConfirmShare(null); await doShare(a); }}>
                Share
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Unshare confirm */}
      {confirmUnshare && (
        <AlertDialog open onOpenChange={(o) => !o && setConfirmUnshare(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove from all lines?</AlertDialogTitle>
              <AlertDialogDescription>
                This activity was originally shared from Line{" "}
                {String(allLines.find((l) => l.id === confirmUnshare.origin_line_id)?.number ?? "?").padStart(2, "0")}.
                Making it local will DELETE it from all other lines in the project.
                Only this line (Line {String(line.number).padStart(2, "0")}) will keep it, with its current dates.
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={async () => { const a = confirmUnshare; setConfirmUnshare(null); await doUnshare(a); }}>
                Make local on this line only
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <AlertDialog open onOpenChange={(o) => !o && setConfirmDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete "{confirmDelete.name}"?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDelete.is_shared
                  ? `This will delete the activity from this line only. Other lines keep their copies.`
                  : `This will permanently delete the activity from this line.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={async () => { const a = confirmDelete; setConfirmDelete(null); await doDelete(a); }}>
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function AddActivityForm({ onSubmit }: { onSubmit: (name: string, start: string, end: string) => Promise<void> }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState<Date | undefined>();
  const [end, setEnd] = useState<Date | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!start || !end) { toast.error("Pick start and end dates"); return; }
    setBusy(true);
    try {
      await onSubmit(name, format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd"));
      setName(""); setStart(undefined); setEnd(undefined);
    } finally { setBusy(false); }
  };

  return (
    <Card className="border-dashed">
      <CardContent className="p-4 space-y-3">
        <div className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Plus className="h-3 w-3" /> Add activity
        </div>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Activity name" />
        <div className="grid gap-2 sm:grid-cols-2">
          <DateField label="Start" date={start} onChange={setStart} />
          <DateField label="End" date={end} onChange={setEnd} />
        </div>
        <Button onClick={submit} disabled={busy} className="w-full sm:w-auto">
          <Plus className="mr-1 h-4 w-4" /> Add activity
        </Button>
      </CardContent>
    </Card>
  );
}

function EditActivityDialog({
  activity, onClose, onSaved,
}: { activity: LineActivity; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(activity.name);
  const [start, setStart] = useState<Date | undefined>(parseISO(activity.start_date));
  const [end, setEnd] = useState<Date | undefined>(parseISO(activity.end_date));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    if (!start || !end) { toast.error("Dates required"); return; }
    if (start > end) { toast.error("End must be after start"); return; }
    setBusy(true);
    const { error } = await supabase
      .from("line_activities")
      .update({ name: name.trim(), start_date: format(start, "yyyy-MM-dd"), end_date: format(end, "yyyy-MM-dd") })
      .eq("id", activity.id);
    setBusy(false);
    if (error) toast.error(toUserMessage(error));
    else { toast.success("Activity updated"); onSaved(); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit activity</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <DateField label="Start" date={start} onChange={setStart} />
            <DateField label="End" date={end} onChange={setEnd} />
          </div>
          {activity.is_shared && (
            <p className="text-xs text-muted-foreground rounded-md border bg-muted/30 px-3 py-2">
              This is a shared activity. Editing the name will only affect this line.
              Dates are always local to each line.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DateField({ label, date, onChange }: { label: string; date: Date | undefined; onChange: (d: Date | undefined) => void }) {
  return (
    <div>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
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
