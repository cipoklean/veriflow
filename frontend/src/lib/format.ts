import { formatUnits, parseUnits } from 'viem';

/**
 * SINGLE SOURCE OF TRUTH for token-amount computation + formatting.
 *
 * Rule (enforced by review): NO `Number()` / `parseFloat()` / `toFixed()` on
 * token amounts anywhere else in the app. All raw bigint math stays in bigint;
 * formatting only happens here, at the display boundary.
 */

/** Round to `maxDp` decimals and strip trailing zeros. Never emits raw
 *  18-decimal floats — e.g. fmt(x, 18) => "0.208068", not "0.208068000000000000".
 *  Dust guard: a nonzero amount that rounds to zero at maxDp renders as
 *  "<0.000001" (never "0", never scientific notation like "1e-7"). */
export function fmt(raw: bigint, decimals: number, maxDp = 6): string {
  if (raw === 0n) return '0';
  const s = formatUnits(raw, decimals);
  const [intPart, frac = ''] = s.split('.');
  const trimmedFrac = frac.slice(0, maxDp).replace(/0+$/, '');
  if (!trimmedFrac && intPart === '0') {
    // nonzero dust that rounds to zero at maxDp → honest "<0.000001"
    return `<0.${'0'.repeat(maxDp - 1)}1`;
  }
  return trimmedFrac ? `${intPart}.${trimmedFrac}` : intPart;
}

/**
 * `pct`% of a raw balance, as a bigint (no float artifacts).
 * For native MON at 100%, subtract a 0.01 gas buffer (floored at 0) so a MAX
 * click can never fail on gas.
 */
export function pctOfBalance(raw: bigint, pct: 10 | 25 | 50 | 100, isNative: boolean): bigint {
  let out = (raw * BigInt(pct)) / 100n;
  if (isNative && pct === 100) {
    const buffer = parseUnits('0.01', 18);
    out = out > buffer ? out - buffer : 0n;
  }
  return out;
}

/** Proportional amount: amountRaw * resB / resA, rounded UP (so the paired
 *  side is never under-filled). Used for A↔B auto-fill from live reserves. */
export function pairAmount(amountRaw: bigint, resA: bigint, resB: bigint): bigint {
  if (resA === 0n) return 0n;
  return (amountRaw * resB + resA - 1n) / resA;
}

/** Slippage-adjusted minimum of a raw amount (× (1 - slippage/100)), bigint. */
export function minAmount(raw: bigint, slippagePct: number): bigint {
  const factor = BigInt(Math.floor((100 - slippagePct) * 100));
  return (raw * factor) / 10000n;
}
