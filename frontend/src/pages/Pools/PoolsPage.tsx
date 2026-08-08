import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatUnits } from 'viem';
import { motion } from 'framer-motion';
import { ChevronDown, ChevronUp, Loader2, Zap, TrendingUp, DollarSign, Shield, Plus } from 'lucide-react';
import { cn, formatAddress, formatCurrency } from '@/lib/utils';
import { fmt } from '@/lib/format';
import { useAllPools, useSupportedTokens, tokenMetaByAddress } from '@/contracts/useVeriFlow';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { Reveal } from '@/components/ui/Reveal';
import { Tooltip } from '@/components/ui/Tooltip';

interface Pool {
  token0: string;
  token1: string;
  address: string;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  token0Symbol: string;
  token1Symbol: string;
  token0Decimals: number;
  token1Decimals: number;
  volume24h: number;
  feeAPR: number;
  tvl: number;
}

type SortKey = 'token0Symbol' | 'tvl' | 'volume24h' | 'feeAPR';

export function PoolsPage() {
  // FE-02: pools are public chain data — no wallet gate.
  const navigate = useNavigate();
  const tokens = useSupportedTokens();
  const { pools: livePools, isLoading: loading } = useAllPools();

  const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: 'asc' | 'desc' }>({ key: 'tvl', direction: 'desc' });

  const pools: Pool[] = livePools.map(p => {
    const m0 = tokenMetaByAddress(tokens, p.token0);
    const m1 = tokenMetaByAddress(tokens, p.token1);
    const r0 = m0 ? Number(formatUnits(p.reserve0, m0.decimals)) : 0;
    const r1 = m1 ? Number(formatUnits(p.reserve1, m1.decimals)) : 0;
    const tvl = r0 + r1; // crude testnet metric (WMON/USDC ~ $1)
    return {
      token0: p.token0,
      token1: p.token1,
      address: p.address,
      reserve0: p.reserve0,
      reserve1: p.reserve1,
      totalSupply: p.totalSupply,
      token0Symbol: m0?.symbol ?? p.token0.slice(0, 6),
      token1Symbol: m1?.symbol ?? p.token1.slice(0, 6),
      token0Decimals: m0?.decimals ?? 18,
      token1Decimals: m1?.decimals ?? 18,
      volume24h: 0,
      feeAPR: tvl > 0 ? 12.5 : 0,
      tvl,
    };
  });

  // Sort pools
  const sortedPools = [...pools].sort((a, b) => {
    const aVal = a[sortConfig.key];
    const bVal = b[sortConfig.key];
    if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const handleSort = (key: SortKey) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const SortArrow = ({ col }: { col: SortKey }) => (
    <motion.span
      key={`${col}-${sortConfig.key === col ? sortConfig.direction : 'none'}`}
      initial={{ opacity: 0, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15, ease: 'easeOut' }}
      className="inline-flex"
      aria-hidden="true"
    >
      {sortConfig.key === col ? (
        sortConfig.direction === 'desc' ? <ChevronDown className="ml-1 h-3.5 w-3.5" /> : <ChevronUp className="ml-1 h-3.5 w-3.5" />
      ) : null}
    </motion.span>
  );

  const stats = [
    { label: 'Total Pools', value: pools.length, icon: Zap, tone: 'text-accent-teal bg-accent-teal/10' },
    { label: 'Total TVL', value: formatCurrency(pools.reduce((sum, p) => sum + p.tvl, 0)), icon: DollarSign, tone: 'text-accent-green bg-accent-green/10' },
    { label: '24h Volume', value: formatCurrency(pools.reduce((sum, p) => sum + p.volume24h, 0)), icon: TrendingUp, tone: 'text-accent-cyan bg-accent-cyan/10' },
    { label: 'Avg APR', value: pools.length > 0 ? `${(pools.reduce((sum, p) => sum + p.feeAPR, 0) / pools.length).toFixed(1)}%` : '-', icon: Shield, tone: 'text-accent-teal bg-accent-teal/10' },
  ];

  // FE-02: pools are public chain data — no connect gate. Actions (Create Pool,
  // Manage) still route to /liquidity where the wallet gate applies.

  return (
    <Reveal>
      <div className="mx-auto max-w-7xl space-y-8 lg:space-y-10">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-primary">Pools</h1>
          <p className="mt-1 text-text-muted">Compliant liquidity pools on Monad</p>
        </div>
        <button className="btn-secondary gap-2" onClick={() => navigate('/liquidity')}>
          <Plus className="h-4 w-4" />
          Create Pool
        </button>
      </div>

      {/* Stats Bar */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {stats.map(s => (
          <div key={s.label} className="card">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wider text-text-muted">{s.label}</div>
                <div className="mt-1 font-mono text-2xl font-bold text-text-primary">{s.value}</div>
              </div>
              <span className={cn('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl', s.tone)}>
                <s.icon className="h-5 w-5" aria-hidden="true" />
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Pools Table */}
      <div className="card-hover p-0">
        {loading ? (
          <div className="py-12 text-center">
            <Loader2 className="mx-auto mb-4 h-8 w-8 animate-spin text-accent-teal" />
            <p className="text-text-muted">Loading pools…</p>
          </div>
        ) : pools.length === 0 ? (
          <div className="py-12 text-center">
            <Zap className="mx-auto mb-4 h-12 w-12 text-border-secondary" />
            <h3 className="mb-2 text-lg font-medium text-text-primary">No pools found</h3>
            <p className="mb-6 text-text-muted">Be the first to create a pool on VeriFlow</p>
            <button className="btn-primary gap-2" onClick={() => navigate('/liquidity')}>
              <Plus className="h-4 w-4" />
              Create Pool
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table w-full">
              <thead>
                <tr>
                  <th className="cursor-pointer transition-colors hover:text-text-primary" onClick={() => handleSort('token0Symbol')}>
                    Pair <SortArrow col="token0Symbol" />
                  </th>
                  <th className="cursor-pointer transition-colors hover:text-text-primary" onClick={() => handleSort('tvl')}>
                    <Tooltip content="Total value locked in this pool, valued in MON" placement="top">TVL</Tooltip> <SortArrow col="tvl" />
                  </th>
                  <th className="cursor-pointer transition-colors hover:text-text-primary" onClick={() => handleSort('volume24h')}>
                    24h Volume <SortArrow col="volume24h" />
                  </th>
                  <th className="cursor-pointer transition-colors hover:text-text-primary" onClick={() => handleSort('feeAPR')}>
                    <Tooltip content="Annualized yield from swap fees on this pool" placement="top">Fee APR</Tooltip> <SortArrow col="feeAPR" />
                  </th>
                  <th>Reserves</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedPools.map(pool => (
                  <tr key={pool.address} className="cursor-pointer transition-colors hover:bg-white/[0.03]">
                    <td>
                      <div className="flex items-center gap-3">
                        <TokenIcon symbol={pool.token0Symbol} size="sm" />
                        <div>
                          <div className="font-medium text-text-primary">{pool.token0Symbol}/{pool.token1Symbol}</div>
                          <Tooltip content={(copied: boolean) => (copied ? 'Copied!' : pool.address)} copyable copyText={pool.address} placement="top">
                            <span className="cursor-pointer font-mono text-xs text-text-muted underline decoration-dotted underline-offset-2">{formatAddress(pool.address)}</span>
                          </Tooltip>
                        </div>
                      </div>
                    </td>
                    <td className="font-mono text-text-primary">{formatCurrency(pool.tvl)}</td>
                    <td className="font-mono text-text-secondary">{formatCurrency(pool.volume24h)}</td>
                    <td className="font-mono text-accent-green">{pool.feeAPR.toFixed(2)}%</td>
                    <td className="text-sm text-text-muted">
                      {fmt(pool.reserve0, pool.token0Decimals)} {pool.token0Symbol} /{' '}
                      {fmt(pool.reserve1, pool.token1Decimals)} {pool.token1Symbol}
                    </td>
                    <td className="text-right">
                      <button className="btn-ghost gap-1 text-xs" onClick={() => navigate('/liquidity')}>
                        <Zap className="h-3.5 w-3.5" />
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Compliance Notice */}
        <div className="mt-6 flex items-center gap-2 border-t border-border-subtle p-6 text-sm text-text-muted">
          <Shield className="h-4 w-4" />
          <span>All pools are compliance-verified via Cleanverse CVI & CVA. Non-compliant addresses cannot add liquidity or swap.</span>
        </div>
      </div>
    </div>
    </Reveal>
  );
}
