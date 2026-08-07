import { useToast } from '@/hooks/useToast';
import { X, CheckCircle, AlertCircle, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEffect } from 'react';

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          toast={toast}
          onDismiss={dismiss}
        />
      ))}
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
  };
  onDismiss: (id: string) => void;
}

function Toast({ toast, onDismiss }: ToastProps) {
  useEffect(() => {
    if (toast.duration !== Infinity) {
      const timer = setTimeout(() => onDismiss(toast.id), toast.duration ?? 5000);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, onDismiss]);

  const styles = {
    default: 'bg-bg-secondary border-border-primary',
    success: 'bg-success-light/20 border-success-primary/30',
    error: 'bg-error-light/20 border-error-primary/30',
    warning: 'bg-warning-light/20 border-warning-primary/30',
  };

  const icons = {
    default: null,
    success: <CheckCircle className="h-5 w-5 text-success-primary" />,
    error: <AlertCircle className="h-5 w-5 text-error-primary" />,
    warning: <AlertTriangle className="h-5 w-5 text-warning-primary" />,
  };

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 p-4 rounded-xl border shadow-xl min-w-[300px] max-w-md animate-slide-up',
        styles[toast.type ?? 'default']
      )}
      role="alert"
    >
      {icons[toast.type ?? 'default'] && (
        <div className="flex-shrink-0 mt-0.5" aria-hidden="true">
          {icons[toast.type ?? 'default']}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="font-medium text-text-primary">{toast.title}</p>
        {toast.description && (
          <p className="text-sm text-text-secondary mt-1">{toast.description}</p>
        )}
      </div>
      <button
        onClick={() => onDismiss(toast.id)}
        className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors p-1"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}