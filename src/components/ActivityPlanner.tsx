import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  format,
  parseISO,
  differenceInCalendarDays,
  endOfMonth,
  eachMonthOfInterval,
  startOfYear,
  eachDayOfInterval,
} from "date-fns";
import {
  Pencil,
  Copy,
  Lock,
  Trash2,
  Plus,
  CalendarIcon,
  Share2,
  GripVertical,
  X,
} from "lucide-react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { toUserMessage } from "@/lib/errors";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const DAY_WIDTH = 28;
const ROW_HEIGHT = 22;
const BAR_HEIGHT = 14;
const YEAR_HEADER_H = 22;
const MONTH_HEADER_H = 22;
const WEEKDAY_HEADER_H = 16;
const DAY_NUMBERS_HEADER_H = 22;
export const PALETTE = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#f97316",
  "#84cc16",
  "#ec4899",
  "#14b8a6",
  "#a855f7",
  "#22c55e",
  "#eab308",
  "#dc2626",
  "#0ea5e9",
  "#d946ef",
  "#f43f5e",
  "#65a30d",
  "#0891b2",
  "#7c3aed",
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
  show_on_global: boolean;
  created_by: string | null;
  created_at: string;
  sort_order: number;
}

export interface LineLite {
  id: string;
  number: number;
  name?: string | null;
}
export interface LineInfo extends LineLite {
  hot_planned_start: string | null;
  hot_planned_end: string | null;
}
interface DuplicateActivityRow {
  name: string;
  color: string;
  line_id: string;
}

