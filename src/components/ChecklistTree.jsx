import { useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ChecklistTree as BaseChecklistTree,
  PhotoTile,
  FileChip,
} from "./ChecklistTree.tsx";

export { PhotoTile, FileChip };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "open", label: "Needs work" },
  { key: "flagged", label: "Flagged" },
  { key: "content", label: "With content" },
];

function hasContent(item) {
  return (
    (item.note ?? "").trim() !== "" ||
    (item.item_photos?.length ?? 0) > 0 ||
    (item.item_files?.length ?? 0) > 0
  );
}

function matches(item, filter) {
  if (filter === "open") return !item.done;
  if (filter === "flagged") return !!item.flagged;
  if (filter === "content") return hasContent(item);
  return true;
}

function filterCounts(items) {
  return items.reduce(
    (acc, item) => {
      if (item.deleted_at) return acc;
      acc.all += 1;
      if (!item.done) acc.open += 1;
      if (item.flagged) acc.flagged += 1;
      if (hasContent(item)) acc.content += 1;
      return acc;
    },
    { all: 0, open: 0, flagged: 0, content: 0 },
  );
}

function filterItems(items, filter) {
  if (filter === "all") return items;

  const byId = new Map(items.map((item) => [item.id, item]));
  const keep = new Set();

  const includeWithParents = (item) => {
    let cur = item;
    while (cur?.id && !keep.has(cur.id)) {
      keep.add(cur.id);
      cur = cur.parent_item_id ? byId.get(cur.parent_item_id) : null;
    }
  };

  for (const item of items) {
    if (!item.deleted_at && matches(item, filter)) includeWithParents(item);
  }

  return items.filter((item) => keep.has(item.id));
}

function ChecklistFilterButton({ label, count, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <span>{label}</span>
      <span className="font-mono tabular-nums opacity-80">{count}</span>
    </button>
  );
}

export function ChecklistTree(props) {
  const { items = [] } = props;
  const [showFilters, setShowFilters] = useState(false);
  const [filter, setFilter] = useState("all");

  const counts = useMemo(() => filterCounts(items), [items]);
  const visibleItems = useMemo(() => filterItems(items, filter), [items, filter]);
  const hasItems = counts.all > 0;

  return (
    <div className="space-y-2">
      {hasItems && (
        <div className="flex justify-end">
          <Button
            size="sm"
            variant={showFilters || filter !== "all" ? "default" : "outline"}
            onClick={() => setShowFilters((v) => !v)}
            title="Filter checklist"
            aria-label="Filter checklist"
          >
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      )}

      {hasItems && showFilters && (
        <div className="flex flex-wrap justify-end gap-1 rounded-md border bg-muted/20 px-2 py-2">
          {FILTERS.map((option) => (
            <ChecklistFilterButton
              key={option.key}
              label={option.label}
              count={counts[option.key]}
              active={filter === option.key}
              onClick={() => setFilter(option.key)}
            />
          ))}
        </div>
      )}

      {hasItems && visibleItems.length === 0 ? (
        <p className="rounded-md border bg-muted/20 px-3 py-3 text-sm text-muted-foreground">
          No checklist items match this filter.
        </p>
      ) : (
        <BaseChecklistTree
          {...props}
          items={visibleItems}
          defaultOpen={filter !== "all" || props.defaultOpen}
        />
      )}
    </div>
  );
}
