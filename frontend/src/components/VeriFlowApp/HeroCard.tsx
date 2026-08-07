import { Link } from 'react-router-dom';
import { ArrowRight, Droplets } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Wave } from '@/components/ui/Wave';

export function HeroCard() {
  return (
    <section className="card-hero p-8 sm:p-12 lg:p-14">
      {/* Decorative blurred wave, bottom-right, ~10% opacity */}
      <svg
        className="pointer-events-none absolute -bottom-10 -right-10 w-[420px] max-w-[60%] opacity-10"
        viewBox="0 0 400 200"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M0 120 C 60 80, 120 160, 200 120 S 340 80, 400 120"
          stroke="url(#heroWave)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          d="M0 150 C 80 110, 140 190, 220 150 S 360 110, 400 150"
          stroke="url(#heroWave2)"
          strokeWidth="8"
          strokeLinecap="round"
          opacity="0.7"
        />
        <defs>
          <linearGradient id="heroWave" x1="0" y1="0" x2="400" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#22D3EE" />
            <stop offset="0.5" stopColor="#2DD4BF" />
            <stop offset="1" stopColor="#34D399" />
          </linearGradient>
          <linearGradient id="heroWave2" x1="0" y1="0" x2="400" y2="0" gradientUnits="userSpaceOnUse">
            <stop stopColor="#34D399" />
            <stop offset="1" stopColor="#22D3EE" />
          </linearGradient>
        </defs>
      </svg>

      <div className="relative">
        {/* Badge row */}
        <div className="flex flex-wrap items-center gap-3 mb-6">
          <Badge tone="success" dot>
            Monad Testnet
          </Badge>
          <span className="text-sm text-text-secondary font-mono">Chain ID 10143</span>
        </div>

        {/* H1 with gradient "compliance" */}
        <h1 className="font-display font-extrabold text-text-primary tracking-tight leading-[1.05] text-[clamp(40px,6vw,64px)]">
          Trade with <span className="gradient-text">compliance</span> built in
        </h1>

        {/* Signature: flowing wave */}
        <div className="mt-6 max-w-md">
          <Wave />
        </div>

        {/* Body */}
        <p className="mt-6 max-w-2xl text-[18px] leading-relaxed text-text-secondary">
          VeriFlow brings Uniswap V2 efficiency to Monad with Cleanverse verification. Every
          trade checks identity and asset authenticity before execution.
        </p>

        {/* CTAs */}
        <div className="mt-8 flex flex-col sm:flex-row gap-4">
          <Link
            to="/swap"
            className="btn btn-primary btn-lg group"
          >
            Start Trading
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            to="/liquidity"
            className="btn btn-secondary btn-lg"
          >
            <Droplets className="h-4 w-4" />
            Provide Liquidity
          </Link>
        </div>
      </div>
    </section>
  );
}
