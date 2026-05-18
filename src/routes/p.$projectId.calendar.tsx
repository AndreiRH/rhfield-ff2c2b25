import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { ChevronLeft, Info } from "lucide-react";
import {
  format, parseISO, differenceInCalendarDays, endOfMonth,
  eachMonthOfInterval, eachDayOfInterval, startOfYear,
} from "date-fns";
import { cn } from "@/lib/utils";
import { TimelineMonthYearHeader } from "@/components/TimelineMonthYearHeader";

interface LineLite { id: string; number: number; name: string | null }
interface Activity { id: string; line_id: string; start_date: string; end_date: string; name: string; color: string }

const DAY_WIDTH = 28;
const ROW_HEIGHT = 22;
const BAR_HEIGHT = 14;
const MONTH_LABEL_W = 78;
const YEAR_LABEL_W = 48;
const LINE_LABEL_W = 70;
const RANGE_START = new Date(2026, 0, 1);
const RANGE_END = new Date(2049, 11, 31);

export const Route = createFileRoute("/p/$projectId/calendar")({
  component: ProjectCalendarPage,
});

function ProjectCalendarPage() {
  const { projectId } = Route.useParams();
  const { session, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && !session) navigate({ to: "/login" }); }, [session, loading, navigate]);
  if (!session) return null;

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-7xl px-4 py-6">
        <div className="mb-6 border-b pb-4">
          <Button asChild variant="ghost" size="sm" className="mb-2 -ml-2 h-7 gap-1 text-muted-foreground">
            <Link to="/p/$projectId" params={{ projectId }}>
              <ChevronLeft className="h-4 w-4" /> Back to project
            </Link>
          </Button>
          <h1 className="text-3xl font-semibold">Global hot commissioning calendar</h1>
          <p className="mt-1 text-sm text-muted-foreground">All activities across every production line.</p>
        </div>
        <CombinedGantt projectId={projectId} />
        <div className="mt-4 flex items-start gap-2 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 shrink-0 text-primary" />
          <span>
            This view is read-only. Activities can be added, edited, or removed only inside each
            <span className="font-medium text-foreground"> Line hot commissioning planner</span>.
          </span>
        </div>
      </main>
    </div>
  );
}

