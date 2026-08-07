import { useAccount, useConnect, useDisconnect, useBalance, useChainId, useSwitchChain } from 'wagmi';
import { formatUnits } from 'viem';
import { Wallet, LogOut, ChevronDown, Loader2, X, ExternalLink, AlertTriangle, Copy } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { cn, formatAddress } from '@/lib/utils';
import { monadTestnet } from '@/chains';

interface ConnectorInfo {
  id: string;
  name: string;
  icon?: React.ReactNode | string;
}

export function WalletButton() {
  const { address, isConnected, isConnecting } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { data: balance } = useBalance({ address });
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showConnectModal, setShowConnectModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Reconnect the previously used connector automatically (wagmi persists
  // connection state across reloads once a connector has been used).
  useEffect(() => {
    const tryAutoConnect = async () => {
      const previouslyUsed = window.localStorage.getItem('wagmi.connected');
      if (!previouslyUsed || isConnected) return;
      const connector = connectors.find(c => c.id === previouslyUsed || c.name === previouslyUsed);
      if (connector) {
        try {
          await connect({ connector });
        } catch {
          /* ignore auto-connect failures */
        }
      }
    };
    tryAutoConnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist which connector was used so we can auto-reconnect next visit.
  useEffect(() => {
    if (isConnected && connectors.length) {
      const active = connectors.find(c => (c as unknown as { [k: string]: unknown }).status === 'connected') ?? connectors[0];
      if (active) window.localStorage.setItem('wagmi.connected', active.id);
    }
  }, [isConnected, connectors]);

  // Close menus on outside click and Escape.
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        setShowConnectModal(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setShowConnectModal(false);
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  const availableConnectors: ConnectorInfo[] = connectors.map(c => ({
    id: c.id,
    name: c.name ?? c.id,
    icon: (c as unknown as { icon?: React.ReactNode }).icon,
  }));

  const handleConnect = (connectorId: string) => {
    const connector = connectors.find(c => c.id === connectorId);
    if (!connector) return;
    connect({ connector }, {
      onError: (err) => {
        console.error('[VeriFlow] wallet connect failed:', err);
        window.alert(
          'Wallet connection failed: ' + (err?.message ?? 'unknown error') +
          '\n\nMake sure your wallet is unlocked and set to Monad Testnet.'
        );
      },
      onSuccess: () => setShowConnectModal(false),
    });
  };

  const onWrongNetwork = isConnected && chainId !== monadTestnet.id;

  if (isConnecting || isPending) {
    return (
      <button className="btn-primary gap-2" disabled>
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>Connecting...</span>
      </button>
    );
  }

  if (!isConnected) {
    return (
      <>
        <button onClick={() => setShowConnectModal(true)} className="btn-primary gap-2">
          <Wallet className="h-4 w-4" />
          <span>Connect Wallet</span>
        </button>

        {createPortal(
          showConnectModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-fade-in"
            onClick={() => setShowConnectModal(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-modal-title"
          >
            <div
              ref={modalRef}
              className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0E1A2B] p-6 shadow-[0_0_40px_rgba(45,212,191,0.15)] animate-slide-up"
              onClick={e => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h2 id="connect-modal-title" className="text-lg font-semibold text-text-primary">
                  Connect Wallet
                </h2>
                <button
                  onClick={() => setShowConnectModal(false)}
                  className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary focus-visible:ring-2 focus-visible:ring-accent-cyan"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <p className="mb-4 text-sm text-text-secondary">
                Choose your preferred wallet to connect to VeriFlow
              </p>
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
                      className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-4 py-3 text-text-primary transition-all duration-200 hover:border-accent-teal/50 hover:bg-accent-teal/10 hover:shadow-[0_0_20px_rgba(45,212,191,0.18)] focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan"
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
      </>
    );
  }

  const formattedBalance = balance ? formatUnits(balance.value, balance.decimals).slice(0, 8) : '0';

  return (
    <div className="flex items-center gap-2">
      {onWrongNetwork && (
        <button
          onClick={() => switchChain({ chainId: monadTestnet.id })}
          disabled={isSwitching}
          className="btn-secondary gap-2 border-error-primary/40 text-error-primary hover:bg-error-light/10"
        >
          <AlertTriangle className="h-4 w-4" />
          {isSwitching ? 'Switching…' : 'Wrong network'}
        </button>
      )}

      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setIsMenuOpen(!isMenuOpen)}
          className="btn-secondary gap-2 min-w-[180px] justify-between"
        >
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <Wallet className="h-4 w-4 text-accent-gold" />
            <span className="font-mono text-sm truncate">{formatAddress(address!)}</span>
          </div>
          <ChevronDown className={cn('h-4 w-4 text-text-muted transition-transform', isMenuOpen && 'rotate-180')} />
        </button>

        {isMenuOpen && (
          <div className="absolute right-0 mt-2 w-64 bg-bg-secondary border border-border-primary rounded-xl shadow-xl overflow-hidden animate-slide-down z-50">
            <div className="p-3 border-b border-border-primary">
              <div className="font-mono text-sm text-text-primary">{formatAddress(address!, 6)}</div>
              {balance && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-mono text-text-primary">{formattedBalance}</span>
                  <span className="text-sm text-text-secondary">{balance.symbol}</span>
                </div>
              )}
              {chainId === monadTestnet.id ? (
                <div className="flex items-center gap-1 mt-2 text-xs text-success-primary">
                  <span className="w-1.5 h-1.5 rounded-full bg-success-primary" /> Monad Testnet · {chainId}
                </div>
              ) : (
                <button
                  onClick={() => switchChain({ chainId: monadTestnet.id })}
                  className="flex items-center gap-1 mt-2 text-xs text-error-primary hover:underline"
                >
                  <AlertTriangle className="h-3 w-3" /> Switch to Monad Testnet
                </button>
              )}
              <a
                href={`https://testnet.monadexplorer.com/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 mt-2 text-xs text-text-muted hover:text-accent-gold transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                View on Explorer
              </a>
            </div>
            <div className="py-1">
              <button
                onClick={() => {
                  navigator.clipboard.writeText(address!);
                  setIsMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:text-text-primary hover:bg-bg-tertiary transition-colors"
              >
                <Copy className="h-4 w-4" />
                <span className="flex-1 text-left">Copy Address</span>
              </button>
              <button
                onClick={() => {
                  disconnect();
                  window.localStorage.removeItem('wagmi.connected');
                  setIsMenuOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-error-primary hover:bg-error-light/10 transition-colors"
              >
                <LogOut className="h-4 w-4" />
                <span className="flex-1 text-left">Disconnect</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
