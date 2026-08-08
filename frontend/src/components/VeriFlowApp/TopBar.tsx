import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { WalletButton } from './WalletButton';

const titles: Record<string, { title: string; subtitle: string }> = {
  '/': { title: 'Dashboard', subtitle: 'Protocol overview' },
  '/swap': { title: 'Swap', subtitle: 'Trade compliant assets' },
  '/pools': { title: 'Pools', subtitle: 'Browse liquidity markets' },
  '/liquidity': { title: 'Liquidity', subtitle: 'Provide or withdraw' },
  '/analytics': { title: 'Analytics', subtitle: 'Live on-chain metrics' },
  '/settings': { title: 'Settings', subtitle: 'Identity & preferences' },
};

interface TopBarProps {
  onOpenMobile: () => void;
}

export function TopBar({ onOpenMobile }: TopBarProps) {
  const location = useLocation();
  const meta =
    titles[location.pathname] ??
    (location.pathname.startsWith('/swap')
      ? { title: 'Swap', subtitle: 'Trade compliant assets' }
      : location.pathname.startsWith('/pools')
      ? { title: 'Pools', subtitle: 'Browse liquidity markets' }
      : location.pathname.startsWith('/liquidity')
      ? { title: 'Liquidity', subtitle: 'Provide or withdraw' }
      : location.pathname.startsWith('/analytics')
      ? { title: 'Analytics', subtitle: 'Live on-chain metrics' }
      : { title: 'Dashboard', subtitle: 'Protocol overview' });

  return (
    <header className="sticky top-0 z-30 h-[72px] glass border-b border-border-subtle flex items-center justify-between px-5 sm:px-8 relative">
      {/* Premium gradient hairline under the glass bar */}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-accent-teal/40 to-transparent" />
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobile}
          className="lg:hidden p-2 -ml-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="leading-tight">
          <h1 className="text-lg font-semibold text-text-primary tracking-tight">{meta.title}</h1>
          <p className="text-xs text-text-muted">{meta.subtitle}</p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {/* Connect Wallet: gradient-border wrapper around the wallet button */}
        <div className="btn-gradient-border rounded-full">
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
