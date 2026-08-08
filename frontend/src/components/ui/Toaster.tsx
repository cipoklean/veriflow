import { useToast } from '@/hooks/useToast';
import { X, CheckCircle, AlertCircle, AlertTriangle, ExternalLink, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="pointer-events-none fixed right-6 top-6 z-[60] flex w-[min(24rem,calc(100vw-3rem))] flex-col gap-2">
      <AnimatePresence>
        {toasts.map(toast => (
          <Toast
            key={toast.id}
            toast={toast}
            onDismiss={dismiss}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

interface ToastProps {
  toast: {
    id: string;
    title: string;
    description?: string;
    type?: 'default' | 'success' | 'error' | 'warning';
    duration?: number;
    txHash?: string;
    action?: { label: string; onClick: () => void };
  };
  onDismiss: (id: string) => void;
}

function Toast({ toast, onDismiss }: ToastProps) {
  const duration = toast.duration === Infinity ? null : toast.duration ?? 5000;

  const styles = {
    default: 'border-white/12',
    success: 'border-success-primary/30',
    error: 'border-error-primary/35',
    warning: 'border-warning-primary/30',
  };

  const icons = {
    default: null,
    success: <CheckCircle className="h-5 w-5 text-success-primary" />,
    error: <AlertCircle className="h-5 w-5 text-error-primary" />,
    warning: <AlertTriangle className="h-5 w-5 text-warning-primary" />,
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 40, scale: 0.95 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 40, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className={cn(
        'pointer-events-auto relative overflow-hidden rounded-2xl border bg-[#0E1A2B]/95 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl',
        styles[toast.type ?? 'default']
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        {icons[toast.type ?? 'default'] && (
          <div className="mt-0.5 flex-shrink-0" aria-hidden="true">
            {icons[toast.type ?? 'default']}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text-primary">{toast.title}</p>
          {toast.description && (
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">{toast.description}</p>
          )}
          {(toast.txHash || toast.action) && (
            <div className="mt-2 flex items-center gap-2">
              {toast.txHash && (
                <a
                  href={`https://testnet.monadexplorer.com/tx/${toast.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-accent-cyan transition-colors hover:bg-white/10"
                >
                  <ExternalLink className="h-3 w-3" /> View tx
                </a>
              )}
              {toast.action && (
                <button
                  onClick={toast.action.onClick}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-text-primary transition-colors hover:bg-white/10"
                >
                  <RotateCcw className="h-3 w-3" /> {toast.action.label}
                </button>
              )}
            </div>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          className="flex-shrink-0 rounded-lg p-1 text-text-muted transition-colors hover:bg-white/8 hover:text-text-primary"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Auto-dismiss progress bar (shrinks over duration; none for Infinity) */}
      {duration !== null && (
        <motion.div
          key={toast.id}
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: duration / 1000, ease: 'linear' }}
          onAnimationComplete={() => onDismiss(toast.id)}
          className={cn(
            'absolute bottom-0 left-0 h-0.5',
            (toast.type ?? 'default') === 'error' ? 'bg-error-primary/60' : (toast.type ?? 'default') === 'warning' ? 'bg-warning-primary/60' : 'bg-accent-teal/60'
          )}
        />
      )}
    </motion.div>
  );
}
