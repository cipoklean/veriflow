/// <reference types="node" />
/**
 * POST /api/cleanverse/faucet  (BONUS — one-shot)
 * Body: { chain?, symbol?, depositAddress?, amount? }
 * Tries the Cleanverse sandbox faucet for Monad-testnet USDC. If it grants funds
 * to the governor address, use them to deepen the WMON/USDC pool. We log the raw
 * response so the result is visible in Vercel function logs.
 *
 * Vercel runs this as a LEGACY Node.js function — the handler signature is
 * (req: IncomingMessage, res: ServerResponse). A returned Response is ignored by
 * that runtime, so we read the POST body from req and write through res.
 * Self-contained on purpose (no sibling .ts imports -> ERR_MODULE_NOT_FOUND).
 */
import type { IncomingMessage, ServerResponse } from 'http';

const BASE = process.env.CLEANVERSE_BASE || 'https://uatapi.cleanverse.com/api/cooperate';
const API_ID = process.env.CLEANVERSE_API_ID;

export const config = { runtime: 'nodejs', maxDuration: 30 };

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(data || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!API_ID) {
    sendJson(res, 500, { ok: false, error: 'Cleanverse not configured (CLEANVERSE_API_ID)' });
    return;
  }
  try {
    const body = await readBody(req);
    const payload = {
      chain: (body.chain as string) || 'monad',
      symbol: (body.symbol as string) || 'usdc',
      depositAddress: body.depositAddress as string | undefined,
      amount: (body.amount as string) || '2000',
    };
    // Full absolute base for the outgoing call (never relative).
    const r = await fetch(`${BASE}/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-id': API_ID },
      body: JSON.stringify(payload),
    });
    const text = await r.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    console.log('[cleanverse faucet]', JSON.stringify(json));
    if (json && json.code && json.code !== '0000') {
      sendJson(res, 502, { ok: false, error: json.message || `Cleanverse error ${json.code}` });
      return;
    }
    sendJson(res, 200, { ok: true, result: json });
  } catch (e: any) {
    console.log('[cleanverse faucet] error', e?.message);
    sendJson(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
