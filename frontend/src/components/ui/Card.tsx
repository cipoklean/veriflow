import { cn } from '@/lib/utils';
import { type HTMLAttributes } from 'react';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

/**
 * Liquid-glass card: white/5 fill, blur-xl, 1px gradient border
 * (white/12 → teal/25), inner top highlight, deep outer shadow.
 */
export function Card({ hover = false, className, children, ...props }: CardProps) {
  return (
    <div className={cn(hover ? 'card-hover' : 'card', className)} {...props}>
      {children}
    </div>
  );
}
