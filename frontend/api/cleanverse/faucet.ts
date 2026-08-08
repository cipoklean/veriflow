/// <reference types="node" />
/**
 * POST /api/cleanverse/faucet  (BONUS — one-shot)
 * Body: { chain?, symbol?, depositAddress?, amount? }
 * Tries the Cleanverse sandbox faucet for Monad-testnet USDC. If it grants
 * funds to the governor address, use them to deepen the WMON/USDC pool. We log
 * the raw response so the result is visible in Vercel function logs.
 *
 * Self-contained on purpose: Vercel's Node serverless build does NOT transpile
 * sibling .ts modules, so the prior relative import failed with
 * ERR_MODULE_NOT_FOUND. The helper is inlined.
 */
const BASE = process.env.CLEANVERSE_BASE || 'https://uatapi.cleanverse.com/api/cooperate';
const API_ID = process.env.CLEANVERSE_API_ID;

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req: Request): Promise<Response> {
  if (!API_ID) {
    return Response.json({ ok: false, error: 'Cleanverse not configured (CLEANVERSE_API_ID)' }, { status: 500 });
  }
  try {
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const payload = {
      chain: (body.chain as string) || 'monad',
      symbol: (body.symbol as string) || 'usdc',
      depositAddress: body.depositAddress as string | undefined,
      amount: (body.amount as string) || '2000',
    };
    // BUG FIX: full absolute base for the outgoing call.
    const res = await fetch(`${BASE}/faucet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-id': API_ID },
      body: JSON.stringify(payload),
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    console.log('[cleanverse faucet]', JSON.stringify(json));
    if (json && json.code && json.code !== '0000') {
      return Response.json({ ok: false, error: json.message || `Cleanverse error ${json.code}` }, { status: 502 });
    }
    return Response.json({ ok: true, result: json });
  } catch (e: any) {
    console.log('[cleanverse faucet] error', e?.message);
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
