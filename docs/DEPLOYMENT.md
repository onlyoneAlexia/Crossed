# Crossed — live testnet deployment (source of truth)

> Single source of truth for live contract IDs. If a summary/memory cites a different
> dark-pool ID, THIS file wins (verify with `stellar contract info interface`).

## Network
- Network: **Stellar testnet**
- Passphrase: `Test SDF Network ; September 2015`
- Network id (sha256 of passphrase): `cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472`
- RPC: `https://soroban-testnet.stellar.org`

## Identities
- Deployer **and** coordinator: `GDQPLQXZJWFGSVWM4JYCBXFOEAATO5TNH2MR674MABIBI5WU3LWTLOUK`
  (stellar key alias `crossed-deployer`; coordinator secret must be supplied from local secure storage)

## Contracts
### Dark-pool v3.1 (CURRENT) — hardened release
- **`CAR5DF4XFMD2ENXVIZPGHNQCRHHO4EBIGAOJ22NVJB6ZGAEEX4DD74QP`**
- v3.1 hardened contract. Adds over v2: **partial fills**, **tiers**, **`cancel_v2`**,
  **enforced expiry** (orders trap once past their bound expiry ledger), **fail-closed
  coordinator auth** (coordinator-gated entrypoints reject when the expected auth is
  absent rather than defaulting open), and a real **`__constructor`** (init is no longer a
  separate post-deploy call). Superset: still serves the v2 (`place_order_v2`,
  `settle_dp_match_v2`) and all v1 entrypoints, plus the kill-switch (`set_paused`/
  `set_guardian`; gates place/settle, NEVER withdraw) and admin timelock
  (`propose_*`/`execute_*`).
- FE (`frontend/src/lib/config.ts`) + coordinator point here; coordinator state
  auto-namespaces by contract id.

### Dark-pool — SUPERSEDED ids (do not use)
These earlier dark-pool deployments are retained for history only. The CURRENT id above
is the only one the FE/coordinator should target.
- **`CCHDHEEBFTLDWAUU5WDE4X5EEVUII4C577Y4TZJPDJB3ZMF32TSL6P6D`** — v2 gap-closure release
  (hex `8e3390812cd63b0294ed864e5fa4256884705dfff1c9e52f1a43bcb0bbd4e4bf`). Deployed
  2026-06-24; introduced the v2 circuits (`place_order_v2` binding expiry/maq/tier,
  `settle_dp_match_v2`), kill-switch and admin timelock. Superseded by v3.1, which adds
  partial fills, tiers, `cancel_v2`, enforced expiry, fail-closed coordinator auth and
  `__constructor`.
- **`CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24`** — cancel-order privacy
  redeploy (hex `4d6311fdc39d7f23fbe44d5321a09663d788d85d2bc06081be99e310a8f836d2`).
  Deployed 2026-06-22 with updated ORDER/DPMATCH/CANCEL_ORDER verification keys (deploy txs
  `79f6a669…` / `e0442554…` / `ffd93646…`; pairs 1..6 configured). Full dark-pool interface
  (`deposit, withdraw, place_order, cancel_order, settle_dp_match, configure_pair,
  escrow_balance, is_order_open` + bilateral `register, post_root, mint, settle_match`).
- **`CDFQ2O2…`** — cancel-order verifier-set deploy used for the 2026-06-22 live e2e runs
  (see VERIFIED LIVE below). Superseded by the cancel-order privacy redeploy and later v2/v3.1.
- **`CC7WVED3QP3TFKWAP3R46E5V6REHB5QHJYHCP2XDLLA6GWOD6NQPS5NN`** — client-order-proof privacy
  redeploy (hex `bf6a907b83f732aac07ee3cf13b5f44870f6074e0e27eae35ac1e359c3f360f9`). Replaced
  because sealed order cancellation needed a new entrypoint and CANCEL_ORDER verification key.
- **`CBD6IWQIARZZ637JBQOLBVZ5ZCMTRKFTHUPTTRWKGW3GTSJGKRZIPRSU`** — hardened redeploy that still
  used coordinator-side order proving (hex `47e45a0804739f6fe90c1cb0d73dc89938a8b33d1f39c6ca35b669c926547287`).
  Replaced because `/dp/order` no longer accepts trader identity `sk`.
- **`CDAHUONCBLL4K5LZHCUXV57533L425PI7DD2G6SQLSYBK2GKD267TAMS`** — first working DP deploy
  (hex `c07a39a20ad7c5757938a97af7fdded7cd75e8f8c7a37a505cb01568ca1ebdf9`; 2026-06-21,
  deploy tx `eb4eac2c…`, init `726d5eec…`, configure_pair `c9e4ad02…`).

### Configured pairs
- pair_id `1`: USDC/XLM (`CAZ2G2K...` / `CC6EOFW...`)
- pair_id `2`: EURC/USDC (`CBPK5QD...` / `CAZ2G2K...`)
- pair_id `3`: USDT/USDC (`CC6MUXK...` / `CAZ2G2K...`)
- pair_id `4`: EURC/XLM (`CBPK5QD...` / `CC6EOFW...`)
- pair_id `5`: USDT/XLM (`CC6MUXK...` / `CC6EOFW...`)
- pair_id `6`: EURC/USDT (`CBPK5QD...` / `CC6MUXK...`)

