/// <reference types="node" />
/**
 * GET /api/cleanverse/status?address=0x...
 * Proxies /query_apass so the UI can show A-Pass tier / expiry.
 * Secrets stay server-side; only the (non-sensitive) address is in the URL.
 *
 * NOTE: Vercel runs these as LEGACY Node.js functions — the handler signature is
 * (req: IncomingMessage, res: ServerResponse). A returned `Response` is ignored
 * by that runtime (it caused a silent hang + FUNCTION_INVOCATION_TIMEOUT). So we
 * write through `res` and read the query from `req.url` (relative, but always
 * carries the `?address=` portion).
 */
import type { IncomingMessage, ServerResponse } from 'http';

const BASE = process.env.CLEANVERSE_BASE || 'https://uatapi.cleanverse.com/api/cooperate';
const API_ID = process.env.CLEANVERSE_API_ID;

export const config = { runtime: 'nodejs', maxDuration: 15 };

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/** Read ?address= from the (relative) req.url without relying on Web URL parsing. */
function getAddress(req: IncomingMessage): string {
  const u = req.url || '';
  const q = u.split('?')[1] || '';
  return (new URLSearchParams(q).get('address') || '').trim();
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const address = getAddress(req);
  if (!ADDR_RE.test(address)) {
    sendJson(res, 400, { ok: false, error: 'Invalid wallet address' });
    return;
  }
  if (!API_ID) {
    sendJson(res, 500, { ok: false, error: 'Cleanverse not configured (CLEANVERSE_API_ID)' });
    return;
  }
  try {
    // Full absolute base for the outgoing call (never relative).
    const r = await fetch(`${BASE}/query_apass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-id': API_ID },
      body: JSON.stringify({ chain: 'monad', address }),
    });
    const text = await r.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (json && json.code && json.code !== '0000') {
      sendJson(res, 502, { ok: false, error: json.message || `Cleanverse error ${json.code}` });
      return;
    }
    sendJson(res, 200, { ok: true, address, data: json?.data ?? null });
  } catch (e: any) {
    sendJson(res, 500, { ok: false, error: e?.message || String(e) });
  }
}
