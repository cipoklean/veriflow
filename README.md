# VeriFlow — Trade with compliance built in

VeriFlow is a Uniswap-V2-style AMM running on **Monad Testnet (Chain ID 10143)** where
every swap, mint, burn, and LP transfer is gated by **Cleanverse CVI (identity)** and
**CVA (asset authenticity)** verification. Built for the Cleanverse Build hackathon.

**Live demo:** https://veriflow-flax.vercel.app · **Chain:** Monad Testnet 10143

## What it is

Most AMMs trust whoever shows up. VeriFlow doesn't — the pool contracts check that both
sides of a trade are identity-verified (CVI) and that the assets being traded are
real, registered tokens (CVA) before anything executes. If a wallet isn't verified,
the transaction reverts on-chain. No warnings, no partial fills — it just doesn't happen.

## How it fits together

```
React + Vite + wagmi frontend
        │  (Vercel serverless: Cleanverse API client, AES/CBC-encrypted payloads)
        ▼
Cleanverse sandbox  ──  A-Pass issuance + validator registry
        │
        ▼
on-chain CVI / CVA registries  ──  VeriFactory / VeriRouter / VeriPair
```

## CVI · CVA integration points

1. **Institutional onboarding (CVI).** The frontend never self-registers users. A
   backend function sends an AES-encrypted `POST /generate_apass` (`api-id` header,
   AES/CBC/PKCS5Padding per spec, `expirationTime` as unix seconds,
   `wallet{address, chain:"monad"}`). Cleanverse issues the A-Pass in its sandbox; our
   registrar key mirrors that registration into the on-chain CVI registry; the UI polls
   `isVerifiedWallet` until the badge flips green.
2. **On-chain enforcement (CVI).** `VeriPair` checks `CVI(msg.sender)` and
   `CVI(recipient)` on swap / mint / burn and on LP transfers — including direct pair
   calls, so there's no router bypass. Unverified wallets revert on-chain.
3. **Asset authenticity (CVA).** Only CVA-verified assets can form pairs — the real
   Circle testnet USDC and the real WMON wrapper, no mock tokens.
4. **Live compliance UX.** Real `isVerifiedWallet` reads, tiered price-impact warnings
   (green / amber / red), decoded revert reasons, and honest empty states.
5. **Production path (documented).** Pool registration via `/validator/register` with an
   EIP-191 owner signature; runtime checks via `/validator/verify`.

## Deployed on 10143

**DEPLOYED CHAIN: Monad Testnet, Chain ID 10143.**

