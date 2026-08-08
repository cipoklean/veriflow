import { DollarSign, Layers, Fingerprint, Shield, TrendingUp, Activity } from 'lucide-react';
import { cn, formatNumber, formatCurrency } from '@/lib/utils';
import { useProtocolStats, useAllPools, useVerifiedAssets } from '@/contracts/useVeriFlow';
import { Reveal } from '@/components/ui/Reveal';

export function AnalyticsPage() {
  // FE-02: analytics are public chain data — no wallet gate.

  // Real on-chain reads: pool reserves + registry counts. No mock data.
  const { tvl, poolCount, verifiedAssetCount, isLoading: statsLoading } = useProtocolStats();
  const { pools, isLoading: poolsLoading } = useAllPools();
  const { assets, isLoading: assetsLoading } = useVerifiedAssets();

  const loading = statsLoading || poolsLoading || assetsLoading;

  return (
    <Reveal>
      <div className="mx-auto max-w-7xl space-y-8 lg:space-y-10">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Analytics</h1>
          <p className="mt-1 text-text-muted">Live on-chain protocol metrics</p>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-tertiary px-3 py-1.5 text-xs text-text-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent-teal" />
          Live reads from Monad Testnet
        </div>
      </div>

      {loading ? (
        <div className="card-hover py-16 text-center text-text-muted">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-accent-teal border-t-transparent" />
          Loading live protocol data…
        </div>
      ) : (
        <>
          {/* Key Metrics — all real, from chain */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <MetricCard
              label="Total Value Locked"
              value={tvl > 0 ? formatCurrency(tvl) : 'N/A'}
              sub={tvl > 0 ? 'Σ pair reserves' : 'No liquidity yet'}
              icon={DollarSign}
              tone="text-accent-green bg-accent-green/10"
            />
            <MetricCard
              label="Active Pools"
              value={poolCount > 0 ? formatNumber(poolCount) : '0'}
              sub="factory allPairs"
              icon={Layers}
              tone="text-accent-teal bg-accent-teal/10"
            />
            <MetricCard
              label="Verified Assets"
              value={verifiedAssetCount > 0 ? formatNumber(verifiedAssetCount) : '0'}
              sub="CVA registry"
              icon={Fingerprint}
              tone="text-accent-cyan bg-accent-cyan/10"
            />
            <MetricCard
              label="24h Volume"
              value="N/A"
              sub="No indexer deployed"
              icon={Activity}
              tone="text-text-primary bg-border-subtle"
            />
          </div>

          {/* Pools Table — live reserves from the factory */}
          <div className="card-hover">
            <h3 className="mb-4 font-semibold text-text-primary">Live Pools</h3>
            {pools.length === 0 ? (
              <div className="py-10 text-center text-text-muted">
                <Layers className="mx-auto mb-3 h-8 w-8 text-border-secondary" />
                <p>No pools have been created yet.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="table w-full">
                  <thead>
                    <tr>
                      <th>Pool</th>
                      <th className="text-right">Reserve 0</th>
                      <th className="text-right">Reserve 1</th>
                      <th className="text-right">LP Supply</th>
                      <th className="text-right">TVL (approx)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pools.map(p => (
                      <tr key={p.address} className="transition-colors hover:bg-white/[0.03]">
                        <td>
                          <div className="flex items-center gap-2">
                            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-teal/10">
                              <Shield className="h-4 w-4 text-accent-teal" />
                            </span>
                            <span className="font-medium text-text-primary">
                              {p.meta0?.symbol ?? p.token0.slice(0, 6)}/{p.meta1?.symbol ?? p.token1.slice(0, 6)}
                            </span>
                          </div>
                        </td>
                        <td className="text-right font-mono text-text-primary">
                          {formatNumber(Number(p.reserve0) / 10 ** (p.meta0?.decimals ?? 18))}
                        </td>
                        <td className="text-right font-mono text-text-primary">
                          {formatNumber(Number(p.reserve1) / 10 ** (p.meta1?.decimals ?? 18))}
                        </td>
                        <td className="text-right font-mono text-text-secondary">
                          {formatNumber(Number(p.totalSupply) / 1e18)}
                        </td>
                        <td className="text-right font-mono text-accent-green">
                          {formatCurrency(
                            (Number(p.reserve0) / 10 ** (p.meta0?.decimals ?? 18)) +
                              (Number(p.reserve1) / 10 ** (p.meta1?.decimals ?? 18)),
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Verified Assets */}
          <div className="card-hover">
            <h3 className="mb-4 font-semibold text-text-primary">Verified Assets (CVA Registry)</h3>
            {assets.length === 0 ? (
              <div className="py-8 text-center text-text-muted">
                <Fingerprint className="mx-auto mb-3 h-8 w-8 text-border-secondary" />
                <p>No assets registered in the CVA registry yet.</p>
              </div>
            ) : (
              <div className="flex flex-wrap gap-3">
                {assets.map(a => (
                  <span
                    key={a}
                    className="flex items-center gap-2 rounded-xl border border-accent-green/30 bg-accent-green/5 px-4 py-2 text-sm text-accent-green"
                  >
                    <Shield className="h-4 w-4" />
                    <span className="font-mono">{a.slice(0, 8)}…{a.slice(-4)}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* Honesty Notice */}
          <div className="card border-border-subtle bg-bg-secondary/50">
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <TrendingUp className="h-4 w-4" />
              <span>
                Volume, fees, and user counts require a subgraph/indexer and are shown as N/A until one is deployed.
                TVL and asset counts are read live from the protocol contracts — no simulated numbers.
              </span>
            </div>
          </div>
        </>
      )}
    </div>
    </Reveal>
  );
}

interface MetricCardProps {
  label: string;
  value: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: string;
}

function MetricCard({ label, value, sub, icon: Icon, tone }: MetricCardProps) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-wider text-text-muted">{label}</div>
          <div className="mt-1 font-mono text-2xl font-bold text-text-primary">{value}</div>
          {sub && <div className="mt-1 text-xs text-text-muted">{sub}</div>}
        </div>
        <span className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl', tone)}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </span>
      </div>
    </div>
  );
}
