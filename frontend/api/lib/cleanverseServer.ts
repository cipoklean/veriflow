/// <reference types="node" />
/**
 * Server-only Cleanverse Cooperate API client.
 *
 * SECURITY (closes M-09): this module runs exclusively inside Vercel
 * serverless functions. The AES key (CLEANVERSE_API_KEY), the API id
 * (CLEANVERSE_API_ID) and the governor registrar key (REGISTRAR_PRIVATE_KEY)
 * are read from `process.env` and NEVER shipped to the browser. The frontend
 * talks only to our own /api/cleanverse/* routes.
 *
 * Cleanverse Cooperate spec (per integration brief):
 *   - Base:   https://uatapi.cleanverse.com/api/cooperate
 *   - Header: `api-id` on ALL requests.
 *   - Crypto: AES-256-CBC, PKCS5/7 padding, FIXED 16-zero-byte IV (do NOT
 *     randomize — this is the Cleanverse contract), key = Base64-decoded
 *     api-key. Send { "data": "<Base64 ciphertext>" }.
 *   - /generate_apass is encrypted; /query_apass and /faucet are plain JSON.
 */

import { createCipheriv, createDecipheriv } from 'crypto';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.CLEANVERSE_BASE || 'https://uatapi.cleanverse.com/api/cooperate';
const API_ID = process.env.CLEANVERSE_API_ID;
const API_KEY = process.env.CLEANVERSE_API_KEY; // Base64-encoded AES key

// FIXED zero IV — required by the Cleanverse spec.
const ZERO_IV = Buffer.alloc(16, 0);

function aesKey(): Buffer {
  if (!API_KEY) throw new Error('Cleanverse API key not configured (CLEANVERSE_API_KEY)');
  return Buffer.from(API_KEY, 'base64');
}

/** Encrypt a JSON payload into the { data: "<base64>" } envelope (zero IV). */
export function encryptJson(payload: unknown): { data: string } {
  const key = aesKey();
  const cipher = createCipheriv('aes-256-cbc', key, ZERO_IV);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data: enc.toString('base64') };
}

/** Decrypt an envelope back to an object (used if a response is encrypted). */
export function decryptJson(envelope: { data: string }): any {
  const key = aesKey();
  const decipher = createDecipheriv('aes-256-cbc', key, ZERO_IV);
  const buf = Buffer.from(envelope.data, 'base64');
  const dec = Buffer.concat([decipher.update(buf), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

type Json = Record<string, unknown> | unknown[];

async function cleanversePost(path: string, body: unknown, encrypted: boolean): Promise<any> {
  if (!API_ID || !API_KEY) throw new Error('Cleanverse not configured (CLEANVERSE_API_ID / CLEANVERSE_API_KEY)');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'api-id': API_ID,
  };
  const payload = encrypted ? encryptJson(body) : (body as Json);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  // Some endpoints return an encrypted envelope { data: "..." }.
  if (json && typeof json.data === 'string') {
    try {
      json = decryptJson(json);
    } catch {
      /* not encrypted — leave as-is */
    }
  }
  if (json && json.code && json.code !== '0000') {
    throw new Error(json.message || `Cleanverse error ${json.code}`);
  }
  return json;
}

/**
 * customerId = "VF" + timestamp(base36) + random alnum (>=12 chars, [A-Za-z0-9]).
 */
export function makeCustomerId(): string {
  const ts = Date.now().toString(36);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 16; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `VF${ts}${rand}`;
}

export async function generateApass(address: string, customerId: string): Promise<any> {
  return cleanversePost('/generate_apass', { customerId, wallet: { address, chain: 'monad' } }, true);
}

export async function queryApass(address: string): Promise<any> {
  return cleanversePost('/query_apass', { chain: 'monad', address }, false);
}

export async function requestFaucet(req: { chain?: string; symbol?: string; depositAddress?: string; amount?: string }): Promise<any> {
  return cleanversePost('/faucet', {
    chain: req.chain || 'monad',
    symbol: req.symbol || 'usdc',
    depositAddress: req.depositAddress,
    amount: req.amount || '2000',
  }, false);
}

/** Poll /query_apass until a record exists (up to `timeoutMs`). */
export async function waitForApass(address: string, timeoutMs = 60000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;
  while (Date.now() < deadline) {
    const q = await queryApass(address);
    last = q;
    const list = q?.data ?? q?.list ?? q?.records ?? q?.result;
    const has = Array.isArray(list) ? list.length > 0 : !!list;
    if (has) return q;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return last;
}

// ── On-chain registration (institution = governor registrar key) ──────────────

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
] as const;

/**
 * Mirror Cleanverse's on-chain registration: the institution (governor) writes
 * the wallet into the CVI registry via REGISTRAR_PRIVATE_KEY. Awaits the
 * receipt so the caller can report on-chain confirmation.
 */
export async function registerWalletOnChain(address: string, tier = 1): Promise<{ hash: string; status: string }> {
  const pk = process.env.REGISTRAR_PRIVATE_KEY;
  if (!pk) throw new Error('Registrar key not configured (REGISTRAR_PRIVATE_KEY)');
  const account = privateKeyToAccount(pk as `0x${string}`);
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
