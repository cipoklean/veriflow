/// <reference types="node" />
/**
 * GET /api/cleanverse/verify?address=0x...
 *
 * Server-Sent Events stream. Orchestrates the real Cleanverse identity flow as
 * the INSTITUTION (VeriFlow), so the end user never signs a registration tx:
 *   1. generate customerId
 *   2. encrypted POST /generate_apass
 *   3. poll plain POST /query_apass until a record exists (<=60s)
 *   4. registerWallet(address) on our CVI registry via REGISTRAR_PRIVATE_KEY
 *   5. emit steps so the UI can show progress, then {ok:true}
 *
 * SECURITY (M-09): secrets (CLEANVERSE_API_KEY, CLEANVERSE_API_ID,
 * REGISTRAR_PRIVATE_KEY) are read from process.env here, never shipped to the
 * browser. The frontend only opens this same-origin SSE route.
 *
 * IMPORTANT: Vercel runs this as a LEGACY Node.js function — the handler
 * signature is (req: IncomingMessage, res: ServerResponse). A returned Response
 * is ignored by that runtime, so we write through `res` for SSE and read the
 * query from req.url. Self-contained on purpose (no sibling .ts imports, which
 * the legacy bundler does not transpile -> ERR_MODULE_NOT_FOUND).
 */
import type { IncomingMessage, ServerResponse } from 'http';
import { createCipheriv, createDecipheriv } from 'crypto';
import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const BASE = process.env.CLEANVERSE_BASE || 'https://uatapi.cleanverse.com/api/cooperate';
const API_ID = process.env.CLEANVERSE_API_ID;
const API_KEY = process.env.CLEANVERSE_API_KEY;

// FIXED zero IV — required by the Cleanverse spec (do NOT randomize).
const ZERO_IV = Buffer.alloc(16, 0);

function aesKey(): Buffer {
  if (!API_KEY) throw new Error('Cleanverse API key not configured (CLEANVERSE_API_KEY)');
  return Buffer.from(API_KEY, 'base64');
}

function encryptJson(payload: unknown): { data: string } {
  const key = aesKey();
  const cipher = createCipheriv('aes-256-cbc', key, ZERO_IV);
  const plain = Buffer.from(JSON.stringify(payload), 'utf8');
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data: enc.toString('base64') };
}

function decryptJson(envelope: { data: string }): any {
  const key = aesKey();
  const decipher = createDecipheriv('aes-256-cbc', key, ZERO_IV);
  const buf = Buffer.from(envelope.data, 'base64');
  const dec = Buffer.concat([decipher.update(buf), decipher.final()]);
  return JSON.parse(dec.toString('utf8'));
}

export const config = { runtime: 'nodejs', maxDuration: 60 };

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

function getAddress(req: IncomingMessage): string {
  const u = req.url || '';
  const q = u.split('?')[1] || '';
  return (new URLSearchParams(q).get('address') || '').trim();
}

async function cleanversePost(path: string, body: unknown, encrypted: boolean): Promise<any> {
  if (!API_ID || !API_KEY)
    throw new Error('Cleanverse not configured (CLEANVERSE_API_ID / CLEANVERSE_API_KEY)');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'api-id': API_ID,
  };
  const payload = encrypted ? encryptJson(body) : (body as Record<string, unknown>);
  // Full absolute base for the outgoing call (never relative).
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
  if (json && typeof json.data === 'string') {
    try {
      json = decryptJson(json);
    } catch {
      /* not encrypted */
    }
  }
  if (json && json.code && json.code !== '0000') {
    throw new Error(json.message || `Cleanverse error ${json.code}`);
  }
  return json;
}

function makeCustomerId(): string {
  const ts = Date.now().toString(36);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 16; i++) rand += chars[Math.floor(Math.random() * chars.length)];
  return `VF${ts}${rand}`;
}

async function generateApass(address: string, customerId: string): Promise<any> {
  return cleanversePost('/generate_apass', { customerId, wallet: { address, chain: 'monad' } }, true);
}

async function queryApass(address: string): Promise<any> {
  return cleanversePost('/query_apass', { chain: 'monad', address }, false);
}

async function waitForApass(address: string, timeoutMs = 60000): Promise<any> {
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

async function registerWalletOnChain(address: string, tier = 1): Promise<{ hash: string; status: string }> {
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

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const address = getAddress(req);

  // Legacy Node runtime: write the SSE stream through `res`.
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });
  const send = (o: Record<string, unknown>) => res.write(`data: ${JSON.stringify(o)}\n\n`);

  try {
    if (!ADDR_RE.test(address)) {
      send({ step: 'error', label: 'Failed', ok: false, error: 'Invalid wallet address' });
      res.end();
      return;
    }

    const customerId = makeCustomerId();
    send({ step: 'apass_submitted', label: 'Submitting A-Pass…', ok: true });

    await generateApass(address, customerId);

    send({ step: 'apass_polling', label: 'A-Pass registered…', ok: true });
    const apass = await waitForApass(address, 60000);
    const tier = (apass?.data?.tier ?? apass?.tier ?? 1) as number;

    send({ step: 'onchain', label: 'On-chain confirmation…', ok: true });

    const result = await registerWalletOnChain(address, tier);
    send({ step: 'done', label: 'Verified', ok: true, hash: result.hash, tier });
  } catch (e: any) {
    send({ step: 'error', label: 'Failed', ok: false, error: e?.message || String(e) });
  } finally {
    res.end();
  }
}
