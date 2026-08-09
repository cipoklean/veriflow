import { useState, useRef, useEffect } from 'react';
import { useAccount, useChainId, useReadContract, useWaitForTransactionReceipt } from 'wagmi';
import { motion } from 'framer-motion';
import { Settings2, ShieldCheck, Network, SlidersHorizontal, Clock, Coins, Loader2, AlertTriangle, Fingerprint, BadgeCheck, UserPlus, Copy } from 'lucide-react';
import { type Address, type Abi, isAddress } from 'viem';
import { cn } from '@/lib/utils';
import { getContractAddresses } from '@/contracts/config';
import { useWalletVerified, decodeRevertReason } from '@/contracts/useVeriFlow';
import ComplianceHookAbi from '@/contracts/abis/ComplianceHook.json';
import CVIRegistryAbi from '@/contracts/abis/CVIRegistry.json';
import { useGasCappedWrite } from '@/hooks/useGasCappedWrite';
import { useToast } from '@/hooks/useToast';
import { useTxDock } from '@/components/ui/TxDock';
import { Reveal } from '@/components/ui/Reveal';
import { ActionButton } from '@/components/ui/ActionButton';
import { verifyOnce, fetchCleanverseStatus, type VerifyResult } from '@/lib/cleanverse';

const CVI_ABI = CVIRegistryAbi as Abi;
// A fresh attestation lasts 10 years — long enough that testnet users never
// hit expiry mid-demo, short enough to be realistic.
const TEN_YEARS = 10n * 365n * 24n * 3600n;

