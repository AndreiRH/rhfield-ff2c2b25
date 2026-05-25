import { createElement, useMemo, useState } from "react";
import { Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { liveChecklistItems } from "@/lib/progress";
import { ComponentTypesTree as BaseComponentTypesTree } from "./ComponentTypesTree.tsx";

type FilterMode = "all" | "open" | "flagged" | "content";

const FILTERS: Array<{ key: FilterMode; label: string }> = [
  { key: "all", label: "All" },
  { key: "open", label: "Needs work" },
  { key: "flagged", label: "Flagged" },
  { key: "content", label: "With content" },
];

function hasContent(item: any) {
  return (
    (item.note ?? "").trim() !== "" ||
    (item.item_photos?.length ?? 0) > 0 ||
    (item.item_files?.length ?? 0) > 0
  );
}

function matchesFilter(item: any, filter: FilterMode) {
  if (filter === "open") return !item.done;
  if (filter === "flagged") return !!item.flagged;
  if (filter === "content") return hasContent(item);
  return true;
}

function itemsForType(type: any) {
  return liveChecklistItems(type?.checklist_items ?? []);
}

function countsForTypes(types: any[]) {
  return types.reduce(
    (acc, type) => {
      for (const item of itemsForType(type)) {
        acc.all += 1;
        if (!item.done) acc.open += 1;
        if (item.flagged) acc.flagged += 1;
        if (hasContent(item)) acc.content += 1;
      }
      return acc;
    },
    { all: 0, open: 0, flagged: 0, content: 0 } as Record<FilterMode, number>,
  );
}

function filterItems(items: any[], filter: FilterMode) {
  if (filter === "all") return items;

  const liveItems = liveChecklistItems(items ?? []);
  const byId = new Map(liveItems.filter((item: any) => item.id).map((item: any) => [item.id, item]));
  const keep = new Set<string>();

  function includeWithParents(item: any) {
    let current = item;
    while (current?.id && !keep.has(current.id)) {
      keep.add(current.id);
      current = current.parent_item_id ? byId.get(current.parent_item_id) : null;
    }
  }

  for (const item of liveItems) {
    if (matchesFilter(item, filter)) includeWithParents(item);
  }

  return (items ?? []).filter((item: any) => keep.has(item.id));
}

function filterGroup(group: any, filter: FilterMode) {
  if (!group || filter === "all") return group;

  const componentTypes = (group.component_types ?? [])
    .map((type: any) => ({
      ...type,
      checklist_items: filterItems(type.checklist_items ?? [], filter),
    }))
    .filter((type: any) => (type.checklist_items ?? []).length > 0);

  return { ...group, component_types: componentTypes };
}

function FilterPill({ option, count, active, onClick }: any) {
  return createElement(
    "button",
    {
      type: "button",
      onClick,
      className: `inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition ${
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
      }`,
    },
    createElement("span", null, option.label),
    createElement("span", { className: "font-mono tabular-nums opacity-80" }, count),
  );
}

export function ComponentTypesTree(props: any) {
  const types = props.group?.component_types ?? [];
  const [showFilters, setShowFilters] = useState(false);
  const [filter, setFilter] = useState<FilterMode>("all");

  const counts = useMemo(() => countsForTypes(types), [types]);
  const group = useMemo(() => filterGroup(props.group, filter), [props.group, filter]);
  const hasItems = counts.all > 0;
  const visibleTypes = group?.component_types ?? [];

  return createElement(
    "div",
    { className: "space-y-2" },
    hasItems &&
      createElement(
        "div",
        { className: "flex justify-end" },
        createElement(
          Button,
          {
            size: "sm",
            variant: showFilters || filter !== "all" ? "default" : "outline",
            onClick: () => setShowFilters((value) => !value),
            title: "Filter checklist",
            "aria-label": "Filter checklist",
          },
          createElement(Filter, { className: "h-4 w-4" }),
        ),
      ),
    hasItems &&
      showFilters &&
      createElement(
        "div",
        { className: "flex flex-wrap justify-end gap-1 rounded-md border bg-muted/20 px-2 py-2" },
        FILTERS.map((option) =>
          createElement(FilterPill, {
            key: option.key,
            option,
            count: counts[option.key],
            active: filter === option.key,
            onClick: () => setFilter(option.key),
          }),
        ),
      ),
    hasItems && filter !== "all" && visibleTypes.length === 0
      ? createElement(
          "p",
          { className: "rounded-md border bg-muted/20 px-3 py-3 text-sm text-muted-foreground" },
          "No checklist items match this filter.",
        )
      : createElement(BaseComponentTypesTree, { ...props, group }),
  );
}
