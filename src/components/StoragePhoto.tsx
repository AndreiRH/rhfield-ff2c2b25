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

export type GalleryItem = { bucket: string; path: string; name?: string };
type LightboxState = {
  gallery: GalleryItem[];
  index: number;
} | null;
let lightboxSetter: ((s: LightboxState) => void) | null = null;

export function openLightbox(
  bucket: string,
  path: string,
  name?: string,
  gallery?: GalleryItem[],
) {
  if (!lightboxSetter) return;
  const list = gallery && gallery.length > 0 ? gallery : [{ bucket, path, name }];
  const idx = Math.max(0, list.findIndex((g) => g.bucket === bucket && g.path === path));
  lightboxSetter({ gallery: list, index: idx === -1 ? 0 : idx });
}

export function LightboxRoot() {
  const [state, setState] = useState<LightboxState>(null);
  useEffect(() => { lightboxSetter = setState; return () => { lightboxSetter = null; }; }, []);
  if (!state) return null;
  return createPortal(<Lightbox state={state} onClose={() => setState(null)} />, document.body);
}

async function resolveUrl(bucket: string, path: string): Promise<string | null> {
  const local = getCachedLocalBlob(bucket, path);
  if (local) return URL.createObjectURL(local);
  if (navigator.onLine) {
    try {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      if (data?.signedUrl) return data.signedUrl;
    } catch {}
  }
  const blob = await getLocalBlob(bucket, path);
  if (blob) return URL.createObjectURL(blob);
  return null;
}

