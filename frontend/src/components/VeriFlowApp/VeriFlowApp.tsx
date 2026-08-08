import { useState } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { cn } from '@/lib/utils';
import { DashboardPage } from '@/pages/Dashboard/DashboardPage';
import { SwapPage } from '@/pages/Swap/SwapPage';
import { PoolsPage } from '@/pages/Pools/PoolsPage';
import { LiquidityPage } from '@/pages/Liquidity/LiquidityPage';
import { AnalyticsPage } from '@/pages/Analytics/AnalyticsPage';
import { SettingsPage } from '@/pages/Settings/SettingsPage';
import { NotFoundPage } from '@/pages/NotFound/NotFoundPage';

export function VeriFlowApp() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const reduced = useReducedMotion();

  return (
    <div className="min-h-screen bg-bg-base text-text-primary">
      {/* Aurora background */}
      <div className="aurora" aria-hidden="true" />

      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed(v => !v)}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
      />

      <main
        className={cn(
          'flex-1 min-h-screen transition-all duration-300',
          collapsed ? 'lg:ml-[72px]' : 'lg:ml-[264px]'
        )}
      >
        <TopBar onOpenMobile={() => setMobileOpen(true)} />

        <div className="p-6 sm:p-8 lg:p-10">
          {/* Route transition: exit fade 120ms → enter stagger (60ms, y 12→0).
              Reduced motion: instant swap, no layout animation. */}
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={location.pathname}
              initial={reduced ? { opacity: 1 } : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduced ? { opacity: 1 } : { opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
            >
              <Routes location={location}>
                <Route path="/" element={<DashboardPage />} />
                <Route path="/swap" element={<SwapPage />} />
                <Route path="/pools" element={<PoolsPage />} />
                <Route path="/liquidity" element={<LiquidityPage />} />
                <Route path="/analytics" element={<AnalyticsPage />} />
                <Route path="/settings" element={<SettingsPage />} />
                {/* FE-03: catch-all 404 */}
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
