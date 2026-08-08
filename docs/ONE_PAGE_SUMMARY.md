# VERIFLOW — Trade with compliance built in

## THE PROBLEM

Institutions can't use DeFi the way it is. The choice on the table is: trade
permissionlessly on AMMs with no idea who you're trading with or whether the tokens
are real — or trade on walled-garden venues that give you compliance but take away
openness. Regulated capital sits on the sidelines because nobody can answer two
questions: "who traded?" and "is this asset real?"

## WHAT WE BUILT

VeriFlow is a Uniswap-V2 AMM on Monad Testnet where compliance is built into the
protocol, not bolted on as middleware. Every swap, mint, burn and LP transfer
reverts on-chain unless two things are true:

  (1) both sender AND recipient hold a Cleanverse-verified identity (CVI), and
  (2) both assets are authentic according to the CVA registry.

The part that matters most: users don't self-certify. Our backend acts as the
institution — it submits AES-encrypted A-Pass registrations to Cleanverse's API,
mirrors the result on-chain, and the UI polls until the wallet is live. That's the
flow institutions actually trust, not "click a checkbox."

The UI is honest by design: live reserves from the chain, decoded revert reasons
instead of "transaction failed," and tiered price-impact warnings (green / amber /
red) instead of everything shouting at the user.

## HOW CVI AND CVA ACTUALLY PLUG IN

1. **A-Pass issuance (CVI):** our serverless proxy POSTs an AES/CBC-encrypted payload
   to /generate_apass (api-id header, expirationTime as unix seconds,
   wallet{address, chain:"monad"}). Cleanverse issues the A-Pass in their sandbox;
   our registrar key then writes it to the CVI registry on Monad. The UI polls
   isVerifiedWallet until the badge flips green.

2. **On-chain gating (CVI):** VeriPair enforces CVI(sender) + CVI(recipient) on every
   swap, mint, burn and LP transfer — including direct pair calls that bypass the
   router. There's no bypass path; four audit rounds of trying to find one confirmed it.

3. **Asset authenticity (CVA):** pair creation is restricted to CVA-verified assets.
   We used real Circle testnet USDC and the real WMON wrapper instead of mocking our
   own tokens — the compliance story only works with real assets.

4. **Compliance UX:** live CVI badges on every wallet, a "Verify with Cleanverse"
   onboarding flow in Settings, and unverified wallets get blocked with a decoded
   ComplianceRejected reason instead of a silent failure.

5. **Production path (documented in the repo):** pool registration via
   /validator/register with an EIP-191 owner signature over chain+contract, and
   runtime /validator/verify for runtime checks.

## DEPLOYED ON MONAD TESTNET (Chain ID 10143)

```
Factory 0x39950C3D2998662D882D47265C7AC587EC4f65B4
Router  0xa39d25Db54d57f7A8193Ad6baEC12042E0988053
CVI     0x5aa3C294b291d29aBF203c780C3C22dC43B21173
CVA     0x08f78faFD91A52C1dC8cDeC89252BA0c0C13Ac2B
Pair    0x2fD1F8B9184d4ed41CF5f1A7639847ADDe9314b7
```

Real WMON→USDC swaps have been executed on-chain; the pool is seeded with real
faucet USDC (not a mock).

## BUILD QUALITY

Four rounds of iterative security audit, each finding fixed and re-verified on-chain
before moving on. Highlights that made it into the final build:

  • atomic exitLiquidity() closing a parked-LP front-run attack
  • MINIMUM_LIQUIDITY permanent lock against the first-depositor drain
  • compliance checks on every entry path, including direct pair calls
  • Ownable2Step + feeToSetter rotation (no stuck anvil keys)

Result: 49/49 Foundry tests passing (including exploit PoCs), npm audit reporting 0
vulnerabilities, and a live demo at veriflow-flax.vercel.app.

## SCALABILITY

A-Pass is chain-agnostic — Cleanverse supports monad, base, eth, polygon, bsc and
more with the same chain-slug pattern. The same hook pattern ports to any V2-style
venue. The tier/subGroup rules let you ship per-product compliance profiles (e.g.
"only tier-3 users can trade this pair"). And Cleanverse's fiat-ramp endpoints let
you add compliant on-ramps to the same stack without building a new KYC flow.

---

Team: cipoklean
Live: veriflow-flax.vercel.app
Repo: github.com/cipoklean/veriflow
