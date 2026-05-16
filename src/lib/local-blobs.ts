// Bridge between freshly-picked files in the React app and the SW's
// IndexedDB blob store. Provides:
//   - rememberLocalFile(bucket, path, file): cache a just-picked File so
//     newly-rendered <img>/<a> elements can preview it immediately, even
//     before any signed URL exists.
//   - getLocalBlob(bucket, path): returns the in-memory File if present;
//     otherwise asks the SW for the persisted blob via postMessage.
//   - subscribe(cb): notify when the local cache changes (so existing
//     components can re-render with the new local preview URL).

type Key = string; // `${bucket}/${path}`

const cache = new Map<Key, Blob>();
const listeners = new Set<() => void>();

function key(bucket: string, path: string) { return `${bucket}/${path}`; }

export function rememberLocalFile(bucket: string, path: string, file: Blob) {
  cache.set(key(bucket, path), file);
  for (const cb of listeners) { try { cb(); } catch {} }
}

export function getCachedLocalBlob(bucket: string, path: string): Blob | null {
  return cache.get(key(bucket, path)) ?? null;
}

export function subscribeLocalBlobs(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export async function getLocalBlob(bucket: string, path: string): Promise<Blob | null> {
  const local = getCachedLocalBlob(bucket, path);
  if (local) return local;
  // Try AI Search offline cache (Dexie).
  try {
    const { getAttachmentBlob } = await import("./offlineCache");
    if (bucket === "photos" || bucket === "files") {
      const b = await getAttachmentBlob(bucket as "photos" | "files", path);
      if (b) return b;
    }
  } catch {}
  if (typeof navigator === "undefined") return null;
  const sw = navigator.serviceWorker?.controller;
  if (!sw) return null;
  return await new Promise<Blob | null>((resolve) => {
    const ch = new MessageChannel();
    const t = setTimeout(() => { try { ch.port1.close(); } catch {} resolve(null); }, 4000);
    ch.port1.onmessage = (ev) => {
      clearTimeout(t);
      try { ch.port1.close(); } catch {}
      const b = ev.data?.blob;
      resolve(b instanceof Blob ? b : null);
    };
    try {
      sw.postMessage({ type: "rhfield-get-blob", bucket, path }, [ch.port2]);
    } catch { clearTimeout(t); resolve(null); }
  });
}
