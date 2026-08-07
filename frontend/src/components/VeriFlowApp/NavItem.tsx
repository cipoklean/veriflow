import { cn } from '@/lib/utils';
import { type LucideIcon } from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { Wave } from '@/components/ui/Wave';

interface NavItemProps {
  name: string;
  href: string;
  icon: LucideIcon;
  collapsed: boolean;
  end?: boolean;
}

export function NavItem({ name, href, icon: Icon, collapsed, end }: NavItemProps) {
  return (
    <NavLink
      to={href}
      end={end}
      className={({ isActive }) =>
        cn(
          'group relative flex items-center gap-3 rounded-full px-3.5 py-2.5 outline-none transition-all duration-200',
          collapsed && 'justify-center px-0',
          isActive
            ? 'nav-active'
            : 'text-text-secondary hover:bg-white/5 hover:text-text-primary'
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon
            className={cn('h-[18px] w-[18px] flex-shrink-0', isActive && 'text-white')}
            aria-hidden="true"
          />
          {!collapsed && (
            <span className="relative flex-1 text-left">
              <span className="font-medium">{name}</span>
              {/* Signature wave accent under the active label */}
              {isActive && (
                <span className="absolute -bottom-1.5 left-0 right-0">
                  <Wave className="opacity-70" />
                </span>
              )}
            </span>
          )}
          {collapsed && (
            <span
              role="tooltip"
              className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg bg-bg-surface px-2.5 py-1.5 text-sm text-text-primary opacity-0 shadow-lg ring-1 ring-white/10 transition-opacity group-hover:opacity-100"
            >
              {name}
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}
