/// <reference types="node" />
/**
 * GET /api/cleanverse/status?address=0x...
 * Proxies /query_apass so the UI can show A-Pass tier / expiry.
 * Secrets stay server-side; only the (non-sensitive) address is in the URL.
 *
 * Self-contained on purpose: Vercel's Node serverless build does NOT transpile
 * sibling .ts modules, so a relative import (../lib/cleanverseServer.js) fails
 * at runtime with ERR_MODULE_NOT_FOUND. The helper is inlined.
 */
const BASE = process.env.CLEANVERSE_BASE || 'https://uatapi.cleanverse.com/api/cooperate';
const API_ID = process.env.CLEANVERSE_API_ID;

export const config = { runtime: 'nodejs', maxDuration: 15 };

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export default async function handler(req: Request): Promise<Response> {
  // BUG FIX (BUG 1): parse the query string without `new URL(req.url)` so a
  // relative URL never throws "Invalid URL".
  const rawQuery = req.url.split('?')[1] || '';
  const address = (new URLSearchParams(rawQuery).get('address') || '').trim();

  if (!ADDR_RE.test(address)) {
    return Response.json({ ok: false, error: 'Invalid wallet address' }, { status: 400 });
  }
  if (!API_ID) {
    return Response.json({ ok: false, error: 'Cleanverse not configured (CLEANVERSE_API_ID)' }, { status: 500 });
  }
  try {
    // BUG FIX: full absolute base for the outgoing call.
    const res = await fetch(`${BASE}/query_apass`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-id': API_ID },
      body: JSON.stringify({ chain: 'monad', address }),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    if (json && json.code && json.code !== '0000') {
      return Response.json({ ok: false, error: json.message || `Cleanverse error ${json.code}` }, { status: 502 });
    }
    return Response.json({ ok: true, address, data: json?.data ?? null });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
