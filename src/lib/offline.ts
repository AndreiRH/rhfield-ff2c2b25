// Client-side glue for the offline service worker + warm-up.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onWarmUpProgress, warmUp, getWarmUpState } from "./warm-up";

type SwQueueMessage = { type: "rhfield-queue"; count: number; failed?: number };
type SwDataChangedMessage = { type: "rhfield-data-changed" };
type SwAuthExpiredMessage = { type: "rhfield-auth-expired" };
type SwFlushCompleteMessage = {
  type: "rhfield-flush-complete";
  remaining: number;
  failedCount?: number;
  failures: number;
  failureSamples: Array<{ url: string; method: string; status: number; body: string }>;
  stalled: boolean;
};
type SwMessage =
  | SwQueueMessage
  | SwDataChangedMessage
  | SwFlushCompleteMessage
  | SwAuthExpiredMessage;

function send(type: string) {
  navigator.serviceWorker?.controller?.postMessage({ type });
}

async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    if (reg && "sync" in reg) {
      // @ts-expect-error - SyncManager isn't in lib.dom yet
      await reg.sync.register("rhfield-flush");
    }
  } catch {
    // Background sync is optional; direct flush messages still run.
  }
}

export function triggerFlush() {
  send("rhfield-flush");
  requestBackgroundSync();
}

export function retryFailedOutbox() {
  send("rhfield-outbox-retry-failed");
}

export function discardFailedOutbox() {
  send("rhfield-outbox-discard-failed");
}

let authRefreshInFlight = false;
async function handleAuthExpired() {
  if (authRefreshInFlight) return;
  authRefreshInFlight = true;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    await supabase.auth.refreshSession();
  } catch {
    /* ignore — flush will surface failure on next attempt */
  } finally {
    authRefreshInFlight = false;
    triggerFlush();
  }
}

// Active connectivity probe — `navigator.onLine` is unreliable on iOS/Android
// PWAs (often stays true after losing connection). Ping a tiny Supabase asset
// to ground-truth it.
async function probeOnline(): Promise<boolean> {
  if (typeof navigator === "undefined") return true;
  if (!navigator.onLine) return false;
  try {
    const url = new URL("/auth/v1/health", import.meta.env.VITE_SUPABASE_URL as string);
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url.href, { method: "GET", cache: "no-store", signal: ctrl.signal });
    clearTimeout(to);
    return res.ok;
  } catch {
    return false;
  }
}

export function useOfflineStatus() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);
  const [warm, setWarm] = useState(getWarmUpState());
  const qc = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    const refreshOnline = async () => {
      const real = await probeOnline();
      if (!cancelled) setOnline(real);
      return real;
    };

    const onOnline = () => {
      refreshOnline().then((ok) => {
        if (ok) triggerFlush();
      });
    };
    const onOffline = () => setOnline(false);
    const onVis = () => {
      if (document.visibilityState === "visible") {
        send("rhfield-queue?");
        refreshOnline().then((ok) => {
          if (ok) triggerFlush();
        });
      }
    };
    const onMsg = (e: MessageEvent<SwMessage>) => {
      const d = e.data;
      if (!d) return;
      if (d.type === "rhfield-queue") {
        setPending(d.count);
        setFailed(d.failed ?? 0);
      }
      if (d.type === "rhfield-data-changed") {
        qc.invalidateQueries();
      }
      if (d.type === "rhfield-auth-expired") {
        handleAuthExpired();
      }
      if (d.type === "rhfield-flush-complete") {
        if (typeof d.failedCount === "number") setFailed(d.failedCount);
        if (d.failures > 0 && d.failureSamples?.length) {
          console.warn(
            `[offline] ${d.failures} queued change(s) were rejected by the server and kept pending:`,
            d.failureSamples,
          );
        }
        if (!d.stalled && d.remaining === 0) {
          warmUp(true).then(() => qc.invalidateQueries());
        }
      }
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVis);
    navigator.serviceWorker?.addEventListener("message", onMsg);
    const off = onWarmUpProgress(setWarm);

    send("rhfield-queue?");
    refreshOnline();
    // Poll every 15s so the cloud icon reflects reality even when the
    // browser doesn't fire offline/online events (common on iOS PWAs).
    const poll = window.setInterval(refreshOnline, 15000);

    return () => {
      cancelled = true;
      window.clearInterval(poll);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVis);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
      off();
    };
  }, [qc]);

  return { online, pending, failed, warm };
}
