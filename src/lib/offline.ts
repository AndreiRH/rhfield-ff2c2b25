// Client-side glue for the offline service worker.
// - Tracks online/offline status and the SW outbox queue size.
// - Triggers queue flushes on reconnect / focus.
// - Registers a Background Sync where supported.

import { useEffect, useState } from "react";

type SwMessage = { type: "rhfield-queue"; count: number };

function send(type: string) {
  navigator.serviceWorker?.controller?.postMessage({ type });
}

async function requestBackgroundSync() {
  try {
    const reg = await navigator.serviceWorker?.ready;
    // SyncManager is only on Chromium-based browsers.
    if (reg && "sync" in reg) {
      // @ts-expect-error - SyncManager not in lib.dom yet
      await reg.sync.register("rhfield-flush");
    }
  } catch {}
}

export function triggerFlush() {
  send("rhfield-flush");
  requestBackgroundSync();
}

export function useOfflineStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [pending, setPending] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onOnline  = () => { setOnline(true);  triggerFlush(); };
    const onOffline = () => setOnline(false);
    const onVis     = () => { if (document.visibilityState === "visible") { send("rhfield-queue?"); if (navigator.onLine) triggerFlush(); } };
    const onMsg = (e: MessageEvent<SwMessage>) => {
      if (e.data?.type === "rhfield-queue") setPending(e.data.count);
    };

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVis);
    navigator.serviceWorker?.addEventListener("message", onMsg);

    // Ask SW for initial count.
    send("rhfield-queue?");

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVis);
      navigator.serviceWorker?.removeEventListener("message", onMsg);
    };
  }, []);

  return { online, pending };
}
