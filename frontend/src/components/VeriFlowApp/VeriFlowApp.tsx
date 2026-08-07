import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';
import { cn } from '@/lib/utils';
import { DashboardPage } from '@/pages/Dashboard/DashboardPage';
import { SwapPage } from '@/pages/Swap/SwapPage';
import { PoolsPage } from '@/pages/Pools/PoolsPage';
import { LiquidityPage } from '@/pages/Liquidity/LiquidityPage';
import { AnalyticsPage } from '@/pages/Analytics/AnalyticsPage';
import { SettingsPage } from '@/pages/Settings/SettingsPage';

export function VeriFlowApp() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

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
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/swap" element={<SwapPage />} />
            <Route path="/pools" element={<PoolsPage />} />
            <Route path="/liquidity" element={<LiquidityPage />} />
            <Route path="/analytics" element={<AnalyticsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