function CombinedGantt({ projectId }: { projectId: string }) {
  const [lines, setLines] = useState<LineLite[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewportW, setViewportW] = useState(0);

  useEffect(() => {
    (async () => {
      const { data: ls } = await supabase
        .from("lines").select("id, number, name").eq("project_id", projectId).order("number");
      const list = (ls ?? []) as LineLite[];
      setLines(list);
      if (list.length === 0) { setActivities([]); return; }
      const { data: acts } = await supabase
        .from("line_activities").select("id, line_id, start_date, end_date, name, color, show_on_global")
        .in("line_id", list.map((l) => l.id))
        .eq("show_on_global", true)
        .order("start_date");
      setActivities((acts ?? []) as Activity[]);
    })();
  }, [projectId]);

  const totalDays = differenceInCalendarDays(RANGE_END, RANGE_START) + 1;
  const dayToX = (d: Date) => differenceInCalendarDays(d, RANGE_START) * DAY_WIDTH;
  const todayX = dayToX(new Date());
  const timelineWidth = totalDays * DAY_WIDTH;

  const months = useMemo(() => eachMonthOfInterval({ start: RANGE_START, end: RANGE_END }), []);
  const days = useMemo(() => eachDayOfInterval({ start: RANGE_START, end: RANGE_END }), []);
  const mondays = useMemo(() => days.filter((d) => d.getDay() === 1), [days]);
  const years = useMemo(() => {
    const map = new Map<number, { start: Date; end: Date }>();
    for (const m of months) {
      const y = m.getFullYear();
      if (!map.has(y)) map.set(y, { start: startOfYear(m), end: m });
      map.get(y)!.end = endOfMonth(m);
    }
    return [...map.entries()].map(([year, { start, end }]) => ({
      year,
      start: start < RANGE_START ? RANGE_START : start,
      end: end > RANGE_END ? RANGE_END : end,
    }));
  }, [months]);

  // Lane-pack activities per line so overlapping ones stack into multiple rows.
  const linePacks = useMemo(() => {
    const result = new Map<string, { lanes: number; placed: (Activity & { lane: number })[] }>();
    for (const l of lines) {
      const acts = activities
        .filter((a) => a.line_id === l.id)
        .sort((a, b) => a.start_date.localeCompare(b.start_date));
      const laneEnds: string[] = [];
      const placed: (Activity & { lane: number })[] = [];
      for (const a of acts) {
        let lane = laneEnds.findIndex((endDate) => endDate < a.start_date);
        if (lane === -1) { lane = laneEnds.length; laneEnds.push(a.end_date); }
        else laneEnds[lane] = a.end_date;
        placed.push({ ...a, lane });
      }
      result.set(l.id, { lanes: Math.max(1, laneEnds.length), placed });
    }
    return result;
  }, [lines, activities]);

  const lineRowInfo = useMemo(() => {
    let top = 0;
    return lines.map((l) => {
      const lanes = linePacks.get(l.id)?.lanes ?? 1;
      const height = lanes * ROW_HEIGHT;
      const info = { id: l.id, top, height, lanes };
      top += height;
      return info;
    });
  }, [lines, linePacks]);

  const bodyHeight = Math.max(lineRowInfo.reduce((acc, l) => acc + l.height, 0), 60);

  useEffect(() => {
    if (!scrollRef.current) return;
    const el = scrollRef.current;
    const target = Math.max(0, todayX - el.clientWidth / 2);
    el.scrollLeft = target;
    setScrollLeft(target);
    setViewportW(el.clientWidth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines.length]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; setScrollLeft(el.scrollLeft); });
    };
    const onResize = () => setViewportW(el.clientWidth);
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    setViewportW(el.clientWidth);
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  if (lines.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No production lines yet.</p>;
  }

  const center = scrollLeft + viewportW / 2;
  // Day-grid header (weekday letters + day numbers) inside the scroll area
  const DAY_HEADER_H = 16 + 22;
  // Month + year header — fixed, OUTSIDE the scroll container
  const FIXED_HEADER_H = 22 + 22;

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      {/* Top fixed header row: spacer over line labels + month/year overlay over timeline */}
      <div className="flex border-b">
        <div className="shrink-0 border-r bg-card" style={{ width: LINE_LABEL_W, height: FIXED_HEADER_H }} />
        <div className="flex-1 min-w-0 overflow-hidden">
          <TimelineMonthYearHeader
            scrollLeft={scrollLeft}
            viewportW={viewportW}
            rangeStart={RANGE_START}
            rangeEnd={RANGE_END}
            dayWidth={DAY_WIDTH}
          />
        </div>
      </div>

      <div className="flex">
        {/* Sticky left line labels */}
        <div className="shrink-0 border-r bg-card" style={{ width: LINE_LABEL_W }}>
          <div className="border-b" style={{ height: DAY_HEADER_H }} />
          {lines.map((l, i) => {
            const info = lineRowInfo[i];
            return (
              <Link
                key={l.id}
                to="/p/$projectId/lines/$lineNumber/calendar"
                params={{ projectId, lineNumber: String(l.number) }}
                className="flex items-center px-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground border-b hover:bg-muted/40 hover:text-foreground transition-colors"
                style={{ height: info.height }}
              >
                Line {String(l.number).padStart(2, "0")}
              </Link>
            );
          })}
        </div>

        {/* Scrollable timeline */}
        <div ref={scrollRef} className="overflow-x-auto flex-1">
          <div className="relative" style={{ width: timelineWidth, minWidth: "100%" }}>
            {/* Header */}
            <div className="sticky top-0 z-10 bg-card border-b">
              <TimelineMonthYearHeader
                scrollLeft={scrollLeft}
                viewportW={viewportW}
                rangeStart={RANGE_START}
                rangeEnd={RANGE_END}
                dayWidth={DAY_WIDTH}
              />
              {/* Weekday letters */}
              <div className="relative border-b" style={{ height: 16 }}>
                {days.map((d) => {
                  const dow = d.getDay();
                  const letter = ["S", "M", "T", "W", "T", "F", "S"][dow];
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <div
                      key={`wd-${d.toISOString()}`}
                      className={cn(
                        "absolute top-0 text-center text-[9px] font-medium uppercase",
                        isWeekend ? "text-primary/70" : "text-muted-foreground/70",
                      )}
                      style={{ left: dayToX(d), width: DAY_WIDTH, height: 16, lineHeight: "16px" }}
                    >
                      {letter}
                    </div>
                  );
                })}
              </div>
              {/* Days */}
              <div className="relative" style={{ height: 22 }}>
                {days.map((d) => {
                  const isFirst = d.getDate() === 1;
                  const dow = d.getDay();
                  const isWeekend = dow === 0 || dow === 6;
                  return (
                    <div
                      key={d.toISOString()}
                      className={cn(
                        "absolute top-0 text-center text-[10px] tabular-nums border-r",
                        isFirst ? "border-border" : "border-border/30",
                        isWeekend ? "text-foreground/70 bg-muted/40" : "text-muted-foreground",
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
            <div className="relative" style={{ height: bodyHeight }}>
              {months.map((m, i) => {
                const mStart = m < RANGE_START ? RANGE_START : m;
                const mEnd = endOfMonth(m) > RANGE_END ? RANGE_END : endOfMonth(m);
                const left = dayToX(mStart);
                const width = (differenceInCalendarDays(mEnd, mStart) + 1) * DAY_WIDTH;
                return (
                  <div
                    key={`bg-${m.toISOString()}`}
                    className="absolute top-0 bottom-0"
                    style={{ left, width, background: i % 2 === 0 ? "hsl(var(--muted) / 0.3)" : "transparent" }}
                  />
                );
              })}

              {/* Week separators (before each Monday) */}
              {mondays.map((d) => (
                <div
                  key={`wk-${d.toISOString()}`}
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: dayToX(d), width: 1, background: "hsl(var(--border) / 0.7)" }}
                />
              ))}

              {lineRowInfo.map((info) => (
                <div
                  key={`sep-${info.id}`}
                  className="absolute left-0 right-0 border-b border-border/40"
                  style={{ top: info.top + info.height - 1, height: 1 }}
                />
              ))}

              {todayX >= 0 && todayX <= timelineWidth && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: todayX, width: 2, background: "hsl(var(--primary) / 0.6)" }}
                />
              )}

              {lineRowInfo.map((info, i) => {
                const l = lines[i];
                const pack = linePacks.get(l.id);
                if (!pack) return null;
                return pack.placed.map((a) => {
                  const s = parseISO(a.start_date);
                  const e = parseISO(a.end_date);
                  const left = dayToX(s);
                  const width = Math.max((differenceInCalendarDays(e, s) + 1) * DAY_WIDTH, 8);
                  return (
                    <div
                      key={a.id}
                      title={`Line ${String(l.number).padStart(2, "0")} · ${a.name} · ${format(s, "d MMM yyyy")} → ${format(e, "d MMM yyyy")}`}
                      className="absolute rounded-full flex items-center px-2 overflow-hidden"
                      style={{
                        left, width,
                        top: info.top + a.lane * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
                        height: BAR_HEIGHT,
                        background: a.color,
                      }}
                    >
                      <span className="text-[10px] font-medium text-white truncate leading-none">{a.name}</span>
                    </div>
                  );
                });
              })}
            </div>
          </div>
        </div>
      </div>
      {activities.length === 0 && (
        <p className="p-4 text-sm text-muted-foreground">No activities scheduled yet.</p>
      )}
    </div>
  );
}