| Contract         | Address                                      |
|------------------|----------------------------------------------|
| Factory          | `0x39950C3D2998662D882D47265C7AC587EC4f65B4` |
| Router           | `0xa39d25Db54d57f7A8193Ad6baEC12042E0988053` |
| CVI              | `0x5aa3C294b291d29aBF203c780C3C22dC43B21173` |
| CVA              | `0x08f78faFD91A52C1dC8cDeC89252BA0c0C13Ac2B` |
| Pair (WMON/USDC) | `0x2fD1F8B9184d4ed41CF5f1A7639847ADDe9314b7` |
| WMON             | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` |
| USDC             | `0x534b2f3A21130d7a60830c2Df862319e593943A3` |

Full addresses also live in `frontend/src/contracts/config.ts`. A real WMON → USDC swap
has been executed end-to-end on-chain.

## Build quality

- 4 iterative security-audit rounds; every finding fixed and re-verified live. Highlights:
  canonical V2 router math, permanently locked `MINIMUM_LIQUIDITY`, atomic `exitLiquidity`
  closing a parked-LP front-run, compliance enforced on every entry path, Ownable2Step,
  and feeToSetter rotation.
- 49/49 Foundry tests including exploit PoCs. `npm audit` reports 0 vulnerabilities.

## Run it locally

Contracts: `forge test`

Frontend: `npm i && npm run dev`

The serverless Cleanverse proxy needs `CLEANVERSE_API_ID`, `CLEANVERSE_API_KEY`, and
`REGISTRAR_PRIVATE_KEY` environment variables.

---

## For contributors — frontend

Stack: Vite 8 + React 19 + TypeScript + Tailwind v4 + wagmi v3 + viem + TanStack Query.

### What was fixed to make this production-shaped

1. **Wallet connection bug (root cause).** `WalletButton` filtered connectors with
   `connectors.filter(c => c.ready === true)`. wagmi v3 connectors don't expose `ready`,
   so every connector was filtered out and the modal always showed "No wallets detected."
   Fixed by listing real connectors (`useConnect().connectors`), auto-connect on mount,
   chain-switch to Monad testnet, and a wrong-network banner.
2. **Mock swap quote.** `SwapPage` used a hardcoded fake price. Now it calls the deployed
   router's `getAmountsOut` via `useQuote()` for a real on-chain quote.
3. **Mock pools / liquidity / dashboard.** These now read live state from the deployed
   contracts via `src/contracts/useVeriFlow.ts` (factory `allPairs`, pair `getReserves`,
   `totalSupply`, CVA `getVerifiedAssets`, router `getAmountsOut`).
4. **Cleanverse Cooperate API client.** `src/lib/cleanverse.ts` implements the AES/CBC
   encrypted request envelope (api-key as AES key, fixed zero IV, PKCS5) per the v5.6 docs,
   plus plain-JSON `/validator/verify` and `/validator/is_register`.

### Environment variables

Copy `.env.example` → `.env` and fill in your Cleanverse sandbox credentials. Never commit
`.env` (it is gitignored).

```
VITE_CLEANVERSE_API_ID=your_sandbox_api_id
VITE_CLEANVERSE_API_KEY=your_base64_sandbox_api_key
# optional override, defaults to the UAT sandbox URL
# VITE_CLEANVERSE_BASE=https://uatapi.cleanverse.com/api/cooperate
```

### Local token / network config

Edit `src/contracts/config.ts`:

- `CONTRACT_ADDRESSES` — deployed VeriFactory / VeriRouter / ComplianceHook / CVI / CVA.
- `SUPPORTED_TOKENS` — UI token list (real Monad testnet USDC `0x534b2f3A...` and
  WMON `0xFb8bf4c1...` are pre-filled).

### Bootstrapping the demo (governor only)

The deployed contracts start empty (no registered CVA assets, no pairs). The compliance
hook fails closed, so no swap/liquidity works until assets are registered and a pool
exists. To bootstrap from the CLI with the governor key:

```bash
cd ../contracts
export PRIVATE_KEY=0x...            # governor key (owner of Factory/Router/Hook)
~/.foundry/bin/forge script script/BootstrapVeriFlow.s.sol:BootstrapVeriFlow \
  --rpc-url https://testnet-rpc.monad.xyz --broadcast
```

This registers WMON + USDC as verified CVA assets, creates the WMON/USDC pair, and seeds
initial liquidity. Until then the UI honestly shows "No pools found" / live zero TVL.

### Scripts

- `npm run dev` — start dev server (http://localhost:5173)
- `npm run build` — typecheck (`tsc -b`) + production build (`vite build`)
- `npm run preview` — serve the production build

### Accepted lint warnings (oxlint)

`npm run lint` reports a few warnings and 0 errors, all accepted by design:

- `react-hooks(exhaustive-deps)` — `LiquidityPage.tsx` / `SwapPage.tsx`: the
  approval-confirmed effects intentionally omit `handleSwap`/`handleAddLiquidity`/etc.
  from deps because those handlers embed the transaction deadline
  (`Math.floor(Date.now() / 1000)`) and would re-fire every render; the effect runs only
  when an approval receipt confirms (`[isApproveConfirmed, approvalStep]`).
- `react(only-export-components)` — `hooks/useToast.tsx`, `components/ui/TxDock.tsx`,
  `components/VeriFlowApp/WalletModalProvider.tsx`: each exports a Provider component AND
  its hook; splitting them would break the provider/consumer wiring for marginal
  fast-refresh benefit.
- `eslint(no-unused-vars)` — `SwapPage.tsx`: a `catch (e)` where the error is
  intentionally swallowed (quote recalculation already guards the failure path).

### Notes

- Compliance is enforced on-chain by `ComplianceHook` (fail-closed). The Cleanverse API is
  the off-chain KYC/asset-onboarding + pool-registry layer (`/validator/*`).
- `AnalyticsPage` still shows placeholder volume (real 24h volume needs a subgraph/indexer);
  TVL and pool count are live.

## Status

Testnet demo: faucet-scale liquidity on the Cleanverse sandbox environment.
