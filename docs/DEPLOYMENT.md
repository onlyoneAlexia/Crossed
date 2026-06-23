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
  (stellar key alias `crossed-deployer`; coordinator secret = `stellar keys show crossed-deployer`)

## Contracts
### Dark-pool (CURRENT) — cancel-order privacy redeploy
- **`CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24`**
- contract_id (raw 32-byte hex): `4d6311fdc39d7f23fbe44d5321a09663d788d85d2bc06081be99e310a8f836d2`
- Deployed 2026-06-22 with updated ORDER/DPMATCH/CANCEL_ORDER verification keys. Deploy txs:
  `79f6a669…` (WASM upload), `e0442554…` (deploy), `ffd93646…` (initialize).
- Pair configuration txs: pair 1 `7ec5dcbf…`, pair 2 `eec39586…`, pair 3 `5e63eb8c…`,
  pair 4 `220b0dc2…`, pair 5 `2642a61f…`, pair 6 `456e13ea…`.
- This is the cancel-order superset the FE (`frontend/src/lib/config.ts`) and coordinator now point at
  (OTC == DP). Initialized + `configure_pair(1..6)`; full dark-pool interface live
  (`deposit, withdraw, place_order, cancel_order, settle_dp_match, configure_pair, escrow_balance,
  is_order_open` + bilateral `register, post_root, mint, settle_match`).

### Dark-pool (SUPERSEDED) — `CC7WVED3QP3TFKWAP3R46E5V6REHB5QHJYHCP2XDLLA6GWOD6NQPS5NN`
- hex `bf6a907b83f732aac07ee3cf13b5f44870f6074e0e27eae35ac1e359c3f360f9`; client-order-proof
  privacy redeploy. Replaced because sealed order cancellation requires a new contract entrypoint
  and CANCEL_ORDER verification key.

### Dark-pool (SUPERSEDED) — `CBD6IWQIARZZ637JBQOLBVZ5ZCMTRKFTHUPTTRWKGW3GTSJGKRZIPRSU`
- hex `47e45a0804739f6fe90c1cb0d73dc89938a8b33d1f39c6ca35b669c926547287`; hardened redeploy that still
  used coordinator-side order proving. Replaced because `/dp/order` no longer accepts trader identity `sk`.

### Dark-pool (SUPERSEDED) — `CDAHUONCBLL4K5LZHCUXV57533L425PI7DD2G6SQLSYBK2GKD267TAMS`
- hex `c07a39a20ad7c5757938a97af7fdded7cd75e8f8c7a37a505cb01568ca1ebdf9`; first working DP deploy
  (2026-06-21, deploy tx `eb4eac2c…`, init `726d5eec…`, configure_pair `c9e4ad02…`). Replaced by the
  hardened redeploy above. Do not use.

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
The DP register/post_root paths target `contractId`, so OTC_CONTRACT_ID must equal the DP id:
```
cd coordinator
  COORDINATOR_SECRET="$(stellar keys show crossed-deployer)" \
  OTC_CONTRACT_ID=CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24 \
  DP_CONTRACT_ID=CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24 \
  PORT=8790 node server.js
```
NOTE: on restart the coordinator rebuilds its in-memory directory from on-chain via `getRegistrations`.
If a coordinator was started while the directory was empty but the contract already had registrations,
`post_root` will trap with a leaf-count mismatch — restart it so the sync runs (look for "Synced N
registration(s)"). API auth is optional: set `COORDINATOR_API_TOKEN` to enforce a bearer token (off by default).
Endpoints: `/dp/register` (owner=trader, trader-signed auth + coordinator source-auth), `/dp/order`
(browser submits `proof`, `leaf`, `note`, `nf_order`, `root`, and one-time order opening fields; **no `sk`**),
`/dp/cancel` (drop an already canceled open order from coordinator memory), `/dp/close` (match batch + settle),
`/dp/batch`, `/dp/fills/:owner`.

## VERIFIED LIVE (2026-06-22; re-verified on cancel-order contract CDFQ2O2)
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
