import * as React from "react";

import { cn } from "@/lib/utils";

const MIN_RESIZED_TEXTAREA_HEIGHT = 60;
const MAX_RESIZED_TEXTAREA_HEIGHT = 360;

const clampHeight = (height: number) =>
  Math.min(MAX_RESIZED_TEXTAREA_HEIGHT, Math.max(MIN_RESIZED_TEXTAREA_HEIGHT, height));

type TextareaProps = React.ComponentProps<"textarea"> & {
  "data-resize-key"?: string;
};

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, style, "data-resize-key": resizeKey, ...props }, ref) => {
    const innerRef = React.useRef<HTMLTextAreaElement>(null);

    React.useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement);

    React.useEffect(() => {
      if (!resizeKey || typeof window === "undefined") return;
      const el = innerRef.current;
      if (!el) return;

      const storageKey = `note_textarea_height:${resizeKey}`;
      const saved = Number(window.localStorage.getItem(storageKey));
      if (Number.isFinite(saved) && saved > 0) el.style.height = `${clampHeight(saved)}px`;

      let frame = 0;
      const observer = new ResizeObserver(([entry]) => {
        if (!entry) return;
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const height = clampHeight(Math.round(entry.contentRect.height));
          if (Math.abs(el.offsetHeight - height) > 2) el.style.height = `${height}px`;
          window.localStorage.setItem(storageKey, String(height));
        });
      });
      observer.observe(el);
      return () => {
        if (frame) cancelAnimationFrame(frame);
        observer.disconnect();
      };
    }, [resizeKey]);

    return (
      <textarea
        className={cn(
          "flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          resizeKey && "max-h-[360px] overflow-auto",
          className,
        )}
        ref={innerRef}
        data-resize-key={resizeKey}
        style={resizeKey ? { minHeight: MIN_RESIZED_TEXTAREA_HEIGHT, maxHeight: MAX_RESIZED_TEXTAREA_HEIGHT, ...style } : style}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
