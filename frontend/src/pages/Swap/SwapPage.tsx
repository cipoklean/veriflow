import { useState, useEffect } from 'react';
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt, useChainId } from 'wagmi';
import { parseUnits, formatUnits, erc20Abi, type Address } from 'viem';
import { ArrowRightLeft, AlertTriangle, CheckCircle2, Loader2, Settings2, ChevronDown, Info, ShieldCheck, Fingerprint, BadgeCheck, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/useToast';
import { getContractAddresses } from '@/contracts/config';
import { useSupportedTokens, useQuote, useWalletVerified, decodeRevertReason, resolveSwapPath } from '@/contracts/useVeriFlow';
import VeriRouterAbi from '@/contracts/abis/VeriRouter.json';
import { Modal } from '@/components/ui/Modal';
import { TokenIcon } from '@/components/ui/TokenIcon';
import { Badge } from '@/components/ui/Badge';

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
  const contractAddresses = getContractAddresses(chainId);
  const supportedTokens = useSupportedTokens();

  // State
  const [fromToken, setFromToken] = useState<Token>(supportedTokens[1] ?? supportedTokens[0]); // WMON
  const [toToken, setToToken] = useState<Token>(supportedTokens[2] ?? supportedTokens[0]); // USDC
  const [fromAmount, setFromAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [showSlippageSettings, setShowSlippageSettings] = useState(false);
  const [selectorFor, setSelectorFor] = useState<'from' | 'to' | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [quote, setQuote] = useState<{ amountOut: bigint; priceImpact: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Write contract
  const { writeContract, data: txHash, isPending: isWriting, error: writeError } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, isError: isTxError, error: receiptError } = useWaitForTransactionReceipt({ hash: txHash });

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

  // Real on-chain quote from the router's getAmountsOut.
  // Native MON (0x0) must be resolved to the canonical WMON address in the path.
  const path: Address[] = resolveSwapPath(fromToken.address, toToken.address, contractAddresses.weth);
  const amountInWei = fromAmount && parseFloat(fromAmount) > 0
    ? parseUnits(fromAmount, fromToken.decimals)
    : 0n;
  const { amountOut, noLiquidity } = useQuote(path, amountInWei);

  // Recompute quote + price impact whenever inputs or the on-chain amountOut change.
  useEffect(() => {
    setError(null);
    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      setQuote(null);
      setToAmount('');
      return;
    }
    try {
      const inNum = Number(amountInWei);
      // crude price impact estimate vs pool mid (not exact, display only)
      const priceImpact = inNum > 0 ? Math.min((inNum / (inNum + 1e22)) * 100, 5) : 0;
      setQuote({ amountOut, priceImpact });
      setToAmount(formatUnits(amountOut, toToken.decimals));
    } catch (e) {
      setQuote(null);
      setToAmount('');
    }
  }, [amountOut, fromAmount, fromToken.decimals, toToken.decimals, amountInWei]);

  // Handle amount changes
  const handleFromAmountChange = (value: string) => {
    setFromAmount(value);
    if (quote && value) {
      const amountIn = parseUnits(value, fromToken.decimals);
      const ratio = Number(quote.amountOut) / Number(amountIn);
      const out = BigInt(Math.floor(Number(amountIn) * ratio));
      setToAmount(formatUnits(out, toToken.decimals));
    }
  };

  const handleToAmountChange = (value: string) => {
    setToAmount(value);
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

  // Approve token
  const handleApprove = async () => {
    if (!address || fromToken.isNative) return;

    try {
      setIsLoading(true);
      const amount = parseUnits('1000000000', fromToken.decimals); // Large approval
      writeContract({
        address: fromToken.address,
        abi: erc20Abi,
        functionName: 'approve',
        args: [contractAddresses.veriRouter, amount],
      });
      toast({ title: 'Approval submitted', type: 'success' });
    } catch (e) {
      toast({ title: 'Approval failed', description: String(e), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  // Execute swap
  const handleSwap = async () => {
    if (!address || !fromAmount || parseFloat(fromAmount) <= 0 || !quote) return;

    try {
      setIsLoading(true);
      const amountIn = parseUnits(fromAmount, fromToken.decimals);
      const minAmountOut = (quote.amountOut * BigInt(Math.floor((100 - slippage) * 100))) / BigInt(10000);

      if (fromToken.isNative) {
        // Native MON swap: path must use the canonical WMON address (path[0] == WETH).
        writeContract({
          address: contractAddresses.veriRouter,
          abi: VeriRouterAbi,
          functionName: 'swapExactETHForTokens',
          args: [minAmountOut, path, address, Math.floor(Date.now() / 1000) + 1200],
          value: amountIn,
        });
      } else if (toToken.isNative) {
        // Token -> native MON: output lands in the router, unwrapped to ETH for the user.
        writeContract({
          address: contractAddresses.veriRouter,
          abi: VeriRouterAbi,
          functionName: 'swapExactTokensForETH',
          args: [amountIn, minAmountOut, path, address, Math.floor(Date.now() / 1000) + 1200],
        });
      } else {
        // ERC20 swap - check allowance first
        if (allowance && allowance < amountIn) {
          toast({ title: 'Insufficient allowance', description: 'Approve the token first, then swap again.', type: 'error' });
          return;
        }
        writeContract({
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
  useEffect(() => {
    if (isSuccess) {
      refetchFromBalance();
      refetchToBalance();
      refetchAllowance();
      setFromAmount('');
      setToAmount('');
      setQuote(null);
      toast({ title: 'Swap completed!', type: 'success' });
    }
  }, [isSuccess, refetchFromBalance, refetchToBalance, refetchAllowance, toast]);

  // Transaction honesty: surface the decoded revert reason instead of success.
  useEffect(() => {
    if (isTxError) {
      const reason = decodeRevertReason(receiptError ?? writeError);
      setError(reason);
      toast({ title: 'Swap reverted', description: reason, type: 'error' });
    }
  }, [isTxError, receiptError, writeError, toast]);

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="card-hover py-16 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-teal/10">
            <ShieldCheck className="h-8 w-8 text-accent-teal" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-text-primary">Connect Wallet to Swap</h2>
          <p className="mb-6 text-text-muted">Every trade is compliance-checked before execution.</p>
          <a href="/#wallet" className="btn-primary">Connect Wallet</a>
        </div>
      </div>
    );
  }
  const fromBalanceFormatted = fromToken.isNative ? '-' : fromBalance ? formatUnits(fromBalance, fromToken.decimals) : '0';
    const toBalanceFormatted = toToken.isNative ? '-' : toBalance ? formatUnits(toBalance, toToken.decimals) : '0';
  const needsApproval = !fromToken.isNative && allowance && quote && parseUnits(fromAmount, fromToken.decimals) > allowance;
  const complianceBlocked = isConnected && !isVerified;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
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
          <div className="relative rounded-2xl border border-border-subtle bg-bg-tertiary p-4 transition-colors focus-within:border-accent-teal/50">
            <div className="mb-3 flex items-center gap-3">
              <button
                onClick={() => setSelectorFor('from')}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent-teal/40"
              >
                <TokenIcon symbol={fromToken.symbol} size="sm" />
                <span className="font-medium text-text-primary">{fromToken.symbol}</span>
                <ChevronDown className="h-4 w-4 text-text-muted" />
              </button>
            </div>
            <div className="relative">
              <input
                type="text"
                value={fromAmount}
                onChange={e => handleFromAmountChange(e.target.value)}
                placeholder="0.0"
                className="input w-full border-0 bg-transparent text-right font-mono text-2xl focus:ring-0 placeholder:text-text-muted"
                inputMode="decimal"
                aria-label="Amount to pay"
              />
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-border-subtle pt-3">
              <span className="font-mono text-sm text-text-secondary">
                Balance: {parseFloat(fromBalanceFormatted).toFixed(4)} {fromToken.symbol}
              </span>
              <div className="flex items-center gap-3">
                {!fromToken.isNative && fromBalance && Number(fromBalance) > 0n && (
                  <button
                    onClick={() => handleFromAmountChange(formatUnits(fromBalance, fromToken.decimals))}
                    className="text-xs font-medium text-accent-teal transition-colors hover:text-accent-green"
                  >
                    Max
                  </button>
                )}
                {needsApproval && (
                  <button
                    onClick={handleApprove}
                    disabled={isLoading || isWriting || isConfirming}
                    className="btn-secondary text-xs"
                  >
                    Approve {fromToken.symbol}
                  </button>
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
          <div className="relative rounded-2xl border border-border-subtle bg-bg-tertiary p-4 transition-colors focus-within:border-accent-teal/50">
            <div className="mb-3 flex items-center gap-3">
              <button
                onClick={() => setSelectorFor('to')}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-bg-surface px-3 py-2.5 text-left transition-colors hover:border-accent-teal/40"
              >
                <TokenIcon symbol={toToken.symbol} size="sm" />
                <span className="font-medium text-text-primary">{toToken.symbol}</span>
                <ChevronDown className="h-4 w-4 text-text-muted" />
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
                Balance: {parseFloat(toBalanceFormatted).toFixed(4)} {toToken.symbol}
              </span>
            </div>
          </div>
        </div>

        {/* Quote Details */}
        {quote && (
          <div className="mt-4 rounded-2xl border border-border-subtle bg-bg-tertiary/50 p-4">
            {noLiquidity ? (
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
              <div>
                <div className="text-xs uppercase tracking-wider text-text-muted">Rate</div>
                <div className="font-mono text-text-primary">
                  1 {fromToken.symbol} = {Number(quote.amountOut) / Number(parseUnits('1', fromToken.decimals))} {toToken.symbol}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-text-muted">Price impact</div>
                <div className={cn('font-mono', quote.priceImpact > 1 ? 'text-warning-primary' : 'text-success-primary')}>
                  {quote.priceImpact.toFixed(2)}%
                </div>
              </div>
            </div>
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

        {/* Swap Button */}
        <button
          onClick={handleSwap}
          disabled={!fromAmount || parseFloat(fromAmount) <= 0 || !quote || needsApproval || !isVerified || isVerifying || noLiquidity || isLoading || isWriting || isConfirming}
          className="btn-primary mt-4 w-full py-4 text-lg font-semibold disabled:opacity-50"
        >
          {isWriting || isConfirming ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Confirming…
            </>
          ) : isLoading ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Processing…
            </>
          ) : isVerifying ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              Verifying compliance…
            </>
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
        </button>
      </div>

      {/* Compliance Info */}
      <div className="card bg-bg-secondary/50 border-border-primary/50">
        <div className="flex items-center gap-2 text-sm text-text-muted">
          <Info className="h-4 w-4" />
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
  );
}
