# Security Review Fixes

## Critical

1. DP coordinator receives trader `sk`.
   - Changed: kept the working Phase 1 flow intact and added an explicit TODO to move order proving client-side so the coordinator receives only proof + public signals (`coordinator/matcher.js:106`).
   - Requires contract redeploy: no.
   - Deferred: full fix requires moving proving to the browser and changing the coordinator submission flow; doing that here would risk breaking the live testnet demo.

2. Coordinator API unauthenticated / wildcard CORS.
   - Changed: replaced wildcard CORS with an origin allowlist from `CORS_ORIGINS`/`FRONTEND_ORIGIN`, added optional bearer/shared-secret auth with warning when unset, per-IP rate limits, and bounded TTL settlement state (`coordinator/security.js:15`, `coordinator/security.js:34`, `coordinator/security.js:51`, `coordinator/security.js:74`, `coordinator/server.js:84`, `coordinator/server.js:100`, `coordinator/server.js:139`).
   - Changed: frontend can send optional `VITE_COORDINATOR_API_TOKEN` without changing payload shapes (`frontend/src/lib/config.ts:16`, `frontend/src/lib/chain.ts:21`, `frontend/src/lib/chain.ts:135`, `frontend/src/lib/chain.ts:272`, `frontend/src/lib/chain.ts:361`, `frontend/src/lib/chain.ts:419`).
   - Requires contract redeploy: no.
   - Deferred: none.

## High

3. `initialize` unauthenticated.
   - Changed: `initialize` now requires `admin.require_auth()` and the test setup mocks that auth (`contracts/crossed/src/lib.rs:193`, `contracts/crossed/src/test.rs:151`).
   - Requires contract redeploy: yes, for the new initialization authorization to apply on-chain.
   - Deferred: no constructor migration; keeping `initialize` preserves the existing deployment scripts and ABI.

4. Merkle roots coordinator-trusted.
   - Changed: added the safe contract-local checks available now: root posts must match the current append-only leaf count and cannot exceed tree capacity (`contracts/crossed/src/lib.rs:276`, `contracts/crossed/src/lib.rs:279`).
   - Requires contract redeploy: yes.
   - Deferred: full root correctness still needs an on-chain Poseidon frontier or signed/multisig root attestations; noted in-code (`contracts/crossed/src/lib.rs:285`).

5. Browser secrets in `localStorage`.
   - Changed: added explicit TODOs on both DP identity and Stellar secret storage, and added optional API-token support so deployments can protect server calls without changing the demo path (`frontend/src/DarkPool.tsx:26`, `frontend/src/lib/chain.ts:28`, `frontend/src/lib/config.ts:16`).
   - Requires contract redeploy: no.
   - Deferred: replacing localStorage with Freighter/passkey/WebCrypto storage would alter wallet/key flow and was left out to keep the live testnet app working.

## Medium

6. OTC proofs not bound to submitting owner.
   - Changed: preserved existing owner auth and documented the circuit-side gap where `submit_intent` lacks a public leaf/owner signal (`contracts/crossed/src/lib.rs:313`, `contracts/crossed/src/lib.rs:328`).
   - Changed: strengthened the enforceable DP-side owner binding already available today: coordinator order intake rejects a mismatched registered leaf owner, and settlement resolves owners from public leaves (`coordinator/matcher.js:132`, `coordinator/matcher.js:134`, `contracts/crossed/src/lib.rs:680`).
   - Requires contract redeploy: no for coordinator-side DP checks already in service code; yes for the settlement/read-path TTL changes that touch the same contract.
   - Deferred: full bilateral OTC owner binding requires regenerating the intent circuit with a public self leaf or owner input.

7. DP token binding relies on mutable/admin pair configuration.
   - Changed: `configure_pair` rejects `base_token == quote_token`; `place_order` now requires the pair to be configured before accepting an order; open orders store `pair_id`; settlement rejects pair mismatches and resolves immutable configured base/quote tokens (`contracts/crossed/src/lib.rs:65`, `contracts/crossed/src/lib.rs:541`, `contracts/crossed/src/lib.rs:599`, `contracts/crossed/src/lib.rs:617`, `contracts/crossed/src/lib.rs:665`, `contracts/crossed/src/lib.rs:682`).
   - Requires contract redeploy: yes.
   - Deferred: binding base/quote token contract IDs directly into ZK public inputs still requires circuit changes.

8. Public service endpoints leak/DoS coordination state.
   - Changed: relayer now uses CORS allowlists, optional bearer/shared-secret auth on state-changing endpoints, per-IP rate limits, bounded TTL rendezvous maps, and bounded TTL profiles (`relayer/security.js:15`, `relayer/security.js:34`, `relayer/security.js:51`, `relayer/store.js:12`, `relayer/store.js:30`, `relayer/server.js:10`, `relayer/server.js:16`, `relayer/server.js:31`, `relayer/server.js:44`).
   - Changed: coordinator `/dp/fills/:owner` now passes through the same optional auth gate, and matcher fills/orders are capped with TTL pruning while preserving response fields (`coordinator/server.js:218`, `coordinator/matcher.js:44`, `coordinator/matcher.js:64`, `coordinator/matcher.js:90`, `coordinator/matcher.js:258`).
   - Changed: frontend can send optional `VITE_RELAYER_API_TOKEN` (`frontend/src/lib/config.ts:16`, `frontend/src/lib/relayer.ts:7`, `frontend/src/lib/relayer.ts:16`, `frontend/src/lib/relayer.ts:32`).
   - Requires contract redeploy: no.
   - Deferred: none.

## Low

9. Tree capacity not enforced.
   - Changed: added `TREE_CAPACITY = 16`; `register` rejects index >= 16 and `post_root` rejects counts above capacity (`contracts/crossed/src/lib.rs:174`, `contracts/crossed/src/lib.rs:244`, `contracts/crossed/src/lib.rs:279`).
   - Requires contract redeploy: yes.
   - Deferred: none.

10. No TTL extension on persistent/instance state.
   - Changed: added instance and persistent TTL refresh helpers and wired them through initialization, require-initialized paths, registrations, roots, intents, nullifiers, matches, escrow, open orders, and read helpers (`contracts/crossed/src/lib.rs:175`, `contracts/crossed/src/lib.rs:211`, `contracts/crossed/src/lib.rs:256`, `contracts/crossed/src/lib.rs:291`, `contracts/crossed/src/lib.rs:350`, `contracts/crossed/src/lib.rs:481`, `contracts/crossed/src/lib.rs:564`, `contracts/crossed/src/lib.rs:613`, `contracts/crossed/src/lib.rs:693`, `contracts/crossed/src/lib.rs:951`, `contracts/crossed/src/lib.rs:958`, `contracts/crossed/src/lib.rs:993`, `contracts/crossed/src/lib.rs:1178`, `contracts/crossed/src/lib.rs:1205`).
   - Requires contract redeploy: yes.
   - Deferred: none.

## Verification

- `cargo build --manifest-path contracts/crossed/Cargo.toml`: passed.
- `cd frontend && npx tsc --noEmit -p tsconfig.app.json`: passed.
- Additional checks run: `cd coordinator && npm test` passed; `cd relayer && npm test` passed.
- Note: `cargo fmt --manifest-path contracts/crossed/Cargo.toml` could not run because `cargo-fmt` is not installed for the active stable toolchain.
