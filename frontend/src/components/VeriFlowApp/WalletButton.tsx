import { useAccount, useConnect, useDisconnect, useBalance, useChainId, useSwitchChain } from 'wagmi';
import { formatUnits } from 'viem';
import { Wallet, LogOut, ChevronDown, Loader2, ExternalLink, AlertTriangle, Copy } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { cn, formatAddress } from '@/lib/utils';
import { monadTestnet } from '@/chains';
import { Tooltip } from '@/components/ui/Tooltip';
import { useWalletModal } from './WalletModalProvider';

export function WalletButton() {
  const { address, isConnected, isConnecting } = useAccount();
  const chainId = useChainId();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();
  const { data: balance } = useBalance({ address });
  const { open: openWalletModal } = useWalletModal();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
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
      <button onClick={() => openWalletModal()} className="btn-primary gap-2">
        <Wallet className="h-4 w-4" />
        <span>Connect Wallet</span>
      </button>
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
        <Tooltip
          content={address ?? ''}
          placement="bottom"
        >
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="btn-secondary gap-2 min-w-[180px] h-10 justify-between px-3"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="flex items-center gap-2 min-w-0">
                <span className="live-dot flex-shrink-0" aria-hidden="true" />
                <span className="font-mono text-sm truncate">{formatAddress(address!)}</span>
              </span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-text-muted transition-transform flex-shrink-0', isMenuOpen && 'rotate-180')} />
          </button>
        </Tooltip>

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