export function SettingsPage() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const contractAddresses = getContractAddresses(chainId);
  const { toast } = useToast();
  const { track, confirm, revert } = useTxDock();
  const [slippage, setSlippage] = useState('0.5');
  const [deadline, setDeadline] = useState('20');
  const [autoApprove, setAutoApprove] = useState(true);
  const [testnet, setTestnet] = useState(true);

  // NEW-08: live compliance state — CVI verification of the connected wallet
  // and the compliance hook's paused state are read on-chain (no hardcoded
  // "Verified"/"Enforced" badges).
  const { isVerified, isLoading: isVerifying, refetch: refetchVerified } = useWalletVerified(address);
  const { data: hookPaused, isLoading: isPausedLoading } = useReadContract({
    address: contractAddresses.complianceHook,
    abi: ComplianceHookAbi,
    functionName: 'paused',
    chainId: 10143,
    query: { enabled: isConnected },
  });
  const enforcementActive = !hookPaused;

  // CVI registry owner (governor). Registration is owner-gated on the real
  // Cleanverse contract, so the Admin "Whitelist Wallet" panel only renders
  // for the owner — regular users get the self-service "Verify My Identity" path.
  const { data: cviOwner } = useReadContract({
    address: contractAddresses.cviRegistry,
    abi: CVI_ABI,
    functionName: 'owner',
    chainId: 10143,
    query: { enabled: isConnected },
  });
  const isCVIOwner = !!address && !!cviOwner && address.toLowerCase() === (cviOwner as Address).toLowerCase();

  // Governor admin fallback: direct on-chain registerWallet from the owner's
  // connected wallet (manual path). Users never self-register — that is done
  // server-side by the institution via /api/cleanverse/verify.
  const { data: regHash, isPending: isRegWriting, error: regWriteError, cappedWriteContract } = useGasCappedWrite();
  const { isLoading: isRegConfirming, isSuccess: isRegSuccess, isError: isRegError, error: regReceiptError } = useWaitForTransactionReceipt({ hash: regHash });
  const [regMode, setRegMode] = useState<'self' | 'admin' | null>(null);
  const [adminTarget, setAdminTarget] = useState('');
  const handledRegRef = useRef<string | null>(null);

  // Cleanverse (institution) verification flow state.
  const [ccBusy, setCcBusy] = useState(false);
  const [ccStep, setCcStep] = useState('');
  const [ccError, setCcError] = useState<string | null>(null);
  const [ccDone, setCcDone] = useState(false);
  const [apassTier, setApassTier] = useState<number | null>(null);

  const registerWalletOnChain = (target: Address) => {
    const expiry = BigInt(Math.floor(Date.now() / 1000)) + TEN_YEARS;
    cappedWriteContract({
      address: contractAddresses.cviRegistry,
      abi: CVI_ABI,
      functionName: 'registerWallet',
      args: [target, 1, 0, '', '', [] as string[], expiry, 0n],
      chainId: 10143,
    });
  };

  const handleVerifyAdmin = () => {
    if (!isAddress(adminTarget)) {
      toast({ title: 'Invalid address', description: 'Paste a valid 0x wallet address.', type: 'error' });
      return;
    }
    setRegMode('admin');
    registerWalletOnChain(adminTarget as Address);
  };

  // Real Cleanverse flow (institution registers on-chain with the governor key).
  // One-shot JSON call; we poll useWalletVerified every 3s so the badge flips to
  // Compliant as soon as the on-chain write confirms.
  const handleVerifyCleanverse = () => {
    if (!address) return;
    setCcBusy(true);
    setCcError(null);
    setCcDone(false);
    setCcStep('Connecting to Cleanverse…');
    const poll = window.setInterval(() => refetchVerified(), 3000);
    verifyOnce(address)
      .then((msg: VerifyResult) => {
        if (msg.already) {
          // M-7: server pre-checked on-chain — wallet already registered.
          setCcDone(true);
          setCcBusy(false);
          refetchVerified();
          window.clearInterval(poll);
          return;
        }
        if (msg.hash) setCcStep('On-chain confirmation…');
        if (msg.step === 'done' || msg.step === 'done-via-query' || msg.ok) {
          setCcDone(true);
          setCcBusy(false);
          refetchVerified();
          window.clearInterval(poll);
        } else {
          // retryable (sandbox busy) → friendly copy; the ActionButton shows
          // an inline Retry that re-runs handleVerifyCleanverse.
          setCcError(
            msg.retryable
              ? msg.error || 'Cleanverse sandbox is busy — try again in a minute.'
              : msg.error || 'Verification failed',
          );
          setCcBusy(false);
          window.clearInterval(poll);
        }
      })
      .catch(() => {
        setCcError('Lost connection to the verification service. Try again.');
        setCcBusy(false);
        window.clearInterval(poll);
      });
  };

  // After the flow reports done, keep polling until the badge actually flips
  // (the governor tx may confirm a few seconds after the SSE closes).
  useEffect(() => {
    if (!ccDone || isVerified) return;
    const poll = window.setInterval(() => refetchVerified(), 3000);
    const stop = window.setTimeout(() => window.clearInterval(poll), 120000);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(stop);
    };
  }, [ccDone, isVerified, refetchVerified]);

  // Surface the A-Pass tier from /status when unverified.
  useEffect(() => {
    if (!isConnected || isVerified || !address) return;
    fetchCleanverseStatus(address)
      .then((d) => {
        if (d?.apass?.tier != null) setApassTier(d.apass.tier);
      })
      .catch(() => {});
  }, [isConnected, isVerified, address]);

  // Refetch the CVI status on success (badge flips green), surface toasts,
  // and clear the admin input. Idempotent per tx hash.
  useEffect(() => {
    if (!isRegSuccess || !regHash || handledRegRef.current === regHash) return;
    handledRegRef.current = regHash;
    confirm(regHash);
    refetchVerified();
    if (regMode === 'admin') setAdminTarget('');
    toast({
      title: regMode === 'admin' ? 'Wallet verified' : 'Identity verified',
      description: regMode === 'admin' ? `${adminTarget} is now registered.` : 'Your wallet is now registered in the CVI registry.',
      type: 'success',
    });
  }, [isRegSuccess, regHash, confirm, refetchVerified, regMode, adminTarget, toast]);

  useEffect(() => {
    if (!isRegError || !regHash || handledRegRef.current === regHash) return;
    handledRegRef.current = regHash;
    revert(regHash);
    const reason = decodeRevertReason(regReceiptError ?? regWriteError);
    toast({
      title: regMode === 'admin' ? 'Verification failed' : 'Registration failed',
      description: reason,
      type: 'error',
    });
  }, [isRegError, regHash, revert, regReceiptError, regWriteError, regMode, toast]);

  useEffect(() => {
    if (regHash && !isRegSuccess && !isRegError) track(regHash, regMode === 'admin' ? 'Verify Address' : 'Verify Identity');
  }, [regHash, isRegSuccess, isRegError, track, regMode]);

  const regState = isRegWriting || isRegConfirming ? (isRegWriting ? 'signing' : 'pending') : isRegError ? 'error' : isRegSuccess ? 'success' : 'idle';

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="card-hover py-16 text-center">
          <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-accent-teal/10">
            <Settings2 className="h-8 w-8 text-accent-teal" />
          </div>
          <h2 className="mb-2 text-xl font-semibold text-text-primary">Connect Wallet</h2>
          <p className="text-text-muted">Connect your wallet to access settings</p>
        </div>
      </div>
    );
  }

  const Row = ({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) => (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="font-medium text-text-primary">{label}</div>
        <div className="mt-0.5 text-sm text-text-muted">{hint}</div>
      </div>
      <div className="flex flex-shrink-0 items-center gap-2">{children}</div>
    </div>
  );

  const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) => (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 rounded-full transition-colors duration-200',
        checked ? 'bg-accent-teal shadow-[0_0_14px_rgba(45,212,191,0.35)]' : 'bg-border-secondary'
      )}
    >
      <motion.span
        className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow"
        animate={{ x: checked ? 20 : 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      />
    </button>
  );

  return (
    <Reveal>
      <div className="mx-auto max-w-2xl space-y-8">
      {/* Cleanverse Identity — onboarding / verification */}
      <section className="card-hover" aria-label="Cleanverse identity">
        <div className="mb-4 flex items-center gap-3 border-b border-border-subtle pb-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-teal/10">
            <Fingerprint className="h-4.5 w-4.5 text-accent-teal" />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-text-primary">Cleanverse Identity</h2>
            <p className="text-xs text-text-muted">Register your wallet in the CVI registry</p>
          </div>
        </div>

        <div className="space-y-4 p-4">
          {/* Status line */}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <div className="font-medium text-text-primary">CVI · Identity verification</div>
              <div className="mt-0.5 text-sm text-text-muted">
                {isVerifying ? 'Checking on-chain…' : isVerified ? 'Your address is verified' : 'Your address is not verified'}
              </div>
            </div>
            {isVerifying ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Checking
              </span>
            ) : isVerified ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-accent-green">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Verified
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-warning-primary">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Not Verified
              </span>
            )}
          </div>

          {!isVerified && (
            <div className="space-y-3 rounded-2xl border border-accent-teal/30 bg-accent-teal/[0.06] p-4">
              <p className="text-sm text-text-secondary">
                VeriFlow swaps require a Cleanverse CVI identity check. Verify your connected wallet to
                unlock trading.
              </p>
              <ActionButton
                state={ccBusy ? 'pending' : ccError ? 'error' : ccDone ? 'success' : 'idle'}
                onClick={handleVerifyCleanverse}
                disabled={!address || ccBusy}
                signingLabel="Connecting…"
                pendingLabel={ccStep || 'Verifying…'}
                successLabel="Verified"
                errorLabel="Failed"
                errorMessage={ccError || undefined}
                onRetry={handleVerifyCleanverse}
              >
                <Fingerprint className="h-4 w-4" />
                Verify with Cleanverse
              </ActionButton>
              {apassTier != null && (
                <p className="text-xs text-text-muted">A-Pass tier: {apassTier}</p>
              )}
              <p className="text-xs text-text-muted">
                VeriFlow (the institution) registers your wallet on-chain with the governor key — you never
                sign a registration transaction.
              </p>
            </div>
          )}

          {isVerified && (
            <div className="flex items-center gap-2 rounded-2xl border border-accent-green/30 bg-accent-green/[0.06] p-4 text-sm text-accent-green">
              <BadgeCheck className="h-4 w-4" />
              Your wallet is compliant. Swaps are enabled.
            </div>
          )}
        </div>
      </section>

      {/* Trading */}
      <section className="card-hover" aria-label="Trading settings">
        <div className="mb-4 flex items-center gap-3 border-b border-border-subtle pb-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-teal/10">
            <SlidersHorizontal className="h-4.5 w-4.5 text-accent-teal" />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-text-primary">Trading</h2>
            <p className="text-xs text-text-muted">Defaults applied to swaps and liquidity</p>
          </div>
        </div>
        <div className="divide-y divide-border-subtle">
          <Row label="Slippage tolerance" hint="Max price movement you accept">
            <div className="flex items-center gap-1.5">
              {['0.1', '0.5', '1'].map(v => (
                <button
                  key={v}
                  onClick={() => setSlippage(v)}
                  className={cn(
                    'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
                    slippage === v
                      ? 'bg-accent-teal/20 text-accent-teal ring-1 ring-accent-teal/50'
                      : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                  )}
                >
                  {v}%
                </button>
              ))}
              <input
                type="text"
                value={slippage}
                onChange={e => setSlippage(e.target.value)}
                aria-label="Custom slippage percent"
                className="input w-16 px-2 py-1 text-right font-mono text-xs"
              />
            </div>
          </Row>
          <Row label="Transaction deadline" hint="Max time before a tx expires">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-text-muted" aria-hidden="true" />
              <input
                type="text"
                value={deadline}
                onChange={e => setDeadline(e.target.value)}
                aria-label="Transaction deadline in minutes"
                className="input w-16 px-2 py-1 text-right font-mono text-xs"
              />
              <span className="text-xs text-text-muted">min</span>
            </div>
          </Row>
          <Row label="Auto-approve tokens" hint="Approve tokens on first use">
            <Toggle checked={autoApprove} onChange={setAutoApprove} label="Auto-approve tokens" />
          </Row>
        </div>
      </section>

      {/* Network */}
      <section className="card-hover" aria-label="Network settings">
        <div className="mb-4 flex items-center gap-3 border-b border-border-subtle pb-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-cyan/10">
            <Network className="h-4.5 w-4.5 text-accent-cyan" />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-text-primary">Network</h2>
            <p className="text-xs text-text-muted">Chain and endpoint configuration</p>
          </div>
        </div>
        <div className="divide-y divide-border-subtle">
          <Row label="Monad Testnet" hint="Chain ID 10143">
            <span className="rounded-full border border-accent-green/40 bg-accent-green/10 px-2.5 py-0.5 text-xs font-medium text-accent-green">
              Active
            </span>
          </Row>
          <Row label="RPC endpoint" hint="Public testnet RPC">
            <span className="font-mono text-xs text-text-secondary">https://testnet-rpc.monad.xyz</span>
          </Row>
          <Row label="Testnet mode" hint="Use sandbox credentials">
            <Toggle checked={testnet} onChange={setTestnet} label="Testnet mode" />
          </Row>
        </div>
      </section>

      {/* Compliance */}
      <section className="card-hover" aria-label="Compliance settings">
        <div className="mb-4 flex items-center gap-3 border-b border-border-subtle pb-4">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-green/10">
            <ShieldCheck className="h-4.5 w-4.5 text-accent-green" />
          </span>
          <div>
            <h2 className="font-display text-base font-semibold text-text-primary">Compliance</h2>
            <p className="text-xs text-text-muted">Cleanverse verification status</p>
          </div>
        </div>
        <div className="divide-y divide-border-subtle">
          <Row label="CVI · Identity verification" hint={isVerified ? 'Your address is verified' : 'Your address is not verified'}>
            {isVerifying ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Checking
              </span>
            ) : isVerified ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-accent-green">
                <Coins className="h-3.5 w-3.5" aria-hidden="true" />
                Verified
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-warning-primary">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Not Verified
              </span>
            )}
          </Row>
          <Row
            label="CVA · Asset authenticity"
            hint={enforcementActive ? 'All pools are registered assets' : 'Compliance enforcement is paused'}
          >
            {isPausedLoading ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                Checking
              </span>
            ) : enforcementActive ? (
              <span className="flex items-center gap-1.5 text-xs font-medium text-accent-green">
                <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                Enforced
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-xs font-medium text-warning-primary">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                Paused
              </span>
            )}
          </Row>
        </div>
      </section>

      {/* Admin: Whitelist Wallet — only the CVI owner (governor) sees this */}
      {isCVIOwner && !isVerified && (
        <section className="card-hover" aria-label="Admin whitelist wallet">
          <div className="mb-4 flex items-center gap-3 border-b border-border-subtle pb-4">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-amber/10">
              <BadgeCheck className="h-4.5 w-4.5 text-accent-amber" />
            </span>
            <div>
              <h2 className="font-display text-base font-semibold text-text-primary">Admin: Whitelist Wallet</h2>
              <p className="text-xs text-text-muted">Register another address (governor only)</p>
            </div>
          </div>
          <div className="space-y-3 p-4">
            <p className="text-sm text-text-secondary">
              You are the CVI registry owner. Paste any wallet address to register it for trading.
            </p>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={adminTarget}
                onChange={e => setAdminTarget(e.target.value)}
                placeholder="0x… target wallet address"
                aria-label="Target wallet address to verify"
                className="input flex-1 px-3 py-2 font-mono text-xs"
              />
              <button
                type="button"
                onClick={() => adminTarget && navigator.clipboard?.writeText(adminTarget)}
                className="rounded-lg border border-white/10 bg-white/[0.04] p-2 text-text-muted transition-colors hover:text-text-primary"
                aria-label="Copy target address"
              >
                <Copy className="h-4 w-4" />
              </button>
            </div>
            <ActionButton
              state={regMode === 'admin' ? regState : 'idle'}
              onClick={handleVerifyAdmin}
              disabled={!isAddress(adminTarget) || isRegWriting || isRegConfirming}
              variant="secondary"
              signingLabel="Confirm in wallet…"
              pendingLabel="Verifying…"
              successLabel="Verified"
              errorLabel="Failed"
              errorMessage={regMode === 'admin' ? decodeRevertReason(regReceiptError ?? regWriteError) : undefined}
              onRetry={handleVerifyAdmin}
            >
              <UserPlus className="h-4 w-4" />
              Verify Address
            </ActionButton>
          </div>
        </section>
      )}

      <p className="flex items-center gap-2 text-xs text-text-muted">
        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
        VeriFlow is a Travel Rule compliant AMM built on Monad using Cleanverse CVI + CVA. All
        transactions are verified on-chain for regulatory compliance.
      </p>
    </div>
    </Reveal>
  );
}
