## Why swipes feel janky today

`fetchEquipmentDetail` is a heavy nested query (groups → components → checklist_items → photos/files, plus types nesting the same) followed by extra requests for photos, line count, siblings, and the auto-insert-missing-chapters branch. On a real backend that takes 1–3 s (sometimes 3–5 s on cold caches).

The current swipe code:

1. Only prefetches **prev / next** siblings, and only after the current equipment finishes loading. If you swipe quickly through 3 items, item +2 has never been requested.
2. The mid-swipe neighbour pane always shows a **ghost skeleton** (header in the wrong color, blank tab bar, grey blocks). On commit the route remounts and TanStack Query may still be loading, so the whole body collapses to a single big `<Skeleton className="h-40" />`. Sections then appear at different times (header → tabs → tree → photos) because `StoragePhoto` resolves signed URLs lazily per image.
3. `useQuery` is keyed per equipment with `staleTime: 30_000`. Anything older than 30 s refetches and there is no `initialData` from cache, so the route lands in the `isLoading` state even when sibling data is already cached.

That combination explains "parts missing, parts old design, sometimes 3–5 s".

## Plan

### 1. Prefetch aggressively, from the list page already

- In `equipment.$kind.index.tsx` (`PlantView`), after the list loads, kick off `qc.prefetchQuery` for **every** sibling's `["equipment-detail", …]` key with `staleTime: 5 * 60_000`. Cheap because the user is about to enter one of them.
- In `EquipmentDetail` keep prev/next prefetch, but also prefetch **+2 / -2** and bump `staleTime` to 5 minutes so we don't re-fight the cache every 30 s.
- Trigger prefetch on **touchstart of a horizontal swipe** too, so even an unprefetched sibling starts loading the moment the finger moves.

### 2. Use cached sibling data as `initialData`

In the `useQuery({ queryKey: ["equipment-detail", …] })` call, add:

```ts
initialData: () => qc.getQueryData(["equipment-detail", projectId, lineNumber, kind, equipmentId]),
initialDataUpdatedAt: () => qc.getQueryState(["equipment-detail", …])?.dataUpdatedAt,
```

With this, when the user lands on a prefetched sibling, `isLoading` is `false` and the page renders the full layout immediately instead of the giant skeleton.

### 3. Render the real neighbour content during the swipe

Inside the "NEIGHBOUR EQUIPMENT PANE" block, when `neighbourData` is available in cache, render the actual `HeaderInner` + `SectionTab`s + `renderSection(section, neighbourData, …)` for the neighbour using its colors. Only fall back to the ghost skeleton when nothing is cached. This kills the "snaps from grey blocks to real UI" feeling.

### 4. Shrink the per-equipment query

`fetchEquipmentDetail` currently asks Postgres for every photo / file row attached to every checklist item up front. We don't need that for the initial paint — `ChecklistTree` only reveals photos/files on row expand.

- Drop `item_photos` / `item_files` / `component_photos` / `component_files` from `groupsSelect`. Load them lazily per-row (a separate keyed query) when a tree node opens, or via a second query that streams in after the page is rendered.
- Run `equipment_photos`, `siblings`, and `lineCount` **in parallel** with the groups query via `Promise.all`. They're independent.
- Move the "insert missing chapters" branch behind a `head: true` existence check so the common case (chapters already exist) avoids the second select.

Expected: ~50–70 % reduction in payload + 1 round-trip saved on the happy path.

### 5. Stop the full-body skeleton on transient refetches

Replace `if (isLoading || !data)` with `if (!data)` so background refetches (after staleTime expires or invalidation) don't blow away the rendered layout — react-query already keeps `data` while `isFetching` is true.

### 6. Optional polish

- Persist the equipment-detail cache to `localStorage` (the project already has a snapshot store) so reopening the app warms instantly.
- For the photos in the header, prefer the already-resolved blob URL from `getCachedLocalBlob` synchronously to skip the lightbox-style async resolve flicker.

## Out of scope

Search, settings sub-routes, and the kind/index list rendering itself. This plan is only about how swiping between equipment items feels.

## Technical notes

- Files touched: `src/routes/p.$projectId.lines.$lineNumber.equipment.$kind.$equipmentId.tsx`, `src/routes/p.$projectId.lines.$lineNumber.equipment.$kind.index.tsx`, possibly `src/components/ChecklistTree.tsx` (lazy photos/files fetch per row).
- No schema changes. No new dependencies.
- Backwards compatible with offline mode (`offlineCache.ts` will still hydrate the same query keys).
