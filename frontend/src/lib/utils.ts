import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

export function formatNumber(num: number | bigint, decimals = 4): string {
  const n = typeof num === 'bigint' ? Number(num) : num;
  if (n >= 1e9) return `${(n / 1e9).toFixed(decimals)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(decimals)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

export function formatCurrency(amount: number | bigint, symbol = 'MON'): string {
  const n = typeof amount === 'bigint' ? Number(amount) : amount;
  return `${formatNumber(n)} ${symbol}`;
}

export function formatPercent(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number,
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), ms);
  };
}

/**
 * FE-21: cap the gas fee a wallet requests for a write. Monad testnet's base
 * fee swings wildly (100-460+ Gwei); MetaMask multiplies gasLimit * maxFeePerGas
 * for the "max" it shows, so during a spike it quotes an absurd 0.2+ MON even
 * though a swap only needs ~520k gas (~0.05 MON at 100 Gwei). We read the live
 * base fee and cap maxFeePerGas at base * 1.25 with no priority fee (tips are
 * meaningless on Monad testnet), so the wallet shows a realistic max. If the
 * chain has no EIP-1559 base fee yet (base 0), we leave gas unset and let the
 * wallet use its default.
 */
export async function withGasCap(
  client: { getBlock: (args: { includeTransactions?: boolean }) => Promise<{ baseFeePerGas?: bigint | null }> },
  request: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let base: bigint | null | undefined;
  try {
    const block = await client.getBlock({ includeTransactions: false });
    base = block.baseFeePerGas;
  } catch {
    base = null;
  }
  if (!base || base === 0n) return request; // no EIP-1559 base fee: let wallet decide
  const capped = (base * 125n) / 100n;
  return {
    ...request,
    maxFeePerGas: capped,
    maxPriorityFeePerGas: 0n,
  };
}
