import { useState } from 'react';
import { useAccount } from 'wagmi';
import { Settings2, ShieldCheck, Network, SlidersHorizontal, Clock, Coins } from 'lucide-react';
import { cn } from '@/lib/utils';

export function SettingsPage() {
  const { isConnected } = useAccount();
  const [slippage, setSlippage] = useState('0.5');
  const [deadline, setDeadline] = useState('20');
  const [autoApprove, setAutoApprove] = useState(true);
  const [testnet, setTestnet] = useState(true);

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
        checked ? 'bg-accent-teal' : 'bg-border-secondary'
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-200',
          checked && 'translate-x-5'
        )}
      />
    </button>
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
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
          <Row label="CVI · Identity verification" hint="Your address is verified">
            <span className="flex items-center gap-1.5 text-xs font-medium text-accent-green">
              <Coins className="h-3.5 w-3.5" aria-hidden="true" />
              Verified
            </span>
          </Row>
          <Row label="CVA · Asset authenticity" hint="All pools are registered assets">
            <span className="flex items-center gap-1.5 text-xs font-medium text-accent-green">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Enforced
            </span>
          </Row>
        </div>
      </section>

      <p className="flex items-center gap-2 text-xs text-text-muted">
        <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />
        VeriFlow is a Travel Rule compliant AMM built on Monad using Cleanverse CVI + CVA. All
        transactions are verified on-chain for regulatory compliance.
      </p>
    </div>
  );
}
