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
  const explorerUrl = `https://testnet.monadexplorer.com/address/${address}`;

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
        {/* Full-address tooltip is SUPPRESSED while the dropdown is open. */}
        <Tooltip content={address ?? ''} placement="bottom" enabled={!isMenuOpen}>
          <button
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-haspopup="menu"
            aria-expanded={isMenuOpen}
            className="btn-secondary flex h-10 max-w-[14rem] items-center gap-2 px-4"
          >
            <span className="live-dot flex-shrink-0" aria-hidden="true" />
            <span className="font-mono text-sm text-text-primary truncate max-w-[10rem]">
              {formatAddress(address!, 4)}
            </span>
            <ChevronDown
              className={cn('h-4 w-4 flex-shrink-0 text-text-muted transition-transform', isMenuOpen && 'rotate-180')}
            />
          </button>
        </Tooltip>

        {isMenuOpen && (
          <div
            role="menu"
            className="absolute right-0 top-[calc(100%+8px)] z-50 min-w-[280px] overflow-hidden rounded-2xl border border-white/10 bg-[#0E1A2B] shadow-2xl"
          >
            {/* Header block */}
            <div className="p-3">
              <div className="font-mono text-sm text-text-primary truncate">{formatAddress(address!, 4)}</div>
              {balance && (
                <div className="mt-1 flex items-baseline gap-1">
                  <span className="font-mono text-sm text-text-primary">{formattedBalance}</span>
                  <span className="text-sm text-text-secondary">{balance.symbol}</span>
                </div>
              )}
              {chainId === monadTestnet.id ? (
                <div className="mt-2 flex items-center gap-1 text-xs text-accent-green">
                  <span className="h-1.5 w-1.5 rounded-full bg-accent-green" />
                  Monad Testnet · {chainId}
                </div>
              ) : (
                <button
                  onClick={() => switchChain({ chainId: monadTestnet.id })}
                  className="mt-2 flex items-center gap-1 text-xs text-error-primary hover:underline"
                >
                  <AlertTriangle className="h-3 w-3" /> Switch to Monad Testnet
                </button>
              )}
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex items-center gap-1 text-xs text-text-muted hover:text-accent-teal transition-colors"
              >
                <ExternalLink className="h-3 w-3" />
                View on Explorer
              </a>
            </div>

            {/* Divider */}
            <div className="my-1 border-t border-white/10" />

            {/* Menu items */}
            <div className="space-y-1 p-2">
              <button
                role="menuitem"
                onClick={() => {
                  navigator.clipboard.writeText(address!);
                  setIsMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                <Copy className="h-4 w-4" />
                <span className="flex-1 text-left">Copy Address</span>
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  disconnect();
                  window.localStorage.removeItem('wagmi.connected');
                  setIsMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-error-primary transition-colors hover:bg-white/5"
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
