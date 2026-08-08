import {
  useChainId,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
  usePublicClient,
} from 'wagmi';
import { useEffect, useState } from 'react';
import { decodeErrorResult, type Abi, type Address, formatUnits, zeroAddress } from 'viem';
import { getContractAddresses, SUPPORTED_TOKENS } from './config';
import VeriFactoryAbi from './abis/VeriFactory.json';
import VeriRouterAbi from './abis/VeriRouter.json';
import VeriPairAbi from './abis/VeriPair.json';
import CVIRegistryAbi from './abis/CVIRegistry.json';
import CVARegistryAbi from './abis/CVARegistry.json';

const NATIVE = zeroAddress;

// JSON ABIs are loosely typed; cast to viem's strict Abi so wagmi hooks accept them.
const FACTORY_ABI = VeriFactoryAbi as Abi;
const ROUTER_ABI = VeriRouterAbi as Abi;
const PAIR_ABI = VeriPairAbi as Abi;
const CVI_ABI = CVIRegistryAbi as Abi;
const CVA_ABI = CVARegistryAbi as Abi;

const MONAD_TESTNET = 10143;

export interface PoolView {
  address: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
}

export interface TokenMeta {
  symbol: string;
  name: string;
  address: Address;
  decimals: number;
  isNative: boolean;
}

export function useVeriFlowAddresses() {
  const chainId = useChainId();
  return getContractAddresses(chainId);
}

export function useSupportedTokens(): TokenMeta[] {
  const chainId = useChainId();
  return (SUPPORTED_TOKENS[chainId === MONAD_TESTNET ? 'monadTestnet' : 'localhost'] ??
    SUPPORTED_TOKENS.monadTestnet) as TokenMeta[];
}

export function tokenMetaByAddress(tokens: TokenMeta[], address: Address): TokenMeta | undefined {
  if (address === NATIVE) return tokens.find(t => t.isNative);
  return tokens.find(t => t.address.toLowerCase() === address.toLowerCase());
}

/** Fetch all live pools from the factory (allPairs). */
export function useAllPools() {
  const addrs = useVeriFlowAddresses();
  const tokens = useSupportedTokens();

  const { data: lengthData, isLoading: lenLoading } = useReadContract({
    address: addrs.veriFactory,
    abi: FACTORY_ABI,
    functionName: 'allPairsLength',
    chainId: MONAD_TESTNET,
    query: { refetchInterval: 5000 },
  });

  const length = lengthData ? Number(lengthData) : 0;

  // Build the list of allPairs(i) calls.
  const pairCalls = Array.from({ length }, (_, i) => ({
    address: addrs.veriFactory as Address,
    abi: FACTORY_ABI,
    functionName: 'allPairs' as const,
    args: [BigInt(i)] as const,
    chainId: 10143 as const,
  }));

  const { data: pairData, isLoading: pairsLoading } = useReadContracts({
    contracts: pairCalls,
    allowFailure: false,
  });

  // For each pair, read token0/token1/reserves/totalSupply.
  const detailCalls = (pairData ?? []).flatMap(pairAddr => {
    const a = pairAddr as Address;
    return [
      { address: a, abi: PAIR_ABI, functionName: 'token0' as const, chainId: 10143 as const },
      { address: a, abi: PAIR_ABI, functionName: 'token1' as const, chainId: 10143 as const },
      { address: a, abi: PAIR_ABI, functionName: 'getReserves' as const, chainId: 10143 as const },
      { address: a, abi: PAIR_ABI, functionName: 'totalSupply' as const, chainId: 10143 as const },
    ];
  });

  const { data: detailData, isLoading: detailsLoading } = useReadContracts({
    contracts: detailCalls,
    allowFailure: false,
    query: { refetchInterval: 5000 },
  });

  const pools: PoolView[] = [];
  if (detailData && pairData) {
    for (let i = 0; i < pairData.length; i++) {
      const base = i * 4;
      const token0 = detailData[base] as Address;
      const token1 = detailData[base + 1] as Address;
      const reserves = detailData[base + 2] as [bigint, bigint, number];
      const totalSupply = detailData[base + 3] as bigint;
      pools.push({
        address: pairData[i] as Address,
        token0,
        token1,
        reserve0: reserves[0],
        reserve1: reserves[1],
        totalSupply,
      });
    }
  }

  // Attach metadata for convenience.
  const enriched = pools.map(p => ({
    ...p,
    meta0: tokenMetaByAddress(tokens, p.token0),
    meta1: tokenMetaByAddress(tokens, p.token1),
  }));

  return {
    pools: enriched,
    isLoading: lenLoading || pairsLoading || detailsLoading,
  };
}

