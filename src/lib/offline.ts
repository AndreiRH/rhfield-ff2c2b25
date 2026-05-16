// Client-side glue for the offline service worker + warm-up.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onWarmUpProgress, warmUp, getWarmUpState } from "./warm-up";

type SwQueueMessage = { type: "rhfield-queue"; count: number };
type SwDataChangedMessage = { type: "rhfield-data-changed" };
type SwFlushCompleteMessage = {
  type: "rhfield-flush-complete";
  remaining: number;
  failures: number;
  failureSamples: Array<{ url: string; method: string; status: number; body: string }>;
  stalled: boolean;
};
type SwMessage = SwQueueMessage | SwDataChangedMessage | SwFlushCompleteMessage;

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
  } catch {}
}

export function triggerFlush() {
  send("rhfield-flush");
  requestBackgroundSync();
}

export function useOfflineStatus() {
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [pending, setPending] = useState(0);
  const [warm, setWarm] = useState(getWarmUpState());
  const qc = useQueryClient();

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onOnline  = () => {
      setOnline(true);
      // Flush first; warm-up runs only after a clean flush (see onMsg below).
      // If there's nothing queued, the SW still replies with flush-complete
      // and we proceed to warm-up immediately.
      triggerFlush();
    };
    const onOffline = () => setOnline(false);
    const onVis     = () => {
      if (document.visibilityState === "visible") {
        send("rhfield-queue?");
        if (navigator.onLine) triggerFlush();
      }
    };
    const onMsg = (e: MessageEvent<SwMessage>) => {
      const d = e.data;
      if (!d) return;
      if (d.type === "rhfield-queue") setPending(d.count);
      if (d.type === "rhfield-data-changed") {
        qc.invalidateQueries();
      }
      if (d.type === "rhfield-flush-complete") {
        if (d.failures > 0 && d.failureSamples?.length) {
          // Surface dropped writes so silent data loss never happens again.
          console.warn(
            `[offline] ${d.failures} queued change(s) were rejected by the server and dropped:`,
            d.failureSamples,
          );
        }
        // Only re-pull the snapshot if the queue actually drained cleanly.
        // Otherwise we'd overwrite still-valid local data with the (incomplete)
        // server state, hiding the user's offline edits.
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

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVis);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
      off();
    };
  }, [qc]);

  return { online, pending, warm };
}
