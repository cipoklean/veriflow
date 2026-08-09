/**
 * Cleanverse identity — frontend client.
 *
 * SECURITY (M-09 closed): the browser holds NO Cleanverse secrets and performs
 * NO AES. All encryption, the api-id, and the governor registrar key live in
 * Vercel serverless functions (api/cleanverse/*.ts, self-contained). The frontend
 * only talks to our own same-origin routes:
 *   - GET /api/cleanverse/verify?address=0x…    (JSON: {ok,step,error?,hash?,tier?,rawCleanverseResponse})
 *   - GET /api/cleanverse/status?address=0x…    (JSON: {verified,apass,detail})
 *   - POST /api/cleanverse/faucet              (bonus, server-only)
 *
 * VeriFlow is the INSTITUTION: the user never self-registers on-chain. The
 * server registers the wallet with the governor key after the A-Pass exists.
 */

const API_BASE = '/api/cleanverse';

export interface VerifyResult {
  ok: boolean;
  already?: boolean;
  message?: string;
  step?: string;
  error?: string;
  hash?: string;
  tier?: number;
  rawCleanverseResponse?: unknown;
}

export interface StatusResult {
  verified: boolean;
  apass: { tier?: number; expiry?: string | number } | null;
  detail?: string;
  raw?: unknown;
}

/** One-shot verification (generate A-Pass + on-chain registration). Returns JSON. */
export async function verifyOnce(address: string): Promise<VerifyResult> {
  const res = await fetch(`${API_BASE}/verify?address=${encodeURIComponent(address)}`);
  // The server always returns JSON (even on 500 for missing env), so parse it.
  return (await res.json()) as VerifyResult;
}

/** Fetch A-Pass status for the UI (proxy of /query_apass). 200 {verified,apass}. */
export async function fetchCleanverseStatus(address: string): Promise<StatusResult> {
  const res = await fetch(`${API_BASE}/status?address=${encodeURIComponent(address)}`);
  return (await res.json()) as StatusResult;
}
