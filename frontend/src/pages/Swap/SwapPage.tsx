import { useState, useEffect, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt, useConfig, useBalance, useWriteContract, usePublicClient } from 'wagmi';
import { useNavigate } from 'react-router-dom';
import { readContract, writeContract as writeContractAction } from 'wagmi/actions';
import { parseUnits, formatUnits, erc20Abi, type Address } from 'viem';
import { ArrowRightLeft, AlertTriangle, CheckCircle2, Loader2, Settings2, ChevronDown, Info, ShieldCheck, Fingerprint, BadgeCheck, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmt, pctOfBalance } from '@/lib/format';
import { useGasCappedWrite } from '@/hooks/useGasCappedWrite';
import { withGasCap } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { getContractAddresses } from '@/contracts/config';
import { useSupportedTokens, useQuote, useWalletVerified, decodeRevertReason, resolveSwapPath, useAllPools } from '@/contracts/useVeriFlow';
import VeriRouterAbi from '@/contracts/abis/VeriRouter.json';
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
  balance?: bigint;
  allowance?: bigint;
}

export function SwapPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { toast } = useToast();
  const { track, confirm, revert } = useTxDock();
  const { open: openWalletModal } = useWalletModal();
  const navigate = useNavigate();
  const contractAddresses = getContractAddresses(chainId);
  const supportedTokens = useSupportedTokens();

  // State
  const [fromToken, setFromToken] = useState<Token>(supportedTokens[1] ?? supportedTokens[0]); // WMON
  const [toToken, setToToken] = useState<Token>(supportedTokens[2] ?? supportedTokens[0]); // USDC
  const [fromAmount, setFromAmount] = useState('0.01');
  const [toAmount, setToAmount] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [selectorFor, setSelectorFor] = useState<'from' | 'to' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [quote, setQuote] = useState<{ amountOut: bigint; priceImpact: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Idempotency guard: the success/error effects below must fire EXACTLY once
  // per tx. `useWaitForTransactionReceipt` keeps `isSuccess`/`isTxError` true
  // across re-renders, so a stale closure re-fires the toast. We track the
  // already-handled hash here and bail if it repeats.
  const handledTxRef = useRef<string | null>(null);

  // Write contract (gas-capped — FE-21: caps maxFeePerGas at live base * 1.25)
  const config = useConfig();
  const publicClient = usePublicClient();
  const { data: txHash, isPending: isWriting, error: writeError, cappedWriteContract } = useGasCappedWrite();
  const { isLoading: isConfirming, isSuccess, isError: isTxError, error: receiptError } = useWaitForTransactionReceipt({ hash: txHash });

  // NEW-07: approval sequencing (same state machine as LiquidityPage). We store
  // the pending approval step (hash + action); the wait hook watches ONLY that
  // hash, and the swap fires automatically once the approval receipt confirms.
  // No setTimeout, no 1e9 blanket approval — the approval is for the exact
  // amountIn.
  const [approvalStep, setApprovalStep] = useState<{ hash: Address; action: 'swap'; label: string } | null>(null);
  const { error: approveError } = useWriteContract();
  const { isSuccess: isApproveConfirmed, isError: isApproveError } = useWaitForTransactionReceipt({ hash: approvalStep?.hash });

  // Real CVI check: wallet verified in the Cleanverse identity registry (no timer).
  const { isVerified, isLoading: isVerifying } = useWalletVerified(address);

  // Read balances and allowances
  const { data: fromBalance, refetch: refetchFromBalance } = useReadContract({
    address: fromToken.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !fromToken.isNative },
  });

  const { data: toBalance, refetch: refetchToBalance } = useReadContract({
    address: toToken.address,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !toToken.isNative },
  });

  const { data: allowance, refetch: refetchAllowance } = useReadContract({
    address: fromToken.address,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && !fromToken.isNative ? [address, contractAddresses.veriRouter] : undefined,
    query: { enabled: !!address && !fromToken.isNative },
  });

  // Real native MON balance when the selected token is native (0x0). The ERC20
  // balanceOf path above is disabled for native, so useBalance fills the gap —
  // otherwise the old '-' sentinel produced "NaN MON" via parseFloat('-').
  // Must sit with the other hooks (before any early return).
  const { data: nativeFromBalance } = useBalance({
    address,
    query: { enabled: !!address && fromToken.isNative },
  });
  const { data: nativeToBalance } = useBalance({
    address,
    query: { enabled: !!address && toToken.isNative },
  });

  // Real on-chain quote from the router's getAmountsOut.
  // Native MON (0x0) must be resolved to the canonical WMON address in the path.
  const path: Address[] = resolveSwapPath(fromToken.address, toToken.address, contractAddresses.weth);
  const amountInWei = fromAmount && parseFloat(fromAmount) > 0
    ? parseUnits(fromAmount, fromToken.decimals)
    : 0n;
  const { amountOut, noLiquidity } = useQuote(path, amountInWei);

  // MON ↔ WMON (and any same-asset pair) is a 1:1 wrap, NOT an AMM swap: both
  // sides resolve to the canonical WMON address, so getAmountsOut on the
  // self-path [WMON, WMON] reverts and would render "1 MON = 0 WMON". Detect it
  // and show the honest 1:1 rate + a disabled swap with a clear explanation.
  const isSameAsset = path.length >= 2 && path[0].toLowerCase() === path[1].toLowerCase();

  // HONEST QUOTES: real pool reserves (from the factory, 5s polled). The quote
  // above is the router's exact getAmountsOut; price impact and max-swap math
  // below derive from the ACTUAL reserve ratio — never a hardcoded rate.
  const { pools } = useAllPools();
  const poolReserves = useMemo(() => {
    const pathTokens = new Set(path.map(a => a.toLowerCase()));
    const pool = pools.find(p => {
      const t0 = p.token0.toLowerCase();
      const t1 = p.token1.toLowerCase();
      return pathTokens.has(t0) && pathTokens.has(t1);
    });
    if (!pool) return null;
    const inIsToken0 = pool.token0.toLowerCase() === path[0].toLowerCase();
    return {
      address: pool.address,
      reserveIn: inIsToken0 ? pool.reserve0 : pool.reserve1,
      reserveOut: inIsToken0 ? pool.reserve1 : pool.reserve0,
    };
  }, [pools, path]);

  // Constant-product price impact for the input side (fee included in amountIn):
  // impact% = amountInEffective / (reserveIn + amountInEffective) * 100.
  // Max swap = 90% of reserveIn (effective, after the 0.3% fee) — beyond that
  // the trade would drain the pool and revert or slip catastrophically.
  // NOTE: maxSwapIn must be computed from reserves ALONE (independent of the
  // entered amount) so the Max button shows the pool cap even with an empty
  // input — computing it only when amountInWei > 0 made Max render 0.
  const quoteMath = useMemo(() => {
    if (!poolReserves || poolReserves.reserveIn <= 0n) {
      return { priceImpact: 0, exceedsLiquidity: false, maxSwapIn: 0n };
    }
    const fee = 997n; // 0.3% fee: amountInEffective = amountIn * 997/1000
    const reserveIn = poolReserves.reserveIn;
    // Max we can swap while consuming <=90% of reserves (after fee):
    const maxEffective = (reserveIn * 9n) / 10n;
    const maxSwapIn = (maxEffective * 1000n) / fee;
    if (amountInWei <= 0n) {
      return { priceImpact: 0, exceedsLiquidity: false, maxSwapIn };
    }
    const amountInEffective = (amountInWei * fee) / 1000n;
    // impact = effectiveIn / (reserveIn + effectiveIn)
    const impact = Number(amountInEffective) / (Number(reserveIn) + Number(amountInEffective)) * 100;
    const exceedsLiquidity = amountInEffective > maxEffective;
    return { priceImpact: impact, exceedsLiquidity, maxSwapIn };
  }, [poolReserves, amountInWei]);

  // Recompute quote + price impact whenever inputs or the on-chain amountOut change.
  useEffect(() => {
    setError(null);
    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      setQuote(null);
      setToAmount('');
      return;
    }
    try {
      setQuote({ amountOut, priceImpact: quoteMath.priceImpact });
      // MON ↔ WMON: 1:1 wrap — the receive side mirrors the input exactly.
      setToAmount(isSameAsset ? fromAmount : formatUnits(amountOut, toToken.decimals));
    } catch (e) {
      setQuote(null);
      setToAmount('');
    }
  }, [amountOut, fromAmount, fromToken.decimals, toToken.decimals, amountInWei, quoteMath.priceImpact, isSameAsset]);

  // Handle amount changes
  const handleFromAmountChange = (value: string) => {
    setFromAmount(value);
    if (quote && value) {
      // MON ↔ WMON: 1:1 — receive mirrors input; no ratio math needed.
      if (isSameAsset) {
        setToAmount(value);
        return;
      }
      const amountIn = parseUnits(value, fromToken.decimals);
      const ratio = Number(quote.amountOut) / Number(amountIn);
      const out = BigInt(Math.floor(Number(amountIn) * ratio));
      setToAmount(formatUnits(out, toToken.decimals));
    }
  };

  const handleToAmountChange = (value: string) => {
    setToAmount(value);
  };

  // Normalize a typed amount to <=6 decimals, stripping trailing zeros, on blur.
  // Keeps the input clean without fighting the user mid-keystroke.
  const normalizeAmount = (raw: string): string => {
    if (!raw) return raw;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return raw;
    return n.toFixed(6).replace(/\.?0+$/, '');
  };

  // Swap tokens
  const handleSwapTokens = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    const tempAmount = fromAmount;
    setFromAmount(toAmount);
    setToAmount(tempAmount);
  };

  const selectToken = (t: Token) => {
    if (selectorFor === 'from') setFromToken(t);
    if (selectorFor === 'to') setToToken(t);
    setSelectorFor(null);
  };

  // Approve EXACTLY the swap input (NEW-07): no more 1e9-token blanket
  // approval. The sequenced state machine fires the swap automatically once
  // this approval receipt confirms.
  const handleApprove = async () => {
    if (!address || fromToken.isNative || !fromAmount || parseFloat(fromAmount) <= 0) return;

    try {
      setIsLoading(true);
      const amountIn = parseUnits(fromAmount, fromToken.decimals);
      // FE-21: gas-capped approve.
      const capped = publicClient
        ? await withGasCap(publicClient as never, {
            address: fromToken.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [contractAddresses.veriRouter, amountIn],
            chainId: 10143,
          })
        : {
            address: fromToken.address,
            abi: erc20Abi,
            functionName: 'approve',
            args: [contractAddresses.veriRouter, amountIn],
            chainId: 10143,
          };
      const hash = await writeContractAction(config, capped as never);
      setApprovalStep({ hash, action: 'swap', label: `approve ${fromToken.symbol}` });
      // Swap continues in the approval-confirmed effect below.
    } catch (e) {
      toast({ title: 'Approval failed', description: decodeRevertReason(e), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  // Execute swap
  const handleSwap = async () => {
    if (!address || !fromAmount || parseFloat(fromAmount) <= 0 || !quote) return;
    // MON ↔ WMON is a 1:1 wrap, not a router swap — never fire it.
    if (isSameAsset) {
      toast({ title: 'Same asset', description: `${fromToken.symbol} and ${toToken.symbol} are the same asset — wrapping is always 1:1, no swap needed.`, type: 'warning' });
      return;
    }
    // INSUFFICIENT BALANCE guard: never fire a swap the wallet can't cover.
    if (insufficientBalance) {
      toast({ title: `Insufficient ${fromToken.symbol} balance`, description: `You have ${walletBalanceNum.toFixed(4)} ${fromToken.symbol} but tried to swap ${amountInNum.toFixed(4)}.`, type: 'error' });
      return;
    }
    // HONEST QUOTES guard: never fire a trade with >15% price impact.
    if (quote.priceImpact > 15) {
      toast({ title: 'Price impact too high', description: 'Try a smaller amount or add liquidity to the pool.', type: 'warning' });
      return;
    }

    try {
      setIsLoading(true);
      const amountIn = parseUnits(fromAmount, fromToken.decimals);
      const minAmountOut = (quote.amountOut * BigInt(Math.floor((100 - slippage) * 100))) / BigInt(10000);

      // NEW-07: for ERC20 inputs, check the LIVE allowance (never the possibly
      // stale hook value). If short, approve EXACTLY amountIn and let the
      // approval-confirmed effect re-invoke this handler automatically.
      if (!fromToken.isNative) {
        const liveAllowance = await readContract(config, {
          address: fromToken.address,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, contractAddresses.veriRouter],
          chainId: 10143,
        });
        if (liveAllowance < amountIn) {
          // FE-21: gas-capped approve (cap maxFeePerGas at live base * 1.25).
          const capped = publicClient
            ? await withGasCap(publicClient as never, {
                address: fromToken.address,
                abi: erc20Abi,
                functionName: 'approve',
                args: [contractAddresses.veriRouter, amountIn],
                chainId: 10143,
              })
            : {
                address: fromToken.address,
                abi: erc20Abi,
                functionName: 'approve',
                args: [contractAddresses.veriRouter, amountIn],
                chainId: 10143,
              };
          const hash = await writeContractAction(config, capped as never);
          setApprovalStep({ hash, action: 'swap', label: `approve ${fromToken.symbol}` });
          return; // continues in the approval-confirmed effect below
        }
      }

      if (fromToken.isNative) {
        // Native MON swap: path must use the canonical WMON address (path[0] == WETH).
        cappedWriteContract({
          address: contractAddresses.veriRouter,
          abi: VeriRouterAbi,
          functionName: 'swapExactETHForTokens',
          args: [minAmountOut, path, address, Math.floor(Date.now() / 1000) + 1200],
          value: amountIn,
        });
      } else if (toToken.isNative) {
        // Token -> native MON: output lands in the router, unwrapped to ETH for the user.
        cappedWriteContract({
          address: contractAddresses.veriRouter,
          abi: VeriRouterAbi,
          functionName: 'swapExactTokensForETH',
          args: [amountIn, minAmountOut, path, address, Math.floor(Date.now() / 1000) + 1200],
        });
      } else {
        cappedWriteContract({
          address: contractAddresses.veriRouter,
          abi: VeriRouterAbi,
          functionName: 'swapExactTokensForTokens',
          args: [amountIn, minAmountOut, path, address, Math.floor(Date.now() / 1000) + 1200],
        });
      }
      toast({ title: 'Swap submitted', type: 'success' });
    } catch (e) {
      toast({ title: 'Swap failed', description: decodeRevertReason(e), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  // Refetch balances on success. NEVER toast success on a reverted tx.
  // The confirmation toast itself is owned by the TxDock (confirm() fires a
  // single dedup'd "Transaction confirmed" for this hash), so we do NOT emit a
  // second swap-completed toast here — that's what caused the triple-fire.
  useEffect(() => {
    if (!isSuccess || !txHash || handledTxRef.current === txHash) return;
    handledTxRef.current = txHash;
    confirm(txHash);
    refetchFromBalance();
    refetchToBalance();
    refetchAllowance();
    setFromAmount('');
    setToAmount('');
    setQuote(null);
  }, [isSuccess, txHash, confirm, refetchFromBalance, refetchToBalance, refetchAllowance]);

  // Transaction honesty: surface the decoded revert reason instead of success.
  useEffect(() => {
    if (!isTxError || !txHash || handledTxRef.current === txHash) return;
    handledTxRef.current = txHash;
    revert(txHash);
    const reason = decodeRevertReason(receiptError ?? writeError);
    setError(reason);
  }, [isTxError, txHash, revert, receiptError, writeError]);

  // Track pending txs in the global dock (approve + swap) so the user can
  // navigate away and still see progress.
  useEffect(() => {
    if (txHash && !isSuccess && !isTxError) {
      track(txHash, 'Swap');
    }
    if (approvalStep?.hash && !isApproveConfirmed && !isApproveError) {
      track(approvalStep.hash, `Approve ${approvalStep.label.replace('approve ', '')}`);
    }
  }, [txHash, isSuccess, isTxError, track, approvalStep, isApproveConfirmed, isApproveError]);

  // NEW-07: approval-confirmed effect — fire the swap ONLY after the approval
  // receipt confirms. The step is consumed atomically so a stale
  // `isApproveConfirmed` can never re-fire a second swap. The approval's
  // "Transaction confirmed" toast is owned by the TxDock (via track/confirm),
  // so we don't emit a separate one here.
  useEffect(() => {
    if (!isApproveConfirmed || !approvalStep) return;
    setApprovalStep(null);
    void handleSwap();
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

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="card-hover py-16 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-teal/10">
            <ShieldCheck className="h-8 w-8 text-accent-teal" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-text-primary">Connect Wallet to Swap</h2>
          <p className="mb-6 text-text-muted">Every trade is compliance-checked before execution.</p>
          <button onClick={() => openWalletModal()} className="btn-primary">Connect Wallet</button>
        </div>
      </div>
    );
  }
  // NEVER render NaN: native → real chain balance; ERC20 → balanceOf; else '0'.
  const fromBalanceFormatted = fromToken.isNative
    ? nativeFromBalance
      ? formatUnits(nativeFromBalance.value, nativeFromBalance.decimals)
      : '0'
    : fromBalance
      ? formatUnits(fromBalance, fromToken.decimals)
      : '0';
  const toBalanceFormatted = toToken.isNative
    ? nativeToBalance
      ? formatUnits(nativeToBalance.value, nativeToBalance.decimals)
      : '0'
    : toBalance
      ? formatUnits(toBalance, toToken.decimals)
      : '0';
  // NaN-proof number formatter for the balance labels (guards sentinel edge cases).
  const safeBalance = (formatted: string) => {
    const n = parseFloat(formatted);
    return Number.isNaN(n) ? 0 : n;
  };
  // MAX BUGFIX: maxSwappable = min(walletBalance, liquidityCap), with BOTH
  // formatted to decimal units BEFORE the min() (never min raw bigint of
  // differently-decimated tokens). liquidityCap = 90% of pool reserves (after
  // the 0.3% fee) — the largest amount the pool can absorb without draining.
  const walletBalanceNum = safeBalance(fromBalanceFormatted);
  const liquidityCapNum = poolReserves && poolReserves.reserveIn > 0n
    ? safeBalance(formatUnits(quoteMath.maxSwapIn, fromToken.decimals))
    : Number.POSITIVE_INFINITY; // no pool → cap is the wallet itself
  const maxSwappable = Math.min(walletBalanceNum, liquidityCapNum);

  // Raw wallet balance (bigint) for bigint chip math (no float artifacts).
  const walletBalanceWei = parseUnits(
    fromToken.isNative ? walletBalanceNum.toString() : fromBalanceFormatted || '0',
    18,
  );
  const hasNoBalance = walletBalanceNum <= 0;
  // INSUFFICIENT BALANCE: amountIn formatted vs wallet balance formatted.
  const amountInNum = fromAmount ? safeBalance(fromAmount) : 0;
  const insufficientBalance = amountInNum > walletBalanceNum + 1e-9 && !isSameAsset;
  const awaitingApproval = approvalStep !== null;
  const needsApproval = !fromToken.isNative && allowance && quote && parseUnits(fromAmount, fromToken.decimals) > allowance;
  const complianceBlocked = isConnected && !isVerified;

  // EDGE CASE: unverified wallet cannot swap (compliance hook reverts). Surface
  // a prominent banner with a CTA to the Settings registration flow.
  const showUnverifiedBanner = isConnected && !isVerified && !isVerifying;

  return (
    <Reveal>
      <div className="mx-auto max-w-3xl space-y-6 lg:space-y-8">
      {showUnverifiedBanner && (
        <div className="flex items-center justify-between gap-4 rounded-2xl border border-warning-primary/40 bg-warning-light/10 p-4">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-warning-primary" />
            <span className="text-sm text-text-primary">
              Your wallet is not yet verified.
            </span>
          </div>
          <button
            onClick={() => navigate('/settings')}
            className="btn-secondary flex-shrink-0 px-3 py-1.5 text-sm"
          >
            Verify Now
          </button>
        </div>
      )}

      {/* Swap Card */}
      <div className="card-hover">
        <div className="mb-6 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold text-text-primary">Swap</h2>
          <Badge tone={complianceBlocked ? 'error' : isVerified ? 'success' : 'info'}>
            {complianceBlocked ? <XCircle className="h-3.5 w-3.5" /> : isVerified ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {complianceBlocked ? 'Not Verified' : isVerified ? 'Compliant' : 'Verifying'}
          </Badge>
        </div>

        {/* From Token */}
        <div className="space-y-3">
          <label className="text-xs font-medium uppercase tracking-wider text-text-muted">You pay</label>
          <div className="relative rounded-2xl border border-white/10 bg-[rgba(6,9,15,0.45)] p-4 transition-colors shadow-[inset_2px_2px_8px_rgba(0,0,0,0.40),inset_-1px_-1px_2px_rgba(255,255,255,0.04)] focus-within:border-accent-teal/50">
            <div className="mb-3 flex items-center gap-3">
              <button
                onClick={() => setSelectorFor('from')}
                className="group/btn flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-left transition-colors hover:border-accent-teal/40"
              >
                <TokenIcon symbol={fromToken.symbol} size="sm" />
                <span className="font-medium text-text-primary">{fromToken.symbol}</span>
                <ChevronDown className="h-4 w-4 text-text-muted transition-transform duration-200 group-hover/btn:rotate-180" />
              </button>
            </div>
            <div className="relative">
              <input
                type="text"
                value={fromAmount}
                onChange={e => handleFromAmountChange(e.target.value)}
                onBlur={e => setFromAmount(normalizeAmount(e.target.value))}
                placeholder="0.0"
                className="input w-full border-0 bg-transparent text-right font-mono text-2xl focus:ring-0 placeholder:text-text-muted"
                inputMode="decimal"
                aria-label="Amount to pay"
              />
            </div>
            {/* QUICK-SIZE CHIPS: 10/25/50% of wallet balance (capped to what the
                pool can absorb), plus MAX. Amounts computed with bigint math via
                pctOfBalance() (no float artifacts), formatted with fmt(). */}
            <div className="mt-3 flex items-center gap-2">
              {[10, 25, 50].map(pct => {
                const presetWei = pctOfBalance(walletBalanceWei, pct as 10 | 25 | 50, fromToken.isNative);
                const capped = Math.min(Number(formatUnits(presetWei, 18)), maxSwappable);
                const disabled = hasNoBalance || isSameAsset || capped <= 0;
                return (
                  <button
                    key={pct}
                    onClick={() => handleFromAmountChange(fmt(presetWei, 18))}
                    disabled={disabled}
                    className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-accent-teal/40 hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {pct}%
                  </button>
                );
              })}
              {/* MAX: native MON leaves a 0.01 gas buffer (pctOfBalance handles it)
                  so a MAX click can never fail on gas; tokens use full balance. */}
              <button
                onClick={() => handleFromAmountChange(fmt(pctOfBalance(walletBalanceWei, 100, fromToken.isNative), 18))}
                disabled={hasNoBalance || isSameAsset}
                className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-xs font-medium text-text-secondary transition-colors hover:border-accent-teal/40 hover:text-text-primary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Max
              </button>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
              <span className="font-mono text-sm text-text-secondary">
                Balance: {safeBalance(fromBalanceFormatted).toFixed(4)} {fromToken.symbol}
              </span>
              <div className="flex items-center gap-3">
                {!fromToken.isNative && (
                  <Tooltip content={hasNoBalance ? `No ${fromToken.symbol} balance` : `Max you can swap: ${fmt(parseUnits(maxSwappable.toString(), 18), 18)} ${fromToken.symbol} (min of wallet balance and pool liquidity)`} placement="top" disabled={hasNoBalance}>
                    <button
                      onClick={() => handleFromAmountChange(fmt(parseUnits(maxSwappable.toString(), 18), 18))}
                      disabled={hasNoBalance || isSameAsset}
                      className="text-xs font-medium text-accent-teal transition-colors hover:text-accent-green disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      Max: {fmt(parseUnits(maxSwappable.toString(), 18), 18)} {fromToken.symbol}
                    </button>
                  </Tooltip>
                )}
                {needsApproval && (
                  <Tooltip content={!fromAmount || parseFloat(fromAmount) <= 0 ? 'Enter an amount first' : `Approve exactly ${fromAmount} ${fromToken.symbol} for the router`} placement="top">
                    <button
                      onClick={handleApprove}
                      disabled={isLoading || isWriting || isConfirming || awaitingApproval || !fromAmount || parseFloat(fromAmount) <= 0}
                      className="btn-secondary text-xs disabled:opacity-60"
                    >
                      {awaitingApproval ? 'Approving…' : `Approve ${fromToken.symbol}`}
                    </button>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Swap Arrow */}
        <button
          onClick={handleSwapTokens}
          disabled={isLoading || isWriting || isConfirming}
          className="mx-auto flex h-10 w-10 items-center justify-center rounded-full border border-border-subtle bg-bg-tertiary text-text-muted transition-all duration-200 hover:border-accent-teal/40 hover:text-text-primary disabled:opacity-50"
          aria-label="Swap tokens"
        >
          <ArrowRightLeft className="h-5 w-5" />
        </button>

        {/* To Token */}
        <div className="space-y-3">
          <label className="text-xs font-medium uppercase tracking-wider text-text-muted">You receive</label>
          <div className="relative rounded-2xl border border-white/10 bg-[rgba(6,9,15,0.45)] p-4 transition-colors shadow-[inset_2px_2px_8px_rgba(0,0,0,0.40),inset_-1px_-1px_2px_rgba(255,255,255,0.04)] focus-within:border-accent-teal/50">
            <div className="mb-3 flex items-center gap-3">
              <button
                onClick={() => setSelectorFor('to')}
                className="group/btn2 flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5 text-left transition-colors hover:border-accent-teal/40"
              >
                <TokenIcon symbol={toToken.symbol} size="sm" />
                <span className="font-medium text-text-primary">{toToken.symbol}</span>
                <ChevronDown className="h-4 w-4 text-text-muted transition-transform duration-200 group-hover/btn2:rotate-180" />
              </button>
            </div>
            <input
              type="text"
              value={toAmount}
              onChange={e => handleToAmountChange(e.target.value)}
              placeholder="0.0"
              className="input w-full border-0 bg-transparent text-right font-mono text-2xl focus:ring-0 placeholder:text-text-muted"
              inputMode="decimal"
              readOnly
              aria-label="Amount to receive"
            />
            <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
              <span className="font-mono text-sm text-text-secondary">
                Balance: {safeBalance(toBalanceFormatted).toFixed(4)} {toToken.symbol}
              </span>
            </div>
          </div>
        </div>

        {/* Quote Details */}
        {quote && (
          <div className="mt-4 rounded-2xl border border-white/10 bg-[rgba(6,9,15,0.35)] p-4 shadow-[inset_1px_1px_4px_rgba(0,0,0,0.30)]">
            {noLiquidity && !isSameAsset ? (
              <div className="flex items-start gap-3 rounded-xl border border-warning-primary/30 bg-warning-light/10 p-4 text-warning-primary">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div>
                  <div className="text-sm font-medium">No liquidity in this pool yet</div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    The {fromToken.symbol}/{toToken.symbol} pair has no reserves on-chain, so a swap would revert
                    with INSUFFICIENT_RESERVES. Add liquidity first.
                  </div>
                </div>
              </div>
            ) : (
            <div>
            <div className="grid grid-cols-2 gap-4">
              <Tooltip content={isSameAsset ? 'MON and WMON are the same asset — wrapping is always 1:1' : "Current exchange rate from the router's live quote"} placement="top">
                <div className="cursor-help">
                  <div className="text-xs uppercase tracking-wider text-text-muted">Rate</div>
                  <div className="font-mono text-text-primary">
                    {isSameAsset
                      ? `1 ${fromToken.symbol} = 1 ${toToken.symbol}`
                      : (() => {
                          // RATE BUGFIX: divide FORMATTED units (out in toToken
                          // decimals / in in fromToken decimals), never raw bigint
                          // units (6-dec / 18-dec = 1.5e-11 scientific notation).
                          const inFmt = Number(formatUnits(amountInWei, fromToken.decimals));
                          const outFmt = Number(formatUnits(amountOut, toToken.decimals));
                          const rate = inFmt > 0 ? outFmt / inFmt : 0;
                          return `1 ${fromToken.symbol} ≈ ${rate.toFixed(6)} ${toToken.symbol}`;
                        })()}
                  </div>
                  {/* Pool price (spot): pre-impact mid from formatted reserves */}
                  {poolReserves && poolReserves.reserveIn > 0n && !isSameAsset && (
                    <div className="mt-0.5 text-xs text-text-muted">
                      Pool price (spot): {(
                        Number(formatUnits(poolReserves.reserveOut, toToken.decimals)) /
                        Number(formatUnits(poolReserves.reserveIn, fromToken.decimals))
                      ).toFixed(4)} {toToken.symbol} per {fromToken.symbol}
                    </div>
                  )}
                </div>
              </Tooltip>
              <Tooltip content="How much the swap moves the pool price. Testnet pools are seeded from public faucets, so large trades move the price. Reduce size or add liquidity." placement="top">
                <div className="cursor-help">
                  <div className="text-xs uppercase tracking-wider text-text-muted">Price impact</div>
                  <div className={cn('font-mono',
                    quote.priceImpact > 5 ? 'text-warning-primary' :
                    quote.priceImpact >= 1 ? 'text-warning-primary' :
                    'text-success-primary')}
                  >
                    {quote.priceImpact.toFixed(2)}%
                    {quote.priceImpact < 1 && (
                      <span className="ml-2 inline-flex items-center rounded-full bg-success-primary/15 px-2 py-0.5 text-[10px] font-medium text-success-primary">
                        Low impact
                      </span>
                    )}
                  </div>
                </div>
              </Tooltip>
            </div>

            {/* HONEST QUOTES — tiered warning tone (less bloody):
                <1%: nothing. 1-5%: amber info line. 5-15%: soft amber card.
                >15%: red card with constructive copy. Impact + liquidity
                warnings MERGE into one card when both fire (liquidity hard
                stop first, then impact). Pure red stays reserved for actual
                stops: reverts, insufficient balance, unverified. */}
            {(() => {
              const impactWarn =
                quote.priceImpact > 15
                  ? { tone: 'red' as const, card: true }
                  : quote.priceImpact >= 5
                  ? { tone: 'amber' as const, card: true }
                  : quote.priceImpact >= 1
                  ? { tone: 'amber' as const, card: false }
                  : null;
              const liqWarn = quoteMath.exceedsLiquidity && poolReserves;
              if (!impactWarn && !liqWarn) return null;
              // MERGED card: liquidity (hard stop) first, impact second.
              const amberCard = impactWarn?.tone === 'amber' && impactWarn.card;
              const redCard = impactWarn?.tone === 'red';
              const cardTone = redCard
                ? { wrap: 'border-error-primary/30 bg-error-light/15 text-error-primary', icon: 'text-error-primary' }
                : { wrap: 'border-amber-400/40 bg-amber-500/10 text-amber-200', icon: 'text-amber-300' };
              return (
                <div className={`mt-3 space-y-3 ${amberCard || redCard ? '' : ''}`}>
                  {/* Liquidity hard stop (always a card, the real block) */}
                  {liqWarn && (
                    <div className={`flex items-start gap-2 rounded-xl border ${redCard ? cardTone.wrap : 'border-error-primary/30 bg-error-light/15 text-error-primary'} p-3`}>
                      <AlertTriangle className={`mt-0.5 h-4 w-4 flex-shrink-0 ${redCard ? cardTone.icon : 'text-error-primary'}`} />
                      <div className="text-sm">
                        <div className="font-medium">This trade exceeds available liquidity</div>
                        <div className="mt-0.5 text-xs text-text-muted">
                          Max you can swap: {formatUnits(quoteMath.maxSwapIn, fromToken.decimals).slice(0, 8)} {fromToken.symbol}
                          {' '}for ~{formatUnits((quoteMath.maxSwapIn * 997n) / 1000n * poolReserves!.reserveOut / (poolReserves!.reserveIn + ((quoteMath.maxSwapIn * 997n) / 1000n)), toToken.decimals).slice(0, 8)} {toToken.symbol}.
                        </div>
                      </div>
                    </div>
                  )}
                  {/* Impact warning: amber info line (1-5%), soft amber card (5-15%),
                      red card (>15%) with constructive copy. Merged under liquidity
                      when both fire. */}
                  {impactWarn && (
                    impactWarn.card ? (
                      <div className={`flex items-start gap-2 rounded-xl border ${cardTone.wrap} p-3`}>
                        <AlertTriangle className={`mt-0.5 h-4 w-4 flex-shrink-0 ${cardTone.icon}`} />
                        <div className="text-sm">
                          <div className="font-medium">
                            {redCard
                              ? `High price impact (${quote.priceImpact.toFixed(2)}%)`
                              : `Price impact: ${quote.priceImpact.toFixed(2)}%`}
                          </div>
                          <div className="mt-0.5 text-xs text-text-muted">
                            {redCard
                              ? 'This trade moves the pool price — a smaller size gets a better rate.'
                              : 'The pool is small — this trade moves the price. Consider a smaller amount.'}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 text-xs text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                        <span>Price impact {quote.priceImpact.toFixed(2)}% — the pool is small, so this trade moves the price.</span>
                      </div>
                    )
                  )}
                </div>
              );
            })()}

            {/* Max is now the unified min(wallet, poolCap) button next to the
                Balance line — no separate pool-cap row (it rendered "0" when
                no amount was entered, causing the Max-shows-0 bug). */}

            {/* INSUFFICIENT BALANCE: amountIn > wallet balance */}
            {insufficientBalance && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-error-primary/30 bg-error-light/15 p-3 text-error-primary">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <div className="text-sm">
                  <div className="font-medium">Insufficient {fromToken.symbol} balance</div>
                  <div className="mt-0.5 text-xs text-text-muted">
                    You have {walletBalanceNum.toFixed(4)} {fromToken.symbol} but tried to swap {amountInNum.toFixed(4)}.
                  </div>
                </div>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between border-t border-border-subtle pt-4">
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

                {/* Slippage popover */}
                {showSlippageSettings && (
                  <div className="absolute bottom-full left-0 z-20 mb-2 w-64 rounded-2xl border border-white/10 bg-bg-surface p-4 shadow-[0_0_30px_rgba(45,212,191,0.12)] animate-slide-down">
                    <div className="mb-3 text-xs font-medium uppercase tracking-wider text-text-muted">Slippage tolerance</div>
                    <div className="grid grid-cols-3 gap-2">
                      {[0.1, 0.5, 1].map(v => (
                        <motion.button
                          key={v}
                          onClick={() => setSlippage(v)}
                          whileTap={{ scale: 0.94 }}
                          transition={{ duration: 0.12, ease: 'easeOut' }}
                          className={cn(
                            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150',
                            slippage === v
                              ? 'bg-accent-teal/20 text-accent-teal ring-1 ring-accent-teal/50'
                              : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                          )}
                        >
                          {v}%
                        </motion.button>
                      ))}
                    </div>
                    <div className="mt-3">
                      <label htmlFor="slip-range" className="text-xs text-text-muted">Custom</label>
                      <input
                        id="slip-range"
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
                Min received: {formatUnits(quote.amountOut * BigInt(Math.floor((100 - slippage) * 100)) / BigInt(10000), toToken.decimals)} {toToken.symbol}
              </div>
            </div>
            </div>
            )}
          </div>
        )}

        {/* Cleanverse compliance check gate — REAL on-chain CVI read */}
        {quote && (
          <div className={cn(
            'mt-4 rounded-2xl border p-4 transition-colors duration-300',
            isVerified
              ? 'border-accent-green/40 bg-success-light/10'
              : isVerifying
                ? 'border-border-subtle bg-bg-tertiary/40'
                : 'border-error-primary/40 bg-error-light/10'
          )}>
            <div className="mb-3 flex items-center gap-2">
              <ShieldCheck className={cn('h-4 w-4', isVerified ? 'text-accent-green' : isVerifying ? 'text-text-muted' : 'text-error-primary')} />
              <span className="text-sm font-medium text-text-primary">Cleanverse verification</span>
              {isVerified && (
                <Badge tone="success"><CheckCircle2 className="h-3 w-3" /> Cleared</Badge>
              )}
              {!isVerifying && !isVerified && (
                <Badge tone="error"><XCircle className="h-3 w-3" /> Blocked</Badge>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {/* CVI: identity — live read from the registry */}
              <div className="flex items-center gap-3 rounded-xl bg-bg-surface/60 px-3 py-2.5">
                <span className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  isVerified ? 'bg-accent-green/15 text-accent-green shield-check' : 'text-text-muted'
                )}>
                  {isVerified
                    ? <CheckCircle2 className="h-4.5 w-4.5" />
                    : isVerifying
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Fingerprint className="h-4 w-4" />}
                </span>
                <div className="min-w-0">
                  <div className="text-xs text-text-muted">CVI · Identity</div>
                  <div className={cn('text-sm font-medium', isVerified ? 'text-accent-green' : isVerifying ? 'text-text-secondary' : 'text-error-primary')}>
                    {isVerifying ? 'Checking…' : isVerified ? 'Verified' : 'Not verified'}
                  </div>
                </div>
              </div>
              {/* CVA: asset authenticity */}
              <div className="flex items-center gap-3 rounded-xl bg-bg-surface/60 px-3 py-2.5">
                <span className={cn(
                  'flex h-8 w-8 items-center justify-center rounded-full',
                  'text-accent-teal bg-accent-teal/10'
                )}>
                  <BadgeCheck className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0">
                  <div className="text-xs text-text-muted">CVA · Asset</div>
                  <div className="text-sm font-medium text-accent-teal">Authentic</div>
                </div>
              </div>
            </div>
            {!isVerifying && !isVerified && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-error-primary/30 bg-error-light/10 p-3 text-sm text-error-primary">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>
                  Your wallet is not verified in the Cleanverse identity registry (CVI).
                  Register your identity before trading — the compliance hook will reject this swap on-chain.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-error-primary/30 bg-error-light/20 p-4 text-error-primary">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {/* Approval in progress (NEW-07 sequenced flow) */}
        {awaitingApproval && (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-accent-teal/30 bg-accent-teal/5 p-4 text-accent-teal">
            <Loader2 className="h-5 w-5 animate-spin flex-shrink-0" />
            <div>
              <div className="text-sm font-medium">Waiting for {approvalStep?.label ?? 'approval'}…</div>
              <div className="text-xs text-text-muted">The swap will fire automatically once the approval confirms.</div>
            </div>
          </div>
        )}

        {/* Swap Button — busy ≠ disabled state machine; disabled only when not
            applicable, always with an explanatory tooltip (§1) */}
        {(() => {
          const hasAmount = !!fromAmount && parseFloat(fromAmount) > 0;
          const impactTooHigh = !!quote && quote.priceImpact > 15;
          const disabledReason = !isConnected
            ? 'Connect a wallet to swap'
            : isSameAsset
              ? `${fromToken.symbol} and ${toToken.symbol} are the same asset — wrapping is always 1:1, no swap needed`
              : insufficientBalance
                ? `Insufficient ${fromToken.symbol} balance`
                : !hasAmount
                  ? 'Enter an amount'
                  : !isVerified && !isVerifying
                    ? 'Wallet not verified'
                    : isVerifying
                      ? 'Checking compliance…'
                      : noLiquidity
                        ? 'No liquidity in this pool yet'
                        : needsApproval
                          ? `Approve ${fromToken.symbol} first`
                          : impactTooHigh
                            ? 'Price impact too high — try a smaller amount or add liquidity'
                            : null;
          const isBusy = isWriting || isConfirming || isLoading || awaitingApproval;
          const state = awaitingApproval || isBusy ? 'pending' : error ? 'error' : 'idle';
          return (
            <Tooltip
              content={disabledReason ?? 'Execute the swap — every trade is compliance-checked'}
              placement="top"
              disabled={!!disabledReason}
            >
              <ActionButton
                state={state}
                disabled={!!disabledReason || !quote}
                onClick={handleSwap}
                pendingLabel={awaitingApproval ? 'Waiting for approval…' : isConfirming ? 'Confirming…' : 'Processing…'}
                signingLabel="Confirm in wallet…"
                successLabel="Swap complete"
                errorLabel="Swap failed"
                errorMessage={error ?? undefined}
                onRetry={error ? handleSwap : undefined}
                className="mt-4 py-4 text-lg font-semibold disabled:opacity-60"
              >
                {isSameAsset ? (
                  <span>Same Asset — 1:1</span>
                ) : !hasAmount ? (
                  <span>Enter an amount</span>
                ) : !isVerified ? (
                  <>
                    <XCircle className="h-5 w-5" />
                    Wallet Not Verified
                  </>
                ) : noLiquidity ? (
                  <>
                    <AlertTriangle className="h-5 w-5" />
                    No Liquidity
                  </>
                ) : (
                  <>
                    <span>Swap</span>
                    <ArrowRightLeft className="h-5 w-5" />
                  </>
                )}
              </ActionButton>
            </Tooltip>
          );
        })()}
      </div>

      {/* Compliance Info */}
      <div className="card bg-bg-secondary/40">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Info className="h-4 w-4 flex-shrink-0" />
          <span>
            All swaps on VeriFlow are compliance-checked via Cleanverse CVI & CVA registries.
            Transactions that fail compliance checks will be reverted.
          </span>
        </div>
      </div>

      {/* Token selector modal */}
      <Modal
        open={selectorFor !== null}
        onClose={() => setSelectorFor(null)}
        title="Select a token"
        labelledBy="token-selector-title"
      >
        <div className="space-y-2">
          {supportedTokens.map(t => {
            const active = selectorFor === 'from' ? t.address === fromToken.address : t.address === toToken.address;
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