function Lightbox({ state, onClose }: { state: NonNullable<LightboxState>; onClose: () => void }) {
  const [index, setIndex] = useState(state.index);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pinchRef = useRef<{ dist: number; zoom: number } | null>(null);
  const cacheRef = useRef<Map<string, string>>(new Map());
  const objectUrlsRef = useRef<Set<string>>(new Set());

  // Lock background scroll while open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevTouch = document.body.style.touchAction;
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.touchAction = prevTouch;
    };
  }, []);

  // Reset zoom when switching images
  useEffect(() => { setZoom(1); setPan({ x: 0, y: 0 }); }, [index]);
  const gallery = state.gallery;
  const current = gallery[index];

  const cacheKey = (g: GalleryItem) => `${g.bucket}:${g.path}`;

  useEffect(() => {
    return () => {
      objectUrlsRef.current.forEach((u) => { try { URL.revokeObjectURL(u); } catch {} });
      objectUrlsRef.current.clear();
      cacheRef.current.clear();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const key = cacheKey(current);
    const cached = cacheRef.current.get(key);
    if (cached) {
      setSrc(cached);
    } else {
      setSrc(null);
      (async () => {
        const u = await resolveUrl(current.bucket, current.path);
        if (cancelled) return;
        if (u) {
          if (u.startsWith("blob:")) objectUrlsRef.current.add(u);
          cacheRef.current.set(key, u);
          setSrc(u);
        } else {
          setError(navigator.onLine ? "Could not load this photo." : "Photo not available offline.");
        }
      })();
    }
    // Preload neighbors.
    const preload = async (i: number) => {
      if (i < 0 || i >= gallery.length) return;
      const g = gallery[i];
      const k = cacheKey(g);
      if (cacheRef.current.has(k)) return;
      const u = await resolveUrl(g.bucket, g.path);
      if (u) {
        if (u.startsWith("blob:")) objectUrlsRef.current.add(u);
        cacheRef.current.set(k, u);
      }
    };
    preload(index - 1);
    preload(index + 1);
    return () => { cancelled = true; };
  }, [current.bucket, current.path, index, gallery]);

  const go = (delta: number) => {
    if (gallery.length <= 1) return;
    setIndex((i) => (i + delta + gallery.length) % gallery.length);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
      else if (e.key === "Escape") { e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [gallery.length, onClose]);

  const touchStartXRef = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { dist, zoom };
      touchStartXRef.current = null;
    } else if (e.touches.length === 1) {
      if (zoom > 1) {
        panStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, px: pan.x, py: pan.y };
        touchStartXRef.current = null;
      } else {
        touchStartXRef.current = e.touches[0].clientX;
      }
    }
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const next = Math.min(6, Math.max(1, pinchRef.current.zoom * (dist / pinchRef.current.dist)));
      setZoom(next);
      if (next === 1) setPan({ x: 0, y: 0 });
    } else if (e.touches.length === 1 && panStartRef.current) {
      const dx = e.touches[0].clientX - panStartRef.current.x;
      const dy = e.touches[0].clientY - panStartRef.current.y;
      setPan({ x: panStartRef.current.px + dx, y: panStartRef.current.py + dy });
    }
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    pinchRef.current = null;
    panStartRef.current = null;
    const start = touchStartXRef.current;
    touchStartXRef.current = null;
    if (start == null || zoom > 1) return;
    const delta = (e.changedTouches[0]?.clientX ?? start) - start;
    if (delta < -50) go(1);
    else if (delta > 50) go(-1);
  };

  const onWheel = (e: React.WheelEvent) => {
    const next = Math.min(6, Math.max(1, zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
    setZoom(next);
    if (next === 1) setPan({ x: 0, y: 0 });
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (zoom > 1) { setZoom(1); setPan({ x: 0, y: 0 }); }
    else setZoom(2);
  };

  const download = async () => {
    let blob = getCachedLocalBlob(current.bucket, current.path) ?? await getLocalBlob(current.bucket, current.path);
    if (!blob && navigator.onLine) {
      try {
        const { data } = await supabase.storage.from(current.bucket).download(current.path);
        if (data) blob = data;
      } catch {}
    }
    if (!blob) { setError("Photo not available offline."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = current.name || current.path.split("/").pop() || "photo";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const hasNav = gallery.length > 1;

  return (
    <div
      onClick={onClose}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onWheel={onWheel}
      data-no-swipe
      className="fixed inset-0 z-[100] flex touch-none items-center justify-center overscroll-contain bg-black/90 p-4"
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
      <div className="absolute left-4 top-4 flex gap-2">
        <button
          onClick={(e) => { e.stopPropagation(); setZoom((z) => Math.min(6, z * 1.25)); }}
          className="rounded-full bg-white/10 px-3 py-1.5 text-base font-semibold text-white hover:bg-white/20"
          aria-label="Zoom in"
        >+</button>
        <button
          onClick={(e) => { e.stopPropagation(); setZoom((z) => { const n = Math.max(1, z / 1.25); if (n === 1) setPan({ x: 0, y: 0 }); return n; }); }}
          className="rounded-full bg-white/10 px-3 py-1.5 text-base font-semibold text-white hover:bg-white/20"
          aria-label="Zoom out"
        >−</button>
      </div>
      {hasNav && zoom === 1 && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); go(-1); }}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Previous"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); go(1); }}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
            aria-label="Next"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs text-white/70">
            {index + 1} / {gallery.length}
          </div>
        </>
      )}
      {error ? (
        <p className="text-sm text-white">{error}</p>
      ) : src ? (
        <img
          src={src}
          alt=""
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={onDoubleClick}
          onError={onImgError}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: "center", transition: "transform 0.1s ease-out" }}
          className="max-h-full max-w-full select-none object-contain"
          draggable={false}
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
  gallery,
}: {
  bucket?: string;
  path: string;
  imgClassName?: string;
  containerClassName?: string;
  canEdit?: boolean;
  onRemove?: () => void;
  gallery?: GalleryItem[];
}) {
  const src = useStorageUrl(bucket, path);
  return (
    <div className={`relative ${containerClassName ?? ""}`}>
      {src ? (
        <button
          type="button"
          onClick={() => openLightbox(bucket, path, undefined, gallery)}
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
