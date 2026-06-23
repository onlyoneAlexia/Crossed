# Crossed v2 — gap-closure interface contract (maximal scope)

> Canonical coordination doc for the two implementation lanes. Baseline rollback point:
> git commit `8deb72ab` ("baseline: pre darkpool-v2 gap-closure snapshot").

## Hard rules (DO NOT VIOLATE)
1. **Never overwrite the live contract `CBGWGEP5…`.** v2 deploys to a NEW contract id; the live
   demo keeps running until v2 is verified green, then `frontend/src/lib/config.ts` cuts over.
2. **Lane separation (no file collisions):**
   - **Codex lane (backend):** `contracts/crossed/**`, `circuits/**`, `coordinator/**`, `scripts/**`,
     `docs/CROSSED_V2_SCHEMA.md`. Local ceremony only. **Must NOT touch** `frontend/src/**`,
     `frontend/src/lib/config.ts`, or overwrite `frontend/public/circuits/**`.
   - **Claude lane (frontend + docs):** `frontend/src/**`, `frontend/src/lib/config.ts`,
     `docs/plans/**`, `docs/*ROADMAP*`. **Must NOT touch** contracts/circuits/coordinator.
3. **All new UI is gated behind `CONFIG.FEATURES` flags defaulting `false`** so the current demo build
   stays green until each backend feature is live.
4. Keep `cargo build` and `npx tsc --noEmit` green. Commit (`git add -A && git commit`) after each class.
5. No faked cryptography. Research-scale items land as design specs + scaffolds, clearly marked.

## Scope matrix (owner → target)
- **Class A** (contract+coordinator, no circuit change) → Codex → fully implemented.
- **Class B** (ONE batched circuit-v2 + ONE local trusted setup) → Codex → implemented + local ceremony; deploy deferred to verify step.
- **Class C** (privacy depth) → Codex → implement what is feasible; document partials.
- **Class D** (research-scale: full MPC/TEE/FHE, match-completeness proof, permissionless settle+bond, proof-of-innocence, recursive aggregation) → Codex → rigorous design spec + interfaces + TODOs.

## Provisional v2 schema (Codex finalizes exact ordering in docs/CROSSED_V2_SCHEMA.md)
- **order.circom v2 public signals:** existing `[note, nf_order, pair_id, batch_id, root]` plus
  `expiry`, `maq` (min acceptable qty), `tier` (counterparty class), `lock_commit` (escrow-reservation commitment).
- **dpmatch.circom v2 public signals:** existing match signals plus `fill_base`, `fill_quote` (partial fill),
  `change_note_sell`, `change_note_buy` (residual UTXO commitments), `ref_mid` (signed oracle midpoint), `fee_base`/`fee_quote`.
  Add in-circuit constraints: `leaf_sell != leaf_buy` (self-trade), `fill ≥ maq`, `limit_sell ≤ ref_mid ≤ limit_buy`, conservation incl. fees.
- **New contract entrypoints:** `set_paused/set_guardian` (pause gates place/settle, NEVER withdraw),
  timelocked admin ops, on-chain Poseidon `insert` (Merkle frontier; replaces trusted `post_root`),
  partial `settle_dp_match` (+ change notes), reserve-on-place, signed-oracle input, vk-version registry.
- **New events:** `Paused`, `RootUpdated`, partial `Fill`, `FeeAccrued`, `VkUpgraded`.
- **New coordinator endpoints:** `/dp/commit` + `/dp/reveal` (commit-reveal staging), `/dp/tca`, `/dp/disclose`,
  durable state (json/sqlite), mandatory auth, signed batch-decision log anchored on-chain.
- **New order fields (FE):** time-in-force / expiry, min-fill (MAQ), counterparty tier, post-only.
- **`CONFIG.FEATURES`** flags (default false): `partialFills, tif, maq, tiers, killSwitch, viewingKeys, tca, passkey, refPrice`.

## Post-implementation cutover (run after both lanes finish)
build wasm → deploy NEW v2 contract → `configure_pair(1..6)` → copy new `circuits/build` artifacts to
`frontend/public/circuits` → flip `config.ts` to the v2 id → `node coordinator/dp_e2e.js` green → adversarial review.
