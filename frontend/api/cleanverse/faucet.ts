/**
 * POST /api/cleanverse/faucet  (BONUS — one-shot)
 * Body: { chain?, symbol?, depositAddress?, amount? }
 * Tries the Cleanverse sandbox faucet for Monad-testnet USDC. If it grants
 * funds to the governor/deposit address, you can re-run the deepen-pool script
 * to add real testnet USDC depth to the WMON/USDC pool. We log the raw response
 * so the result is visible in Vercel function logs.
 */
import { requestFaucet } from '../lib/cleanverseServer.js';

export const config = { runtime: 'nodejs', maxDuration: 30 };

export default async function handler(req: Request): Promise<Response> {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      chain?: string;
      symbol?: string;
      depositAddress?: string;
      amount?: string;
    };
    const result = await requestFaucet(body);
    // BONUS: surface the sandbox response for inspection.
    console.log('[cleanverse][faucet]', JSON.stringify(result));
    return Response.json({ ok: true, result });
  } catch (e: any) {
    console.log('[cleanverse][faucet] error', e?.message || String(e));
    return Response.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
