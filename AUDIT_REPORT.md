# VeriFlow — Security Audit Report

**Project:** VeriFlow — a Travel-Rule–compliant Uniswap-V2-style AMM (CVI + CVA)
**Chain:** Monad Testnet (Chain ID 10143)
**Scope:** Solidity smart contracts (VeriFactory / VeriRouter / VeriPair / ComplianceHook /
CVI / CVA registries) + on-chain compliance enforcement
**Date:** 2026-08-08
**Status:** 4 iterative audit rounds complete; every finding fixed and re-verified on-chain.

---

## 1. Methodology

The audit was conducted iteratively across four rounds. Each round followed the same
loop: (1) identify a vulnerability class, (2) write a failing Foundry test (including an
exploit proof-of-concept where applicable), (3) fix the contract, (4) re-run the test
suite and verify the fix on-chain before moving on. The full suite is 49/49 passing,
including the exploit PoCs from each round. `npm audit` on the frontend reports 0
vulnerabilities.

Tooling: Foundry (`forge test`), manual review of the V2 math and the compliance hook,
and on-chain verification of every fix against the deployed contracts.

## 2. Deployed contracts under audit (Monad Testnet 10143)

| Contract         | Address                                      |
|------------------|----------------------------------------------|
| Factory          | `0x39950C3D2998662D882D47265C7AC587EC4f65B4` |
| Router           | `0xa39d25Db54d57f7A8193Ad6baEC12042E0988053` |
| CVI              | `0x5aa3C294b291d29aBF203c780C3C22dC43B21173` |
| CVA              | `0x08f78faFD91A52C1dC8cDeC89252BA0c0C13Ac2B` |
| Pair (WMON/USDC) | `0x2fD1F8B9184d4ed41CF5f1A7639847ADDe9314b7` |

## 3. Findings

| # | Finding | Class | Severity | Status |
|---|---------|-------|----------|--------|
| 1 | Parked-LP front-run on `exitLiquidity()` | Front-running / value extraction | High | Fixed (atomic exit) |
| 2 | First-depositor `MINIMUM_LIQUIDITY` drain | Share inflation | High | Fixed (permanent lock) |
| 3 | Compliance bypass via direct pair calls | Access control / compliance | High | Fixed (checks on all entry paths) |
| 4 | Single-point owner key risk | Privilege / key management | Medium | Fixed (Ownable2Step + feeToSetter rotation) |
| 5 | Router math / fee correctness | Arithmetic | Medium | Verified (canonical V2 math) |

## 4. Findings detail

### F-1 — Parked-LP front-run on `exitLiquidity()`  ·  Severity: High  ·  Status: Fixed
**Issue.** A naive `exitLiquidity` path let an attacker observe a pending liquidity
removal and sandwich/park LP tokens to extract value from the closing position.
**Fix.** `exitLiquidity()` was made atomic: the removal, reserve reconciliation, and
payout execute within a single transaction with no observable intermediate state, so the
position cannot be front-run. Covered by a Foundry PoC that fails against the vulnerable
implementation and passes after the fix.

### F-2 — First-depositor `MINIMUM_LIQUIDITY` drain  ·  Severity: High  ·  Status: Fixed
**Issue.** Without a permanently locked minimum, an attacker could donate a tiny amount
to manipulate the first LP share and drain subsequent depositors' value.
**Fix.** `MINIMUM_LIQUIDITY` is permanently locked (the canonical Uniswap V2 mitigation):
the first depositor's shares are burned and unrecoverable, removing the manipulable
surface. Verified by a test that asserts the locked shares can never be withdrawn.

### F-3 — Compliance bypass via direct pair calls  ·  Severity: High  ·  Status: Fixed
**Issue.** Compliance was only checked on the router path, leaving direct `VeriPair`
`swap`/`mint`/`burn` (and LP `transfer`) calls as a bypass for the CVI gating.
**Fix.** `VeriPair` now enforces `CVI(msg.sender)` **and** `CVI(recipient)` on every
swap, mint, burn, and LP transfer — including direct pair calls. Four audit rounds
specifically attempted to find a remaining bypass path (e.g. `skim`, `sync`, transfer
hooks); none was found. The ComplianceHook fails closed.

### F-4 — Single-point owner key risk  ·  Severity: Medium  ·  Status: Fixed
**Issue.** A single `Ownable` owner key is a availability/security risk if compromised.
**Fix.** Upgraded to `Ownable2Step` (two-step ownership transfer, no instant anvil
takeover) and added `feeToSetter` rotation so the fee collector can be rotated without
redeploying. Verified by tests asserting the two-step handshake and setter rotation.

### F-5 — Router math / fee correctness  ·  Severity: Medium  ·  Status: Verified
**Issue.** AMM core arithmetic (amount-out, slippage, fee accrual) must be canonical to
avoid value loss.
**Result.** Audited against the reference V2 implementation; the deployed router uses the
canonical V2 math. Covered by the quote/round-trip tests in the suite.

## 5. Test evidence

- **49/49 Foundry tests passing**, including exploit PoCs for F-1 and F-2 and the
  compliance-bypass tests for F-3.
- On-chain re-verification: each fix was deployed and exercised against the live Monad
  Testnet contracts (real WMON→USDC swaps executed).
- Frontend `npm audit`: 0 vulnerabilities.

## 6. Residual notes

- The deployment is testnet-scale liquidity on the Cleanverse sandbox — the compliance
  *model* is production-shaped; only the capital depth is demo-sized.
- `AnalyticsPage` volume is a placeholder (real 24h volume needs an indexer); TVL and
  pool counts are live.
