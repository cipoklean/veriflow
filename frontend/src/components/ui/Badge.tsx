import { cn } from '@/lib/utils';
import { type HTMLAttributes } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: 'success' | 'error' | 'warning' | 'info';
  dot?: boolean;
}

export function Badge({ tone = 'success', dot = false, className, children, ...props }: BadgeProps) {
  return (
    <span className={cn('badge', `badge-${tone}`, className)} {...props}>
      {dot && (
        <span
          className="h-1.5 w-1.5 rounded-full bg-current animate-pulse-dot"
          aria-hidden="true"
        />
      )}
      {children}
    </span>
  );
}