### Bilateral (LEGACY, superseded) — `CBXFJMEVB3QKKTLKVCWXQMNRZ2OKCBP4EX4KOZXFJ4TYEHBKCQUX5FN4`
Legacy `coordinator/chain.js` DEFAULT_CONTRACT_ID. The DP contract above is a SUPERSET (has both
bilateral `register/post_root/settle_match` AND dark-pool fns), so the coordinator runs entirely on it.

## Coordinator run (dark-pool mode)
The DP register/post_root paths target `contractId`, so OTC_CONTRACT_ID must equal the DP id.
For the v3.1 contract, enable the v2 order circuit and v3 match path, and set the API token:
```
cd coordinator
  COORDINATOR_SECRET="<local-coordinator-secret>" \
  OTC_CONTRACT_ID=CAR5DF4XFMD2ENXVIZPGHNQCRHHO4EBIGAOJ22NVJB6ZGAEEX4DD74QP \
  DP_CONTRACT_ID=CAR5DF4XFMD2ENXVIZPGHNQCRHHO4EBIGAOJ22NVJB6ZGAEEX4DD74QP \
  DP_ORDER_V2=1 \
  DP_MATCH_V3=1 \
  COORDINATOR_API_TOKEN="<shared-secret>" \
  PORT=8790 node server.js
```
`COORDINATOR_API_TOKEN` enforces a bearer token on the coordinator API. The frontend must be
built/run with **`VITE_COORDINATOR_API_TOKEN` set to the same value** or its `/dp/*` calls will be
rejected. With the v3.1 contract the coordinator auth is **fail-closed**: if the token is required
but missing/mismatched, requests are denied rather than served.

NOTE: on restart the coordinator rebuilds its in-memory directory from on-chain via `getRegistrations`.
If a coordinator was started while the directory was empty but the contract already had registrations,
`post_root` will trap with a leaf-count mismatch — restart it so the sync runs (look for "Synced N
registration(s)").
Endpoints: `/dp/register` (owner=trader, trader-signed auth + coordinator source-auth), `/dp/order`
(browser submits `proof`, `leaf`, `note`, `nf_order`, `root`, and one-time order opening fields; **no `sk`**),
`/dp/cancel` (drop an already canceled open order from coordinator memory), `/dp/close` (match batch + settle),
`/dp/batch`, `/dp/fills/:owner`.

## Honest limitations (current)
- The coordinator is a **single trusted off-chain operator**: it sees order details before
  proving/settlement, sequences the batch, and holds the deployer/coordinator key. It is not yet
  decentralized or operator-blind on-chain — privacy from *other traders* and on-chain observers
  is real, privacy from the operator is not.
- `COORDINATOR_API_TOKEN` is a single shared bearer secret (coordinator) matched by
  `VITE_COORDINATOR_API_TOKEN` (frontend); it gates API access, not on-chain authorization.
- Deployer and coordinator are the **same testnet identity** (see Identities). Fine for the
  hackathon demo; a production split would separate admin, guardian and coordinator keys.
- v3.1 partial fills / tiers / `cancel_v2` / enforced expiry are exercised by the v2/v3 coordinator
  paths (`DP_ORDER_V2=1`, `DP_MATCH_V3=1`); see the contract tests/fixtures for coverage.
- Testnet only. Mock SACs, no real-value assets.

## VERIFIED LIVE (2026-06-22; on the then-current cancel-order contract `CDFQ2O2…`, now SUPERSEDED)
- Offline prover test: `node coordinator/darkpool.test.js` → PASS.
- Two-party e2e: `COORDINATOR_URL=http://127.0.0.1:8790 node coordinator/dp_e2e.js` → **PASS** (against CDFQ2O2). Atomic midpoint swap settled on testnet:
  seller 10 AAA escrow → 0, +25 BBB; buyer 25 BBB escrow → 0, +10 AAA. dpmatch Groth16 proof verified
  inside `settle_dp_match`. This is the hackathon ZK requirement met end-to-end.
  Latest verified match+settle tx: `4914f1fc48…`.
- Cancel contract tests and offline cancel prover test pass against the CDFQ2O2 verifier set.
- Live cancel e2e: `COORDINATOR_URL=http://127.0.0.1:8790 node coordinator/dp_cancel_e2e.js` → **PASS**.
  Latest verified cancel tx: `c82940e0ca…`.
- FE: browser flow (enter pool → deposit → post sealed order) previously verified live; member registered owner=trader.

### Hardening note — post_root leaf-count race (fixed coordinator-side, no redeploy)
The hardened contract's `post_root` now strictly requires `leaf_count == on-chain LeafCount`.
`register` and `post_root` are separate transactions; after `register` is confirmed, the RPC's
simulation snapshot can still lag one ledger behind, so `post_root` simulated against stale state
and trapped (`UnreachableCodeReached`), leaving orphan leaves on-chain (count drifted 0→6 during
debugging). Fix: `chain.waitForLeafCount()` blocks until the snapshot reflects the committed count
before posting the root, and `submitAndWait`/`waitForLeafCount` now retry transient RPC blips
(`ECONNRESET`) instead of aborting mid-flow. See `coordinator/chain.js`, `coordinator/server.js`.
