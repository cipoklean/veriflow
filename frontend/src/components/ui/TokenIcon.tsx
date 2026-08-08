import { cn } from '@/lib/utils';

interface TokenIconProps {
  symbol: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeMap = {
  sm: 'h-7 w-7 text-[11px]',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

/**
 * Deterministic token monogram: letter on a brand-tinted radial chip.
 * No logos/emojis — keeps the icon system consistent and dependency-free.
 */
export function TokenIcon({ symbol, size = 'md', className }: TokenIconProps) {
  const s = symbol.replace(/\W/g, '').slice(0, 4).toUpperCase() || '?';
  const letter = s.slice(0, 1);
  // Stable hue per symbol (cyan → teal → emerald rotations, no yellow/purple).
  const hue = (symbol.length * 37 + symbol.charCodeAt(0) * 13) % 3;
  const chips = [
    'from-cyan-400/25 to-cyan-500/5 text-cyan-300',
    'from-teal-400/25 to-teal-500/5 text-teal-300',
    'from-emerald-400/25 to-emerald-500/5 text-emerald-300',
  ];
  return (
    <span
      className={cn(
        'inline-flex flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br font-bold transition-transform duration-300 group-hover:scale-110',
        sizeMap[size],
        chips[hue],
        className
      )}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}
