import { Flag } from "lucide-react";

/**
 * Compact red badge showing how many flagged ("problem") checklist items
 * exist below a node. Renders nothing when count is 0.
 */
export function FlagBadge({ count, className = "" }: { count: number; className?: string }) {
  if (!count) return null;
  return (
    <span
      title={`${count} flagged item${count > 1 ? "s" : ""}`}
      className={`inline-flex shrink-0 items-center gap-0.5 rounded-md border border-destructive/40 bg-destructive/10 px-1 py-0.5 font-mono text-[10px] font-semibold leading-none tabular-nums text-destructive ${className}`}
    >
      <Flag className="h-3 w-3 fill-current" />
      {count}
    </span>
  );
}
