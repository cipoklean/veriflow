/**
 * Cleanverse identity — frontend client.
 *
 * SECURITY (M-09 closed): the browser holds NO Cleanverse secrets and performs
 * NO AES. All encryption, the api-id, and the governor registrar key live in
 * Vercel serverless functions (see api/lib/cleanverseServer.ts). The frontend
 * only talks to our own same-origin routes:
 *   - GET /api/cleanverse/verify?address=0x…   (SSE progress stream)
 *   - GET /api/cleanverse/status?address=0x…   (A-Pass tier / expiry)
 *   - POST /api/cleanverse/faucet              (bonus, server-only)
 *
 * VeriFlow is the INSTITUTION: the user never self-registers on-chain. The
 * server registers the wallet with the governor key after the A-Pass exists.
 */

const API_BASE = '/api/cleanverse';

export interface VerifyStep {
  step: 'apass_submitted' | 'apass_polling' | 'onchain' | 'done' | 'error';
  label?: string;
  ok: boolean;
  error?: string;
  hash?: string;
  tier?: number;
}

/** Open an SSE stream of verification progress for `address`. */
export function verifyStream(address: string): EventSource {
  const url = `${API_BASE}/verify?address=${encodeURIComponent(address)}`;
  return new EventSource(url);
}

/** Fetch A-Pass tier/status for the UI (proxy of /query_apass). */
export async function fetchCleanverseStatus(
  address: string,
): Promise<{ ok: boolean; data?: { tier?: number; expiry?: string | number } | null; error?: string }> {
  const res = await fetch(`${API_BASE}/status?address=${encodeURIComponent(address)}`);
  return res.json();
}
