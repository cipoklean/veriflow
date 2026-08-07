import {
  useChainId,
  useReadContract,
  useReadContracts,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
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
 * Returns { isVerified, isLoading }. This is a live on-chain read — NOT a timer.
 */
export function useWalletVerified(wallet?: Address) {
  const addrs = useVeriFlowAddresses();
  const { data, isLoading } = useReadContract({
    address: addrs.cviRegistry,
    abi: CVI_ABI,
    functionName: 'isVerified',
    args: wallet ? [wallet] : undefined,
    chainId: MONAD_TESTNET,
    query: { enabled: !!wallet },
  });
  return { isVerified: !!data, isLoading };
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
