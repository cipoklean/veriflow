# VeriFlow Security & Correctness Audit — Monad Testnet (Chain 10143)

Audit date: 2026-08-07 · Read-only · No code modified
Scope: `contracts/` (Foundry) + `frontend/` (Vite/React/wagmi v3) + deployed on-chain state

---

## 1. Summary (risk posture)

1. The protocol is **100% non-functional as deployed**: verified live via RPC — the factory has 0 pools, the CVA registry has 0 verified assets, the CVI registry has 0 verified wallets, and the deployed router's `factory()`/`WETH()` both return `0x0`. Every user-facing transaction path reverts on-chain.
2. The router is structurally broken in source: `_swap()` never calls `pair.swap()` (it pushes tokens from the router's own empty balance), WETH is deposited to the router but never forwarded to the pair, and several refund paths send from the router's balance.
3. The compliance architecture double-checks `msg.sender` at the pair level, so router-mediated calls are checked against the *router contract's* CVI status — guaranteed revert unless the router itself is registered as a "verified wallet".
4. The frontend fakes the compliance gate (700 ms timer), shows false "success" on reverted txs (never inspects `receipt.status`), and ships fabricated analytics ($45M TVL, 99.97% compliance) alongside a genuinely empty protocol.
5. No confirmed fund-**loss** exploit exists (everything reverts safely); the risk is total breakage, misleading UX, centralization, and secret hygiene. Fixes require a full redeploy + router rewrite, not a patch.

---

## 2. Findings

### CRITICAL — none confirmed (no verified fund-loss path; all broken paths revert atomically)

---

### HIGH

#### H-01 · Router `_swap()` never calls `pair.swap()` — every swap reverts
- **File:** `contracts/src/core/VeriRouter.sol:373-384` (used by all 6 swap fns, e.g. 225-237, 239-252, 254-268, 270-286, 288-304, 306-320)
- **Description:** Uniswap's `_swap` calls `pair.swap(amountOut, to, data)` per hop. Here `_swap` only does `_safeTransfer(path[i+1], to, amounts[i+1])` — transferring the *output* token **from the router's own balance**. The router never holds output tokens and never pulls the input (only `swapTokensForExactTokens`/`swapTokensForExactETH` pull input to the pair, at :250/:282).
- **Scenario:** User approves router + calls `swapExactTokensForTokens(1 USDC, min, [USDC, WMON], user)`. Router computes amounts, then tries `USDC.transfer(user, out)` from its own (empty) balance → revert `ERC20InsufficientBalance`. Every swap fails, for every user.
- **Fix:** Rewrite `_swap` to call `pair.swap()` per hop (V2 pattern): pull input into hop-1 pair, intermediate hops `pair.swap(0, amounts[i+1], nextPair, "")`, final hop `pair.swap(0, amounts[last], to, "")`.
- **Effort:** M

#### H-02 · WETH/ETH handling: deposit lands on the router, never reaches the pair
- **File:** `VeriRouter.sol:160-164` (`addLiquidityETH` deposits `amountETH` → WETH minted to *router*), `:265`, `:317` (ETH swaps), `:397-403` (`_safeTransferFrom` WETH branch does `deposit{value}` from the router's balance and **ignores `to`**), `:216-218` (`removeLiquidityETH` re-sends token/ETH from the router *after* `burn` already delivered them → double-send attempt + revert)
- **Description:** No `IWETH(WETH).transfer(address(pair), amountETH)` anywhere. `pair.mint` sees zero WETH balance delta → `INSUFFICIENT_LIQUIDITY_MINTED` (or sqrt-underflow on first deposit). `removeLiquidityETH` double-delivers.
- **Scenario:** `addLiquidityETH(USDC, …)` with 10 MON: 10 MON → WETH on router; pair receives only USDC; `mint` reverts; tx unwinds (no loss), but the ETH path is permanently dead. If any future change makes the deposit survive (e.g. reordering), the WETH strands on the router with **no rescue function**.
- **Fix:** After `deposit`, `IWETH(WETH).transfer(address(pair), amountETH)`. Make `_safeTransferFrom` treat WETH like any ERC20 (`transferFrom(from, to, value)`). Remove the redundant post-burn transfers in `removeLiquidityETH` (burn already sends to `to`).
- **Effort:** M

#### H-03 · Deployed router is zeroed: `factory()` = `0x0`, `WETH()` = `0x0` (verified on-chain, 2 RPC checks)
- **File:** live contract `0xC96181FdcD68937e76F2dc4e2Fc9D6AEf47B4D6C` vs `broadcast/DeployVeriFlow.s.sol/10143/run-latest.json` (broadcast claims args `(0x566e…, 0x0C6c…mockWETH, 0xe829…hook)`; on-chain storage shows factory=0, WETH=0, hook=0xe829… set)
- **Description:** The live router bytecode does not match the current source/deploy script. With `_factory = 0`, `getPair` is called on `address(0)` → every router entry point reverts (`PAIR_NOT_EXISTS` / decode failure). `getAmountsOut` also reverts → frontend quotes fail.
- **Scenario:** Any router call, ever, on the live deployment.
- **Fix:** Redeploy the full stack with a corrected script (see Top-5 plan) and update `frontend/src/contracts/config.ts`. Consider a script that asserts `factory()==expected && WETH()==expected` post-deploy.
- **Effort:** S (script + redeploy) — but blocks everything else

#### H-04 · Compliance registry state is empty on-chain — protocol bricked end-to-end (verified)
- **File:** live `0xBF9d97a54BA2eB0e559b5012a77550F3dDC3312D` (CVI mock) / `0xAc233f7169E57eA15182F5bC66C2C427a7af6103` (CVA mock); owners = deployer `0x51b0228bd9B8BF78CEDB11Cb485BA9F80cCf4655` (NOT the governor `0x7250…`)
- **Description:** Verified via RPC: `cva.isVerifiedAsset(WMON)=false`, `cva.isVerifiedAsset(USDC)=false`, `cvi.isVerified(router)=false`, `cvi.isVerified(governor)=false`, `factory.allPairsLength()=0`. `BootstrapVeriFlow.s.sol` (which registers WMON/USDC and seeds the pool) was **never run** (no broadcast file; its `registerAsset` would revert anyway — mock registry owners were never transferred from the deployer, and bootstrap runs as governor). The deploy script only transfers ownership of hook/factory/router, not the registries (`DeployVeriFlow.s.sol:102-121,132-167`).
- **Scenario:** `factory.createPair(WMON, USDC)` reverts `TOKEN_A_NOT_VERIFIED`; every `checkSwap`/`checkAddLiquidity`/`checkRemoveLiquidity` returns not-allowed → no trade can ever execute. The frontend "Pools" page correctly shows zero pools; the fake-verified Swap UI contradicts reality.
- **Fix:** Register WMON/USDC (and the router if keeping pair-level checks — see H-05) in the CVI/CVA mocks as owner, or deploy the real Cleanverse registries; transfer mock ownership to governor; run bootstrap; then verify with `cast call`s before wiring the UI.
- **Effort:** S

#### H-05 · Pair-level compliance checks re-verify `msg.sender` = the ROUTER, not the user
- **File:** `VeriPair.sol:167` (`mint`), `:201` (`burn`), `:238` (`swap`) → `_checkCompliance*` helpers `:291-333` pass `msg.sender`
- **Description:** Router-mediated calls reach the pair with `msg.sender == router`. The pair then asks the hook `checkSwap(router, …)` → `cviRegistry.isVerified(router)`. A contract is never a verified "A-Pass wallet" → guaranteed `ComplianceRejected`, *even after* H-03/H-04 are fixed. The router's own check (user) is correct; the pair's second check (router) is wrong by construction.
- **Scenario:** Any router swap/add/remove after redeploy — reverts at the pair.
- **Fix:** Drop the pair-level check (router is the only sanctioned entry), or pass the original user explicitly, or register the router in the CVI registry (hacky). Also consider checking the **recipient** `to` (see M-03).
- **Effort:** S

#### H-06 · Frontend reports success on reverted transactions (wagmi `isSuccess` = receipt received, not `status === 'success'`)
- **File:** `SwapPage.tsx:46,204-214`; `LiquidityPage.tsx:41,255-261`
- **Description:** `useWaitForTransactionReceipt` resolves `isSuccess` when a receipt is fetched. `receipt.status` (`'success' | 'reverted'`) is never inspected. Every tx that broadcasts then reverts on-chain (i.e. **every** tx today, per H-01/H-03/H-05) shows "Swap completed!" / "Liquidity updated!" and clears inputs.
- **Scenario:** User swaps USDC→WMON; router reverts (H-01); UI toasts "Swap completed!", refetches balances (unchanged), clears the form. User believes the trade executed; repeats and loses gas repeatedly.
- **Fix:** Read the receipt (e.g. `useWaitForTransactionReceipt` → `receipt.status`), treat `reverted` as error, decode the revert reason (`ComplianceRejected`, `K`, `PAIR_NOT_EXISTS`…) and display it.
- **Effort:** S

#### H-07 · Liquidity remove flow: unawaited approve + `setTimeout(1000)` race + zero min amounts
- **File:** `LiquidityPage.tsx:209-252` (`minAmountA/B = parseUnits('0', …)` at :215-216; `setTimeout` at :227-246)
- **Description:** Approve is broadcast and the remove tx is fired 1 s later without waiting for the approval receipt. On testnet 1 s is usually not enough → `transferFrom` fails → remove reverts (and with H-06 the UI says it succeeded). Min amounts are hardcoded `0` → zero slippage protection on removal. `removeLiquidityETH` also receives a nonsensical `minAmountA + minAmountB` (mixed units) as `amountETHMin` (:235).
- **Fix:** Wait for the approval receipt before sending remove (or use `permit`/single `approve`+remove multicall); compute real min amounts from pool ratio × (1 − slippage); fix the ETH-min argument.
- **Effort:** S/M

#### H-08 · Native MON swap path uses the zero address as WETH — broken quote + `INVALID_PATH`
- **File:** `SwapPage.tsx:173-181` (`swapExactETHForTokens` with `path[0] = 0x0…0`); `config.ts:45` (MON `isNative` with `address: 0x0`)
- **Description:** The router requires `path[0] == _WETH` (VeriRouter.sol:261,313). The frontend sends `0x0`. Also `useQuote` calls `getAmountsOut([0x0, USDC])` → `getPair(0x0, USDC)=0` → reserve read on `address(0)` reverts → quote = 0.
- **Fix:** For native MON, build the path as `[weth, …]`, deposit+swap via router with `value`, and display MON/WMON as one asset (Uniswap convention). Quote against the WMON path.
- **Effort:** M

---

### MEDIUM

#### M-01 · Compliance cache is dead code — and the *intended* 24 h TTL is dangerous
- **File:** `ComplianceHook.sol:28-31,106-108,139-141` (reads only), `:334-338` (`_invalidateAllCaches` emits an event but clears nothing), `:345-357` (per-entry deletes)
- **Description:** `cviCache`/`cvaCache` are never written (all check fns are `view`; no assignment exists). Every check hits the registry (gas, but live enforcement). Conversely, if the documented design (24 h TTL) were implemented, a revoked/blacklisted user keeps trading for up to 24 h — a compliance hole. As-is, the TTL/`invalidate*` surface is misleading dead code.
- **Fix:** Either delete the cache entirely or implement it with an invalidation strategy that propagates registry revocations (e.g., short TTL + version counter bumped on revocation).
- **Effort:** S

#### M-02 · Compliance gates only `msg.sender`, never the recipient; LP tokens transfer freely
- **File:** `VeriPair.sol:166-167,200-201,232-238` (checks sender only); `swap/burn` send to arbitrary `to`; LP `transfer/transferFrom` (inherited ERC20) unchecked; `skim`/`sync` permissionless (:270-285)
- **Description:** A verified user can `pair.swap(…, to=unverified)` or `burn(to=unverified)`; LP tokens can be gifted to any unverified wallet; `skim` moves pair excess to any address. For a Travel-Rule/regulatory product this is the core compliance promise unenforced on the receive side.
- **Fix:** Add CVI checks on `to` for swap/burn recipients (and decide LP-transfer policy — e.g., restrict transfer when recipient unverified).
- **Effort:** M

#### M-03 · Router/factory governance gaps: single-step ownership, decorative `feeToSetter`, wrong events, missing `PairCreated`
- **File:** `VeriFactory.sol:66-74` (`setFeeTo`/`setFeeToSetter` emit `(old, old)` — the new value never appears in the event), `IVeriAMM.sol:81` declares `PairCreated` but `VeriFactory` **never emits it** (verified by grep), `_feeToSetter` has no power (`setFeeTo` is `onlyOwner`, not feeToSetter-gated, :66), all three contracts use single-step OZ `Ownable` (`transferOwnership` not 2-step)
- **Description:** Indexers/frontends cannot watch pool creation; event logs lie about fee changes; a compromised governor key instantly redirects 100% of future protocol fees (`setFeeTo`) and swaps registries (`setComplianceHook`, `setCVIRegistry`), with no timelock and no two-step handoff.
- **Fix:** Emit `(old, new)`; emit `PairCreated` in `createPair`; gate `setFeeTo` by `feeToSetter`; switch to `Ownable2Step` (+ optionally a timelock for fee/registry changes).
- **Effort:** S

#### M-04 · `setComplianceHook` on the factory does not propagate to existing pairs (and pairs can never be paused)
- **File:** `VeriFactory.sol:88-91`; `VeriPair.sol:30` (mutable `complianceHook` but **no setter**), `:21` (inherits `Pausable` but exposes **no pause function**)
- **Description:** Updating the hook only affects *new* pairs; existing pairs keep the old hook forever (owner of each pair is the factory — also dead, no `onlyOwner` fn exists in the pair). Governance cannot freeze trading on existing pairs in an emergency.
- **Fix:** Add `setComplianceHook` + `pause/unpause` (onlyOwner) to `VeriPair`; wire the factory to update live pairs or document pair-hook immutability.
- **Effort:** S

#### M-05 · Frontend compliance gate is simulated — 700 ms timer, no on-chain/API check
- **File:** `SwapPage.tsx:101-111` ("Simulated deterministic pass once a valid quote exists"), `SettingsPage.tsx:153-164` (hardcoded "Verified"/"Enforced" badges), `useVeriFlow.ts:152-167` (`useVerifiedAssets` calls `getVerifiedAssets` against the **ComplianceHook ABI/address** — that function doesn't exist there → always empty; currently unused, but broken if wired)
- **Description:** The UI asserts "Cleared / Verified / Authentic" purely from a timer. A user whose CVI attestation expired (or who was never registered) is told they're compliant, then their tx reverts with an undecoded `ComplianceRejected`.
- **Fix:** Read `hook.checkCVI(account)` + `hook.checkCVA(token)` (real on-chain reads) or call Cleanverse `/validator/verify`; disable the action and show the actual reason when not compliant.
- **Effort:** M

#### M-06 · `useWaitForTransactionReceipt` + `useWriteContract` double-submit / approval UX
- **File:** `SwapPage.tsx:144-162` (`approve` = 1e9 tokens ≈ infinite; no receipt wait; `needsApproval` derived from a possibly-stale allowance read), `:165-201` (submit-then-error model)
- **Description:** Effectively-infinite approvals (contradicts the checklist's "no needless infinite approvals"); after approving, the user must re-click swap and may hit a stale-allowance false negative ("Insufficient allowance" despite a pending approve).
- **Fix:** Approve exact-or-bounded amounts (or max-approval with documented rationale), wait for the approval receipt, then auto-proceed or refresh allowance.
- **Effort:** S

#### M-07 · Liquidity page mislabels reserves when token selection order ≠ pair sort order
- **File:** `LiquidityPage.tsx:99-108,119` (`reserve0/reserve1` mapped to `tokenA/tokenB` as selected; pair sorts by address)
- **Description:** Selecting (USDC, WMON) displays USDC reserve = WMON's reserve and computes the B-side estimate from the inverted ratio (`reserve1/reserve0`).
- **Fix:** Fetch `token0()/token1()` from the pair and map reserves accordingly (as `useAllPools` already does).
- **Effort:** S

#### M-08 · Fabricated analytics presented as protocol data
- **File:** `AnalyticsPage.tsx:46-68` (hardcoded $1.25M 24h volume, $45M TVL, $32M 30d volume, "99.97% compliance rate", pseudo-random charts), `PoolsPage.tsx:51-52` (`feeAPR: 12.5`, `volume24h: 0`)
- **Description:** The Analytics page invents numbers that contradict the live on-chain state (0 pools, 0 TVL). Anyone (judges included) comparing Pools/Dashboard (real, empty) vs Analytics (fake, huge) sees an inconsistency; "Compliance Rate 99.97%" is presented as fact.
- **Fix:** Either compute from on-chain data (pair reserves × a testnet price proxy; swap events for volume) or label the page "Demo/illustrative" with a banner. Do not ship fabricated compliance metrics.
- **Effort:** M

#### M-09 · Cleanverse AES key ships in the client bundle
- **File:** `cleanverse.ts:21-22` (`VITE_CLEANVERSE_API_KEY`), `frontend/.env` (key present, 44 chars), `:50-56` (AES-256-CBC, **fixed zero IV**), `:106-108` (`generateApass` posts ID-card PII from the browser)
- **Description:** `VITE_*` vars are inlined into the public JS bundle by Vite. The "kept in .env, never hardcoded" comment is misleading — every visitor can extract the key and decrypt/encrypt the Cleanverse traffic (and the fixed zero IV makes CBC patterns guessable). PII (identity document fields) is submitted from a client that cannot keep secrets.
- **Fix:** Move Cleanverse calls behind a small backend/proxy (key server-side); at minimum document that the key is public by design and encrypt-at-rest concerns don't apply to transport. Consider random IV per request (if the API allows).
- **Effort:** L (backend) / S (documentation)

#### M-10 · Secrets on disk; project is not a git repo
- **File:** `contracts/.env` (`PRIVATE_KEY`, `DEPLOYER_PRIVATE_KEY` set, 66 chars — real keys, plaintext), `frontend/.env` (API key/id)
- **Description:** VeriFlow has **no `.git`** (verified) — nothing is committed, so nothing is leaked *yet*, but the folder is unversioned and zippable: a hackathon submission containing `.env` ships the deployer key. The deployer key also matches another project's governor key (key reuse).
- **Fix:** Rotate the key after the demo; keep `.env` out of any archive; `git init` + confirm `.gitignore` (both exist) before first commit; never reuse deployer keys across projects.
- **Effort:** S

#### M-11 · `npm audit`: 2 HIGH vulnerabilities
- **File:** `frontend/package-lock.json` (react-router-dom 7.18.2 → GHSA-qwww-vcr4-c8h2, RSC-mode CSRF)
- **Description:** Fix requires `react-router-dom@7.11.0` (breaking). Impact is limited here (SPA, no RSC actions), but it's a known-high advisory on a runtime dep.
- **Fix:** `npm audit fix --force` + retest, or pin to a patched line when available.
- **Effort:** S

---

### LOW / INFO

- **L-01 · `addLiquidity` refund path sends from the router's own balance** — `VeriRouter.sol:120-121,166-167`. For non-proportional inputs the "refund" reverts (should simply pull only the optimal amount, V2-style). Also makes `addLiquidity` fail on any fee-on-transfer token. Effort S.
- **L-02 · First-depositor protection present ✓** — `VeriPair.sol:47,179-180` burn `MINIMUM_LIQUIDITY = 1000` to `address(0)`; tiny first deposits underflow-revert. No donation/inflation attack found. (Info.)
- **L-03 · Pair token compatibility ✓ (balance-based)** — mint/burn/swap compute from balance deltas (`VeriPair.sol:168-172,205-206,250-254`), so fee-on-transfer/rebasing tokens don't corrupt reserves; the K-check uses 997/1000 (:258-260) matching `getAmountOut` (:335). Note: `skim`/`sync` are permissionless by design (V2 semantics). (Info.)
- **L-04 · Oracle/TWAP ✓ no manipulation surface** — `_update` accumulates V2-style TWAP (`VeriPair.sol:339-357`), but nothing consumes the accumulators; no price feeds compliance/routing. No flash-loan vector beyond standard V2 sandwiching (which the router's missing slippage… is enforced via `amountOutMin` ✓; direct `pair.swap` has no slippage/deadline — inherent). (Info.)
- **L-05 · Reentrancy & CEI ✓** — all state-changing pair/router entry points are `nonReentrant`; `data` callback param is ignored (no flash loans); hook/registry calls are `view` inside guarded fns. Burn/swap transfer-then-update follows V2 with revert-unwind safety. (Info.)
- **L-06 · Permit** — `VeriPair.sol:120-140`: nonce is consumed inside the digest (replay-safe), invalid sigs revert atomically; but the domain separator is frozen at construction (`:82,385-395`) — stale if chain id ever forks. Standard V2 limitation. Effort S.
- **L-07 · Hardcoded chainId 10143 on most reads** — `useVeriFlow.ts:67,78,90-93,143,159`, `LiquidityPage.tsx:61,68,77,85`: `chainId` forced to 10143 while addresses come from `getContractAddresses(currentChain)` — `localhost` (31337) config is dead; unknown chains silently default to Monad addresses (`config.ts:33-35`). Effort S.
- **L-08 · Dead UI** — Pools "Create Pool"/"Manage" buttons disabled/no-op (`PoolsPage.tsx:110-113,145-148,191-194`); there is **no create-pool flow in the UI at all** (with zero CVA assets registered, nobody can create one even via the factory — H-04). "Max" button sets the amount to `'0.0'` (`LiquidityPage.tsx:400`); balances hardcoded `'0'` (`:396,457`). Settings page controls are local state, not wired to Swap/Liquidity (`SettingsPage.tsx:8-11,71-111`). Effort M.
- **L-09 · WalletConnect projectId fallback `'demo'`** — `App.tsx:19`; WC Cloud rejects demo ids → mobile connect fails. Effort S.
- **L-10 · Dead links** — `docs.veriflow.xyz` doesn't resolve (curl failed); `github.com/veriflow` returns a 200 stub; Terms/Privacy links are `href="#"` (`WalletButton.tsx:181-183`). Effort S.
- **L-11 · No CSP / headers** in `index.html`; Vite warns chunk > 500 kB (`index-trGuy5RA.js` 503 kB) and `__dirname` native-loader warning. Effort S.
- **L-12 · `forge lint` warnings** — 16× `block-timestamp` (deadline/expiry compares — inherent to DEX), `erc20-unchecked-transfer` at `VeriRouter.sol:189,210` (pair LP `transferFrom` return unchecked — pair is trusted, low risk), `unsafe-typecast` (uint112/uint32 truncation — guarded by `OVERFLOW` require). Effort S.
- **L-13 · `useAllPools`/`useQuote` never refetch on chain/account change; `useProtocolStats` TVL = reserve sum in MON units mislabeled** (`useVeriFlow.ts:169-183`, `PoolsPage.tsx:39` "crude testnet metric"). Effort S.
- **L-14 · Cleanverse `verifyUser`/`isPoolRegistered` helpers are unused** (dead client code) — the only compliance surface actually used is the simulated timer. Effort S.
- **L-15 · `Counter.sol` + `Counter.s.sol` leftover template files** ship in `src/` and `script/`. Effort S (delete).

---

## 3. Verified OK (coverage proof)

- Builds/tests: `forge build` ✓ (0 errors), `forge test` ✓ 2/2 — **but the only suite is `Counter.t.sol`; there are ZERO tests for VeriFactory/VeriPair/VeriRouter/ComplianceHook and zero invariant tests** (k-constancy, MINIMUM_LIQUIDITY, fee math). CI (`contracts/.github/workflows/test.yml`) runs fmt/build/test only.
- Frontend: `npm run build` (tsc -b + vite) ✓ clean; `npm run lint` ✓ 0 errors / 2 warnings (`useToast.tsx:39` fast-refresh, `SwapPage.tsx:95` unused catch var).
- Wallet integration (old bugs verified fixed): wagmi v3 MIPD config with no duplicate injected/metaMask/coinbase connectors (`App.tsx:28-37`) ✓; wallet icons render via `<img src>` for string icons (`WalletButton.tsx:163-168`) ✓; connect modal closes on backdrop click + Escape + scrolls (`:64-69,121-131`) ✓; no-provider state renders install hint (`:148-155`) ✓; wrong-network banner + switch button ✓ (not auto-switch — see L-07/H-08 area).
- Addresses: frontend `config.ts` matches the broadcast file exactly (factory/router/hook/cvi/cva) ✓; single source of truth for addresses ✓; no init-code hash anywhere because pairs deploy via CREATE (non-deterministic) and the frontend correctly reads `getPair`/`allPairs` instead of computing ✓ (that's also why `PairCreated` missing matters — M-03).
- Decimals: `parseUnits`/`formatUnits` used per-token (6 for USDC, 18 else) ✓; LP treated as 18 ✓.
- Slippage/deadline: router enforces `deadline` and `amountOutMin` on all swap paths ✓ (contract); frontend sets +1200 s and 0.1–5% slippage ✓ (except remove-liquidity mins = 0 — H-07).
- No `eval`/`dangerouslySetInnerHTML`/`innerHTML` ✓; external links use `rel="noopener noreferrer"` ✓; focus-visible + reduced-motion present in `index.css` ✓; no secrets in source (only `.env`, VITE key is bundle-public by design — M-09) ✓.
- On-chain (all verified via `cast call` + raw JSON-RPC, 2 endpoints): router code exists (22 183 bytes), hook `paused()=false`; CVI/CVA registry owners = deployer `0x51b0…`; factory owner = governor `0x7250…`.

## 4. Assumptions / unverifiable

- **No fund-loss exploit was found**; the audit cannot prove absence of a loss path in `MockCVIRegistry`/`MockCVARegistry` because these are mocks — production registries are external, and their access control, revocation semantics, and upgrade paths are out of scope (the interfaces define the contract: `ICVIRegistry.sol`, `ICVARegistry.sol`).
- CVI wallet registry is a mapping — I verified governor+router are unverified but cannot enumerate every registered wallet.
- The live router bytecode differs from the current source (H-03); I could not recover the original deployment transaction to confirm what was actually deployed (no explorer archive checked; `cast tx` of the CREATE was not in the broadcast receipts I read). The broadcast file itself is inconsistent with on-chain storage.
- I did not run slither/aderyn (not installed; per your instruction I didn't install heavy tooling). Static review + forge lint + manual tracing used instead.
- Browser console/visual QA on the live dev server was not performed (build+typecheck+lint run); the runtime errors cited (getVerifiedAssets selector, quote reverts) follow deterministically from the code paths.

## 5. Top-5 fix plan (dependency order)

1. **Redeploy the stack correctly (unblocks everything).** Fix `DeployVeriFlow.s.sol`: set real WMON `0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701` as `WETH_ADDRESS`, transfer mock-registry ownership to the governor, register WMON+USDC as CVA and the governor (and any demo users) as CVI, then run `BootstrapVeriFlow`; add post-deploy assertions (`factory()`, `WETH()`, `allPairsLength()`, `isVerifiedAsset`). Update `config.ts` if addresses change.
2. **Rewrite `VeriRouter`** (H-01, H-02, L-01): `_swap` calls `pair.swap()` per hop; WETH = plain ERC20 in `_safeTransferFrom`; `addLiquidityETH` transfers WETH to the pair; pull only optimal amounts (drop router-balance refunds); fix `removeLiquidityETH` double-delivery and min-amount args.
3. **Fix the compliance double-check** (H-05, M-02, M-01): drop/replace the pair-level `msg.sender` check with the true user, add recipient (`to`) checks, and either implement or delete the cache (with revocation handling).
4. **Frontend truthfulness** (H-06, H-07, H-08, M-05, M-06, M-07): check `receipt.status` before any success toast + decode revert reasons; await approval before remove; real WMON path for native swaps; real `hook.checkCVI/checkCVA` reads instead of the timer; fix `useVerifiedAssets` ABI/address; map reserves by `token0/token1`.
5. **Governance + hygiene** (M-03, M-04, M-08, M-09, M-10, M-11, L-08): correct events + emit `PairCreated`, `Ownable2Step` (+ timelock for fee/registry setters), pair hook-setter/pause, replace fabricated analytics or label as demo, move the Cleanverse key server-side, rotate `.env` keys + `git init`, `npm audit fix`, add a real Foundry suite (unit + invariant: k never decreases, MINIMUM_LIQUIDITY burn, compliance revert paths, fee math) before any further deploys.

---
*Audit performed read-only. No files were modified. Awaiting your approval before implementing any fix.*
