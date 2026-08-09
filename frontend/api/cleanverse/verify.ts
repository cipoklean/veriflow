/// <reference types="node" />
/**
 * GET /api/cleanverse/verify?address=0x...
 *
 * Honest, single-pass identity registration (institution = VeriFlow):
 *   Step 0: if any env var missing -> 500 { error: "missing <NAME>" }
 *   Step 1: one encrypted generate_apass call
 *   Step 2: registerWallet(address) on our CVI registry via REGISTRAR_PRIVATE_KEY,
 *           await the receipt (Monad ~1s blocks).
 *   Returns { ok, step, error?, hash?, tier?, rawCleanverseResponse } — the RAW
 *   Cleanverse body is included in every response so failures are never opaque.
 *
 * Vercel Hobby: 10s cap. No polling loops. generate_apass is capped at 8s.
 *
 * SECURITY (M-09): secrets read from process.env here, never shipped to browser.
 * LEGACY Node.js runtime: handler signature (req: IncomingMessage, res: ServerResponse).
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createCipheriv, createDecipheriv } from 'crypto';
import { createPublicClient, createWalletClient, http, isAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.CLEANVERSE_BASE || 'https://uatapi.cleanverse.com/api/cooperate';
const API_ID = process.env.CLEANVERSE_API_ID;
const API_KEY = process.env.CLEANVERSE_API_KEY;
const REGISTRAR = process.env.REGISTRAR_PRIVATE_KEY;

export const config = { runtime: 'nodejs', maxDuration: 10 };

function getAddress(req: IncomingMessage): string {
  const u = req.url || '';
  const q = u.split('?')[1] || '';
  return (new URLSearchParams(q).get('address') || '').trim();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// ── AES (matches Cleanverse spec exactly) ────────────────────────────────────
function aesKey(): Buffer {
  return Buffer.from(API_KEY || '', 'base64');
}
function aesAlgo(): string {
  const key = aesKey();
  return key.length === 32 ? 'aes-256-cbc' : 'aes-128-cbc';
}
function encryptJson(payload: unknown): { data: string } {
  const key = aesKey();
  const algo = aesAlgo();
  const iv = Buffer.alloc(16); // FIXED zero IV — per Cleanverse spec.
  const cipher = createCipheriv(algo, key, iv);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data: enc.toString('base64') };
}
function decryptJson(envelope: { data: string }): any {
  const key = aesKey();
  const algo = aesAlgo();
  const iv = Buffer.alloc(16);
  const decipher = createDecipheriv(algo, key, iv);
  const buf = Buffer.from(envelope.data, 'base64');
  const dec = Buffer.concat([decipher.update(buf), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

async function generateApass(address: string, customerId: string): Promise<any> {
  // expirationTime: required long, Unix SECONDS (~1 year out), plain number —
  // NOT a string, NOT milliseconds. Confirmed against the live 0002 error.
  const expirationTime = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
  const payload = encryptJson({
    customerId,
    expirationTime,
    wallet: { address, chain: 'monad' },
    override: false,
  });
  const res = await fetch(`${BASE}/generate_apass`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-id': API_ID as string },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (json && typeof json.data === 'string') {
    try {
      json = decryptJson(json);
    } catch {
      /* not encrypted */
    }
  }
  // NOTE: do NOT throw on a Cleanverse error code here — the caller needs the
  // raw body (rawCleanverseResponse) so failures are never opaque.
  return json;
}

const CVI_REGISTRY = '0x5aa3C294b291d29aBF203c780C3C22dC43B21173' as const;
const RPC_URL = process.env.MONAD_RPC_URL || 'https://testnet-rpc.monad.xyz';

const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
} as const;

