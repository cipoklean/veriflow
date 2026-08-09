import { useAccount, useConnect, useSwitchChain } from 'wagmi';
import { Wallet, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { monadTestnet } from '@/chains';

const MONAD_CHAIN_ID = monadTestnet.id; // 10143

interface WalletModalContextType {
  /** Open the wallet-connect modal from anywhere (TopBar, gated CTAs). */
  open: () => void;
  close: () => void;
  isOpen: boolean;
}

const WalletModalContext = createContext<WalletModalContextType | null>(null);

export function useWalletModal() {
  const ctx = useContext(WalletModalContext);
  if (!ctx) throw new Error('useWalletModal must be used within WalletModalProvider');
  return ctx;
}

/**
 * FE-01: single source of truth for the wallet-connect modal. TopBar's
 * WalletButton AND the gated-page "Connect Wallet" CTAs both call open() —
 * the old `<a href="/#wallet">` navigated to Dashboard because no #wallet
 * element exists. Connectors render here, portal'd to document.body.
 */
export function WalletModalProvider({ children }: { children: ReactNode }) {
  const { connect, connectors, isPending } = useConnect();
  const { isConnected, chainId, address } = useAccount();
  const { switchChain, isPending: isSwitchingChain } = useSwitchChain();
  const [isOpen, setIsOpen] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => {
    setIsOpen(false);
    setConnectError(null);
  }, []);

  // Auto-close once connected (or if already connected when opened).
  useEffect(() => {
    if (isConnected) setIsOpen(false);
  }, [isConnected]);

  // AUTO CHAIN-SWITCH: the app only runs on Monad Testnet (10143). Whenever a
  // wallet connects on ANY other chain, immediately prompt the wallet to switch.
  // Covers fresh connects AND auto-reconnects (wagmi restores the last session).
  useEffect(() => {
    if (isConnected && chainId && chainId !== MONAD_CHAIN_ID) {
      // a wallet that reports the wrong chain is a wallet we must switch
      try {
        void switchChain({ chainId: MONAD_CHAIN_ID });
      } catch (err) {
        console.error('[VeriFlow] auto chain-switch failed:', err);
      }
    }
  }, [isConnected, chainId, address, switchChain, isSwitchingChain]);

  // Close on outside click and Escape.
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const availableConnectors = connectors.map(c => ({
    id: c.id,
    name: c.name ?? c.id,
    icon: (c as unknown as { icon?: ReactNode }).icon,
  }));

  const handleConnect = (connectorId: string) => {
    const connector = connectors.find(c => c.id === connectorId);
    if (!connector) return;
    setConnectError(null);
    connect({ connector }, {
      onError: (err) => {
        // L-13: inline error in the modal (replaces window.alert) — matches the
        // inline error/toast pattern used elsewhere in the app.
        setConnectError(
          (err?.message ?? 'unknown error') +
          ' — make sure your wallet is unlocked and set to Monad Testnet.',
        );
      },
      onSuccess: () => setIsOpen(false),
    });
  };

  return (
    <WalletModalContext.Provider value={{ open, close, isOpen }}>
      {children}
      {createPortal(
        isOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#06090F]/70 p-4 backdrop-blur-md animate-fade-in"
            onClick={close}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-modal-title"
          >
            <div
              ref={modalRef}
              className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-3xl border border-white/12 p-6 animate-slide-up bg-gradient-to-b from-white/[0.07] to-white/[0.03] backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.10),0_30px_80px_rgba(0,0,0,0.60),0_0_50px_rgba(45,212,191,0.12)]"
              onClick={e => e.stopPropagation()}
            >
              <div className="mb-4 flex items-center justify-between">
                <h2 id="connect-modal-title" className="font-display text-lg font-semibold text-text-primary">
                  Connect Wallet
                </h2>
                <button
                  onClick={close}
                  className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-cyan"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mb-4 text-sm text-text-secondary">
                Choose your preferred wallet to connect to VeriFlow
              </p>
              {connectError && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300"
                >
                  {connectError}
                </div>
              )}
              <div className="space-y-2">
                {availableConnectors.length === 0 ? (
                  <div className="py-6 text-center text-text-secondary">
                    <Wallet className="mx-auto mb-3 h-10 w-10 text-border-secondary" />
                    <p className="font-medium">No wallets detected</p>
                    <p className="mt-1 text-sm">
                      Install <a href="https://metamask.io/download/" target="_blank" rel="noopener noreferrer" className="text-accent-teal hover:underline">MetaMask</a> or another Web3 wallet to continue
                    </p>
                  </div>
                ) : (
                  availableConnectors.map(connector => (
                    <button
                      key={connector.id}
                      onClick={() => handleConnect(connector.id)}
                      disabled={isPending}
                      className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-text-primary transition-all duration-200 hover:border-accent-teal/50 hover:bg-accent-teal/10 hover:shadow-[0_0_20px_rgba(45,212,191,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan disabled:opacity-60"
                    >
                      {typeof connector.icon === 'string' ? (
                        <img
                          src={connector.icon}
                          alt={`${connector.name} icon`}
                          className="h-8 w-8 flex-shrink-0 rounded-lg object-contain"
                        />
                      ) : connector.icon ? (
                        <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center">{connector.icon}</div>
                      ) : (
                        <Wallet className="h-8 w-8 flex-shrink-0 text-accent-teal" />
                      )}
                      <span className="min-w-0 flex-1 truncate font-medium">{connector.name}</span>
                    </button>
                  ))
                )}
              </div>
              <p className="mt-4 text-center text-xs text-text-muted">
                By connecting, you agree to our{' '}
                <a href="#" className="underline hover:text-accent-teal">Terms of Service</a>
                {' '}and{' '}
                <a href="#" className="underline hover:text-accent-teal">Privacy Policy</a>
              </p>
            </div>
          </div>
        ),
        document.body,
      )}
    </WalletModalContext.Provider>
  );
}
