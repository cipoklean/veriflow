import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface Toast {
  id: string;
  title: string;
  description?: string;
  type?: 'default' | 'success' | 'error' | 'warning';
  duration?: number;
  txHash?: string;
  action?: { label: string; onClick: () => void };
}

interface ToastContextType {
  toasts: Toast[];
  toast: (props: Omit<Toast, 'id'>) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback(({ title, description, type = 'default', duration = 5000, txHash, action }: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, title, description, type, duration, txHash, action }]);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
}