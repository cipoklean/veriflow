import { Droplets, BarChart3, Layers } from 'lucide-react';
import { cn, formatCurrency } from '@/lib/utils';
import { useProtocolStats } from '@/contracts/useVeriFlow';
import { HeroCard } from '@/components/VeriFlowApp/HeroCard';

export function DashboardPage() {
  const { tvl, poolCount, isLoading } = useProtocolStats();

  const stats = [
    {
      label: 'Total Value Locked',
      value: isLoading ? '…' : formatCurrency(tvl),
      icon: Layers,
      tone: 'text-accent-teal bg-accent-teal/10',
    },
    {
      label: '24h Volume',
      value: '$0.00',
      icon: BarChart3,
      tone: 'text-accent-cyan bg-accent-cyan/10',
    },
    {
      label: 'Fees (24h)',
      value: '$0.00',
      icon: Droplets,
      tone: 'text-accent-green bg-accent-green/10',
    },
    {
      label: 'Verified Trades',
      value: String(poolCount),
      icon: BarChart3,
      tone: 'text-accent-teal bg-accent-teal/10',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <HeroCard />

      {/* Key stats — mono numerals */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4" aria-label="Protocol stats">
        {stats.map(stat => (
          <div
            key={stat.label}
            className="card group transition-colors hover:border-accent-teal/40"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-text-muted">{stat.label}</p>
                <p className="mt-1.5 truncate font-mono text-2xl font-bold text-text-primary">
                  {stat.value}
                </p>
              </div>
              <span className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl', stat.tone)}>
                <stat.icon className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
          </div>
        ))}
      </section>

      {/* Compliance notice */}
      <section className="card border-accent-green/30 bg-success-light/10 p-6">
        <div className="flex items-start gap-4">
          <span className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-accent-green/15 text-accent-green">
            <Droplets className="h-6 w-6" aria-hidden="true" />
          </span>
          <div>
            <h3 className="mb-2 font-semibold text-accent-green">Fully compliant by design</h3>
            <p className="mb-3 text-sm leading-relaxed text-text-secondary">
              VeriFlow uses a fail-closed architecture. If Cleanverse verification is unavailable,
              trading pauses automatically. No trades execute without confirmed clean status.
            </p>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full border border-accent-green/40 bg-accent-green/10 px-3 py-1 text-xs font-medium text-accent-green">
                CVI: Identity Verification
              </span>
              <span className="rounded-full border border-accent-green/40 bg-accent-green/10 px-3 py-1 text-xs font-medium text-accent-green">
                CVA: Asset Verification
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
