// Shared photo/file display components that work offline.
//
// Order of preference for the src URL:
//   1. A locally-cached File (if the user just picked it this session).
//   2. The SW's persisted blob (for previously-uploaded items).
//   3. The Supabase signed URL (will be intercepted by SW when offline).
// On <img> error, falls back to the placeholder so React never re-renders
// in an infinite loop.
//
// Clicking opens an in-app full-screen <Lightbox> instead of navigating
// the browser to the raw storage URL (which fails offline). Downloads
// also go through the local blob store first.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  getCachedLocalBlob,
  getLocalBlob,
  subscribeLocalBlobs,
} from "@/lib/local-blobs";

const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 80 80'>
       <rect width='80' height='80' fill='hsl(var(--muted))'/>
       <g fill='hsl(var(--muted-foreground))' opacity='.5'>
         <circle cx='28' cy='30' r='6'/>
         <path d='M10 64l18-20 14 14 10-10 18 22z'/>
       </g>
     </svg>`,
  );

function useStorageUrl(bucket: string, path: string | null | undefined) {
  const [src, setSrc] = useState<string | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const revoke = () => {
      if (objectUrlRef.current) {
        try { URL.revokeObjectURL(objectUrlRef.current); } catch {}
        objectUrlRef.current = null;
      }
    };

    const apply = async () => {
      if (!path) { setSrc(null); return; }

      // 1. In-memory local file (just picked this session).
      const localNow = getCachedLocalBlob(bucket, path);
      if (localNow) {
        revoke();
        const u = URL.createObjectURL(localNow);
        objectUrlRef.current = u;
        if (!cancelled) setSrc(u);
        return;
      }

      // 2. Signed URL — the SW intercepts and serves from its blob store
      //    when offline, so this works in both modes.
      try {
        const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
        if (cancelled) return;
        if (data?.signedUrl) { revoke(); setSrc(data.signedUrl); return; }
      } catch {}

      // 3. Offline + no signed URL — try the SW blob store directly.
      const blob = await getLocalBlob(bucket, path);
      if (cancelled) return;
      if (blob) {
        revoke();
        const u = URL.createObjectURL(blob);
        objectUrlRef.current = u;
        setSrc(u);
      }
    };
    apply();
    const unsub = subscribeLocalBlobs(apply);
    return () => { cancelled = true; unsub(); revoke(); };
  }, [bucket, path]);

  return src;
}

function onImgError(e: React.SyntheticEvent<HTMLImageElement>) {
  const img = e.currentTarget;
  img.onerror = null; // prevent infinite re-render loop
  if (img.src !== PLACEHOLDER) img.src = PLACEHOLDER;
}

// ---------------- Lightbox (singleton, portal) ----------------

type LightboxState = { bucket: string; path: string; name?: string } | null;
let lightboxSetter: ((s: LightboxState) => void) | null = null;

export function openLightbox(bucket: string, path: string, name?: string) {
  if (lightboxSetter) lightboxSetter({ bucket, path, name });
}

export function LightboxRoot() {
  const [state, setState] = useState<LightboxState>(null);
  useEffect(() => { lightboxSetter = setState; return () => { lightboxSetter = null; }; }, []);
  if (!state) return null;
  return createPortal(<Lightbox state={state} onClose={() => setState(null)} />, document.body);
}

function Lightbox({ state, onClose }: { state: NonNullable<LightboxState>; onClose: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const objRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cleanup = () => {
      if (objRef.current) { try { URL.revokeObjectURL(objRef.current); } catch {} objRef.current = null; }
    };
    (async () => {
      const local = getCachedLocalBlob(state.bucket, state.path);
      if (local) {
        const u = URL.createObjectURL(local);
        objRef.current = u;
        if (!cancelled) setSrc(u);
        return;
      }
      if (navigator.onLine) {
        try {
          const { data } = await supabase.storage.from(state.bucket).createSignedUrl(state.path, 3600);
          if (!cancelled && data?.signedUrl) { setSrc(data.signedUrl); return; }
        } catch {}
      }
      const blob = await getLocalBlob(state.bucket, state.path);
      if (cancelled) return;
      if (blob) {
        const u = URL.createObjectURL(blob);
        objRef.current = u;
        setSrc(u);
      } else {
        setError(navigator.onLine ? "Could not load this photo." : "Photo not available offline.");
      }
    })();
    return () => { cancelled = true; cleanup(); };
  }, [state.bucket, state.path]);

  const download = async () => {
    let blob = getCachedLocalBlob(state.bucket, state.path) ?? await getLocalBlob(state.bucket, state.path);
    if (!blob && navigator.onLine) {
      try {
        const { data } = await supabase.storage.from(state.bucket).download(state.path);
        if (data) blob = data;
      } catch {}
    }
    if (!blob) { setError("Photo not available offline."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = state.name || state.path.split("/").pop() || "photo";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 p-4"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Close"
      >
        <X className="h-5 w-5" />
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); download(); }}
        className="absolute right-16 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
        aria-label="Download"
      >
        <Download className="h-5 w-5" />
      </button>
      {error ? (
        <p className="text-sm text-white">{error}</p>
      ) : src ? (
        <img
          src={src}
          alt=""
          onClick={(e) => e.stopPropagation()}
          onError={onImgError}
          className="max-h-full max-w-full object-contain"
        />
      ) : (
        <p className="text-sm text-white/70">Loading…</p>
      )}
    </div>
  );
}

// ---------------- StoragePhoto ----------------

export function StoragePhoto({
  bucket = "photos",
  path,
  imgClassName,
  containerClassName,
  canEdit,
  onRemove,
}: {
  bucket?: string;
  path: string;
  imgClassName?: string;
  containerClassName?: string;
  canEdit?: boolean;
  onRemove?: () => void;
}) {
  const src = useStorageUrl(bucket, path);
  return (
    <div className={`relative ${containerClassName ?? ""}`}>
      {src ? (
        <button
          type="button"
          onClick={() => openLightbox(bucket, path)}
          className="block w-full"
        >
          <img
            src={src}
            alt=""
            onError={onImgError}
            className={imgClassName ?? "max-h-40 w-full rounded border object-cover"}
          />
        </button>
      ) : (
        <div className={`animate-pulse rounded bg-muted ${imgClassName?.includes("h-") ? imgClassName : "h-24"}`} />
      )}
      {canEdit && onRemove && (
        <button
          onClick={onRemove}
          className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

// ---------------- StorageFile ----------------

export async function openStorageFile(
  bucket: string,
  path: string | null | undefined,
  name: string,
) {
  if (!path) return;
  let blob = getCachedLocalBlob(bucket, path) ?? await getLocalBlob(bucket, path);
  if (!blob && navigator.onLine) {
    try {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 60);
      if (data?.signedUrl) { window.open(data.signedUrl, "_blank", "noopener"); return; }
    } catch {}
  }
  if (!blob) {
    try {
      const { data } = await supabase.storage.from(bucket).download(path);
      if (data) blob = data;
    } catch {}
  }
  if (!blob) { alert("File not available offline."); return; }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
