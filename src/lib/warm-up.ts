// Warm-up: pulls every table the user can read into IndexedDB and pre-caches
// every referenced storage object. The service worker uses the same snapshot
// to answer offline reads and applies offline writes back into it.
//
// Runs on app boot, on `online`, on tab focus (throttled), and after the
// outbox flushes (so the local snapshot rejoins the server state).

import { supabase } from "@/integrations/supabase/client";
import { putTable, hasBlob, setMeta } from "./snapshot-store";

const TABLES = [
  "projects", "lines", "plant_equipment", "equipment_groups",
  "component_types", "components", "checklist_items",
  "equipment_settings", "equipment_notes", "equipment_photos",
  "item_photos", "item_files",
  "component_photos", "component_files",
  "setting_photos", "setting_files", "setting_logs",
  "pa_folders", "pa_notes", "pa_attachments",
  "milestones",
  "common_notes", "common_files",
  "common_folders", "common_folder_notes", "common_folder_attachments",
  "profiles", "user_roles",
] as const;

type PathSpec = { bucket: "photos" | "files"; col: string };
const PATH_COLUMNS: Record<string, PathSpec[]> = {
  equipment_photos:           [{ bucket: "photos", col: "storage_path" }],
  item_photos:                [{ bucket: "photos", col: "storage_path" }],
  component_photos:           [{ bucket: "photos", col: "storage_path" }],
  setting_photos:             [{ bucket: "photos", col: "storage_path" }],
  item_files:                 [{ bucket: "files",  col: "storage_path" }],
  component_files:            [{ bucket: "files",  col: "storage_path" }],
  setting_files:              [{ bucket: "files",  col: "storage_path" }],
  pa_attachments:             [{ bucket: "files",  col: "storage_path" }],
  common_files:               [{ bucket: "files",  col: "storage_path" }],
  common_folder_attachments:  [{ bucket: "files",  col: "storage_path" }],
  equipment_notes:            [{ bucket: "photos", col: "photo_path" }, { bucket: "files", col: "file_path" }],
  equipment_settings:         [{ bucket: "photos", col: "photo_path" }, { bucket: "files", col: "file_path" }],
  pa_notes:                   [{ bucket: "photos", col: "photo_path" }, { bucket: "files", col: "file_path" }],
  common_folder_notes:        [{ bucket: "photos", col: "photo_path" }, { bucket: "files", col: "file_path" }],
};

