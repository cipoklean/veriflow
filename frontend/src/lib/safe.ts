import { parseUnits } from 'viem';

/**
 * Safe parse helpers for token amounts.
 *
 * Root-cause guard (white-screen fix): viem's parseUnits throws
 * InvalidDecimalNumberError on scientific notation ("9.17602280404e-7") and
 * other non-plain-decimal strings. Any float → String → parseUnits round-trip
 * can produce that. Every computed-number call site MUST go through
 * safeParseUnits; user-typed strings are plain by construction.
 */

/** True only for plain non-negative decimals: "0", "42", "3.141592653589". */
export const isPlainDecimal = (s: string) => /^\d+(\.\d+)?$/.test(s);

/** parseUnits if the string is a plain decimal, else 0n (never throws). */
export function safeParseUnits(s: string, dec: number): bigint {
  return isPlainDecimal(s) ? parseUnits(s, dec) : 0n;
}
