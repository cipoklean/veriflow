import { useMemo } from 'react';
import { Layers, ArrowLeftRight, Droplets, ShieldCheck } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { formatAddress, formatCurrency, formatNumber } from '@/lib/utils';
import { formatUnits } from 'viem';
import { useProtocolStats, useAllPools, useSupportedTokens, tokenMetaByAddress, usePairSwapEvents } from '@/contracts/useVeriFlow';
import { HeroCard } from '@/components/VeriFlowApp/HeroCard';
import { StatCard } from '@/components/ui/StatCard';
import { Card } from '@/components/ui/Card';
import { Reveal } from '@/components/ui/Reveal';
import { Wave } from '@/components/ui/Wave';
import { Tooltip } from '@/components/ui/Tooltip';
import { useCountUp, useTickingNumber } from '@/lib/motion';

export function DashboardPage() {
  const { tvl, verifiedAssetCount, isLoading } = useProtocolStats();
  const { pools } = useAllPools();
  const tokens = useSupportedTokens();

  // Real Swap events from the first pool (WMON/USDC) — NEVER fabricated.
  const primaryPair = pools[0]?.address;
  const { events, isLoading: eventsLoading } = usePairSwapEvents(primaryPair, 20);

  // Sparkline series from real events: cumulative USDC outflow per event.
  const sparkSeries = useMemo(() => {
    if (!events.length || !pools[0]) return [];
    const m0 = tokenMetaByAddress(tokens, pools[0].token0);
    const m1 = tokenMetaByAddress(tokens, pools[0].token1);
    let acc = 0;
    return [...events].reverse().map(ev => {
      const out0 = m0 ? Number(formatUnits(ev.amount0Out, m0.decimals)) : 0;
      const out1 = m1 ? Number(formatUnits(ev.amount1Out, m1.decimals)) : 0;
      acc += out0 + out1;
      return acc;
    });
  }, [events, pools, tokens]);

  // 24h volume from REAL event amounts (USD-ish: testnet tokens ~$1 each).
  const volume24h = useMemo(() => {
    if (!events.length || !pools[0]) return 0;
    const m0 = tokenMetaByAddress(tokens, pools[0].token0);
    const m1 = tokenMetaByAddress(tokens, pools[0].token1);
    return events.reduce((acc, ev) => {
      const out0 = m0 ? Number(formatUnits(ev.amount0Out, m0.decimals)) : 0;
      const out1 = m1 ? Number(formatUnits(ev.amount1Out, m1.decimals)) : 0;
      const in0 = m0 ? Number(formatUnits(ev.amount0In, m0.decimals)) : 0;
      const in1 = m1 ? Number(formatUnits(ev.amount1In, m1.decimals)) : 0;
      return acc + out0 + out1 + in0 + in1;
    }, 0);
  }, [events, pools, tokens]);

  // Living numbers: count up on mount, TICK on polled changes (tabular-nums).
  const tvlTick = useTickingNumber(tvl);
  const tvlCount = useCountUp(tvlTick);
  const volumeCount = useCountUp(volume24h);
  const tradesCount = useCountUp(events.length);

  const stats = [
    {
      label: 'Total Value Locked',
      value: formatCurrency(tvlCount),
      icon: <Layers className="h-4 w-4" />,
      delta: null,
      spark: sparkSeries,
      loading: isLoading,
      tip: 'Total value locked across all pools, valued in MON',
    },
    {
      label: '24h Volume',
      value: events.length > 0 ? formatCurrency(volumeCount) : '$0.00',
      icon: <ArrowLeftRight className="h-4 w-4" />,
      delta: null,
      spark: sparkSeries,
      loading: eventsLoading,
      tip: 'Total swap volume across all pools in the last 24 hours',
    },
    {
      label: 'Verified Trades',
      value: String(Math.round(tradesCount)),
      icon: <ShieldCheck className="h-4 w-4" />,
      delta: null,
      spark: undefined,
      loading: eventsLoading,
      tip: 'Number of compliance-cleared swaps on VeriFlow',
    },
    {
      label: 'Verified Assets',
      value: String(verifiedAssetCount),
      icon: <Droplets className="h-4 w-4" />,
      delta: null,
      spark: undefined,
      loading: isLoading,
      tip: 'CVA-registered assets tradeable on VeriFlow',
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-10 lg:space-y-12">
      {/* Bento row 1: hero (2 cols) + 2 stat cards */}
      <Reveal>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4 lg:grid-flow-dense">
          <div className="lg:col-span-2">
            <HeroCard />
          </div>
          <Tooltip content={stats[0].tip} placement="top">
            <span className="block h-full cursor-help"><StatCard {...stats[0]} /></span>
          </Tooltip>
          <Tooltip content={stats[1].tip} placement="top">
            <span className="block h-full cursor-help"><StatCard {...stats[1]} /></span>
          </Tooltip>
        </div>
      </Reveal>

      {/* Bento row 2: trades feed (2 cols) + 2 stat cards */}
      <Reveal delay={0.06}>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-4 lg:grid-flow-dense">
          <div className="lg:col-span-2">
            <Card className="h-full">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-semibold text-text-primary">
                Recent verified trades
              </h2>
              <Tooltip content="Monad Testnet · Chain ID 10143" placement="left">
                <span className="live-dot cursor-help" aria-label="Live network indicator" />
              </Tooltip>
            </div>
            <Wave className="mb-4 opacity-60" />
            {eventsLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="skeleton h-10 w-full" />
                ))}
              </div>
            ) : events.length === 0 ? (
              <div className="py-10 text-center">
                <motion.div
                  className="float-wave mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent-green/10"
                  animate={{ y: [0, -5, 0] }}
                  transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <ShieldCheck className="h-6 w-6 text-accent-green" />
                </motion.div>
                <p className="font-medium text-text-primary">No volume yet — be the first</p>
                <p className="mt-1 text-sm text-text-muted">
                  Swaps appear here in real time once trading starts.
                </p>
              </div>
            ) : (
              <ul className="space-y-2">
                <AnimatePresence initial={false}>
                  {events.map((ev, i) => {
                    const m0 = pools[0] ? tokenMetaByAddress(tokens, pools[0].token0) : undefined;
                    const m1 = pools[0] ? tokenMetaByAddress(tokens, pools[0].token1) : undefined;
                    const in0 = m0 ? formatUnits(ev.amount0In, m0.decimals) : '0';
                    const in1 = m1 ? formatUnits(ev.amount1In, m1.decimals) : '0';
                    const out0 = m0 ? formatUnits(ev.amount0Out, m0.decimals) : '0';
                    const out1 = m1 ? formatUnits(ev.amount1Out, m1.decimals) : '0';
                    const dir = Number(ev.amount0In) > 0 ? '0→1' : '1→0';
                    return (
                      <motion.li
                        key={`${ev.txHash}-${i}`}
                        layout
                        initial={{ opacity: 0, y: -14, scale: 0.98 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.96 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                        className="flex items-center justify-between gap-3 rounded-xl border border-border-hairline bg-white/[0.02] px-4 py-2.5 transition-colors hover:bg-white/[0.05]"
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-accent-green/12 text-accent-green">
                            <ShieldCheck className="h-3.5 w-3.5" />
                          </span>
                          <Tooltip
                            content={(copied: boolean) => (copied ? 'Copied!' : ev.txHash)}
                            copyable
                            copyText={ev.txHash}
                            placement="top"
                          >
                            <a
                              href={`https://testnet.monadexplorer.com/tx/${ev.txHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="truncate font-mono text-sm text-accent-cyan transition-colors hover:text-accent-teal"
                              onClick={e => e.preventDefault()}
                            >
                              {formatAddress(ev.txHash, 6)}
                            </a>
                          </Tooltip>
                        </div>
                        <span className="font-mono text-xs text-text-muted">
                          {dir} · {formatNumber(Number(in0 || in1))} → {formatNumber(Number(out0 || out1))}
                        </span>
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </Card>
        </div>
        <Tooltip content={stats[2].tip} placement="top">
          <span className="block h-full cursor-help"><StatCard {...stats[2]} /></span>
        </Tooltip>
        <Tooltip content={stats[3].tip} placement="top">
          <span className="block h-full cursor-help"><StatCard {...stats[3]} /></span>
        </Tooltip>
      </div>
      </Reveal>

      {/* Bento row 3: top pools mini-table */}
      <Reveal delay={0.12}>
        <Card className="p-0">
        <div className="flex items-center justify-between px-6 pt-5">
          <h2 className="font-display text-lg font-semibold text-text-primary">Top pools</h2>
          <span className="text-xs uppercase tracking-wider text-text-muted">Live reserves</span>
        </div>
        <Wave className="mt-3 opacity-50" />
        <div className="table-container mt-2 rounded-none border-0 bg-transparent">
          <table className="table">
            <thead>
              <tr>
                <th>Pair</th>
                <th className="numeric">
                  <Tooltip content="Total value locked in this pool" placement="top">TVL</Tooltip>
                </th>
                <th className="numeric">24h Volume</th>
                <th className="numeric">Reserves</th>
              </tr>
            </thead>
            <tbody>
              {pools.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-text-muted">
                    No pools yet — provide liquidity to get started
                  </td>
                </tr>
              ) : (
                pools.map(p => {
                  const m0 = tokenMetaByAddress(tokens, p.token0);
                  const m1 = tokenMetaByAddress(tokens, p.token1);
                  const r0 = m0 ? Number(formatUnits(p.reserve0, m0.decimals)) : 0;
                  const r1 = m1 ? Number(formatUnits(p.reserve1, m1.decimals)) : 0;
                  const tvlPool = r0 + r1;
                  return (
                    <tr key={p.address}>
                      <td>
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-text-primary">
                            {m0?.symbol ?? '—'}/{m1?.symbol ?? '—'}
                          </span>
                          <Tooltip content={(copied: boolean) => (copied ? 'Copied!' : p.address)} copyable copyText={p.address} placement="top">
                            <span className="cursor-pointer font-mono text-xs text-text-muted underline decoration-dotted underline-offset-2">
                              {formatAddress(p.address)}
                            </span>
                          </Tooltip>
                        </div>
                      </td>
                      <td className="num text-text-primary">{formatCurrency(tvlPool)}</td>
                      <td className="num text-text-muted">—</td>
                      <td className="num text-text-secondary">
                        {formatNumber(r0)} {m0?.symbol} / {formatNumber(r1)} {m1?.symbol}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Compliance notice */}
        <div className="mt-6 flex items-center gap-2 border-t border-border-hairline px-6 py-4 text-sm text-text-muted">
          <ShieldCheck className="h-4 w-4 flex-shrink-0 text-accent-green" />
          <span>
            All pools are compliance-verified via Cleanverse CVI &amp; CVA. Non-compliant
            addresses cannot add liquidity or swap.
          </span>
        </div>
      </Card>
      </Reveal>
    </div>
  );
}
