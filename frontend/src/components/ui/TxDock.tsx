import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Loader2, CheckCircle2, XCircle, X } from 'lucide-react';
import { useToast } from '@/hooks/useToast';
import { formatAddress } from '@/lib/utils';

export interface TxRecord {
  hash: string;
  label: string;
  status: 'pending' | 'confirmed' | 'reverted';
  startedAt: number;
  confirmedAt?: number;
}

interface TxDockContextType {
  /** Register a pending tx. Shows in the global dock bottom-right. */
  track: (hash: string, label: string) => void;
  /** Mark a tx confirmed (dock chip → check; toast fired by the hook side). */
  confirm: (hash: string) => void;
  /** Mark a tx reverted. */
  revert: (hash: string) => void;
  remove: (hash: string) => void;
  pendingCount: number;
}

const TxDockContext = createContext<TxDockContextType | null>(null);

export function useTxDock() {
  const ctx = useContext(TxDockContext);
  if (!ctx) throw new Error('useTxDock must be used within TxDockProvider');
  return ctx;
}

/** Auto-dismiss windows (ms) and matching drain animations. */
const DISMISS_MS: Record<TxRecord['status'], number> = {
  pending: 0,
  confirmed: 5000,
  reverted: 10000,
};

/**
 * Global tx dock (bottom-right): tracks ALL pending txs so the user may
 * navigate away. Each TxChip owns its own timers (elapsed tick while pending,
 * auto-dismiss after confirmation/reversion) and clears them on unmount.
 */
export function TxDockProvider({ children }: { children: ReactNode }) {
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const { toast } = useToast();

  const track = useCallback((hash: string, label: string) => {
    setTxs((prev) =>
      prev.some((t) => t.hash === hash)
        ? prev
        : [...prev, { hash, label, status: 'pending' as const, startedAt: Date.now() }],
    );
  }, []);

  const confirm = useCallback(
    (hash: string) => {
      setTxs((prev) => {
        const tx = prev.find((t) => t.hash === hash);
        if (tx && tx.status !== 'confirmed') {
          toast({ title: 'Transaction confirmed', description: tx.label, type: 'success', duration: 5000 });
        }
        return prev.map((t) =>
          t.hash === hash ? { ...t, status: 'confirmed' as const, confirmedAt: Date.now() } : t,
        );
      });
    },
    [toast],
  );

  const revert = useCallback(
    (hash: string) => {
      setTxs((prev) => {
        const tx = prev.find((t) => t.hash === hash);
        if (tx && tx.status !== 'reverted') {
          toast({ title: 'Transaction reverted', description: tx.label, type: 'error', duration: 8000 });
        }
        return prev.map((t) =>
          t.hash === hash ? { ...t, status: 'reverted' as const, confirmedAt: Date.now() } : t,
        );
      });
    },
    [toast],
  );

  const remove = useCallback((hash: string) => {
    setTxs((prev) => prev.filter((t) => t.hash !== hash));
  }, []);

  const pendingCount = txs.filter((t) => t.status === 'pending').length;

  return (
    <TxDockContext.Provider value={{ track, confirm, revert, remove, pendingCount }}>
      {children}
      {txs.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.25, ease: 'easeOut' }}
          className="fixed bottom-6 left-6 z-50 flex w-80 flex-col gap-2"
          aria-label="Pending transactions"
        >
          <AnimatePresence initial={false}>
            {txs.map((tx) => (
              <TxChip key={tx.hash} tx={tx} onRemove={remove} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </TxDockContext.Provider>
  );
}

function TxChip({ tx, onRemove }: { tx: TxRecord; onRemove: (h: string) => void }) {
  const explorer = `https://testnet.monadexplorer.com/tx/${tx.hash}`;

  // Elapsed seconds. Live-ticks every 1s while pending; freezes on the final
  // status (confirmation/reversion) using confirmedAt.
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.round((Date.now() - tx.startedAt) / 1000)),
  );
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dismissRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (tx.status === 'pending') {
      tickRef.current = setInterval(() => {
        setElapsed(Math.max(0, Math.round((Date.now() - tx.startedAt) / 1000)));
      }, 1000);
    } else {
      if (tickRef.current) clearInterval(tickRef.current);
      const end = tx.confirmedAt ?? Date.now();
      setElapsed(Math.max(0, Math.round((end - tx.startedAt) / 1000)));
    }
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, [tx.status, tx.startedAt, tx.confirmedAt]);

  // Auto-dismiss: 5s after confirmation, 10s after reversion. Cleared on
  // unmount and whenever the status changes (e.g. manual dismiss also unmounts).
  useEffect(() => {
    const ms = DISMISS_MS[tx.status];
    if (ms > 0) {
      dismissRef.current = setTimeout(() => onRemove(tx.hash), ms);
    }
    return () => {
      if (dismissRef.current) clearTimeout(dismissRef.current);
    };
  }, [tx.status, tx.hash, onRemove]);

  const dismissMs = DISMISS_MS[tx.status];
  const isPending = tx.status === 'pending';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.2 } }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="pointer-events-auto flex items-center gap-3 rounded-xl border border-white/12 bg-[#0E1A2B]/95 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] backdrop-blur-xl"
    >
      {isPending ? (
        <span className="relative flex h-7 w-7 flex-shrink-0 items-center justify-center">
          <span className="absolute inset-0 animate-ping rounded-full bg-accent-teal/20" />
          <Loader2 className="h-4 w-4 animate-spin text-accent-teal" />
        </span>
      ) : tx.status === 'confirmed' ? (
        <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-accent-green" />
      ) : (
        <XCircle className="h-5 w-5 flex-shrink-0 text-error-primary" />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-text-primary">{tx.label}</span>
          <span className="text-xs text-text-muted">{elapsed}s</span>
        </div>
        <div className="relative mt-1.5 h-1 overflow-hidden rounded-full bg-white/8">
          {isPending ? (
            <motion.div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent-cyan to-accent-teal"
              initial={{ width: '8%' }}
              animate={{ width: ['8%', '92%', '8%'] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            />
          ) : (
            // Drains over the same window as the auto-dismiss so the visual and
            // the removal stay in sync.
            <motion.div
              className={tx.status === 'confirmed' ? 'absolute inset-0 bg-accent-green/70' : 'absolute inset-0 bg-error-primary/70'}
              initial={{ width: '100%' }}
              animate={{ width: '0%' }}
              transition={{ duration: dismissMs / 1000, ease: 'linear' }}
            />
          )}
        </div>
      </div>
      <a
        href={explorer}
        target="_blank"
        rel="noopener noreferrer"
        className="flex-shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/8 hover:text-text-primary"
        aria-label="View transaction on explorer"
        title={formatAddress(tx.hash, 6)}
      >
        <ExternalLink className="h-4 w-4" />
      </a>
      <button
        onClick={() => onRemove(tx.hash)}
        className="flex-shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-white/8 hover:text-text-primary"
        aria-label="Dismiss transaction"
      >
        <X className="h-4 w-4" />
      </button>
    </motion.div>
  );
}
