/**
 * GET /api/cleanverse/status?address=0x...
 * Proxies /query_apass so the UI can show A-Pass tier / expiry.
 * Secrets stay server-side; only the (non-sensitive) address is in the URL.
 */
import { queryApass } from '../lib/cleanverseServer.js';

export const config = { runtime: 'nodejs', maxDuration: 15 };

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = (url.searchParams.get('address') || '').trim();
  if (!ADDR_RE.test(address)) {
    return Response.json({ ok: false, error: 'Invalid wallet address' }, { status: 400 });
  }
  try {
    const q = await queryApass(address);
    return Response.json({ ok: true, address, data: q?.data ?? null });
  } catch (e: any) {
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