/** Real quote from the router's getAmountsOut for a token path. */
export function useQuote(path: Address[], amountIn: bigint) {
  const addrs = useVeriFlowAddresses();
  const enabled = path.length >= 2 && amountIn > 0n;
  const { data, isLoading, isError, error, refetch } = useReadContract({
    address: addrs.veriRouter,
    abi: ROUTER_ABI,
    functionName: 'getAmountsOut',
    args: enabled ? [amountIn, path] : undefined,
    chainId: 10143 as const,
    query: { enabled },
  });
  const amounts = (data as bigint[] | undefined) ?? [];
  const amountOut = amounts.length > 0 ? amounts[amounts.length - 1] : 0n;
  // getAmountsOut reverts with INSUFFICIENT_RESERVES when the pool has no
  // liquidity. Surface that so the UI can say "no liquidity" instead of 0.
  const noLiquidity = isError && String(error?.shortMessage ?? error?.message ?? '').includes('INSUFFICIENT_RESERVES');
  return { amountOut: amountOut as bigint, isLoading, isError, noLiquidity, refetch };
}

/** Read verified CVA asset list from the registry. */
export function useVerifiedAssets() {
  const addrs = useVeriFlowAddresses();
  const tokens = useSupportedTokens();
  const { data, isLoading } = useReadContract({
    address: addrs.cvaRegistry,
    abi: CVA_ABI,
    functionName: 'getVerifiedAssets',
    chainId: MONAD_TESTNET,
  });
  const assets = (data as Address[] | undefined) ?? [];
  return {
    assets,
    isLoading,
    tokens: assets.map(a => tokenMetaByAddress(tokens, a)).filter(Boolean) as TokenMeta[],
  };
}

/**
 * Real CVI check: is this wallet verified in the Cleanverse identity registry?
 * Returns { isVerified, isLoading, refetch }. This is a live on-chain read — NOT a timer.
 * `refetch` is exposed so a registration tx can instantly refresh the badge.
 */
export function useWalletVerified(wallet?: Address) {
  const addrs = useVeriFlowAddresses();
  const { data, isLoading, refetch } = useReadContract({
    address: addrs.cviRegistry,
    abi: CVI_ABI,
    functionName: 'isVerified',
    args: wallet ? [wallet] : undefined,
    chainId: MONAD_TESTNET,
    query: { enabled: !!wallet },
  });
  return { isVerified: !!data, isLoading, refetch };
}

/**
 * Decode a viem TransactionRevertedError into a human-readable reason.
 * Tries decodeErrorResult against the router + pair ABIs (which carry the
 * ComplianceRejected(string,uint8) error), then falls back to the raw error.
 */
export function decodeRevertReason(error: unknown): string {
  const err = error as { data?: { errorName?: string; args?: unknown } } | { shortMessage?: string; message?: string } | null;
  if (!err) return 'Transaction reverted';
  // viem wraps reverted txs with `.data` when the ABI is known to wagmi's config.
  const maybeData = (error as { data?: `0x${string}` | { errorName?: string; args?: unknown } }).data;
  if (maybeData && typeof maybeData === 'object' && 'errorName' in maybeData) {
    const name = maybeData.errorName;
    const args = maybeData.args as { reason?: string; checkType?: bigint } | undefined;
    if (name === 'ComplianceRejected' && args?.reason) {
      return `Compliance rejected: ${args.reason}`;
    }
    if (name) return `${name}${args ? ` (${JSON.stringify(args)})` : ''}`;
  }
  if (typeof maybeData === 'string' && maybeData.length >= 10) {
    for (const abi of [ROUTER_ABI, PAIR_ABI]) {
      try {
        const decoded = decodeErrorResult({ abi, data: maybeData as `0x${string}` });
        const args = decoded.args as { reason?: string; checkType?: bigint } | undefined;
        if (decoded.errorName === 'ComplianceRejected' && args?.reason) {
          return `Compliance rejected: ${args.reason}`;
        }
        return `${decoded.errorName}${args ? ` (${JSON.stringify(args)})` : ''}`;
      } catch {
        // not this ABI; try the next
      }
    }
  }
  const short = (error as { shortMessage?: string }).shortMessage;
  const message = (error as { message?: string }).message;
  return short ?? (message ? message.split('\n')[0] : 'Transaction reverted');
}

