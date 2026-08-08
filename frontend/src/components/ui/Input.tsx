import { cn } from '@/lib/utils';
import { type InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  id?: string;
}

/**
 * Soft-depth input: recessed ("carved") with inset shadows; labels stay
 * visible (never placeholder-only).
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, hint, error, id, className, ...props }, ref) => {
    const inputId = id ?? props.name;
    return (
      <div className="space-y-1.5">
        {label && (
          <label htmlFor={inputId} className="block text-xs font-medium uppercase tracking-wider text-text-muted">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn('input', error && 'border-error-primary/60', className)}
          aria-invalid={error ? true : undefined}
          {...props}
        />
        {error ? (
          <p className="text-xs text-error-primary" role="alert">{error}</p>
        ) : hint ? (
          <p className="text-xs text-text-muted">{hint}</p>
        ) : null}
      </div>
    );
  }
);
Input.displayName = 'Input';
