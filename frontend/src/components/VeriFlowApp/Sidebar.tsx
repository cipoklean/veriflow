import { cn } from '@/lib/utils';
import { Link } from 'react-router-dom';
import { LayoutDashboard, ArrowLeftRight, Zap, Droplets, BarChart3, Settings, BookOpen, Code, X } from 'lucide-react';
import { NavItem } from './NavItem';
import { Tooltip } from '@/components/ui/Tooltip';
import logo from '@/assets/veriflow-logo.png';

const navigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard, end: true },
  { name: 'Swap', href: '/swap', icon: ArrowLeftRight },
  { name: 'Pools', href: '/pools', icon: Zap },
  { name: 'Liquidity', href: '/liquidity', icon: Droplets },
  { name: 'Analytics', href: '/analytics', icon: BarChart3 },
  { name: 'Settings', href: '/settings', icon: Settings },
];

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

export function Sidebar({ collapsed, onToggle, mobileOpen, onCloseMobile }: SidebarProps) {
  const navList = (
    <nav className="flex-1 px-3 py-4 space-y-1.5 overflow-y-auto">
      {navigation.map((item) => (
        <NavItem
          key={item.name}
          name={item.name}
          href={item.href}
          icon={item.icon}
          collapsed={collapsed}
          end={item.end}
        />
      ))}
    </nav>
  );

  const footer = (
    <div className="p-3 border-t border-border-subtle">
      <div className={cn('space-y-1.5', collapsed && 'flex flex-col items-center')}>
        <Tooltip content="Coming soon" placement="right">
          <a
            href="#"
            aria-disabled="true"
            className={cn(
              'flex items-center gap-3 rounded-full px-3.5 py-2.5 text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors text-sm cursor-not-allowed',
              collapsed && 'justify-center px-0'
            )}
            title={collapsed ? 'Documentation' : undefined}
          >
            <BookOpen className="h-[18px] w-[18px] flex-shrink-0" />
            {!collapsed && <span>Documentation</span>}
          </a>
        </Tooltip>
        <Tooltip content="Coming soon" placement="right">
          <a
            href="#"
            aria-disabled="true"
            className={cn(
              'flex items-center gap-3 rounded-full px-3.5 py-2.5 text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors text-sm cursor-not-allowed',
              collapsed && 'justify-center px-0'
            )}
            title={collapsed ? 'GitHub' : undefined}
          >
            <Code className="h-[18px] w-[18px] flex-shrink-0" />
            {!collapsed && <span>GitHub</span>}
          </a>
        </Tooltip>
      </div>
    </div>
  );

  const header = (
    <div className="flex items-center justify-between h-16 px-4 border-b border-border-subtle">
      <Link to="/" className="flex items-center gap-2.5 min-w-0" onClick={onCloseMobile}>
        <img src={logo} alt="VeriFlow" className="h-9 w-9 flex-shrink-0 rounded-lg" />
        {!collapsed && (
          <span className="font-extrabold text-xl text-text-primary tracking-tight truncate">
            VeriFlow
          </span>
        )}
      </Link>
      {collapsed ? (
        <button
          onClick={onToggle}
          className="hidden lg:flex p-2 rounded-lg hover:bg-white/5 text-text-secondary transition-colors"
          aria-label="Expand sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="rotate-180" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      ) : (
        <button
          onClick={onToggle}
          className="hidden lg:flex p-2 rounded-lg hover:bg-white/5 text-text-secondary transition-colors"
          aria-label="Collapse sidebar"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop sidebar (fixed, 264px or 72px icon rail) */}
      <aside
        className={cn(
          'hidden lg:flex fixed left-0 top-0 h-screen surface border-r flex-col z-40 transition-all duration-300',
          collapsed ? 'w-[72px]' : 'w-[264px]'
        )}
      >
        {header}
        {navList}
        {footer}
      </aside>

      {/* Mobile drawer */}
      <div
        className={cn(
          'lg:hidden fixed inset-0 z-50',
          mobileOpen ? 'pointer-events-auto' : 'pointer-events-none'
        )}
        aria-hidden={!mobileOpen}
      >
        <div
          className={cn(
            'absolute inset-0 bg-black/60 transition-opacity duration-300',
            mobileOpen ? 'opacity-100' : 'opacity-0'
          )}
          onClick={onCloseMobile}
        />
        <aside
          className={cn(
            'absolute left-0 top-0 h-full w-[264px] surface border-r flex flex-col transition-transform duration-300',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
        >
          <div className="flex items-center justify-between h-16 px-4 border-b border-border-subtle">
            <Link to="/" className="flex items-center gap-2.5" onClick={onCloseMobile}>
              <img src={logo} alt="VeriFlow" className="h-9 w-9 rounded-lg" />
              <span className="font-extrabold text-xl text-text-primary tracking-tight">VeriFlow</span>
            </Link>
            <button
              onClick={onCloseMobile}
              className="p-2 rounded-lg hover:bg-white/5 text-text-secondary transition-colors"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {navList}
          {footer}
        </aside>
      </div>
    </>
  );
}
