import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
}

export function Modal({ open, onClose, title, children, className, labelledBy }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#06090F]/70 p-4 backdrop-blur-md animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
    >
      <div
        className={cn(
          'w-full max-w-md max-h-[80vh] overflow-y-auto rounded-3xl border border-white/12 p-6 animate-slide-up',
          'bg-gradient-to-b from-white/[0.07] to-white/[0.03] backdrop-blur-2xl',
          'shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_30px_80px_rgba(0,0,0,0.60),0_0_50px_rgba(45,212,191,0.12)]',
          className
        )}
        onClick={e => e.stopPropagation()}
      >
        {title && (
          <div className="mb-4 flex items-center justify-between">
            <h2 id={labelledBy} className="font-display text-lg font-semibold text-text-primary">
              {title}
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body
  );
}
