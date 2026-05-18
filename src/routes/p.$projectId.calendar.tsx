import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import {
  format, parseISO, differenceInCalendarDays, endOfMonth,
  eachMonthOfInterval, eachDayOfInterval, startOfYear,
} from "date-fns";
import { cn } from "@/lib/utils";

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
        .from("line_activities").select("id, line_id, start_date, end_date, name, color")
        .in("line_id", list.map((l) => l.id))
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

  const actsByLine = useMemo(() => {
    const m = new Map<string, Activity[]>();
    for (const a of activities) {
      if (!m.has(a.line_id)) m.set(a.line_id, []);
      m.get(a.line_id)!.push(a);
    }
    return m;
  }, [activities]);

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

  const bodyHeight = Math.max(lines.length * ROW_HEIGHT, 60);
  const center = scrollLeft + viewportW / 2;
  // header rows: year (22) + month (22) + weekday (16) + day (22) = 82
  const HEADER_H = 22 + 22 + 16 + 22;

  return (
    <div className="rounded-md border bg-card overflow-hidden">
      <div className="flex">
        {/* Sticky left line labels */}
        <div className="shrink-0 border-r bg-card" style={{ width: LINE_LABEL_W }}>
          <div className="border-b" style={{ height: HEADER_H }} />
          {lines.map((l) => (
            <div
              key={l.id}
              className="flex items-center px-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground border-b"
              style={{ height: ROW_HEIGHT }}
            >
              Line {String(l.number).padStart(2, "0")}
            </div>
          ))}
        </div>

        {/* Scrollable timeline */}
        <div ref={scrollRef} className="overflow-x-auto flex-1">
          <div className="relative" style={{ width: timelineWidth, minWidth: "100%" }}>
            {/* Header */}
            <div className="sticky top-0 z-10 bg-card border-b">
              {/* Years */}
              <div className="relative border-b" style={{ height: 22 }}>
                {years.map((y) => {
                  const left = dayToX(y.start);
                  const width = (differenceInCalendarDays(y.end, y.start) + 1) * DAY_WIDTH;
                  const labelW = Math.min(YEAR_LABEL_W, width);
                  const ideal = center - labelW / 2;
                  const clamped = Math.max(left, Math.min(left + width - labelW, ideal));
                  return (
                    <div key={y.year} className="absolute top-0 border-r h-full" style={{ left, width }}>
                      <div
                        className="absolute top-0 h-full text-xs font-semibold text-center"
                        style={{ left: clamped - left, width: labelW, lineHeight: "22px" }}
                      >
                        {y.year}
                      </div>
                    </div>
                  );
                })}
              </div>
              {/* Months */}
              <div className="relative border-b" style={{ height: 22 }}>
                {months.map((m) => {
                  const mStart = m < RANGE_START ? RANGE_START : m;
                  const mEnd = endOfMonth(m) > RANGE_END ? RANGE_END : endOfMonth(m);
                  const left = dayToX(mStart);
                  const width = (differenceInCalendarDays(mEnd, mStart) + 1) * DAY_WIDTH;
                  const labelW = Math.min(MONTH_LABEL_W, width);
                  const ideal = center - labelW / 2;
                  const clamped = Math.max(left, Math.min(left + width - labelW, ideal));
                  return (
                    <div key={m.toISOString()} className="absolute top-0 border-r h-full" style={{ left, width }}>
                      <div
                        className="absolute top-0 h-full text-[11px] text-muted-foreground text-center truncate"
                        style={{ left: clamped - left, width: labelW, lineHeight: "22px" }}
                      >
                        {format(m, "MMM")}
                      </div>
                    </div>
                  );
                })}
              </div>
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
                          : isWeekend ? "text-foreground/70 bg-muted/40" : "text-muted-foreground",
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

              {lines.map((l, i) => (
                <div
                  key={`sep-${l.id}`}
                  className="absolute left-0 right-0 border-b border-border/40"
                  style={{ top: (i + 1) * ROW_HEIGHT - 1, height: 1 }}
                />
              ))}

              {todayX >= 0 && todayX <= timelineWidth && (
                <div
                  className="absolute top-0 bottom-0 pointer-events-none"
                  style={{ left: todayX, width: 2, background: "hsl(var(--primary) / 0.6)" }}
                />
              )}

              {lines.map((l, rowIdx) => {
                const acts = actsByLine.get(l.id) ?? [];
                return acts.map((a) => {
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
                        top: rowIdx * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2,
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