export function ActivityPlanner({
  line,
  allLines,
  activities,
  canEdit,
  onChange,
}: {
  line: LineInfo;
  allLines: LineLite[];
  activities: LineActivity[];
  canEdit: boolean;
  onChange: () => void;
}) {
  const { user } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const mobileYearRowRef = useRef<HTMLDivElement>(null);
  const mobileMonthRowRef = useRef<HTMLDivElement>(null);
  const desktopYearRowRef = useRef<HTMLDivElement>(null);
  const [editing, setEditing] = useState<LineActivity | null>(null);
  const [duplicateConflict, setDuplicateConflict] = useState<{
    name: string;
    existingLineNumbers: number[];
    existingColor: string;
    start: string;
    end: string;
  } | null>(null);
  const [confirmShare, setConfirmShare] = useState<LineActivity | null>(null);
  const [confirmUnshare, setConfirmUnshare] = useState<LineActivity | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<LineActivity | null>(null);
  const [creating, setCreating] = useState(false);
  const [mode, setMode] = useState<"idle" | "copy" | "delete" | "reorder">("idle");

  const sorted = useMemo(
    () =>
      [...activities].sort((a, b) => {
        const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
        if (so !== 0) return so;
        return a.start_date.localeCompare(b.start_date);
      }),
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
  const months = useMemo(
    () => eachMonthOfInterval({ start: rangeStart, end: rangeEnd }),
    [rangeStart, rangeEnd],
  );
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
  }, [months, rangeEnd, rangeStart]);
  const days = useMemo(
    () => eachDayOfInterval({ start: rangeStart, end: rangeEnd }),
    [rangeStart, rangeEnd],
  );
  const mondays = useMemo(() => days.filter((d) => d.getDay() === 1), [days]);
  const weekendDays = useMemo(
    () => days.filter((d) => d.getDay() === 0 || d.getDay() === 6),
    [days],
  );

  const updateMobileHeader = () => {
    const el = scrollRef.current;
    if (!el) return;
    const visibleLeft = el.scrollLeft;
    const visibleRight = visibleLeft + el.clientWidth;
    const renderRow = (
      row: HTMLDivElement | null,
      segments: { key: string; label: string; startX: number; endX: number }[],
      textClass: string,
    ) => {
      if (!row) return;
      const children = segments.flatMap((segment) => {
        const left = Math.max(segment.startX, visibleLeft);
        const right = Math.min(segment.endX, visibleRight);
        const width = right - left;
        if (width <= 0) return [];
        const child = document.createElement("div");
        child.className = `flex h-full min-w-0 flex-none items-center justify-center ${textClass}`;
        child.style.width = `${width}px`;
        child.dataset.segmentKey = segment.key;
        const label = document.createElement("span");
        label.className = "truncate px-1";
        label.textContent = segment.label;
        child.appendChild(label);
        return [child];
      });
      children.forEach((child, index) => {
        if (index > 0) child.classList.add("border-l", "border-border/40");
      });
      row.replaceChildren(...children);
    };
    const yearSegments = years.map((y) => ({
      key: String(y.year),
      label: String(y.year),
      startX: dayToX(y.start),
      endX: dayToX(y.end) + DAY_WIDTH,
    }));
    renderRow(mobileYearRowRef.current, yearSegments, "text-xs font-semibold");
    renderRow(desktopYearRowRef.current, yearSegments, "text-xs font-semibold");
    renderRow(
      mobileMonthRowRef.current,
      months.map((m) => {
        const mStart = m < rangeStart ? rangeStart : m;
        const mEnd = endOfMonth(m) > rangeEnd ? rangeEnd : endOfMonth(m);
        return {
          key: m.toISOString(),
          label: format(m, "MMM"),
          startX: dayToX(mStart),
          endX: dayToX(mEnd) + DAY_WIDTH,
        };
      }),
      "text-[11px] text-muted-foreground",
    );
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const sync = () => updateMobileHeader();
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }, [months, years]);

  // Auto-scroll to today (or first activity) on mount
  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const focusX = sorted.length > 0 ? dayToX(parseISO(sorted[0].start_date)) : todayX;
    const target = Math.max(0, focusX - el.clientWidth / 2);
    el.scrollLeft = target;
    updateMobileHeader();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToActivity = (a: LineActivity) => {
    if (!scrollRef.current) return;
    const x = dayToX(parseISO(a.start_date));
    const w =
      (differenceInCalendarDays(parseISO(a.end_date), parseISO(a.start_date)) + 1) * DAY_WIDTH;
    const el = scrollRef.current;
    el.scrollTo({ left: Math.max(0, x + w / 2 - el.clientWidth / 2), behavior: "smooth" });
  };

  // Avoid color repeats on the same line — include shared + local activities.
  const usedColors = new Set(activities.map((a) => a.color));
  const nextColor = () =>
    PALETTE.find((c) => !usedColors.has(c)) ?? PALETTE[activities.length % PALETTE.length];

  // ---------- handlers ----------
  const nextSortOrder = () =>
    activities.length === 0
      ? 0
      : Math.max(...activities.map((a) => a.sort_order ?? 0)) + 1;

  const insertLocal = async (name: string, start: string, end: string, color?: string) => {
    const c = color ?? nextColor();
    const { error } = await supabase.from("line_activities").insert({
      line_id: line.id,
      name,
      start_date: start,
      end_date: end,
      color: c,
      is_shared: false,
      created_by: user?.id ?? null,
      show_on_global: false,
      sort_order: nextSortOrder(),
    });
    if (error) toast.error(toUserMessage(error));
    else {
      toast.success("Activity added");
      onChange();
    }
  };

  const insertSharedAcrossAll = async (name: string, start: string, end: string, color: string) => {
    const groupId = crypto.randomUUID();
    const rows = allLines.map((l) => ({
      line_id: l.id,
      name,
      start_date: start,
      end_date: end,
      color,
      is_shared: true,
      shared_group_id: groupId,
      origin_line_id: line.id,
      created_by: user?.id ?? null,
      show_on_global: l.id === line.id,
    }));
    const { error } = await supabase.from("line_activities").insert(rows);
    if (error) toast.error(toUserMessage(error));
    else {
      toast.success(`Shared "${name}" across ${allLines.length} lines`);
      onChange();
    }
  };

  const checkDuplicateAndAdd = async (
    name: string,
    start: string,
    end: string,
    shareGlobal: boolean,
  ) => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Activity name required");
      return;
    }
    if (!start || !end) {
      toast.error("Pick start and end dates");
      return;
    }
    if (start > end) {
      toast.error("End date must be after start");
      return;
    }
    const otherLineIds = allLines.filter((l) => l.id !== line.id).map((l) => l.id);
    if (otherLineIds.length > 0) {
      const { data } = await supabase
        .from("line_activities")
        .select("name, color, line_id")
        .in("line_id", otherLineIds)
        .ilike("name", trimmed);
      const dupes = ((data ?? []) as DuplicateActivityRow[]).filter(
        (r) => r.name.toLowerCase() === trimmed.toLowerCase(),
      );
      if (dupes.length > 0) {
        const lineNumbers = dupes
          .map((d) => allLines.find((l) => l.id === d.line_id)?.number)
          .filter((n): n is number => typeof n === "number");
        setDuplicateConflict({
          name: trimmed,
          existingLineNumbers: lineNumbers,
          existingColor: dupes[0].color,
          start,
          end,
        });
        return;
      }
    }
    if (shareGlobal && allLines.length > 1) {
      await insertSharedAcrossAll(trimmed, start, end, nextColor());
    } else {
      await insertLocal(trimmed, start, end);
    }
  };

  const doShare = async (a: LineActivity) => {
    const groupId = crypto.randomUUID();
    const { error: updErr } = await supabase
      .from("line_activities")
      .update({ is_shared: true, shared_group_id: groupId, origin_line_id: line.id })
      .eq("id", a.id);
    if (updErr) {
      toast.error(toUserMessage(updErr));
      return;
    }
    const others = allLines.filter((l) => l.id !== line.id);
    if (others.length > 0) {
      const rows = others.map((l) => ({
        line_id: l.id,
        name: a.name,
        start_date: a.start_date,
        end_date: a.end_date,
        color: a.color,
        is_shared: true,
        shared_group_id: groupId,
        origin_line_id: line.id,
        created_by: user?.id ?? null,
        show_on_global: false,
      }));
      const { error } = await supabase.from("line_activities").insert(rows);
      if (error) {
        toast.error(toUserMessage(error));
        return;
      }
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
    if (delErr) {
      toast.error(toUserMessage(delErr));
      return;
    }
    const { error: updErr } = await supabase
      .from("line_activities")
      .update({ is_shared: false, shared_group_id: null, origin_line_id: null })
      .eq("id", a.id);
    if (updErr) {
      toast.error(toUserMessage(updErr));
      return;
    }
    toast.success("Now local to this line");
    onChange();
  };

  const doDelete = async (a: LineActivity) => {
    const { error } = await supabase.from("line_activities").delete().eq("id", a.id);
    if (error) toast.error(toUserMessage(error));
    else {
      toast.success("Activity deleted");
      onChange();
    }
  };

  const doDuplicate = async (a: LineActivity) => {
    await insertLocal(a.name, a.start_date, a.end_date);
  };

  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } }),
  );

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = sorted.findIndex((x) => x.id === active.id);
    const newIdx = sorted.findIndex((x) => x.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(sorted, oldIdx, newIdx);
    const updates = await Promise.all(
      next.map((row, i) =>
        supabase.from("line_activities").update({ sort_order: i }).eq("id", row.id),
      ),
    );
    const err = updates.find((u) => u.error)?.error;
    if (err) toast.error(toUserMessage(err));
    else onChange();
  };

  const bodyHeight = Math.max(sorted.length * ROW_HEIGHT, 120);
  const headerHeight = YEAR_HEADER_H + MONTH_HEADER_H + WEEKDAY_HEADER_H + DAY_NUMBERS_HEADER_H;
  const weekSeparatorTop = YEAR_HEADER_H + MONTH_HEADER_H + WEEKDAY_HEADER_H;
  const weekSeparatorHeight = DAY_NUMBERS_HEADER_H + bodyHeight;

  return (
    <div className="space-y-6">
      {/* Gantt timeline */}
      <Card>
        <CardContent className="p-0">
          <div className="relative">
            <div className="absolute left-0 right-0 top-0 z-30 border-b bg-card md:hidden">
              <div
                ref={mobileYearRowRef}
                className="flex overflow-hidden border-b border-border/40"
                style={{ height: YEAR_HEADER_H }}
              />
              <div
                ref={mobileMonthRowRef}
                className="flex overflow-hidden"
                style={{ height: MONTH_HEADER_H }}
              />
            </div>
            <div ref={scrollRef} className="overflow-x-auto">
            <div className="relative" style={{ width: timelineWidth, minWidth: "100%" }}>
              {mondays.map((d) => (
                <div
                  key={`wk-full-${d.toISOString()}`}
                  className="absolute z-20 pointer-events-none bg-muted-foreground/30"
                  style={{
                    left: dayToX(d),
                    top: weekSeparatorTop,
                    width: 1,
                    height: weekSeparatorHeight,
                  }}
                />
              ))}

              {/* Full timeline header */}
              <div className="border-b bg-card">
                {/* Years */}
                <div className="relative border-b" style={{ height: YEAR_HEADER_H }}>
                  {years.map((y) => {
                    const left = dayToX(y.start);
                    const width = (differenceInCalendarDays(y.end, y.start) + 1) * DAY_WIDTH;
                    return (
                      <div
                        key={`yr-${y.year}`}
                        className="absolute top-0 hidden items-center justify-center border-r border-border/40 text-xs font-semibold md:flex"
                        style={{ left, width, height: YEAR_HEADER_H }}
                      >
                        <span className="truncate px-1">{y.year}</span>
                      </div>
                    );
                  })}
                </div>
                {/* Months */}
                <div className="relative border-b" style={{ height: MONTH_HEADER_H }}>
                  {months.map((m) => {
                    const mStart = m < rangeStart ? rangeStart : m;
                    const mEnd = endOfMonth(m) > rangeEnd ? rangeEnd : endOfMonth(m);
                    const left = dayToX(mStart);
                    const width = (differenceInCalendarDays(mEnd, mStart) + 1) * DAY_WIDTH;
                    return (
                      <div
                        key={`mo-${m.toISOString()}`}
                        className="absolute top-0 hidden items-center justify-center border-r border-border/40 text-[11px] text-muted-foreground md:flex"
                        style={{ left, width, height: MONTH_HEADER_H }}
                      >
                        <span className="truncate px-1">{format(m, "MMM")}</span>
                      </div>
                    );
                  })}
                </div>
                {/* Weekday letters */}
                <div className="relative border-b" style={{ height: WEEKDAY_HEADER_H }}>
                  {days.map((d) => {
                    const dow = d.getDay(); // 0=Sun..6=Sat
                    const letter = ["S", "M", "T", "W", "T", "F", "S"][dow];
                    const isWeekend = dow === 0 || dow === 6;
                    return (
                      <div
                        key={`wd-${d.toISOString()}`}
                        className={cn(
                          "absolute top-0 text-center text-[9px] font-medium uppercase",
                          isWeekend ? "text-primary/70" : "text-muted-foreground/70",
                        )}
                        style={{
                          left: dayToX(d),
                          width: DAY_WIDTH,
                          height: WEEKDAY_HEADER_H,
                          lineHeight: `${WEEKDAY_HEADER_H}px`,
                        }}
                      >
                        {letter}
                      </div>
                    );
                  })}
                </div>
                {/* Days */}
                <div className="relative" style={{ height: DAY_NUMBERS_HEADER_H }}>
                  {days.map((d) => {
                    const isToday = format(d, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");
                    const isFirst = d.getDate() === 1;
                    const dow = d.getDay();
                    const isWeekend = dow === 0 || dow === 6;
                    return (
                      <div
                        key={d.toISOString()}
                        className={cn(
                          "absolute top-0 text-center text-[10px] tabular-nums border-r",
                          isFirst ? "border-border" : "border-border/30",
                          isToday
                            ? "bg-primary text-primary-foreground font-semibold"
                            : isWeekend
                              ? "text-foreground/70 bg-muted/40"
                              : "text-muted-foreground",
                        )}
                        style={{
                          left: dayToX(d),
                          width: DAY_WIDTH,
                          height: DAY_NUMBERS_HEADER_H,
                          lineHeight: `${DAY_NUMBERS_HEADER_H}px`,
                        }}
                      >
                        {d.getDate()}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Body */}
              <div className="relative" style={{ height: bodyHeight }}>
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
                        left,
                        width,
                        background: i % 2 === 0 ? "hsl(var(--muted) / 0.3)" : "transparent",
                      }}
                    />
                  );
                })}

                {/* Weekend column shading */}
                {weekendDays.map((d) => (
                  <div
                    key={`we-body-${d.toISOString()}`}
                    className="absolute top-0 bottom-0 pointer-events-none bg-muted/40"
                    style={{ left: dayToX(d), width: DAY_WIDTH }}
                  />
                ))}

                {/* Hot planned band */}
                {line.hot_planned_start && line.hot_planned_end && (
                  <div
                    className="absolute top-0 bottom-0"
                    style={{
                      left: dayToX(parseISO(line.hot_planned_start)),
                      width:
                        (differenceInCalendarDays(
                          parseISO(line.hot_planned_end),
                          parseISO(line.hot_planned_start),
                        ) +
                          1) *
                        DAY_WIDTH,
                      background: "hsl(var(--primary) / 0.08)",
                    }}
                    title="Hot commissioning planned window"
                  />
                )}

                {/* Today line */}
                {todayX >= 0 && todayX <= timelineWidth && (
                  <div
                    className="absolute top-0 bottom-0 pointer-events-none"
                    style={{ left: todayX, width: 2, background: "hsl(var(--primary) / 0.6)" }}
                  />
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
                      className="absolute rounded-full flex items-center px-2 overflow-hidden hover:ring-2 hover:ring-foreground/30 transition"
                      style={{
                        left,
                        width,
                        top: i * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
                        height: BAR_HEIGHT,
                        background: a.color,
                      }}
                    >
                      <span className="text-[10px] font-medium text-white truncate leading-none">
                        {a.name}
                      </span>
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
          </div>
        </CardContent>
      </Card>

      {/* Activity list */}
      <div>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-muted-foreground">Activities</h3>
          {canEdit && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setMode((m) => (m === "copy" ? "idle" : "copy"))}
                title={mode === "copy" ? "Exit duplicate mode" : "Duplicate an activity"}
                aria-label="Duplicate mode"
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded border transition",
                  mode === "copy"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40",
                )}
              >
                {mode === "copy" ? <X className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setMode((m) => (m === "delete" ? "idle" : "delete"))}
                title={mode === "delete" ? "Exit delete mode" : "Delete an activity"}
                aria-label="Delete mode"
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded border transition",
                  mode === "delete"
                    ? "border-destructive bg-destructive/10 text-destructive"
                    : "border-border text-muted-foreground hover:text-destructive hover:border-destructive/40",
                )}
              >
                {mode === "delete" ? <X className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5" />}
              </button>
              <button
                type="button"
                onClick={() => setMode((m) => (m === "reorder" ? "idle" : "reorder"))}
                title={mode === "reorder" ? "Done reordering" : "Reorder activities"}
                aria-label="Reorder mode"
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded border transition",
                  mode === "reorder"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40",
                )}
              >
                {mode === "reorder" ? <X className="h-3.5 w-3.5" /> : <GripVertical className="h-3.5 w-3.5" />}
              </button>
              <Button
                size="icon"
                onClick={() => { setMode("idle"); setCreating(true); }}
                className="h-7 w-7 bg-blue-600 hover:bg-blue-700 text-white"
                title="Add activity"
                aria-label="Add activity"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
        {mode !== "idle" && (
          <p className="mb-2 text-[11px] text-muted-foreground">
            {mode === "copy" && "Click an activity to duplicate it on this line."}
            {mode === "delete" && "Click an activity to delete it."}
            {mode === "reorder" && "Drag an activity by the handle to reorder. The calendar follows this order."}
          </p>
        )}
        {sorted.length === 0 ? (
          <p className="text-sm text-muted-foreground">No activities scheduled.</p>
        ) : (
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={sorted.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <ul className="space-y-1">
                {sorted.map((a) => (
                  <SortableActivityRow
                    key={a.id}
                    a={a}
                    mode={mode}
                    canEdit={canEdit}
                    onScrollTo={() => scrollToActivity(a)}
                    onDuplicate={() => doDuplicate(a)}
                    onDelete={() => setConfirmDelete(a)}
                    onEdit={() => setEditing(a)}
                    onToggleShare={() => (a.is_shared ? setConfirmUnshare(a) : setConfirmShare(a))}
                    onToggleGlobal={async () => {
                      const { error } = await supabase
                        .from("line_activities")
                        .update({ show_on_global: !a.show_on_global })
                        .eq("id", a.id);
                      if (error) toast.error(toUserMessage(error));
                      else {
                        toast.success(
                          a.show_on_global
                            ? "Hidden from global calendar"
                            : "Shown on global calendar",
                        );
                        onChange();
                      }
                    }}
                  />
                ))}
              </ul>
            </SortableContext>
          </DndContext>
        )}
      </div>

      {/* Create dialog */}
      {creating && (
        <CreateActivityDialog
          onClose={() => setCreating(false)}
          onSubmit={async (name, start, end) => {
            await checkDuplicateAndAdd(name, start, end, false);
            setCreating(false);
          }}
        />
      )}

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
                  await insertLocal(
                    duplicateConflict.name,
                    duplicateConflict.start,
                    duplicateConflict.end,
                  );
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
          onSaved={() => {
            setEditing(null);
            onChange();
          }}
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
              <AlertDialogAction
                onClick={async () => {
                  const a = confirmShare;
                  setConfirmShare(null);
                  await doShare(a);
                }}
              >
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
                {String(
                  allLines.find((l) => l.id === confirmUnshare.origin_line_id)?.number ?? "?",
                ).padStart(2, "0")}
                . Making it local will DELETE it from all other lines in the project. Only this line
                (Line {String(line.number).padStart(2, "0")}) will keep it, with its current dates.
                This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  const a = confirmUnshare;
                  setConfirmUnshare(null);
                  await doUnshare(a);
                }}
              >
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
              <AlertDialogAction
                onClick={async () => {
                  const a = confirmDelete;
                  setConfirmDelete(null);
                  await doDelete(a);
                }}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </div>
  );
}

function CreateActivityDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (name: string, start: string, end: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [start, setStart] = useState<Date | undefined>();
  const [end, setEnd] = useState<Date | undefined>();
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Activity name required");
      return;
    }
    if (!start || !end) {
      toast.error("Pick start and end dates");
      return;
    }
    if (start > end) {
      toast.error("End must be after start");
      return;
    }
    setBusy(true);
    try {
      await onSubmit(name.trim(), format(start, "yyyy-MM-dd"), format(end, "yyyy-MM-dd"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New activity</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">Name</Label>
            <Input
              value={name}
              autoFocus
              onChange={(e) => setName(e.target.value)}
              placeholder="Activity name"
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <DateField label="Start" date={start} onChange={setStart} />
            <DateField label="End" date={end} onChange={setEnd} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            <Plus className="mr-1 h-4 w-4" /> Add activity
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditActivityDialog({
  activity,
  onClose,
  onSaved,
}: {
  activity: LineActivity;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(activity.name);
  const [start, setStart] = useState<Date | undefined>(parseISO(activity.start_date));
  const [end, setEnd] = useState<Date | undefined>(parseISO(activity.end_date));
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) {
      toast.error("Name required");
      return;
    }
    if (!start || !end) {
      toast.error("Dates required");
      return;
    }
    if (start > end) {
      toast.error("End must be after start");
      return;
    }
    setBusy(true);
    const { error } = await supabase
      .from("line_activities")
      .update({
        name: name.trim(),
        start_date: format(start, "yyyy-MM-dd"),
        end_date: format(end, "yyyy-MM-dd"),
      })
      .eq("id", activity.id);
    setBusy(false);
    if (error) toast.error(toUserMessage(error));
    else {
      toast.success("Activity updated");
      onSaved();
    }
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
              This is a shared activity. Editing the name will only affect this line. Dates are
              always local to each line.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DateField({
  label,
  date,
  onChange,
}: {
  label: string;
  date: Date | undefined;
  onChange: (d: Date | undefined) => void;
}) {
  return (
    <div>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-left font-normal">
            <CalendarIcon className="mr-2 h-4 w-4" />
            {date ? (
              format(date, "d MMM yyyy")
            ) : (
              <span className="text-muted-foreground">Pick a date</span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={onChange}
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function SortableActivityRow({
  a,
  mode,
  canEdit,
  onScrollTo,
  onDuplicate,
  onDelete,
  onEdit,
  onToggleShare,
  onToggleGlobal,
}: {
  a: LineActivity;
  mode: "idle" | "copy" | "delete" | "reorder";
  canEdit: boolean;
  onScrollTo: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onToggleShare: () => void;
  onToggleGlobal: () => void;
}) {
  const disabled = !canEdit || mode !== "reorder";
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: a.id,
    disabled,
  });
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    borderColor: a.color,
    opacity: isDragging ? 0.6 : 1,
  };
  const rowClick =
    mode === "copy"
      ? onDuplicate
      : mode === "delete"
      ? onDelete
      : mode === "reorder"
      ? undefined
      : onScrollTo;
  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "rounded-md border-2 bg-card px-2 py-0.5 text-xs transition",
        rowClick && "cursor-pointer hover:brightness-105",
        mode === "copy" && "hover:bg-primary/5",
        mode === "delete" && "hover:bg-destructive/10",
      )}
      onClick={rowClick}
    >
      <div className="flex items-center gap-2">
        {canEdit && mode === "reorder" && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            onClick={(e) => e.stopPropagation()}
            title="Drag to reorder"
            aria-label="Drag handle"
            className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none shrink-0"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        )}
        {canEdit && mode === "idle" && (
          <div
            className="flex items-center gap-0.5 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onEdit}
              title="Edit"
              className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onToggleShare}
              title={
                a.is_shared
                  ? "Shared across all lines — click to make local"
                  : "Share across all lines"
              }
              className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded hover:text-foreground",
                a.is_shared ? "text-primary" : "text-muted-foreground",
              )}
            >
              {a.is_shared ? <Share2 className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
            </button>
          </div>
        )}
        <span className="font-medium flex-1 min-w-0 truncate" style={{ color: a.color }}>
          {a.name}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground hidden sm:inline shrink-0">
          {format(parseISO(a.start_date), "d MMM yy")} → {format(parseISO(a.end_date), "d MMM yy")}
        </span>
        {canEdit && mode === "idle" && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleGlobal();
            }}
            title={
              a.show_on_global
                ? "Visible on global calendar — click to hide"
                : "Hidden from global calendar — click to show"
            }
            className={cn(
              "shrink-0 inline-flex h-5 items-center gap-1 rounded px-1.5 text-[10px] font-medium uppercase tracking-wide border transition",
              a.show_on_global
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/40",
            )}
          >
            <CalendarIcon className="h-3 w-3" />
            <span>{a.show_on_global ? "Global" : "Local"}</span>
          </button>
        )}
      </div>
    </li>
  );
}