const CVI_ABI = [
  {
    type: 'function',
    name: 'registerWallet',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'wallet', type: 'address' },
      { name: 'tier', type: 'uint8' },
      { name: 'subTier', type: 'uint8' },
      { name: 'group', type: 'string' },
      { name: 'subGroup', type: 'string' },
      { name: 'countries', type: 'string[]' },
      { name: 'expiry', type: 'uint256' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'isVerified',
    stateMutability: 'view',
    inputs: [{ name: 'wallet', type: 'address' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// M-7: per-address 10-minute cooldown (in-memory Map). Vercel function
// instances are ephemeral, so this is a best-effort throttle, not a guarantee.
const COOLDOWN_MS = 10 * 60 * 1000;
const lastAttempt = new Map<string, number>();

async function registerWalletOnChain(address: string, tier = 1): Promise<{ hash: string; status: string }> {
  const account = privateKeyToAccount(REGISTRAR as `0x${string}`);
  const wallet = createWalletClient({ chain: monadTestnet, transport: http() });
  const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });
  const expiry = BigInt(Math.floor(Date.now() / 1000)) + 10n * 365n * 24n * 3600n;
  const hash = await wallet.writeContract({
    account,
    chain: monadTestnet,
    address: CVI_REGISTRY,
    abi: CVI_ABI,
    functionName: 'registerWallet',
    args: [address as `0x${string}`, tier, 0, '', '', [] as string[], expiry, 0n],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return { hash: receipt.transactionHash, status: receipt.status };
}

function tierOf(raw: any): number {
  return raw?.data?.tier ?? raw?.tier ?? 1;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const address = getAddress(req);
  // M-7: strict address validation (viem isAddress — rejects checksum-mismatched
  // addresses, not just the shape regex).
  if (!isAddress(address)) {
    sendJson(res, 400, { ok: false, step: 'address', error: 'Invalid wallet address' });
    return;
  }
  const key = address.toLowerCase();

  // Step 0 — env check. Name the missing var.
  const missing = !API_ID ? 'CLEANVERSE_API_ID' : !API_KEY ? 'CLEANVERSE_API_KEY' : !REGISTRAR ? 'REGISTRAR_PRIVATE_KEY' : null;
  if (missing) {
    sendJson(res, 500, { ok: false, step: 'env', error: `missing ${missing}` });
    return;
  }

  // M-7: per-address 10-minute cooldown. Already attempted recently → reject
  // with 429 so the UI can show "try again in a few minutes".
  const now = Date.now();
  const last = lastAttempt.get(key);
  if (last && now - last < COOLDOWN_MS) {
    const minsLeft = Math.ceil((COOLDOWN_MS - (now - last)) / 60000);
    sendJson(res, 429, { ok: false, step: 'cooldown', error: `Already attempted recently — try again in ~${minsLeft} min` });
    return;
  }
  lastAttempt.set(key, now);

  let rawCleanverseResponse: any = null;
  try {
    // M-7: pre-check on-chain FIRST — if this wallet is already registered in
    // the CVI registry, return immediately with NO tx and no A-Pass call.
    const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });
    // NOTE: `as unknown as` — viem's readContract params type under TS 6.0.3
    // requires EIP-7702 `authorizationList`; the const ABI's readonly tuple
    // shape doesn't overlap, so bridge through unknown. Runtime is unchanged.
    const already = await publicClient.readContract({
      address: CVI_REGISTRY,
      abi: CVI_ABI,
      functionName: 'isVerified',
      args: [address as `0x${string}`],
    } as unknown as Parameters<typeof publicClient.readContract>[0]);
    if (already) {
      sendJson(res, 200, { ok: true, already: true, step: 'precheck', message: 'Wallet already verified — no action needed' });
      return;
    }

    // Step 1 — one encrypted generate_apass call.
    rawCleanverseResponse = await generateApass(address, makeCustomerId());

    // Surface a Cleanverse error code honestly, with the raw body attached.
    if (rawCleanverseResponse && rawCleanverseResponse.code && rawCleanverseResponse.code !== '0000') {
      sendJson(res, 200, {
        ok: false,
        step: 'generate',
        error: `Cleanverse error ${rawCleanverseResponse.code}: ${rawCleanverseResponse.message ?? 'no message'}`,
        rawCleanverseResponse,
      });
      return;
    }

    // Step 2 — register on-chain, await receipt.
    const tier = tierOf(rawCleanverseResponse);
    const result = await registerWalletOnChain(address, tier);

    sendJson(res, 200, {
      ok: true,
      step: 'done',
      hash: result.hash,
      tier,
      rawCleanverseResponse,
    });
  } catch (e: any) {
    sendJson(res, 200, {
      ok: false,
      step: 'error',
      error: e?.message || String(e),
      rawCleanverseResponse,
    });
  }
}

function makeCustomerId(): string {
  const ts = Date.now().toString(36);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 16; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `VF${ts}${rand}`;
}
