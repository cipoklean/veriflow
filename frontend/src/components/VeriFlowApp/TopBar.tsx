import { useLocation } from 'react-router-dom';
import { Menu } from 'lucide-react';
import { WalletButton } from './WalletButton';

const titles: Record<string, string> = {
  '/': 'Dashboard',
  '/swap': 'Swap',
  '/pools': 'Pools',
  '/liquidity': 'Liquidity',
  '/analytics': 'Analytics',
  '/settings': 'Settings',
};

interface TopBarProps {
  onOpenMobile: () => void;
}

export function TopBar({ onOpenMobile }: TopBarProps) {
  const location = useLocation();
  const title =
    titles[location.pathname] ??
    (location.pathname.startsWith('/swap')
      ? 'Swap'
      : location.pathname.startsWith('/pools')
      ? 'Pools'
      : location.pathname.startsWith('/liquidity')
      ? 'Liquidity'
      : location.pathname.startsWith('/analytics')
      ? 'Analytics'
      : 'Dashboard');

  return (
    <header className="sticky top-0 z-30 h-[72px] glass border-b border-border-subtle flex items-center justify-between px-5 sm:px-8">
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobile}
          className="lg:hidden p-2 -ml-2 rounded-lg text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg font-semibold text-text-primary tracking-tight">{title}</h1>
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
