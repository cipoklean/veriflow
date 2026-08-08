import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Check, AlertTriangle } from 'lucide-react';
import { type ButtonHTMLAttributes, type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

export type ActionState = 'idle' | 'signing' | 'pending' | 'success' | 'error';

interface ActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Driving state of the action state machine. */
  state?: ActionState;
  /** Label for the idle state (or per-state overrides below). */
  children: ReactNode;
  signingLabel?: ReactNode;
  pendingLabel?: ReactNode;
  successLabel?: ReactNode;
  errorLabel?: ReactNode;
  /** Decoded reason shown inline under the button in error state. */
  errorMessage?: string;
  /** Called when the user clicks Retry after an error. */
  onRetry?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  className?: string;
}

/**
 * Busy ≠ disabled: idle → signing → pending → success → error with a
 * compositor-friendly motion layer. Success morphs a check + glow bloom then
 * resets; error shakes (200ms) + red glow + inline reason + Retry.
 * The button is NEVER gray while busy — signing/pending glow pulse instead.
 * Disabled is only used when the action isn't applicable (see tooltips §1).
 */
export function ActionButton({
  state = 'idle',
  children,
  signingLabel = 'Confirm in wallet…',
  pendingLabel = 'Processing…',
  successLabel = 'Done',
  errorLabel = 'Failed',
  errorMessage,
  onRetry,
  variant = 'primary',
  className,
  disabled,
  ...props
}: ActionButtonProps) {
  const [showSuccess, setShowSuccess] = useState(false);
  const [showError, setShowError] = useState(false);
  const prevState = useRef<ActionState>(state);

  // Success: morph + bloom, then reset to idle after 1.6s.
  useEffect(() => {
    if (state === 'success' && prevState.current !== 'success') {
      setShowSuccess(true);
      const t = setTimeout(() => setShowSuccess(false), 1600);
      return () => clearTimeout(t);
    }
    // Error: shake + red glow while state === error.
    if (state === 'error') setShowError(true);
    else setShowError(false);
    prevState.current = state;
  }, [state]);

  const isBusy = state === 'signing' || state === 'pending';

  const variantClasses = disabled
    ? 'btn-disabled'
    : {
        primary: 'btn-primary',
        secondary: 'btn-secondary',
        danger: 'btn-danger',
      }[variant];

  return (
    <div className={cn('w-full', className)}>
      <motion.button
        type="button"
        disabled={disabled || isBusy}
        className={cn(
          'btn w-full gap-2',
          variantClasses,
          showError && 'border-error-primary/60',
          isBusy && 'glow-pulse',
          className
        )}
        animate={
          showError
            ? { x: [0, -6, 6, -4, 4, 0] }
            : state === 'success' || showSuccess
              ? { scale: [1, 1.015, 1] }
              : {}
        }
        transition={showError ? { duration: 0.2 } : { duration: 0.4, ease: 'easeOut' }}
        onClick={props.onClick}
        onKeyDown={props.onKeyDown}
      >
        <AnimatePresence mode="wait" initial={false}>
          {isBusy ? (
            <motion.span
              key="busy"
              className="inline-flex items-center gap-2"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.12 }}
            >
              <Loader2 className="h-4 w-4 animate-spin" />
              {state === 'signing' ? signingLabel : pendingLabel}
            </motion.span>
          ) : showSuccess || state === 'success' ? (
            <motion.span
              key="success"
              className="inline-flex items-center gap-2"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <Check className="h-4 w-4" />
              {successLabel}
            </motion.span>
          ) : state === 'error' ? (
            <motion.span
              key="error"
              className="inline-flex items-center gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              <AlertTriangle className="h-4 w-4" />
              {errorLabel}
            </motion.span>
          ) : (
            <motion.span
              key="idle"
              className="inline-flex items-center justify-center gap-2"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
            >
              {children}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>

      <AnimatePresence>
        {showError && errorMessage && (
          <motion.p
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="mt-2 overflow-hidden text-xs leading-relaxed text-error-primary"
          >
            {errorMessage}
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="ml-2 font-semibold underline underline-offset-2 hover:text-text-primary transition-colors"
              >
                Retry
              </button>
            )}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
