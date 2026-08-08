/// <reference types="node" />
/**
 * GET /api/cleanverse/status?address=0x...
 * Proxies /query_apass so the UI can show A-Pass tier / expiry.
 * Secrets stay server-side; only the (non-sensitive) address is in the URL.
 *
 * Vercel Hobby: 10s function cap. We guard the upstream call with an 8s
 * AbortController and NEVER return 5xx for a missing A-Pass — that is a normal
 * "not verified yet" state and must come back as HTTP 200 { verified:false }.
 * 400 is reserved for a malformed address param only.
 *
 * LEGACY Node.js runtime: handler signature (req: IncomingMessage, res: ServerResponse).
 */
import type { IncomingMessage, ServerResponse } from 'http';

const BASE = process.env.CLEANVERSE_BASE || 'https://uatapi.cleanverse.com/api/cooperate';
const API_ID = process.env.CLEANVERSE_API_ID;

export const config = { runtime: 'nodejs', maxDuration: 10 };

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

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
    sendJson(res, 400, { verified: false, apass: null, detail: 'Invalid wallet address' });
    return;
  }
  if (!API_ID) {
    // Config problem — still 200 so the UI treats it as "not verified yet"
    // rather than a hard failure; detail explains what is missing.
    sendJson(res, 200, { verified: false, apass: null, detail: 'Cleanverse not configured (CLEANVERSE_API_ID)' });
    return;
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    let text: string;
    try {
      const r = await fetch(`${BASE}/query_apass`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-id': API_ID },
        body: JSON.stringify({ chain: 'monad', address }),
        signal: ctrl.signal,
      });
      text = await r.text();
    } finally {
      clearTimeout(timer);
    }

    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }

    // Cleanverse error code -> treat as "not verified yet" (200, not 502).
    if (json && json.code && json.code !== '0000') {
      sendJson(res, 200, {
        verified: false,
        apass: null,
        detail: `A-Pass not found (code ${json.code}: ${json.message ?? 'no message'})`,
        raw: json,
      });
      return;
    }

    // Extract whatever record shape came back.
    const rec = json?.data ?? json?.result ?? json?.records ?? null;
    const hasRecord =
      rec != null &&
      (Array.isArray(rec) ? rec.length > 0 : Object.keys(rec).length > 0 || rec.tier != null);

    if (hasRecord) {
      sendJson(res, 200, { verified: true, apass: rec, detail: undefined });
    } else {
      sendJson(res, 200, {
        verified: false,
        apass: null,
        detail: 'A-Pass not found',
        raw: json,
      });
    }
  } catch (e: any) {
    // 502-proof: any failure (timeout, network, parse) -> 200 with detail.
    sendJson(res, 200, {
      verified: false,
      apass: null,
      detail: `Cleanverse query failed: ${e?.message || String(e)}`,
    });
  }
}
