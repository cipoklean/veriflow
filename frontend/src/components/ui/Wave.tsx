import { cn } from '@/lib/utils';

interface WaveProps {
  className?: string;
  id?: string;
}

/**
 * Signature element: the logo's flowing wave. An animated gradient stroke that
 * drifts along the path. Use ONLY in hero and active nav states.
 */
export function Wave({ className, id = 'veriflowWaveGradient' }: WaveProps) {
  return (
    <span className={cn('wave-line block h-1.5 w-full', className)} aria-hidden="true">
      <svg className="wave-svg" viewBox="0 0 240 8" preserveAspectRatio="none">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="240" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#22D3EE" />
            <stop offset="0.5" stopColor="#2DD4BF" />
            <stop offset="1" stopColor="#34D399" />
          </linearGradient>
        </defs>
        <path
          className="wave-path"
          d="M0 4 C 30 0, 60 8, 90 4 S 150 0, 180 4 S 230 8, 240 4"
        />
      </svg>
    </span>
  );
}
