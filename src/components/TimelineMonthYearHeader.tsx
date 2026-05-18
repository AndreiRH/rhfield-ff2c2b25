import { useMemo } from "react";
import {
  addDays, differenceInCalendarDays, eachMonthOfInterval, endOfMonth,
  format, startOfMonth, startOfYear, endOfYear,
} from "date-fns";

interface Props {
  scrollLeft: number;
  viewportW: number;
  rangeStart: Date;
  rangeEnd: Date;
  dayWidth: number;
}

/**
 * Sticky month + year header. Renders viewport-relative segments only,
 * never drifts with horizontal scroll. Place inside the horizontally
 * scrolling container with `position: sticky; left: 0; width: viewportW`.
 */
export function TimelineMonthYearHeader({
  scrollLeft, viewportW, rangeStart, rangeEnd, dayWidth,
}: Props) {
  const segs = useMemo(() => {
    if (viewportW <= 0) return { months: [], years: [] };
    const totalDays = differenceInCalendarDays(rangeEnd, rangeStart) + 1;
    const firstIdx = Math.max(0, Math.floor(scrollLeft / dayWidth));
    const lastIdx = Math.min(totalDays - 1, Math.ceil((scrollLeft + viewportW) / dayWidth) - 1);
    if (lastIdx < firstIdx) return { months: [], years: [] };
    const visStart = addDays(rangeStart, firstIdx);
    const visEnd = addDays(rangeStart, lastIdx);

    const clamp = (d: Date, lo: Date, hi: Date) => (d < lo ? lo : d > hi ? hi : d);
    const toViewportX = (d: Date) =>
      differenceInCalendarDays(d, rangeStart) * dayWidth - scrollLeft;

    const months = eachMonthOfInterval({ start: startOfMonth(visStart), end: visEnd }).map((m) => {
      const s = clamp(m, visStart, visEnd);
      const e = clamp(endOfMonth(m), visStart, visEnd);
      const left = toViewportX(s);
      const width = (differenceInCalendarDays(e, s) + 1) * dayWidth;
      return { key: m.toISOString(), label: format(m, "MMM"), left, width };
    });

    const yearMap = new Map<number, { start: Date; end: Date }>();
    let cursor = startOfMonth(visStart);
    while (cursor <= visEnd) {
      const y = cursor.getFullYear();
      const yStart = clamp(startOfYear(cursor), visStart, visEnd);
      const yEnd = clamp(endOfYear(cursor), visStart, visEnd);
      yearMap.set(y, { start: yStart, end: yEnd });
      cursor = addDays(endOfYear(cursor), 1);
    }
    const years = [...yearMap.entries()].map(([year, { start, end }]) => {
      const left = toViewportX(start);
      const width = (differenceInCalendarDays(end, start) + 1) * dayWidth;
      return { key: year, label: String(year), left, width };
    });

    return { months, years };
  }, [scrollLeft, viewportW, rangeStart, rangeEnd, dayWidth]);

  return (
    <div
      className="sticky left-0 z-20 bg-card"
      style={{ width: viewportW || "100%" }}
    >
      {/* Years */}
      <div className="relative border-b overflow-hidden" style={{ height: 22 }}>
        {segs.years.map((y) => (
          <div
            key={`y-${y.key}`}
            className="absolute top-0 flex items-center justify-center text-xs font-semibold"
            style={{ left: y.left, width: y.width, height: 22 }}
          >
            <span className="truncate px-1">{y.label}</span>
          </div>
        ))}
      </div>
      {/* Months */}
      <div className="relative border-b overflow-hidden" style={{ height: 22 }}>
        {segs.months.map((m) => (
          <div
            key={`m-${m.key}`}
            className="absolute top-0 flex items-center justify-center text-[11px] text-muted-foreground"
            style={{ left: m.left, width: m.width, height: 22 }}
          >
            <span className="truncate px-1">{m.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
