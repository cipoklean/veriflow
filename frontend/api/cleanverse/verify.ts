/**
 * GET /api/cleanverse/verify?address=0x...
 *
 * Server-Sent Events stream. Orchestrates the real Cleanverse identity flow
 * as the INSTITUTION (VeriFlow), so the end user never signs a registration
 * transaction:
 *   1. generate customerId
 *   2. encrypted POST /generate_apass
 *   3. poll plain POST /query_apass until a record exists (<=60s)
 *   4. registerWallet(address) on our CVI registry via REGISTRAR_PRIVATE_KEY
 *   5. emit steps so the UI can show progress, then {ok:true}
 *
 * Secrets live only here (server-side). See ../lib/cleanverseServer.ts.
 */
import { generateApass, waitForApass, registerWalletOnChain, makeCustomerId } from '../lib/cleanverseServer';

export const config = { runtime: 'nodejs', maxDuration: 60 };

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const address = (url.searchParams.get('address') || '').trim();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        if (!ADDR_RE.test(address)) {
          send({ step: 'error', label: 'Failed', ok: false, error: 'Invalid wallet address' });
          controller.close();
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
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
