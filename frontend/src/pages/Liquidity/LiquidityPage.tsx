import { useState, useEffect, useCallback } from 'react';
import { useAccount, useConfig, useReadContract, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { readContract, writeContract as writeContractAction } from 'wagmi/actions';
import { parseUnits, formatUnits, erc20Abi, type Address } from 'viem';
import { Zap, Minus, Shield, AlertTriangle, CheckCircle2, Loader2, Settings2, ChevronDown, Info, Wallet, ArrowRightLeft } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { getContractAddresses } from '@/contracts/config';
import { useSupportedTokens, decodeRevertReason } from '@/contracts/useVeriFlow';
import VeriRouterAbi from '@/contracts/abis/VeriRouter.json';
import VeriFactoryAbi from '@/contracts/abis/VeriFactory.json';
import VeriPairAbi from '@/contracts/abis/VeriPair.json';
import { Modal } from '@/components/ui/Modal';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { Badge } from '@/components/ui/Badge';

interface Token {
  symbol: string;
  name: string;
  address: `0x${string}`;
  decimals: number;
  isNative: boolean;
}

interface PoolInfo {
  address: string;
  token0: Token;
  token1: Token;
  reserve0: bigint;
  reserve1: bigint;
  totalSupply: bigint;
  userLiquidity: bigint;
}

export function LiquidityPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const config = useConfig();
  const contractAddresses = getContractAddresses(chainId);
  const supportedTokens = useSupportedTokens();
  const { toast } = useToast();

  // Action writes (add / remove liquidity on the router).
  const { writeContract, data: txHash, isPending: isWriting, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, isError: isTxError, error: receiptError } = useWaitForTransactionReceipt({ hash: txHash });

  // Approval sequencing: we store the pending approval step (hash + follow-up
  // action). The wait hook watches ONLY that hash, so a confirmed approval for
  // token A can never accidentally re-trigger while token B's approval is still
  // in flight. No setTimeout — the action fires from the receipt-confirmed effect.
  const [approvalStep, setApprovalStep] = useState<{ hash: Address; action: 'add' | 'remove'; label: string } | null>(null);
  const { error: approveError } = useWriteContract();
  const { isSuccess: isApproveConfirmed, isError: isApproveError } = useWaitForTransactionReceipt({ hash: approvalStep?.hash });

  const [activeTab, setActiveTab] = useState<'add' | 'remove'>('add');
  const [tokenA, setTokenA] = useState<Token>(supportedTokens[1] ?? supportedTokens[0]); // WMON
  const [tokenB, setTokenB] = useState<Token>(supportedTokens[2] ?? supportedTokens[0]); // USDC
  const [amountA, setAmountA] = useState('');
  const [amountB, setAmountB] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [poolInfo, setPoolInfo] = useState<PoolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectorFor, setSelectorFor] = useState<'A' | 'B' | null>(null);
  // A pending approval step means we're waiting on a receipt before the action.
  const awaitingApproval = approvalStep !== null;

  // Native MON (0x0) must resolve to the canonical WMON address for pair lookups.
  const resolveAddr = useCallback((t: Token): Address =>
    t.isNative ? contractAddresses.weth : t.address, [contractAddresses.weth]);
  const tokenAAddr = resolveAddr(tokenA);
  const tokenBAddr = resolveAddr(tokenB);

  // Read the live pool (if it exists) for the selected token pair.
  const { data: pairAddress } = useReadContract({
    address: contractAddresses.veriFactory,
    abi: VeriFactoryAbi,
    functionName: 'getPair',
    args: [tokenAAddr, tokenBAddr],
    chainId: 10143,
  });

  const { data: reservesData } = useReadContract({
    address: pairAddress as Address | undefined,
    abi: VeriPairAbi,
    functionName: 'getReserves',
    chainId: 10143,
    query: { enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' },
  });

  const { data: lpTotalSupply } = useReadContract({
    address: pairAddress as Address | undefined,
    abi: VeriPairAbi,
    functionName: 'totalSupply',
    chainId: 10143,
    query: { enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' },
  });

  const { data: userLpBalance } = useReadContract({
    address: pairAddress as Address | undefined,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: 10143,
    query: { enabled: !!pairAddress && !!address && pairAddress !== '0x0000000000000000000000000000000000000000' },
  });

  // LP allowance to the router (for remove) — read live.
  const { data: lpAllowance } = useReadContract({
    address: pairAddress as Address | undefined,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && pairAddress ? [address, contractAddresses.veriRouter] : undefined,
    chainId: 10143,
    query: { enabled: !!pairAddress && !!address && pairAddress !== '0x0000000000000000000000000000000000000000' },
  });

  const isEmptyAddr = !pairAddress || pairAddress === '0x0000000000000000000000000000000000000000';

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    try {
      if (isEmptyAddr || tokenA.address === tokenB.address) {
        setPoolInfo(null);
        return;
      }
      const [r0, r1] = (reservesData as [bigint, bigint, number] | undefined) ?? [0n, 0n, 0];
      setPoolInfo({
        address: pairAddress as string,
        token0: tokenA,
        token1: tokenB,
        reserve0: r0,
        reserve1: r1,
        totalSupply: (lpTotalSupply as bigint) ?? 0n,
        userLiquidity: (userLpBalance as bigint) ?? 0n,
      });
    } catch {
      setError('Pool does not exist');
      setPoolInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [pairAddress, reservesData, lpTotalSupply, userLpBalance, tokenA, tokenB, isEmptyAddr]);

  useEffect(() => {
    if (poolInfo && amountA && parseFloat(amountA) > 0) {
      const ratio = Number(poolInfo.reserve1) / Number(poolInfo.reserve0);
      const amountBVal = parseFloat(amountA) * ratio;
      setAmountB(amountBVal.toFixed(tokenB.decimals === 6 ? 2 : 4));
    }
  }, [amountA, poolInfo, tokenB]);

  // Handle tab change
  const handleTabChange = (tab: 'add' | 'remove') => {
    setActiveTab(tab);
    setAmountA('');
    setAmountB('');
    setError(null);
  };

  const selectToken = (t: Token) => {
    if (selectorFor === 'A') setTokenA(t);
    if (selectorFor === 'B') setTokenB(t);
    setSelectorFor(null);
  };

  // ============================================================
  // Add liquidity
  // ============================================================
  const doAddLiquidity = useCallback((amountADesired: bigint, amountBDesired: bigint, minA: bigint, minB: bigint) => {
    if (tokenA.isNative) {
      writeContract({
        address: contractAddresses.veriRouter,
        abi: VeriRouterAbi,
        functionName: 'addLiquidityETH',
        args: [
          tokenBAddr,
          amountBDesired,
          minB,
          minA,
          address,
          Math.floor(Date.now() / 1000) + 1200,
        ],
        value: amountADesired,
      });
    } else if (tokenB.isNative) {
      writeContract({
        address: contractAddresses.veriRouter,
        abi: VeriRouterAbi,
        functionName: 'addLiquidityETH',
        args: [
          tokenAAddr,
          amountADesired,
          minA,
          minB,
          address,
          Math.floor(Date.now() / 1000) + 1200,
        ],
        value: amountBDesired,
      });
    } else {
      writeContract({
        address: contractAddresses.veriRouter,
        abi: VeriRouterAbi,
        functionName: 'addLiquidity',
        args: [
          tokenAAddr,
          tokenBAddr,
          amountADesired,
          amountBDesired,
          minA,
          minB,
          address,
          Math.floor(Date.now() / 1000) + 1200,
        ],
      });
    }
  }, [tokenA.isNative, tokenB.isNative, tokenAAddr, tokenBAddr, address, contractAddresses.veriRouter, writeContract]);

  const handleAddLiquidity = async () => {
    if (!address || !amountA || !amountB || !poolInfo) return;

    try {
      setIsLoading(true);
      const amountADesired = parseUnits(amountA, tokenA.decimals);
      const amountBDesired = parseUnits(amountB, tokenB.decimals);
      const minAmountA = (amountADesired * BigInt(Math.floor((100 - slippage) * 100))) / BigInt(10000);
      const minAmountB = (amountBDesired * BigInt(Math.floor((100 - slippage) * 100))) / BigInt(10000);

      // Strict approval sequencing: await the approval receipt before adding.
      if (!tokenA.isNative) {
        const allowanceA = await readContract(config, {
          address: tokenAAddr,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, contractAddresses.veriRouter],
          chainId: 10143,
        });
        if (allowanceA < amountADesired) {
          const hash = await writeContractAction(config, {
            address: tokenAAddr,
            abi: erc20Abi,
            functionName: 'approve',
            args: [contractAddresses.veriRouter, amountADesired],
            chainId: 10143,
          });
          setApprovalStep({ hash, action: 'add', label: `approve ${tokenA.symbol}` });
          return; // continues in the approval-confirmed effect below
        }
      }
      if (!tokenB.isNative) {
        const allowanceB = await readContract(config, {
          address: tokenBAddr,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, contractAddresses.veriRouter],
          chainId: 10143,
        });
        if (allowanceB < amountBDesired) {
          const hash = await writeContractAction(config, {
            address: tokenBAddr,
            abi: erc20Abi,
            functionName: 'approve',
            args: [contractAddresses.veriRouter, amountBDesired],
            chainId: 10143,
          });
          setApprovalStep({ hash, action: 'add', label: `approve ${tokenB.symbol}` });
          return; // continues in the approval-confirmed effect below
        }
      }

      doAddLiquidity(amountADesired, amountBDesired, minAmountA, minAmountB);
      toast({ title: 'Add liquidity submitted', type: 'success' });
    } catch (e) {
      toast({ title: 'Add liquidity failed', description: decodeRevertReason(e), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Remove liquidity — strictly await LP approval before removing
  // ============================================================
  const doRemoveLiquidity = useCallback((liquidity: bigint, minA: bigint, minB: bigint) => {
    if (tokenA.isNative || tokenB.isNative) {
      const token = tokenA.isNative ? tokenBAddr : tokenAAddr;
      const minToken = tokenA.isNative ? minB : minA;
      writeContract({
        address: contractAddresses.veriRouter,
        abi: VeriRouterAbi,
        functionName: 'removeLiquidityETH',
        args: [token, liquidity, minToken, minA + minB, address, Math.floor(Date.now() / 1000) + 1200],
      });
    } else {
      writeContract({
        address: contractAddresses.veriRouter,
        abi: VeriRouterAbi,
        functionName: 'removeLiquidity',
        args: [tokenAAddr, tokenBAddr, liquidity, minA, minB, address, Math.floor(Date.now() / 1000) + 1200],
      });
    }
  }, [tokenA.isNative, tokenB.isNative, tokenAAddr, tokenBAddr, address, contractAddresses.veriRouter, writeContract]);

  const handleRemoveLiquidity = async () => {
    if (!address || !amountA || !poolInfo) return;

    try {
      setIsLoading(true);
      const liquidity = parseUnits(amountA, 18); // LP tokens have 18 decimals
      // Slippage-protected minima from the user's LP share of reserves.
      const share = poolInfo.totalSupply > 0n ? (liquidity * BigInt(1e18)) / poolInfo.totalSupply : 0n;
      const estA = poolInfo.totalSupply > 0n ? (poolInfo.reserve0 * share) / BigInt(1e18) : 0n;
      const estB = poolInfo.totalSupply > 0n ? (poolInfo.reserve1 * share) / BigInt(1e18) : 0n;
      const minAmountA = (estA * BigInt(Math.floor((100 - slippage) * 100))) / BigInt(10000);
      const minAmountB = (estB * BigInt(Math.floor((100 - slippage) * 100))) / BigInt(10000);

      // Strict sequencing: approve the LP token, await the receipt, then remove.
      // (No setTimeout — the approval-confirmed effect below fires the removal.)
      if (lpAllowance !== undefined && lpAllowance < liquidity) {
        const hash = await writeContractAction(config, {
          address: poolInfo.address as `0x${string}`,
          abi: erc20Abi,
          functionName: 'approve',
          args: [contractAddresses.veriRouter, liquidity],
          chainId: 10143,
        });
        setApprovalStep({ hash, action: 'remove', label: `approve LP (${tokenA.symbol}/${tokenB.symbol})` });
        return; // continues in the approval-confirmed effect below
      }

      doRemoveLiquidity(liquidity, minAmountA, minAmountB);
      toast({ title: 'Remove liquidity submitted', type: 'success' });
    } catch (e) {
      toast({ title: 'Remove liquidity failed', description: decodeRevertReason(e), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================
  // Approval-confirmed effect: fire the pending action ONLY after
  // the approval transaction receipt confirms (no timing races).
  // The step is consumed atomically so a stale `isApproveConfirmed`
  // (e.g. after a second approval for the other token) cannot re-fire.
  // ============================================================
  useEffect(() => {
    if (!isApproveConfirmed || !approvalStep) return;
    const step = approvalStep;
    const label = step.label;
    setApprovalStep(null);
    if (step.action === 'add') {
      void handleAddLiquidity();
    } else {
      void handleRemoveLiquidity();
    }
    toast({ title: `${label} confirmed`, description: 'Continuing with your transaction…', type: 'success' });
  }, [isApproveConfirmed, approvalStep]);

  // Approval error: surface the decoded revert reason.
  useEffect(() => {
    if (isApproveError) {
      const reason = decodeRevertReason(approveError);
      setError(reason);
      toast({ title: 'Approval reverted', description: reason, type: 'error' });
      setApprovalStep(null);
    }
  }, [isApproveError, approveError, toast]);

  // Action success: refetch state. Action revert: decode + show, NEVER success.
  useEffect(() => {
    if (isSuccess) {
      setAmountA('');
      setAmountB('');
      toast({ title: 'Liquidity updated!', type: 'success' });
    }
  }, [isSuccess, toast]);

  useEffect(() => {
    if (isTxError) {
      const reason = decodeRevertReason(receiptError ?? writeError);
      setError(reason);
      toast({ title: 'Transaction reverted', description: reason, type: 'error' });
    }
  }, [isTxError, receiptError, writeError, toast]);

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="card-hover py-16 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-teal/10">
            <Wallet className="h-8 w-8 text-accent-teal" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-text-primary">Connect Wallet for Liquidity</h2>
          <p className="mb-6 text-text-muted">Connect your wallet to add or remove liquidity</p>
          <a href="/#wallet" className="btn-primary">Connect Wallet</a>
        </div>
      </div>
    );
  }

  const poolExists = !!poolInfo && poolInfo.totalSupply > 0n;
  const isFirstLiquidity = !!poolInfo && poolInfo.totalSupply === 0n;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Tab Navigation */}
      <div className="flex rounded-2xl border border-white/10 bg-bg-surface p-1" role="tablist" aria-label="Liquidity mode">
        <button
          role="tab"
          aria-selected={activeTab === 'add'}
          onClick={() => handleTabChange('add')}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all',
            activeTab === 'add'
              ? 'gradient-primary text-[#04121B] shadow-[0_0_16px_rgba(45,212,191,0.35)]'
              : 'text-text-secondary hover:text-text-primary'
          )}
        >
          <Zap className="h-4 w-4" />
          Add Liquidity
        </button>
        <button
          role="tab"
          aria-selected={activeTab === 'remove'}
          onClick={() => handleTabChange('remove')}
          disabled={!poolExists}
          className={cn(
            'flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all',
            activeTab === 'remove'
              ? 'gradient-primary text-[#04121B] shadow-[0_0_16px_rgba(45,212,191,0.35)]'
              : poolExists
                ? 'text-text-secondary hover:text-text-primary'
                : 'cursor-not-allowed text-border-secondary'
          )}
        >
          <Minus className="h-4 w-4" />
          Remove Liquidity
        </button>
      </div>

      {/* Pool Status */}
      <div className={cn('card', poolExists && 'border-accent-green/30')}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="font-medium text-text-primary">Pool status</h3>
          {poolExists && (
            <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" /> Pool Active</Badge>
          )}
        </div>

        {poolInfo ? (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-xs uppercase tracking-wider text-text-muted">Reserves</div>
              <div className="font-mono text-text-primary">
                {formatNumber(Number(formatUnits(poolInfo.reserve0, poolInfo.token0.decimals)))} {poolInfo.token0.symbol}
              </div>
              <div className="mt-1 font-mono text-text-primary">
                {formatNumber(Number(formatUnits(poolInfo.reserve1, poolInfo.token1.decimals)))} {poolInfo.token1.symbol}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-text-muted">Total liquidity</div>
              <div className="font-mono text-text-primary">
                {formatNumber(Number(formatUnits(poolInfo.totalSupply, 18)))} LP
              </div>
              {poolInfo.userLiquidity > 0n && (
                <div className="mt-1 font-mono text-accent-teal">
                  Your share: {formatNumber(Number(formatUnits(poolInfo.userLiquidity, 18)))} LP
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-4 text-center text-text-muted">
            <Zap className="mx-auto mb-2 h-8 w-8 text-border-secondary" />
            <p>Select two tokens to view pool info</p>
          </div>
        )}

        {isFirstLiquidity && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-warning-primary/30 bg-warning-light/20 p-3 text-warning-primary">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            <span className="text-sm">First liquidity provider sets the initial price. Ensure ratio reflects fair market value.</span>
          </div>
        )}
      </div>

      {/* Token Inputs */}
      <div className="space-y-4">
        {/* Token A */}
        <div className="space-y-2">
          <label className="text-xs font-medium uppercase tracking-wider text-text-muted">
            {activeTab === 'add' ? 'Token A' : 'LP tokens to remove'}
          </label>
          <div className="rounded-2xl border border-border-subtle bg-bg-tertiary p-4 transition-colors focus-within:border-accent-teal/50">
            <div className="mb-3 flex items-center gap-3">
              <button
                onClick={() => activeTab === 'add' && setSelectorFor('A')}
                disabled={activeTab === 'remove' || isLoading || isWriting || isConfirming}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent-teal/40 disabled:opacity-50"
              >
                <TokenIcon symbol={activeTab === 'add' ? tokenA.symbol : 'LP'} size="sm" />
                <span className="font-medium text-text-primary">{activeTab === 'add' ? tokenA.symbol : 'LP'}</span>
                {activeTab === 'add' && <ChevronDown className="h-4 w-4 text-text-muted" />}
              </button>
            </div>
            <input
              type="text"
              value={amountA}
              onChange={e => setAmountA(e.target.value)}
              placeholder="0.0"
              disabled={activeTab === 'remove' || isLoading || isWriting || isConfirming || awaitingApproval}
              className="input w-full border-0 bg-transparent text-right font-mono text-2xl focus:ring-0 placeholder:text-text-muted"
              inputMode="decimal"
              aria-label={activeTab === 'add' ? 'Token A amount' : 'LP tokens amount'}
            />
            <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
              <span className="font-mono text-sm text-text-secondary">
                Balance: {activeTab === 'add' ? '0' : formatNumber(Number(formatUnits(poolInfo?.userLiquidity || 0n, 18)))} {activeTab === 'add' ? tokenA.symbol : 'LP'}
              </span>
              {activeTab === 'add' && (
                <button
                  onClick={() => setAmountA('0.0')}
                  className="text-xs font-medium text-accent-teal transition-colors hover:text-accent-green"
                >
                  Max
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Swap Arrow (only for add) */}
        {activeTab === 'add' && (
          <button
            onClick={() => {
              setTokenA(tokenB);
              setTokenB(tokenA);
              const temp = amountA;
              setAmountA(amountB);
              setAmountB(temp);
            }}
            disabled={isLoading || isWriting || isConfirming || awaitingApproval}
            className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-bg-tertiary text-text-muted transition-all duration-200 hover:border-accent-teal/40 hover:text-text-primary disabled:opacity-50"
            aria-label="Swap tokens"
          >
            <ArrowRightLeft className="h-5 w-5" />
          </button>
        )}

        {/* Token B */}
        {activeTab === 'add' && (
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-wider text-text-muted">Token B</label>
            <div className="rounded-2xl border border-border-subtle bg-bg-tertiary p-4 transition-colors focus-within:border-accent-teal/50">
              <div className="mb-3 flex items-center gap-3">
                <button
                  onClick={() => setSelectorFor('B')}
                  disabled={isLoading || isWriting || isConfirming || awaitingApproval}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent-teal/40 disabled:opacity-50"
                >
                  <TokenIcon symbol={tokenB.symbol} size="sm" />
                  <span className="font-medium text-text-primary">{tokenB.symbol}</span>
                  <ChevronDown className="h-4 w-4 text-text-muted" />
                </button>
              </div>
              <input
                type="text"
                value={amountB}
                onChange={e => setAmountB(e.target.value)}
                placeholder="0.0"
                disabled={isLoading || isWriting || isConfirming || awaitingApproval}
                className="input w-full border-0 bg-transparent text-right font-mono text-2xl focus:ring-0 placeholder:text-text-muted"
                inputMode="decimal"
                readOnly
                aria-label="Token B amount"
              />
              <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
                <span className="font-mono text-sm text-text-secondary">
                  Balance: 0 {tokenB.symbol}
                </span>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'remove' && poolInfo && (
          <div className="card border-border-subtle bg-bg-tertiary/50">
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Info className="h-4 w-4" />
              <span>You will receive {poolInfo.token0.symbol} and {poolInfo.token1.symbol} proportional to your LP share.</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-center">
                <div className="font-mono text-text-primary">
                  {formatNumber(Number(formatUnits(poolInfo.reserve0, poolInfo.token0.decimals)) * Number(formatUnits(poolInfo.userLiquidity || 0n, 18)) / Number(formatUnits(poolInfo.totalSupply, 18)))} {poolInfo.token0.symbol}
                </div>
                <div className="text-xs text-text-muted">Est. {poolInfo.token0.symbol}</div>
              </div>
              <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-center">
                <div className="font-mono text-text-primary">
                  {formatNumber(Number(formatUnits(poolInfo.reserve1, poolInfo.token1.decimals)) * Number(formatUnits(poolInfo.userLiquidity || 0n, 18)) / Number(formatUnits(poolInfo.totalSupply, 18)))} {poolInfo.token1.symbol}
                </div>
                <div className="text-xs text-text-muted">Est. {poolInfo.token1.symbol}</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Slippage Settings */}
      <div className="card border-border-subtle bg-bg-tertiary/50">
        <div className="flex items-center justify-between">
          <div className="relative">
            <button
              onClick={() => setShowSlippageSettings(v => !v)}
              className="flex items-center gap-2 rounded-lg px-2 py-1 text-sm text-text-secondary transition-colors hover:text-text-primary"
              aria-expanded={showSlippageSettings}
            >
              <Settings2 className="h-4 w-4 text-text-muted" />
              Slippage: {slippage}%
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showSlippageSettings && 'rotate-180')} />
            </button>
            {showSlippageSettings && (
              <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-2xl border border-white/10 bg-bg-surface p-4 shadow-[0_0_30px_rgba(45,212,191,0.12)] animate-slide-down">
                <div className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">Slippage tolerance</div>
                <div className="grid grid-cols-3 gap-2">
                  {[0.1, 0.5, 1].map(v => (
                    <button
                      key={v}
                      onClick={() => setSlippage(v)}
                      className={cn(
                        'rounded-lg px-3 py-1.5 text-sm font-medium transition-all',
                        slippage === v
                          ? 'bg-accent-teal/20 text-accent-teal ring-1 ring-accent-teal/50'
                          : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                      )}
                    >
                      {v}%
                    </button>
                  ))}
                </div>
                <div className="mt-3">
                  <label htmlFor="liq-slip-range" className="text-xs text-text-muted">Custom</label>
                  <input
                    id="liq-slip-range"
                    type="range"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={slippage}
                    onChange={e => setSlippage(parseFloat(e.target.value))}
                    className="mt-1 w-full accent-accent-teal"
                  />
                  <div className="flex justify-between text-xs text-text-muted">
                    <span>0.1%</span>
                    <span>{slippage.toFixed(1)}%</span>
                    <span>5%</span>
                  </div>
                </div>
              </div>
            )}
          </div>
          <div className="font-mono text-sm text-text-secondary">
            Min A: {amountA ? (parseFloat(amountA) * (1 - slippage / 100)).toFixed(4) : '-'} {tokenA.symbol}
          </div>
        </div>
      </div>

      {/* Approval in progress */}
      {awaitingApproval && (
        <div className="flex items-center gap-3 rounded-xl border border-accent-teal/30 bg-accent-teal/5 p-4 text-accent-teal">
          <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
          <div>
            <div className="text-sm font-medium">Waiting for {approvalStep?.label ?? 'approval'}…</div>
            <div className="text-xs text-text-muted">The transaction will continue automatically once the approval confirms.</div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-xl border border-error-primary/30 bg-error-light/20 p-4 text-error-primary">
          <AlertTriangle className="h-5 w-5 flex-shrink-0" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Action Button */}
      <button
        onClick={activeTab === 'add' ? handleAddLiquidity : handleRemoveLiquidity}
        disabled={
          !amountA ||
          parseFloat(amountA) <= 0 ||
          (activeTab === 'add' && (!amountB || parseFloat(amountB) <= 0)) ||
          (activeTab === 'add' && tokenA.address === tokenB.address) ||
          (!poolExists && activeTab === 'remove') ||
          isLoading || isWriting || isConfirming || awaitingApproval
        }
        className={cn(
          'btn-primary w-full py-4 text-lg font-semibold disabled:opacity-50',
          activeTab === 'remove' && 'btn-danger'
        )}
      >
        {awaitingApproval ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Waiting for approval…
          </>
        ) : isWriting || isConfirming ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Confirming…
          </>
        ) : isLoading ? (
          <>
            <Loader2 className="h-5 w-5 animate-spin" />
            Processing…
          </>
        ) : activeTab === 'add' ? (
          <>
            <Zap className="h-5 w-5" />
            <span>{isFirstLiquidity ? 'Create Pool & Add' : 'Add Liquidity'}</span>
          </>
        ) : (
          <>
            <Minus className="h-5 w-5" />
            <span>Remove Liquidity</span>
          </>
        )}
      </button>

      {/* Compliance Info */}
      <div className="card border-border-subtle bg-bg-secondary/50">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Shield className="h-4 w-4" />
          <span>
            All liquidity operations are compliance-checked via Cleanverse CVI & CVA registries.
            Only verified addresses can provide liquidity.
          </span>
        </div>
      </div>

      {/* Token selector modal */}
      <Modal
        open={selectorFor !== null}
        onClose={() => setSelectorFor(null)}
        title="Select a token"
        labelledBy="liq-token-selector-title"
      >
        <div className="space-y-2">
          {supportedTokens.map(t => {
            const active = selectorFor === 'A' ? t.address === tokenA.address : t.address === tokenB.address;
            return (
              <button
                key={t.address}
                onClick={() => selectToken(t)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-all duration-200',
                  active
                    ? 'border-accent-teal/50 bg-accent-teal/10'
                    : 'border-white/10 bg-white/[0.04] hover:border-accent-teal/40 hover:bg-accent-teal/5'
                )}
              >
                <TokenIcon symbol={t.symbol} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-text-primary">{t.symbol}</div>
                  <div className="truncate text-xs text-text-muted">{t.name}</div>
                </div>
                {t.isNative && <Badge tone="info">Native</Badge>}
              </button>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
