## Problem

When everything is expanded, the four nesting levels (Type → Component → Item → Subtask) all use the same `rounded-lg border bg-card` styling and similar spacing. The result reads as one continuous list — you can't see where a parent ends and the next sibling begins.

## Goal

Make each level visually distinct so that, at a glance, the user can tell:
- which level a row belongs to,
- where a parent's children end and the next sibling parent starts.

Logic, data, and behavior stay untouched — purely a presentation change in the existing tree components.

## Design system

Assign each level a clear visual signature using existing semantic tokens (no new colors):

| Level | Container | Left accent rail | Header background | Sibling gap |
|------|-----------|------------------|-------------------|-------------|
| Type | thicker outer card, stronger shadow | `border-l-4 border-l-primary` | bold header (`bg-muted/70`, larger title) | `space-y-6` |
| Component | nested card, lighter shadow, indented `ml-2` | `border-l-4 border-l-accent` (or `border-l-secondary`) | `bg-muted/40`, smaller title | `space-y-4` |
| Item | flat row inside a soft container, indented `ml-3` | `border-l-2 border-l-muted-foreground/40` | no header band | `space-y-2` |
| Subtask | already `border-l-2 border-primary/20 ml-4` — keep, but bump padding so it visually separates from its parent item | unchanged | unchanged | `space-y-1` |

Additional cues:
- Wrap each level's children area in a subtle inset background (`bg-muted/20` or `bg-card/50`) and add a small top/bottom padding so children sit "inside" the parent rather than flush against the next sibling.
- Add a thin divider (`border-t border-dashed border-border`) between sibling Components inside a Type, and between sibling Items inside a Component, to reinforce the boundary when content is dense.
- Keep the existing color-state styling (delete = destructive, copy = primary, complete = success) — apply the new level rails only when no action mode is active so we don't fight the selection colors.

## Files to change

- `src/components/ComponentTypesTree.tsx` — TypeSection container + the wrapper around `<ComponentsList>` (lines ~396–478): add primary left rail, stronger outer card, inset background on the children area, increase outer `space-y` to `space-y-6`.
- `src/components/ExtraWorkChapterView.tsx` — `ComponentsList` outer `space-y-3` → `space-y-4`, `ComponentBlock` (lines ~269–336): add accent left rail, `ml-2` indent, softer inset on the expanded children area, dashed divider between siblings.
- `src/components/ChecklistTree.tsx` — Item rows: add muted left rail + `ml-3` indent; tighten header so items read as rows-in-a-container rather than independent cards. Subtask rail (`border-l-2 border-primary/20 ml-4`, lines 487 and 513): keep but add a small top margin so the subtask block clearly belongs to its parent.

## Out of scope

- No changes to data fetching, drag-and-drop, selection, delete confirmation, or the action toolbar.
- No new color tokens; only existing semantic tokens from `src/styles.css`.
- No change to the collapsed appearance — only how nesting reads when expanded.

## Verification

After the edit, open a Type → Component → Item with subtasks in the preview, expand everything, and screenshot: each level should have a visible indent + a distinct colored left rail, and sibling parents should be separated by clear vertical gaps.
