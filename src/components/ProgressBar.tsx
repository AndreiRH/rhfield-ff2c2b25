interface Props {
  value: number; // 0-100
  className?: string;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export function ProgressBar({ value, className = "", size = "md", showLabel = false }: Props) {
  const h = size === "sm" ? "h-1.5" : size === "lg" ? "h-3" : "h-2";
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className={`w-full ${className}`}>
      <div className={`relative w-full overflow-hidden rounded-full bg-secondary ${h}`}>
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-success transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      {showLabel && (
        <div className="mt-1 text-xs tabular-nums text-muted-foreground">{pct}%</div>
      )}
    </div>
  );
}

export function ProgressRing({ value, size = 96 }: { value: number; size?: number }) {
  const stroke = 8;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = c - (pct / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} stroke="var(--color-secondary)" fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          stroke="var(--color-success)"
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{pct}</span>
        <span className="-mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">percent</span>
      </div>
    </div>
  );
}
