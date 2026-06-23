# Crossed v2 — honest gap-closure roadmap

> Companion to `docs/CROSSED_V2_PLAN.md` (the interface contract) and
> `docs/codex-security-review.md` (the gap inventory). This file maps **each known
> dark-pool gap** to a v2 work-class and an honest status, and ends with the one
> section that matters most for judges and users:
> **what is cryptographically guaranteed vs honest-operator-trusted vs not-yet-built.**
>
> Live baseline this roadmap measures against:
> - DP/OTC contract `CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24` (see `docs/DEPLOYMENT.md`).
> - Verified e2e: order proof in browser → coordinator match → `settle_dp_match` Groth16-verified
>   atomic midpoint swap on testnet. Cancel proof + on-chain cancel also verified.
>
> No faked cryptography. Anything not yet proven in-circuit or enforced on-chain is labeled as such.

## Class legend (from CROSSED_V2_PLAN.md scope matrix)

| Class | Meaning | Cryptographic weight |
|-------|---------|----------------------|
| **A — done** | Contract + coordinator hardening, **no circuit change**. Implementable now, fully verifiable. | Strengthens honest-operator and availability guarantees; no new ZK. |
| **B — circuit-v2** | ONE batched circuit-v2 + ONE local trusted setup. New public signals + in-circuit constraints. | Moves guarantees **from honest-operator to cryptographic**. |
| **C — privacy** | Privacy depth (encryption, viewing keys, order-blinding). Implement feasible parts, document partials. | Reduces what the operator can *see*; mostly off-chain crypto. |
| **D — spec-only** | Research-scale (MPC/TEE/FHE, match-completeness proof, permissionless settle+bond, proof-of-innocence, recursive aggregation). | Rigorous design spec + interfaces + TODOs only. **Not built.** |

---

## Gap → v2 status map

Each row is a gap from the security review (numbers match `docs/codex-security-review.md`),
its current trust basis, the v2 class that closes it, and the concrete v2 mechanism.

### Coordinator / operator trust

| # | Gap (today) | Today's basis | v2 class | v2 mechanism |
|---|-------------|---------------|----------|--------------|
| 2 | Coordinator API unauthenticated; wildcard CORS; raw env secret controls mint/fund/settle | not-guaranteed | **A** | mandatory bearer auth (`COORDINATOR_API_TOKEN` exists but optional → make required), origin allowlist, per-IP/account rate limits, request signatures, split issuer/admin/coordinator keys |
| 1 | Coordinator is semi-trusted: sees submitted order **terms** and has place/settle authority | honest-operator | **C** (see/terms) + **D** (authority) | C: commit-reveal staging (`/dp/commit`+`/dp/reveal`), encrypted/order-blind matching; D: threshold/MPC matchers so no single operator holds authority |
| 7 (server) | Wallet-signed bounded order permits missing → coordinator places notes without per-note trader authorization | honest-operator | **B** | wallet-signed bounded order permit bound into order public inputs; coordinator placement authorized per note |
| 8 | `/settle`, `/dp/fills/:owner`, relayer profiles unauthenticated → scrape/DoS | not-guaranteed | **A** | authenticated owner lookups, signed requests, bounded TTL maps, private fill retrieval |
| — | Coordinator state is in-memory, lost on restart | not-guaranteed | **A** | durable state (json/sqlite), signed batch-decision log anchored on-chain |

### Root / membership integrity

| # | Gap (today) | Today's basis | v2 class | v2 mechanism |
|---|-------------|---------------|----------|--------------|
| 4 | Merkle roots fully coordinator-trusted: `post_root` checks only auth + leaf_count, not correctness | honest-operator | **B** | on-chain Poseidon `insert` (Merkle frontier) replaces trusted `post_root`; root becomes contract-computed, not operator-asserted |
| 9 | Tree capacity (16 leaves / depth 4) not enforced on-chain | not-guaranteed | **A** | enforce `leaf_count < 16` (or raise depth in circuit-v2 under **B**) |
| 10 | No TTL extension on persistent/instance state → archival can break registrations/nullifiers/roots | not-guaranteed | **A** | TTL policy; `extend_ttl` on every touch of critical keys |

### Contract authorization / proof binding

