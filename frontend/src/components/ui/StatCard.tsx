import { cn, formatPercent } from '@/lib/utils';
import { type ReactNode } from 'react';
import { useSparklineDraw } from '@/lib/motion';

interface SparklineProps {
  points: number[];
  className?: string;
  /** teal gradient stroke + fading area fill (signature palette) */
  stroke?: string;
  strokeWidth?: number;
}

/**
 * SVG sparkline: teal-gradient stroke with a fading area fill. Pure data —
 * pass real event-derived values; render nothing meaningful when empty.
 * Re-draws with a dash animation when the data updates (living data).
 */
export function Sparkline({ points, className, stroke = '#2DD4BF', strokeWidth = 1.75 }: SparklineProps) {
  const draw = useSparklineDraw(points, 500);

  if (!points || points.length < 2) {
    return (
      <svg className={cn('sparkline', className)} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="16" x2="100" y2="16" stroke="rgba(148,163,184,0.22)" strokeWidth="1" strokeDasharray="3 4" />
      </svg>
    );
  }

  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = 100 / (points.length - 1);
  const coords = points.map((p, i) => [i * step, 30 - ((p - min) / span) * 26] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L100 32 L0 32 Z`;
  const gradId = `spark-${stroke.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <svg className={cn('sparkline', className)} viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#22D3EE" />
          <stop offset="0.55" stopColor="#2DD4BF" />
          <stop offset="1" stopColor="#34D399" />
        </linearGradient>
        <linearGradient id={`${gradId}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgba(45,212,191,0.28)" />
          <stop offset="1" stopColor="rgba(45,212,191,0)" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradId}-fill)`} />
      <path
        ref={draw.ref}
        d={line}
        fill="none"
        stroke={`url(#${gradId})`}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={draw.strokeDasharray}
        strokeDashoffset={draw.dashOffset}
      />
    </svg>
  );
}

interface StatCardProps {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  /** real delta vs prior period; undefined → flat "—" chip */
  delta?: number | null;
  deltaLabel?: string;
  /** sparkline data points (real events); undefined → no sparkline */
  spark?: number[];
  loading?: boolean;
  className?: string;
}

/**
 * Bento stat card: real on-chain value + delta chip + sparkline.
 * NEVER fake data — when loading, show a skeleton; when there are no
 * events, show the elegant empty state.
 */
export function StatCard({ label, value, icon, delta, deltaLabel, spark, loading, className }: StatCardProps) {
  const chip = delta == null ? (
    <span className="delta-chip flat">—</span>
  ) : delta > 0 ? (
    <span className="delta-chip up" aria-label={deltaLabel ?? `${delta}% vs prior`}>{formatPercent(delta)}</span>
  ) : delta < 0 ? (
    <span className="delta-chip down" aria-label={deltaLabel ?? `${delta}% vs prior`}>{formatPercent(delta)}</span>
  ) : (
    <span className="delta-chip flat">0.00%</span>
  );

  // FALLBACK GUARD: the "No data yet" empty state must ONLY show when there is
  // genuinely no value — i.e. loading, or the value is null/undefined/''/'0'.
  // A card with real (even zero) formatted data — "10.9894 MON", "Verified
  // Assets: 2", "$0.00" — must NOT render the fallback alongside the number.
  // A formatted string carries a unit/symbol ($ MON % letters), so it is always
  // a real display value, never "no data". Only a bare 0 (or empty) counts.
  const isValueEmpty = (v: ReactNode): boolean => {
    if (v == null) return true;
    if (typeof v === 'number' || typeof v === 'bigint') return v === 0;
    if (typeof v === 'string') {
      const t = v.trim();
      if (t === '') return true;
      // Unit/symbol present → real formatted display (e.g. "$0.00", "2 MON").
      if (/[A-Za-z$%]/.test(t)) return false;
      const n = Number(t);
      return n === 0 || Number.isNaN(n);
    }
    return false; // ReactElement / other node → treat as present
  };

  return (
    <div className={cn('bento-stat', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">{label}</p>
          <p className="mt-1.5 truncate font-mono text-2xl font-semibold text-text-primary tabular-nums" data-num>
            {loading ? <span className="skeleton inline-block h-6 w-24 align-middle" /> : value}
          </p>
        </div>
        {icon && (
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-accent-teal/10 text-accent-teal">
            {icon}
          </span>
        )}
      </div>
      <div className="mt-3 flex items-end justify-between gap-2">
        {loading ? (
          <span className="skeleton inline-block h-4 w-16" />
        ) : spark && spark.length >= 2 ? (
          <Sparkline points={spark} className="h-10 w-full max-w-[120px]" />
        ) : isValueEmpty(value) ? (
          <span className="text-xs text-text-muted">No data yet — be the first</span>
        ) : null}
        {chip}
      </div>
    </div>
  );
}
