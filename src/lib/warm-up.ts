// Warm-up: pulls every table the user has access to into IndexedDB and
// pre-fetches every storage object referenced. Runs on app boot, on
// `online`, and on tab focus (throttled).
//
// The service worker uses the same IndexedDB snapshot to answer
// Supabase REST GETs when offline.

import { supabase } from "@/integrations/supabase/client";
import { putTable, setMeta } from "./snapshot-store";

// Tables to mirror locally. Only tables the current user can SELECT
// thanks to RLS will return rows; the rest come back empty (fine).
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

// Map a row+column to its storage bucket. By convention in this project:
// - any *photo*_path / column on a *_photos table  → "photos" bucket
// - any *file*_path / column on a *_files / *_attachments table → "files" bucket
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

type Progress = { phase: "idle" | "tables" | "blobs" | "done"; done: number; total: number; lastSync?: number };
type Listener = (p: Progress) => void;
const listeners = new Set<Listener>();
let current: Progress = { phase: "idle", done: 0, total: 0 };
function emit(p: Partial<Progress>) {
  current = { ...current, ...p };
  listeners.forEach((fn) => fn(current));
}
export function onWarmUpProgress(fn: Listener) {
  fn(current);
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function getWarmUpState() { return current; }

const THROTTLE_MS = 30 * 1000;
let lastRunAt = 0;
let inflight: Promise<void> | null = null;

export function warmUp(force = false): Promise<void> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return Promise.resolve();
  if (inflight) return inflight;
  if (!force && Date.now() - lastRunAt < THROTTLE_MS) return Promise.resolve();

  inflight = (async () => {
    try {
      // Need a session — if not signed in, nothing to mirror.
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // 1) Pull every table in parallel.
      emit({ phase: "tables", done: 0, total: TABLES.length });
      const results = await Promise.all(
        TABLES.map(async (t) => {
          try {
            const { data, error } = await supabase.from(t as never).select("*");
            if (error) throw error;
            await putTable(t, data ?? []);
            emit({ done: current.done + 1 });
            return [t, data ?? []] as const;
          } catch {
            emit({ done: current.done + 1 });
            return [t, []] as const;
          }
        }),
      );

      // 2) Collect every storage path.
      type Job = { bucket: "photos" | "files"; path: string };
      const jobs: Job[] = [];
      const seen = new Set<string>();
      for (const [tableName, rows] of results) {
        const specs = PATH_COLUMNS[tableName];
        if (!specs) continue;
        for (const row of rows as Record<string, unknown>[]) {
          for (const { bucket, col } of specs) {
            const path = row?.[col] as string | null | undefined;
            if (!path) continue;
            const key = `${bucket}:${path}`;
            if (seen.has(key)) continue;
            seen.add(key);
            jobs.push({ bucket, path });
          }
        }
      }

      // 3) Sign URLs in batches, then GET each (the SW caches the response).
      emit({ phase: "blobs", done: 0, total: jobs.length });
      // Group by bucket for createSignedUrls.
      const byBucket = new Map<"photos" | "files", string[]>();
      for (const j of jobs) {
        const list = byBucket.get(j.bucket) ?? [];
        list.push(j.path);
        byBucket.set(j.bucket, list);
      }
      const signed: { url: string }[] = [];
      for (const [bucket, paths] of byBucket) {
        // createSignedUrls handles up to ~1000 at a time comfortably.
        const chunk = 200;
        for (let i = 0; i < paths.length; i += chunk) {
          const slice = paths.slice(i, i + chunk);
          const { data } = await supabase.storage.from(bucket).createSignedUrls(slice, 60 * 60 * 12);
          for (const r of data ?? []) {
            if (r.signedUrl) signed.push({ url: r.signedUrl });
          }
        }
      }

      // Throttle parallel downloads.
      const CONCURRENCY = 6;
      let i = 0;
      async function worker() {
        while (i < signed.length) {
          const idx = i++;
          try {
            await fetch(signed[idx].url, { cache: "no-store" });
          } catch {}
          emit({ done: current.done + 1 });
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, signed.length) }, worker));

      lastRunAt = Date.now();
      await setMeta("lastSync", lastRunAt);
      emit({ phase: "done", lastSync: lastRunAt });
    } finally {
      inflight = null;
    }
  })();

  return inflight;
}