| # | Gap (today) | Today's basis | v2 class | v2 mechanism |
|---|-------------|---------------|----------|--------------|
| 3 | `initialize` unauthenticated → first caller can become admin if deploy/init not atomic | not-guaranteed | **A** | Soroban `__constructor` (atomic deploy+init) or deployer-auth |
| 6 | Bilateral OTC proofs not bound to submitting owner → front-runnable proof material | honest-operator | **B** | output self leaf + enforce `RegistrationByLeaf(leaf).owner == owner`, or bind owner into proof public inputs |
| 7 | DP token binding relies on mutable admin config, not the proof; `place_order` allows unconfigured pair | honest-operator | **A** (require configured pair, reject base==quote) + **B** (bind base/quote token IDs into match public inputs) | A part is contract-only; full fix needs circuit-v2 public signals |
| — | No kill-switch: a discovered bug cannot be paused | not-guaranteed | **A** | `set_paused`/`set_guardian` gating place/settle (NEVER withdraw); timelocked admin ops; `Paused` event |
| — | Admin actions are immediate (no timelock/multisig) | not-guaranteed | **A** (timelock) + **D** (full multisig governance) | timelocked admin ops now; threshold governance is research-scale |

### Settlement / matching semantics

| # | Gap (today) | Today's basis | v2 class | v2 mechanism |
|---|-------------|---------------|----------|--------------|
| — | Only **exact-size** crossing matches (`size_sell == size_buy`); no partial fills | honest-operator (matcher picks) | **B** | `fill_base`/`fill_quote` + `change_note_sell`/`change_note_buy` (residual UTXO commitments) in dpmatch-v2; conservation incl. fees constrained in-circuit |
| — | Midpoint uses matcher-chosen cross, no external reference | honest-operator | **B** | `ref_mid` (signed oracle midpoint) public signal + in-circuit `limit_sell ≤ ref_mid ≤ limit_buy`; on-chain signed-oracle input |
| — | No min-acceptable-qty / time-in-force / counterparty tier / post-only | honest-operator | **B** (constraints) + **A** (FE/contract fields) | order-v2 public signals `expiry`, `maq`, `tier`, `lock_commit`; in-circuit `fill ≥ maq`; FE fields gated behind `CONFIG.FEATURES` |
| — | Self-trade (same leaf both sides) not constrained in-circuit | honest-operator | **B** | in-circuit `leaf_sell != leaf_buy` |
| — | No fees modeled | n/a | **B** | `fee_base`/`fee_quote` public signals; conservation-with-fees constraint; `FeeAccrued` event |
| — | Escrow reserved only implicitly at settle, not at place | honest-operator | **A** | reserve-on-place + `lock_commit` escrow-reservation commitment |
| — | Match-completeness (operator can't silently drop a crossable order) is unprovable | honest-operator | **D** | match-completeness proof — research-scale, spec-only |
| — | Settlement is coordinator-only; no permissionless fallback if operator stalls | honest-operator | **D** | permissionless settle + bond / proof-of-innocence — research-scale, spec-only |

### Client key handling

| # | Gap (today) | Today's basis | v2 class | v2 mechanism |
|---|-------------|---------------|----------|--------------|
| 5 | DP identity AES-GCM-encrypted via wallet-signed message, but wallets without `signMessage` fall back to plaintext `localStorage` | honest-operator / device-trust | **C** | passkey-backed / non-exportable key wrapping (`CONFIG.FEATURES.passkey`); CSP; remove plaintext fallback |
| — | XSS / malicious extension can attack the active session even with encryption | not-guaranteed | **C** | CSP, passkey key wrapping; cannot be fully closed in a browser tab — documented as residual |

### Privacy depth (what the chain/operator can infer)

| # | Gap (today) | Today's basis | v2 class | v2 mechanism |
|---|-------------|---------------|----------|--------------|
| — | Operator sees full order terms at submission | honest-operator | **C** | commit-reveal staging; viewing keys (`CONFIG.FEATURES.viewingKeys`); order-blind matching |
| — | Cancel reveals the member leaf (owner-linkable for that order) | by-design tradeoff | **C** | documented as intentional; reducing it needs nullifier-based cancel (research-scale → **D**) |
| — | No trade-cost-analysis / disclosure surface for users | n/a | **A** | coordinator `/dp/tca`, `/dp/disclose` endpoints; FE `CONFIG.FEATURES.tca` |
| — | Cross-batch linkage of a trader's notes possible by the operator | honest-operator | **C/D** | encrypted mempool (C-partial) → full operator-blind matching via MPC/TEE/FHE (**D**) |

---

## What is cryptographically guaranteed vs honest-operator vs not-yet

This is the section to read before claiming anything in a demo or pitch.

### Cryptographically guaranteed TODAY (live baseline, on-chain enforced)

These hold even against a fully malicious coordinator, because a Groth16 proof is verified on-chain
before state changes:

- **Order membership.** A placed order proves the trader is a registered pool member (Merkle
  membership against the posted root) without revealing which member — `place_order` rejects an
  invalid `order` proof.
- **Match validity & price bound.** `settle_dp_match` verifies the dpmatch Groth16 proof:
  notes, spend nullifiers, leaves, amounts, pair, batch, and root are bound in public signals, and
  midpoint/limit math (`limit_sell ≤ cross ≤ limit_buy`, quote = size·cross/SCALE) is constrained
  **in-circuit**. The operator cannot settle a price outside both limits.
- **Atomic conservation at settle.** The swap debits both escrows and credits both traders atomically;
  open-order removal + match/nullifier flags prevent simple double-settlement and replay of the same note.
- **On-chain privacy of terms.** On-chain observers see only commitments (notes/nullifiers/leaves)
  and the settled fill amounts — not the resting order's side/size/limit before it fills.
- **Identity key locality.** The trader's pool identity `sk` never leaves the browser; `/dp/order`
  rejects any submitted `sk`. A stolen coordinator cannot forge *future* orders from a long-lived identity.
- **Cancel ownership.** Cancelling an order requires a CANCEL_ORDER proof; the contract enforces
  wallet ownership via the revealed member leaf, so no one else can cancel your order.

### Honest-operator-trusted TODAY (correct only if the coordinator behaves)

These are NOT cryptographically enforced yet; a malicious or buggy operator can violate them.
They are the primary targets of Class B (move to cryptographic) and Class A (reduce blast radius):

- **Root correctness / no censorship.** Coordinator asserts the Merkle root (`post_root` checks only
  auth + leaf_count). It could post a root over a tree that omits or alters members. → **Class B** (on-chain `insert`).
- **Order terms confidentiality from the operator.** The coordinator *sees* submitted side/size/limit
  to match. Do **not** call it operator-blind. → **Class C**.
- **Matching fairness / completeness.** The operator chooses which orders to pair and at what (in-bounds)
  midpoint, and could ignore a crossable order. Bounds are enforced; *selection* is trusted. → **Class B** (ref_mid/oracle) + **Class D** (completeness proof).
- **Per-note placement authorization.** Coordinator places notes under its own authority; there is no
  per-note wallet permit yet. → **Class B** (bounded order permits).
- **Token/pair mapping.** Settlement resolves tokens from mutable admin config, not the proof. → **Class A** (require configured pair) + **Class B** (bind token IDs in-circuit).
- **Availability & state durability.** In-memory coordinator state, unauthenticated high-value endpoints,
  no rate limits, no TTL refresh. → **Class A**.
- **Admin safety.** `initialize` unauthenticated; no kill-switch; immediate admin actions. → **Class A** (constructor, pause, timelock).
- **Client key at rest on weak wallets.** Plaintext `localStorage` fallback when the wallet can't sign messages. → **Class C** (passkey wrapping).

### NOT yet — built only as design specs (Class D), or not started

These are honestly out of scope for the hackathon build and exist (or will exist) as specs + interfaces + TODOs only:

- **Operator-blind matching** (encrypted mempool → MPC / TEE / FHE matching). Class C lands partials
  (commit-reveal, viewing keys); full blindness is **Class D**.
- **Match-completeness proof** — cryptographic guarantee the operator did not silently drop a crossable order. **Class D, spec-only.**
- **Permissionless settlement + bond / proof-of-innocence** — fallback path if the operator stalls or misbehaves. **Class D, spec-only.**
- **Decentralized / threshold matchers** removing single-operator authority. **Class D, spec-only.**
- **Recursive proof aggregation** for batches. **Class D, spec-only.**
- **Full multisig admin governance.** Timelock is Class A; threshold governance is **Class D**.
- **Unlinkable cancel** (cancel without revealing the member leaf). Today's leaf reveal is an intentional
  tradeoff; removing it is **Class D**.

---

## Execution order (so the demo never goes red)

Per CROSSED_V2_PLAN.md hard rules: v2 deploys to a **NEW** contract id; the live demo on
`CBGWGEP5…` keeps running until v2 is verified green, then `frontend/src/lib/config.ts` cuts over.
All new UI is gated behind `CONFIG.FEATURES` flags defaulting `false`.

1. **Class A** — contract + coordinator hardening (no circuit change). Ship + commit; demo stays green.
2. **Class B** — one batched circuit-v2 (order-v2 + dpmatch-v2 public signals/constraints) + one local
   trusted setup. Implement + local ceremony; deploy deferred to the verify step.
3. **Class C** — privacy depth (commit-reveal, viewing keys, passkey wrapping); implement feasible parts, document partials honestly.
4. **Class D** — write rigorous design specs + interfaces + TODOs only. Never claimed as built.
5. **Cutover** — build wasm → deploy new v2 contract → `configure_pair(1..6)` → copy `circuits/build`
   artifacts to `frontend/public/circuits` → flip `config.ts` → `node coordinator/dp_e2e.js` green → adversarial review.