export type WarmPhase = "idle" | "tables" | "blobs" | "done";
export type Progress = { phase: WarmPhase; done: number; total: number; lastSync?: number; error?: string };
type Listener = (p: Progress) => void;
const listeners = new Set<Listener>();
let current: Progress = { phase: "idle", done: 0, total: 0 };
function emit(p: Partial<Progress>) {
  current = { ...current, ...p };
  listeners.forEach((fn) => { try { fn(current); } catch {} });
}
export function onWarmUpProgress(fn: Listener) {
  fn(current);
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getWarmUpState() { return current; }

const THROTTLE_MS = 30 * 1000;
const PAGE_SIZE = 1000;
let lastRunAt = 0;
let inflight: Promise<void> | null = null;

async function pageTable(table: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase.from(table as never).select("*").range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

function postToServiceWorker(type: string, payload: Record<string, unknown> = {}) {
  if (typeof navigator === "undefined" || !navigator.serviceWorker) return;
  const msg = { type, ...payload };
  if (navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage(msg);
  else navigator.serviceWorker.ready.then((reg) => reg.active?.postMessage(msg)).catch(() => {});
}

function buildOfflineRoutes(results: Array<readonly [string, Record<string, unknown>[]]>) {
  const tables = Object.fromEntries(results) as Record<string, Record<string, unknown>[]>;
  const routes = new Set<string>(["/", "/login"]);
  const lines = tables.lines ?? [];
  const plant = tables.plant_equipment ?? [];
  const extraGroups = (tables.equipment_groups ?? []).filter((g) => g.kind === "extra_work" && !g.deleted_at);

  for (const project of tables.projects ?? []) {
    const projectId = String(project.id ?? "");
    if (!projectId) continue;
    routes.add(`/p/${projectId}`);
    routes.add(`/p/${projectId}/common`);
    const projectLines = lines.filter((line) => line.project_id === project.id);
    for (const line of projectLines) {
      const lineNumber = String(line.number ?? "");
      if (!lineNumber) continue;
      routes.add(`/p/${projectId}/lines/${lineNumber}`);
      routes.add(`/p/${projectId}/lines/${lineNumber}/equipment/kiln`);
      routes.add(`/p/${projectId}/lines/${lineNumber}/equipment/shs`);
      routes.add(`/p/${projectId}/lines/${lineNumber}/equipment/kiln/pa`);
      routes.add(`/p/${projectId}/lines/${lineNumber}/equipment/shs/pa`);
      for (const pe of plant.filter((p) => p.line_id === line.id && !p.deleted_at)) {
        const kind = String(pe.kind ?? "");
        const id = String(pe.id ?? "");
        if (!kind || !id) continue;
        routes.add(`/p/${projectId}/lines/${lineNumber}/equipment/${kind}/${id}`);
        routes.add(`/p/${projectId}/lines/${lineNumber}/equipment/${kind}/${id}/settings`);
        routes.add(`/p/${projectId}/lines/${lineNumber}/equipment/${kind}/${id}/settings/log`);
      }
      for (const group of extraGroups.filter((g) => g.line_id === line.id)) {
        const id = String(group.id ?? "");
        if (id) routes.add(`/p/${projectId}/lines/${lineNumber}/equipment/${id}`);
      }
    }
  }
  return [...routes];
}

export function warmUp(force = false): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve();
  if (inflight) return inflight;
  if (!force && Date.now() - lastRunAt < THROTTLE_MS) return Promise.resolve();

  inflight = (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Ask Android/Chromium to keep our storage. No-op on browsers without it.
      try {
        if (typeof navigator !== "undefined" && navigator.storage?.persist) {
          await navigator.storage.persist();
        }
      } catch {}

      // 1) Pull every table fully (paged).
      emit({ phase: "tables", done: 0, total: TABLES.length, error: undefined });
      const results: Array<readonly [string, Record<string, unknown>[]]> = [];
      await Promise.all(
        TABLES.map(async (t) => {
          try {
            const rows = await pageTable(t);
            await putTable(t, rows);
            results.push([t, rows] as const);
          } catch {
            results.push([t, []] as const);
          } finally {
            emit({ done: current.done + 1 });
          }
        }),
      );

      postToServiceWorker("rhfield-cache-routes", { routes: buildOfflineRoutes(results) });

      // 2) Collect every storage path, skipping anything already cached locally.
      type Job = { bucket: "photos" | "files"; path: string };
      const seen = new Set<string>();
      const candidates: Job[] = [];
      for (const [table, rows] of results) {
        const specs = PATH_COLUMNS[table];
        if (!specs) continue;
        for (const row of rows) {
          for (const { bucket, col } of specs) {
            const path = (row?.[col] ?? null) as string | null;
            if (!path) continue;
            const key = `${bucket}:${path}`;
            if (seen.has(key)) continue;
            seen.add(key);
            candidates.push({ bucket, path });
          }
        }
      }
      // Drop ones we already have a local blob for — saves bandwidth.
      const jobs: Job[] = [];
      for (const c of candidates) {
        if (await hasBlob(c.bucket, c.path)) continue;
        jobs.push(c);
      }

      // 3) Sign + GET so the SW caches them in the local blob store.
      emit({ phase: "blobs", done: 0, total: jobs.length });
      const byBucket = new Map<"photos" | "files", string[]>();
      for (const j of jobs) {
        const list = byBucket.get(j.bucket) ?? [];
        list.push(j.path);
        byBucket.set(j.bucket, list);
      }
      const signed: string[] = [];
      for (const [bucket, paths] of byBucket) {
        const chunk = 200;
        for (let i = 0; i < paths.length; i += chunk) {
          const slice = paths.slice(i, i + chunk);
          try {
            const { data } = await supabase.storage.from(bucket).createSignedUrls(slice, 60 * 60 * 12);
            for (const r of data ?? []) if (r.signedUrl) signed.push(r.signedUrl);
          } catch {}
        }
      }
      const CONCURRENCY = 6;
      let i = 0;
      async function worker() {
        while (i < signed.length) {
          const idx = i++;
          try { await fetch(signed[idx], { cache: "no-store" }); } catch {}
          emit({ done: current.done + 1 });
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, signed.length) }, worker));

      lastRunAt = Date.now();
      await setMeta("lastSync", lastRunAt);
      emit({ phase: "done", lastSync: lastRunAt, total: current.total, done: current.total });
    } catch (e: unknown) {
      emit({ phase: "done", error: e instanceof Error ? e.message : String(e) });
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
