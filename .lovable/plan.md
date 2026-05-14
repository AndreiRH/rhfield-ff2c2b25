# BlueW1 Commissioning Tracker — v1 Plan

## Goals
- Track commissioning of a project (BlueW1) made of 10 fixed lines.
- Engineers update checklists, upload photos & documents, plan hot-commissioning milestones.
- Project management has read-only access.
- Works offline on site; syncs when online.
- Progress rolls up automatically from checklist items (unweighted).

---

## Roles & Access
- **Engineer** (4 users): full read/write on assigned project.
- **Project Manager**: read-only across all projects (sees dashboards, checklists, photos, calendar — cannot edit).
- **Admin**: can create new projects and invite users.

Auth via Lovable Cloud email/password + Google. Roles stored in a separate `user_roles` table (admin / engineer / pm).

---

## Data model (hierarchy)

```text
Project (BlueW1, ...)
└── Line (1..N, fixed at project creation; default 10 for BlueW1)
    └── Chapter (Assembly | Wiring | Cold Comm | Hot Comm | After-Sales)
        └── Equipment group (Kiln | SHS)              ← only for the 4 main chapters
            └── Component (configurable list)
                └── Checklist item (done / not done, optional note + photo)
        └── After-Sales: list of "extra works", each with its own checklist
        └── Hot Comm: also has a Calendar with milestones
```

Progress rule (unweighted): `% = done items / total items`, computed at every level by simple aggregation of leaf checklist items beneath that node. Visible at project, line, chapter, equipment, and component level.

---

## Screens

1. **Projects list** — tiles for each project with overall %. "+ New project" (admin only). Delete is a destructive 3-step confirm (type project name).
2. **Project dashboard** (BlueW1) — header with overall %, ring chart + bar. Grid of 11 tiles: Lines 1–10 + 1 "Common" tile. Each line tile shows its overall % and a mini bar.
3. **Line detail** — sticky header with line % + chapter chips (Assembly / Wiring / Cold / Hot / After-Sales) each showing %. Tabs/sections for the 5 chapters. For the 4 main chapters: Kiln and SHS sub-cards, each expandable to components → checklist items.
4. **Hot Commissioning calendar** — month view with planned start/end and milestones (kiln heatup, loading empty saggars, loading full saggars, purging dry air, purging oxygen, holding temperature, provisional acceptance measurements, custom). Add/edit/delete milestones with date, label, notes.
5. **After-sales** — list of paid extra works; each has its own checklist + %.
6. **Common** — plant-wide notes, files, checklists not tied to a specific line.
7. **Item detail / drawer** — checklist item with status, note, photo attachments, history (who/when).
8. **Login / Auth** screens.

---

## Offline-first & sync

- Primary store: **IndexedDB** (via Dexie) holding projects, lines, chapters, components, checklist items, photos (as Blobs), milestones, files metadata.
- Every mutation writes locally first and is queued in an `outbox` table with a client-generated UUID + timestamp + user id.
- When online, a background sync worker drains the outbox to Lovable Cloud (Postgres + Storage). Conflict policy v1: **last-write-wins per field** with a server-side `updated_at`; conflicting edits are flagged in a "Sync issues" panel for manual review.
- Photos/files: stored locally as Blobs; uploaded to Cloud Storage in the background; the row keeps both local blob ref and remote URL until upload confirms.
- Online status indicator + manual "Sync now" button + last-sync timestamp in the header.

---

## Safety against accidental deletes
- Checklist items: soft-delete with undo toast (10s).
- Components / extra works: confirm dialog.
- Lines: cannot be deleted (fixed at project creation).
- Projects: 3-step destructive flow — confirm → type project name → final confirm. Admin only.

---

## Templates (so engineers don't build checklists from scratch)
- A "Line template" defines the default Kiln + SHS components and their checklist items per chapter.
- BlueW1 is seeded from this template at project creation; engineers can add/edit components and items per line afterwards.
- Milestone presets for Hot Comm calendar are seeded but customizable.

---

## Tech notes (technical, can skip)

- **Stack**: TanStack Start (already set up) + Lovable Cloud (Supabase Postgres, Auth, Storage).
- **Local DB**: Dexie (IndexedDB).
- **Sync layer**: a small reconciler that reads `outbox`, calls server functions (`createServerFn` with `requireSupabaseAuth`), then marks rows synced. On pull, it fetches rows with `updated_at > last_pull` and merges.
- **Charts**: recharts (donut + horizontal bar).
- **Calendar**: react-day-picker (already used by shadcn) for month view; milestones rendered as colored dots with a side panel listing them.
- **File size**: Supabase Storage handles dozens of MB per file easily; we'll set a 100 MB per-file cap in the UI.
- **PWA**: enabled minimally so the app is installable and offline-capable on site tablets/phones (with the documented preview-iframe guard).
- **RLS**: row-level security on all tables; PM role gets SELECT only via a `has_role()` security-definer function.

---

## Build order (still v1, but in this sequence so the app is usable as early as possible)

1. Auth + roles + project/line schema + RLS.
2. Projects list + BlueW1 dashboard (11 tiles, % rollup) — online only first.
3. Line detail with the 5 chapters, Kiln/SHS, components, checklist items, photos.
4. After-sales chapter.
5. Hot Comm calendar with milestones.
6. Common tile (notes + files).
7. Offline layer (Dexie + outbox + sync) + PWA install.
8. Admin: create new project with configurable line count; line/component templates.

---

## Open questions before building
1. Is the kiln/SHS component list and per-chapter checklist already documented somewhere I can seed from, or should I start with placeholder components and let engineers fill them in?
2. Should photos be required on certain checklist items (e.g. provisional acceptance), or always optional?
3. For PM read-only: should they also be able to add comments, or strictly view-only?

I can proceed with sensible defaults (placeholder components, optional photos, strictly view-only PM) if you'd rather not decide now.