/** Aggregate TVL (crude testnet metric: WMON/USDC ~ $1 each). */
export function useProtocolStats() {
  const { pools, isLoading } = useAllPools();
  const tokens = useSupportedTokens();
  const { assets, isLoading: assetsLoading } = useVerifiedAssets();

  let tvl = 0;
  for (const p of pools) {
    const m0 = tokenMetaByAddress(tokens, p.token0);
    const m1 = tokenMetaByAddress(tokens, p.token1);
    const r0 = m0 ? Number(formatUnits(p.reserve0, m0.decimals)) : 0;
    const r1 = m1 ? Number(formatUnits(p.reserve1, m1.decimals)) : 0;
    tvl += r0 + r1;
  }
  return {
    tvl,
    poolCount: pools.length,
    verifiedAssetCount: assets.length,
    isLoading: isLoading || assetsLoading,
  };
}

/**
 * Build the on-chain swap path, substituting the canonical WMON address for
 * native MON (zeroAddress). The router requires path[0] == WETH for ETH-entry
 * swaps — sending 0x0 makes getAmountsOut/swapExactETHForTokens revert.
 */
export function resolveSwapPath(
  from: Address,
  to: Address,
  wethAddress: Address,
): Address[] {
  const fromAddr = from === NATIVE || from === zeroAddress ? wethAddress : from;
  const toAddr = to === NATIVE || to === zeroAddress ? wethAddress : to;
  return [fromAddr, toAddr];
}

export function useVeriWrite() {
  const { writeContract, data: txHash, isPending } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash: txHash });
  return { writeContract, txHash, isPending, isConfirming, isSuccess };
}

/** Decode a Swap event from a raw log (amounts are raw token units). */
export interface SwapEvent {
  txHash: Address;
  sender: Address;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  timestamp: number;
}

/**
 * Read-only Swap-event feed for a pair (real on-chain logs, newest first).
 * Used by the Dashboard trades feed + stat sparklines. NEVER fabricates data:
 * when the chain has no events in the scanned window, returns an empty array
 * so the UI shows the graceful empty state.
 *
 * NOTE: Monad testnet's public RPC caps eth_getLogs at a 100-block range, so
 * this scans backward in 100-block chunks from the tip (up to SCAN_BLOCKS of
 * history, stopping early once the requested count is found). Swaps older
 * than the scan window are simply not shown — the feed is honest about that.
 */
export function usePairSwapEvents(pair: Address | undefined, limit = 20) {
  const addrs = useVeriFlowAddresses();
  const publicClient = usePublicClient();
  const [events, setEvents] = useState<SwapEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!pair || !publicClient) {
      setEvents([]);
      return;
    }
    const scan = async () => {
      try {
        const scanBlock = 100; // RPC cap for eth_getLogs range
        const maxChunks = 10; // scan up to 1000 blocks back
        const tip = await publicClient.getBlockNumber();
        const found: SwapEvent[] = [];
        for (let i = 0; i < maxChunks && found.length < limit; i++) {
          const toBlock = tip - BigInt(i * scanBlock);
          const fromBlock = toBlock - BigInt(scanBlock - 1);
          if (fromBlock > toBlock) break;
          try {
            const logs = await publicClient.getLogs({
              address: pair,
              event: {
                type: 'event',
                name: 'Swap',
                inputs: [
                  { type: 'address', name: 'sender', indexed: true },
                  { type: 'uint256', name: 'amount0In', indexed: false },
                  { type: 'uint256', name: 'amount1In', indexed: false },
                  { type: 'uint256', name: 'amount0Out', indexed: false },
                  { type: 'uint256', name: 'amount1Out', indexed: false },
                  { type: 'address', name: 'to', indexed: true },
                ],
              },
              fromBlock,
              toBlock,
            });
            for (const l of logs.reverse()) {
              found.push({
                txHash: l.transactionHash,
                sender: l.args.sender ?? addrs.veriRouter,
                amount0In: l.args.amount0In ?? 0n,
                amount1In: l.args.amount1In ?? 0n,
                amount0Out: l.args.amount0Out ?? 0n,
                amount1Out: l.args.amount1Out ?? 0n,
                timestamp: Number(l.blockNumber ?? 0n),
              });
            }
          } catch {
            // a chunk can fail (RPC flake); keep scanning older chunks
          }
        }
        if (cancelled) return;
        setEvents(prev => {
          const next = found.slice(0, limit);
          // keep newest-first ordering; identical arrays skip re-render churn
          if (prev.length === next.length && prev.every((e, i) => e.txHash === next[i].txHash)) return prev;
          return next;
        });
      } catch {
        if (!cancelled) setEvents([]);
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void scan();
    const timer = setInterval(scan, 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pair, publicClient, addrs.veriRouter, limit]);

  return { events, isLoading };
}
