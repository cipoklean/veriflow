import { useState, useEffect, useCallback } from 'react';
import { useAccount, useConfig, useReadContract, useWaitForTransactionReceipt, useChainId, useBalance, useWriteContract, usePublicClient } from 'wagmi';
import { readContract, writeContract as writeContractAction } from 'wagmi/actions';
import { parseUnits, formatUnits, erc20Abi, type Address } from 'viem';
import { Zap, Minus, Shield, AlertTriangle, CheckCircle2, Loader2, Settings2, ChevronDown, Info, Wallet, ArrowRightLeft } from 'lucide-react';
import { cn, formatNumber } from '@/lib/utils';
import { useGasCappedWrite } from '@/hooks/useGasCappedWrite';
import { withGasCap } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { fmt, pctOfBalance, pairAmount, minAmount } from '@/lib/format';
import { getContractAddresses } from '@/contracts/config';
import { useSupportedTokens, decodeRevertReason } from '@/contracts/useVeriFlow';
import VeriRouterAbi from '@/contracts/abis/VeriRouter.json';
import VeriFactoryAbi from '@/contracts/abis/VeriFactory.json';
import VeriPairAbi from '@/contracts/abis/VeriPair.json';
import { Modal } from '@/components/ui/Modal';
import { Reveal } from '@/components/ui/Reveal';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { Badge } from '@/components/ui/Badge';
import { Tooltip } from '@/components/ui/Tooltip';
import { ActionButton } from '@/components/ui/ActionButton';
import { useTxDock } from '@/components/ui/TxDock';
import { useWalletModal } from '@/components/VeriFlowApp/WalletModalProvider';

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
  const { track, confirm, revert } = useTxDock();
  const { open: openWalletModal } = useWalletModal();

  // Action writes (add / remove liquidity on the router). Gas-capped FE-21.
  const publicClient = usePublicClient();
  const { writeContract, data: txHash, isPending: isWriting, error: writeError, cappedWriteContract } = useGasCappedWrite();
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
  const [removePct, setRemovePct] = useState(100); // % of LP to remove
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

  // NEW-04: getReserves() returns (reserve0, reserve1) in PAIR SORT order
  // (token0 < token1 by address, e.g. USDC < WMON), which does NOT necessarily
  // match the user's A/B selection. Read the pair's actual token order and map
  // reserves to the SELECTED order before display and before the amountB
  // auto-fill.
  const { data: pairToken0 } = useReadContract({
    address: pairAddress as Address | undefined,
    abi: VeriPairAbi,
    functionName: 'token0',
    chainId: 10143,
    query: { enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' },
  });

  const { data: pairToken1 } = useReadContract({
    address: pairAddress as Address | undefined,
    abi: VeriPairAbi,
    functionName: 'token1',
    chainId: 10143,
    query: { enabled: !!pairAddress && pairAddress !== '0x0000000000000000000000000000000000000000' },
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

  // NEW-08: real wallet balances for the selected tokens (live reads, no
  // hardcoded "Balance: 0"). Native MON resolves to the wallet's ETH balance.
  const { data: nativeBalance } = useBalance({ address });
  const { data: tokenABalanceRaw } = useReadContract({
    address: tokenAAddr,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: 10143,
    query: { enabled: !!address && !tokenA.isNative },
  });
  const { data: tokenBBalanceRaw } = useReadContract({
    address: tokenBAddr,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: 10143,
    query: { enabled: !!address && !tokenB.isNative },
  });
  const tokenABalance = tokenA.isNative ? (nativeBalance?.value ?? 0n) : ((tokenABalanceRaw as bigint | undefined) ?? 0n);
  const tokenBBalance = tokenB.isNative ? (nativeBalance?.value ?? 0n) : ((tokenBBalanceRaw as bigint | undefined) ?? 0n);

  // Max fills the input with the REAL wallet balance of the selected token
  // (formatted to its decimals) — never a hardcoded value.
  const handleMaxA = () => {
    if (activeTab === 'add') {
      setAmountA(fmt(pctOfBalance(tokenABalance, 100, tokenA.isNative), tokenA.decimals));
    } else {
      setAmountA(fmt(pctOfBalance(poolInfo?.userLiquidity ?? 0n, 100, false), 18)); // LP tokens
    }
  };

  // Max B (add only): fill B to full balance, then back-compute A from reserves.
  const handleMaxB = () => {
    if (!poolInfo) return;
    const bWei = pctOfBalance(tokenBBalance, 100, tokenB.isNative);
    setAmountB(fmt(bWei, tokenB.decimals));
    const aWei = pairAmount(bWei, poolInfo.reserve1, poolInfo.reserve0);
    setAmountA(fmt(aWei, tokenA.decimals));
  };

  useEffect(() => {
    setIsLoading(true);
    setError(null);
    try {
      if (isEmptyAddr || tokenA.address === tokenB.address) {
        setPoolInfo(null);
        return;
      }
      const [r0, r1] = (reservesData as [bigint, bigint, number] | undefined) ?? [0n, 0n, 0];
      // NEW-04: getReserves() is in pair sort order (token0 < token1 by
      // address). Re-map to the user's SELECTED order (tokenA/tokenB) so both
      // the display and the amountB auto-fill use consistent units. Cross-check
      // both token0() and token1() (e.g. USDC as token0, WMON as token1).
      const t0 = (pairToken0 as string | undefined)?.toLowerCase();
      const t1 = (pairToken1 as string | undefined)?.toLowerCase();
      const a = tokenAAddr.toLowerCase();
      const b = tokenBAddr.toLowerCase();
      const tokenAIsToken0 = t0 === a || (t1 === b && t0 !== b);
      const reserveA = tokenAIsToken0 ? r0 : r1;
      const reserveB = tokenAIsToken0 ? r1 : r0;
      setPoolInfo({
        address: pairAddress as string,
        token0: tokenA,
        token1: tokenB,
        reserve0: reserveA,
        reserve1: reserveB,
        totalSupply: (lpTotalSupply as bigint) ?? 0n,
        userLiquidity: (userLpBalance as bigint) ?? 0n,
      });
    } catch {
      setError('Pool does not exist');
      setPoolInfo(null);
    } finally {
      setIsLoading(false);
    }
  }, [pairAddress, reservesData, lpTotalSupply, userLpBalance, tokenA, tokenB, pairToken0, pairToken1, tokenAAddr, tokenBAddr, isEmptyAddr]);

  // Normalize a typed liquidity amount to <=6 decimals, stripping trailing
  // zeros, on blur (mirrors the Swap input behavior).
  const normalizeLiq = (raw: string, _decimals: number): string => {
    if (!raw) return raw;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return raw;
    return n.toFixed(6).replace(/\.?0+$/, '');
  };

  // A→B when A is edited, B→A when B is edited. Only re-fills the counterpart,
  // preserving whatever the user typed on the active side.
  useEffect(() => {
    if (!poolInfo) return;
    if (amountA && parseFloat(amountA) > 0) {
      const aWei = parseUnits(amountA, tokenA.decimals);
      setAmountB(fmt(pairAmount(aWei, poolInfo.reserve0, poolInfo.reserve1), tokenB.decimals));
    } else if (amountB && parseFloat(amountB) > 0) {
      const bWei = parseUnits(amountB, tokenB.decimals);
      setAmountA(fmt(pairAmount(bWei, poolInfo.reserve1, poolInfo.reserve0), tokenA.decimals));
    }
  }, [amountA, amountB, poolInfo, tokenA.decimals, tokenB.decimals]);

  // Remove tab: a percent slider drives the LP amount; derive it from the user's
  // LP share via bigint (pctOfBalance) and surface est token0/token1.
  useEffect(() => {
    if (activeTab !== 'remove' || !poolInfo) return;
    const lpWei = pctOfBalance(poolInfo.userLiquidity, removePct as 10 | 25 | 50 | 100, false);
    setAmountA(fmt(lpWei, 18));
  }, [activeTab, removePct, poolInfo]);


  const handleTabChange = (tab: 'add' | 'remove') => {
    setActiveTab(tab);
    setAmountA('');
    setAmountB('');
    setError(null);
    setRemovePct(100);
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
      cappedWriteContract({
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
      cappedWriteContract({
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
      cappedWriteContract({
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
          // FE-21: gas-capped approve.
          const capped = publicClient
            ? await withGasCap(publicClient as never, {
                address: tokenAAddr,
                abi: erc20Abi,
                functionName: 'approve',
                args: [contractAddresses.veriRouter, amountADesired],
                chainId: 10143,
              })
            : {
                address: tokenAAddr,
                abi: erc20Abi,
                functionName: 'approve',
                args: [contractAddresses.veriRouter, amountADesired],
                chainId: 10143,
              };
          const hash = await writeContractAction(config, capped as never);
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
          // FE-21: gas-capped approve.
          const capped = publicClient
            ? await withGasCap(publicClient as never, {
                address: tokenBAddr,
                abi: erc20Abi,
                functionName: 'approve',
                args: [contractAddresses.veriRouter, amountBDesired],
                chainId: 10143,
              })
            : {
                address: tokenBAddr,
                abi: erc20Abi,
                functionName: 'approve',
                args: [contractAddresses.veriRouter, amountBDesired],
                chainId: 10143,
              };
          const hash = await writeContractAction(config, capped as never);
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
      // NEW-06: amountETHMin must be the WMON (native) leg's own minimum in
      // ITS decimals — NOT minA + minB, which mixes 6-dec USDC and 18-dec WMON
      // into a meaningless sum that would make the slippage floor absurd.
      const amountETHMin = tokenA.isNative ? minA : minB;
      cappedWriteContract({
        address: contractAddresses.veriRouter,
        abi: VeriRouterAbi,
        functionName: 'removeLiquidityETH',
        args: [token, liquidity, minToken, amountETHMin, address, Math.floor(Date.now() / 1000) + 1200],
      });
    } else {
      cappedWriteContract({
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
        // FE-21: gas-capped approve.
        const capped = publicClient
          ? await withGasCap(publicClient as never, {
              address: poolInfo.address as `0x${string}`,
              abi: erc20Abi,
              functionName: 'approve',
              args: [contractAddresses.veriRouter, liquidity],
              chainId: 10143,
            })
          : {
              address: poolInfo.address as `0x${string}`,
              abi: erc20Abi,
              functionName: 'approve',
              args: [contractAddresses.veriRouter, liquidity],
              chainId: 10143,
            };
        const hash = await writeContractAction(config, capped as never);
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
    if (isSuccess && txHash) {
      confirm(txHash);
      setAmountA('');
      setAmountB('');
      toast({ title: 'Liquidity updated!', type: 'success', txHash });
    }
  }, [isSuccess, txHash, confirm, toast]);

  useEffect(() => {
    if (isTxError && txHash) {
      revert(txHash);
      const reason = decodeRevertReason(receiptError ?? writeError);
      setError(reason);
      toast({ title: 'Transaction reverted', description: reason, type: 'error', txHash });
    }
  }, [isTxError, txHash, revert, receiptError, writeError, toast]);

  // Track pending txs in the global dock (approve + add/remove).
  useEffect(() => {
    if (txHash && !isSuccess && !isTxError) {
      track(txHash, activeTab === 'add' ? 'Add liquidity' : 'Remove liquidity');
    }
    if (approvalStep?.hash && !isApproveConfirmed && !isApproveError) {
      track(approvalStep.hash, `Approve ${approvalStep.label.replace('approve ', '')}`);
    }
  }, [txHash, isSuccess, isTxError, track, approvalStep, isApproveConfirmed, isApproveError, activeTab]);

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="card-hover py-16 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-teal/10">
            <Wallet className="h-8 w-8 text-accent-teal" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-text-primary">Connect Wallet for Liquidity</h2>
          <p className="mb-6 text-text-muted">Connect your wallet to add or remove liquidity</p>
          <button onClick={() => openWalletModal()} className="btn-primary">Connect Wallet</button>
        </div>
      </div>
    );
  }

  const poolExists = !!poolInfo && poolInfo.totalSupply > 0n;
  const isFirstLiquidity = !!poolInfo && poolInfo.totalSupply === 0n;

  return (
    <Reveal>
      <div className="mx-auto max-w-3xl space-y-6 lg:space-y-8">
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
                {fmt(poolInfo.reserve0, poolInfo.token0.decimals)} {poolInfo.token0.symbol}
              </div>
              <div className="mt-1 font-mono text-text-primary">
                {fmt(poolInfo.reserve1, poolInfo.token1.decimals)} {poolInfo.token1.symbol}
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-wider text-text-muted">Total liquidity</div>
              <div className="font-mono text-text-primary">
                {fmt(poolInfo.totalSupply, 18)} LP
              </div>
              {poolInfo.userLiquidity > 0n && (
                <div className="mt-1 font-mono text-accent-teal">
                  Your share: {fmt(poolInfo.userLiquidity, 18)} LP
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
                Balance: {activeTab === 'add' ? fmt(tokenABalance, tokenA.decimals) : fmt(poolInfo?.userLiquidity || 0n, 18)} {activeTab === 'add' ? tokenA.symbol : 'LP'}
              </span>
              <button
                onClick={handleMaxA}
                className="text-xs font-medium text-accent-teal transition-colors hover:text-accent-green"
              >
                Max
              </button>
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
                onBlur={e => setAmountB(normalizeLiq(e.target.value, tokenB.decimals))}
                placeholder="0.0"
                disabled={isLoading || isWriting || isConfirming || awaitingApproval}
                className="input w-full border-0 bg-transparent text-right font-mono text-2xl focus:ring-0 placeholder:text-text-muted"
                inputMode="decimal"
                aria-label="Token B amount"
              />
              <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
                <span className="font-mono text-sm text-text-secondary">
                  Balance: {fmt(tokenBBalance, tokenB.decimals)} {tokenB.symbol}
                </span>
                <button
                  onClick={handleMaxB}
                  disabled={isLoading || isWriting || isConfirming || awaitingApproval || !poolInfo}
                  className="text-xs font-medium text-accent-teal transition-colors hover:text-accent-green disabled:opacity-50"
                >
                  Max
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'remove' && poolInfo && (
          <div className="card border-border-subtle bg-bg-tertiary/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <Info className="h-4 w-4" />
                <span>You will receive {poolInfo.token0.symbol} and {poolInfo.token1.symbol} proportional to your LP share.</span>
              </div>
              <span className="font-mono text-sm text-text-secondary">{removePct}%</span>
            </div>
            {/* Percent slider — drives the LP amount (see effect above) */}
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={removePct}
              onChange={e => setRemovePct(parseInt(e.target.value, 10))}
              className="mt-3 w-full accent-accent-teal"
              aria-label="Percentage of liquidity to remove"
            />
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-center">
                <div className="font-mono text-text-primary">
                  {fmt(pairAmount(poolInfo.reserve0, poolInfo.totalSupply, pctOfBalance(poolInfo.userLiquidity, removePct as 10 | 25 | 50 | 100, false)), poolInfo.token0.decimals)} {poolInfo.token0.symbol}
                </div>
                <div className="text-xs text-text-muted">Est. {poolInfo.token0.symbol} · Min {fmt(minAmount(pairAmount(poolInfo.reserve0, poolInfo.totalSupply, pctOfBalance(poolInfo.userLiquidity, removePct as 10 | 25 | 50 | 100, false)), slippage), poolInfo.token0.decimals)}</div>
              </div>
              <div className="rounded-lg border border-border-subtle bg-bg-surface p-3 text-center">
                <div className="font-mono text-text-primary">
                  {fmt(pairAmount(poolInfo.reserve1, poolInfo.totalSupply, pctOfBalance(poolInfo.userLiquidity, removePct as 10 | 25 | 50 | 100, false)), poolInfo.token1.decimals)} {poolInfo.token1.symbol}
                </div>
                <div className="text-xs text-text-muted">Est. {poolInfo.token1.symbol} · Min {fmt(minAmount(pairAmount(poolInfo.reserve1, poolInfo.totalSupply, pctOfBalance(poolInfo.userLiquidity, removePct as 10 | 25 | 50 | 100, false)), slippage), poolInfo.token1.decimals)}</div>
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
            {activeTab === 'add' ? (
              <>
                Min A: {amountA ? fmt(minAmount(parseUnits(amountA, tokenA.decimals), slippage), tokenA.decimals) : '-'} {tokenA.symbol}
                {'  ·  '}
                Min B: {amountB ? fmt(minAmount(parseUnits(amountB, tokenB.decimals), slippage), tokenB.decimals) : '-'} {tokenB.symbol}
              </>
            ) : (
              <>Min A: {amountA ? fmt(minAmount(parseUnits(amountA, 18), slippage), 18) : '-'} LP</>
            )}
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

      {/* Action Button — busy ≠ disabled; disabled only when not applicable,
          always with an explanatory tooltip (§1) */}
      {(() => {
        const hasA = !!amountA && parseFloat(amountA) > 0;
        const hasB = activeTab === 'add' ? !!amountB && parseFloat(amountB) > 0 : true;
        const disabledReason = !hasA
          ? 'Enter an amount'
          : !hasB
            ? `Enter the ${tokenB.symbol} amount`
            : activeTab === 'add' && tokenA.address === tokenB.address
              ? 'Select two different tokens'
              : !poolExists && activeTab === 'remove'
                ? 'No pool exists for this pair'
                : null;
        const isBusy = isLoading || isWriting || isConfirming || awaitingApproval;
        const state = awaitingApproval || isBusy ? 'pending' : error ? 'error' : 'idle';
        return (
          <Tooltip content={disabledReason ?? (activeTab === 'add' ? 'Provide liquidity — compliance-checked on-chain' : 'Remove your liquidity — compliance-checked on-chain')} placement="top" disabled={!!disabledReason}>
            <ActionButton
              state={state}
              disabled={!!disabledReason}
              variant={activeTab === 'remove' ? 'danger' : 'primary'}
              onClick={activeTab === 'add' ? handleAddLiquidity : handleRemoveLiquidity}
              pendingLabel={awaitingApproval ? 'Waiting for approval…' : isConfirming ? 'Confirming…' : 'Processing…'}
              signingLabel="Confirm in wallet…"
              successLabel={activeTab === 'add' ? 'Liquidity added' : 'Liquidity removed'}
              errorLabel="Failed"
              errorMessage={error ?? undefined}
              onRetry={error ? (activeTab === 'add' ? handleAddLiquidity : handleRemoveLiquidity) : undefined}
              className="py-4 text-lg font-semibold disabled:opacity-60"
            >
              {activeTab === 'add' ? (
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
            </ActionButton>
          </Tooltip>
        );
      })()}

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
    </Reveal>
  );
}
