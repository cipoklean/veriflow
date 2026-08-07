# VeriFlow Frontend

Travel-Rule compliant AMM frontend for the Cleanverse (CVI + CVA) Build hackathon.
Stack: Vite 8 + React 19 + TypeScript + Tailwind v4 + wagmi v3 + viem + TanStack Query.

## What was fixed to make this production-shaped

1. **Wallet connection bug (root cause)** — `WalletButton` filtered connectors with
   `connectors.filter(c => c.ready === true)`. wagmi v3 connectors do NOT expose `ready`,
   so every connector was filtered out and the modal always showed "No wallets detected".
   Fixed by listing real connectors (`useConnect().connectors`), auto-connect on mount,
   chain-switch to Monad testnet, and a wrong-network banner.
2. **Mock swap quote** — `SwapPage` used a hardcoded WETH=3000 fake price. Now it calls
   the deployed router's `getAmountsOut` via `useQuote()` for a real on-chain quote.
3. **Mock pools / liquidity / dashboard** — these now read live state from the deployed
   contracts via `src/contracts/useVeriFlow.ts` (factory `allPairs`, pair `getReserves`,
   `totalSupply`, CVA `getVerifiedAssets`, router `getAmountsOut`).
4. **Cleanverse Cooperate API client** — `src/lib/cleanverse.ts` implements the AES/CBC
   encrypted request envelope (api-key as AES key, fixed zero IV, PKCS5) per the v5.6 docs,
   plus plain-JSON `/validator/verify` and `/validator/is_register`.

## Environment variables

Copy `.env.example` → `.env` and fill in your Cleanverse sandbox credentials.
Never commit `.env` (it is gitignored).

```
VITE_CLEANVERSE_API_ID=your_sandbox_api_id
VITE_CLEANVERSE_API_KEY=your_base64_sandbox_api_key
# optional override, defaults to the UAT sandbox URL
# VITE_CLEANVERSE_BASE=https://uatapi.cleanverse.com/api/cooperate
```

## Local token / network config

Edit `src/contracts/config.ts`:
- `CONTRACT_ADDRESSES` — deployed VeriFactory / VeriRouter / ComplianceHook / CVI / CVA.
- `SUPPORTED_TOKENS` — UI token list (real Monad testnet USDC `0x534b2f3A...` and
  WMON `0x760AfE86...` are pre-filled).

## Bootstrapping the demo (governor only)

The deployed contracts start empty (no registered CVA assets, no pairs). The compliance
hook FAILS CLOSED, so no swap/liquidity works until assets are registered and a pool exists.

To bootstrap from the CLI with the governor key:

```bash
cd ../contracts
export PRIVATE_KEY=0x...            # governor key (owner of Factory/Router/Hook)
~/.foundry/bin/forge script script/BootstrapVeriFlow.s.sol:BootstrapVeriFlow \
  --rpc-url https://testnet-rpc.monad.xyz --broadcast
```

This registers WMON + USDC as verified CVA assets, creates the WMON/USDC pair, and seeds
initial liquidity. Until then the UI honestly shows "No pools found" / live zero TVL.

## Scripts

- `npm run dev` — start dev server (http://localhost:5173)
- `npm run build` — typecheck (`tsc -b`) + production build (`vite build`)
- `npm run preview` — serve the production build

## Notes

- Compliance is enforced on-chain by `ComplianceHook` (fail-closed). The Cleanverse API
  is the off-chain KYC/asset-onboarding + pool-registry layer (`/validator/*`).
- `AnalyticsPage` still shows placeholder volume (real 24h volume needs a subgraph/indexer);
  TVL and pool count are live.
