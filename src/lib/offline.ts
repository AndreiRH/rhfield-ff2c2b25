// Client-side glue for the offline service worker + warm-up.

import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onWarmUpProgress, warmUp, getWarmUpState } from "./warm-up";

type SwQueueMessage = { type: "rhfield-queue"; count: number };
type SwDataChangedMessage = { type: "rhfield-data-changed" };
type SwMessage = SwQueueMessage | SwDataChangedMessage;

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
      triggerFlush();
      warmUp(true).then(() => qc.invalidateQueries());
    };
    const onOffline = () => setOnline(false);
    const onVis     = () => {
      if (document.visibilityState === "visible") {
        send("rhfield-queue?");
        if (navigator.onLine) { triggerFlush(); warmUp(); }
      }
    };
    const onMsg = (e: MessageEvent<SwMessage>) => {
      const d = e.data;
      if (!d) return;
      if (d.type === "rhfield-queue") setPending(d.count);
      if (d.type === "rhfield-data-changed") {
        // SW updated the local snapshot (write replay or optimistic write).
        // Refetch active queries so screens reflect the change immediately.
        qc.invalidateQueries();
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
