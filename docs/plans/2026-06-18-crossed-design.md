# Crossed — Design Doc

**Date:** 2026-06-18 · **Event:** Stellar Hacks: Real-World ZK (deadline 2026-06-29) · **Status:** design locked, adversarially verified (Claude 19-agent workflow + Codex cross-attack)

> **Crossed** is a consumer mutual-match / secret-crush app on Stellar. You privately flag interest in someone; a match is revealed **only if both like each other**. Until then, nobody — not the people you like, not other users, not our servers, not the chain — can tell who you like. Off-chain zero-knowledge proofs + elliptic-curve Diffie-Hellman; verification happens inside a Soroban smart contract.

---

## 1. Why this (and why it can win)

- **Off the official idea board** — DoraHacks' suggested ideas (reviews, proof-of-funds, age check, private payments, voting…) are an *anti-reference*; Crossed is none of them.
- **Genuinely novel ZK primitive** — mutual-match / private-set-intersection, not another membership+nullifier badge. Triple-converged across an independent research workflow, Codex, and manual brainstorm.
- **Cross-ecosystem viability** — the double-opt-in pattern is proven at consumer scale (Tinder/Hinge/Bumble, FB "Secret Crush", Gas); PSI underpins Apple/Google contact discovery. ZK is the trust upgrade.
- **The story lands in 90 seconds** — two phones light up *in sync* from two opaque on-chain blobs, then a "probe" tool provably fails to detect an unmatched like.
- **ZK is essential** — the privacy property (unmatched likes hidden even from the target) is impossible with plain hashing or a custodial server.

## 2. The honest privacy claim (no overclaim)

**Strength: COMPUTATIONAL** (CDH on baby-jubjub ≈128-bit + Poseidon as PRF/CRH + Groth16 soundness). We explicitly **do not** claim information-theoretic privacy.

| Adversary | Can they learn an unmatched like? |
|---|---|
| Any chain observer / full node | **No** — sees only uniformly-random salted commitments + private-key-bound nullifiers (indistinguishable from noise). |
| Any third party / targeted attacker who knows both handles+pubkeys but neither secret key | **No** — requires solving Diffie-Hellman on baby-jubjub. |
| The **relayer** (disclosed v1 trust point) | **No identities** — sees only opaque records; cannot decrypt envelopes or forge matches. Learns coarse metadata (mitigated; OPRF/PSI on roadmap). |
| The **target** of a like | **Only by reciprocating** — which posts their *own* logged like. There is no free, silent, offline "who likes me" scan. |

One-liner for judges: *"An unmatched like is hidden from the chain, from third parties, and from anyone who knows both identities but neither secret key; the only party who can learn it is the target, and only by liking back."*

## 3. Architecture

- **Client (React + TS PWA)** — the trust boundary. baby-jubjub keypair derived from a Freighter-signed seed; `sk` never leaves the device. circomlibjs/noble-curves for ECDH + Poseidon (must byte-match the circuit). snarkjs WASM in-browser for both proofs.
- **Relayer (Node, semi-trusted, disclosed)** — rendezvous point. Holds rdv-encrypted envelopes it cannot read; matches submitted likes; notifies both parties. **No equality-test / lookup API** (see §6.2). Never submits txs, never sees identities, cannot forge matches.
- **Soroban contract (on-chain root of trust)** — Merkle directory of registered keys; verifies both Groth16 circuits via BN254 host functions; stores opaque records, nullifiers, matches.
- **Circuits (Circom)** — `like.circom`, `match.circom`; Groth16 over BN254 with baby-jubjub embedded.
- **Indexer (read-only)** — lets a judge live-inspect the ledger and see only opaque blobs.

## 4. Protocol

### 4.1 Identity & registration
Each user `U` generates baby-jubjub `(sk_U, pk_U = sk_U·G)` in-browser. `register(addr, pk_U, pop_sig, H_skU)` where `H_skU = Poseidon(sk_U)`:
- verifies a Schnorr proof-of-possession of `sk_U`,
- binds `pk_U` to the Stellar address, rejects duplicate `pk`,
- appends leaf `Poseidon(pk_U, H_skU)` to an incremental Merkle directory and publishes the new root.
A signed `handle → pk` entry is served off-chain; clients pin & verify before liking.

### 4.2 Rendezvous secret (the crux)
For A→B: A computes `S = sk_A·pk_B` (= `sk_B·pk_A`). Then:
```
pair_secret = Poseidon(S.x, S.y)
rdv         = Poseidon(pair_secret, sorted(pk_A, pk_B), EPOCH, DOM_RDV)
```
`rdv` is symmetric (both derive it) but **uncomputable without one of the two secret keys** (CDH). Binding to the **sorted registered pair** (not the bare DH point) kills bilinearity/scaled-key forgery.

Direction labels (distinct ordered labels of the unordered pair → anti-self-match):
```
dir_self    = Poseidon(pk_self,    pk_partner, DOM_DIR)
dir_partner = Poseidon(pk_partner, pk_self,    DOM_DIR)
```

### 4.3 Phase 1 — `submit_like` (every like, authored & authenticated)
```
nf_key  = Poseidon(sk_self, DOM_NF_KEY)                      # liker-PRIVATE  (the critical fix)
C_self  = Poseidon(rdv, dir_self, H_skself, salt_self)       # salt_self = fresh random
nf_self = Poseidon(rdv, dir_self, nf_key, EPOCH, DOM_NF)     # NOT recomputable by the recipient
```
Client proves **Circuit 1 (LIKE)** and calls `submit_like(proof_L, C_self, nf_self, epoch, root)`. Contract verifies, rejects used `nf`, enforces a per-(identity,epoch) cap, charges a small refundable stake, stores `C_self` under an opaque id, marks `nf_self`. Off-chain, the client hands the relayer an envelope `Enc_{HKDF(rdv)}(salt_self, dir_self, on-chain id)`.

### 4.4 Matching (relayer learns no identities)
The relayer groups submissions by a rendezvous bucket *only after both sides exist*; on collision it forwards each party the other's encrypted envelope + "potential match." **It exposes no API to test whether a token exists** — so a recipient cannot probe it; the only way to test "does X like me" remains submitting a real, on-chain-logged like.

### 4.5 Phase 2 — `publish_match` (mutual-only reveal)
Either matched client decrypts the partner envelope with `rdv`, getting `(salt_partner, dir_partner, C_partner id)`, proves **Circuit 2 (MATCH)** and calls `publish_match(proof_M, match_id, id_self, id_partner, epoch, root)`.
```
match_id = Poseidon(rdv, salt_lo, salt_hi, DOM_MATCH)   # salts ordered by sorted(pk); only the two parties can compute it
```
Contract verifies, confirms both records exist for this epoch, `match_id` unused, stores + emits `Match(match_id, epoch)`, refunds both stakes.

**Why unforgeable:** publishing a match for {A,B} requires *both* `C_A` (bound to `sk_A`) and `C_B` (bound to `sk_B`) already on-chain, each having passed its own Like-proof (its own `sk` + directory membership). One actor cannot author the counterparty's authenticated record. The Match-proof is just a rendezvous certificate over two pre-authenticated records.

**Why no silent scan:** the chain holds only salted-random commitments + private-key-bound nullifiers. Even the target (who can derive `rdv`) cannot recognize a lone like without the per-like `salt`, shared only via the rdv-encrypted envelope that materializes only when they *also* like back.

## 5. Circuits

### Circuit 1 — LIKE
- **Private:** `sk_self`; `pk_partner(x,y)`; `salt_self`; `H_sk_partner`; Merkle paths+indices for self & partner leaves.
- **Public:** `C_self`, `nf_self`, `EPOCH`, `merkle_root`.
- **Constraints:** `pk_self = sk_self·G` (EscalarMulFix); `H_skself = Poseidon(sk_self)`; `nf_key = Poseidon(sk_self, DOM_NF_KEY)`; `S = sk_self·pk_partner` (EscalarMulAny); `pair_secret = Poseidon(S.x,S.y)`; sorted-pair `rdv`; `dir_self` (recomputed, never witnessed); `C_self`, `nf_self` equalities; Merkle membership of `leaf_self = Poseidon(pk_self,H_skself)` and `leaf_partner = Poseidon(pk_partner,H_sk_partner)`; **on-curve + prime-order subgroup + canonical-encoding checks** on `pk_partner` and `S`; bit-decomposition of `sk_self`.

### Circuit 2 — MATCH
- **Private:** `sk_self`; `pk_partner(x,y)`; `salt_self`, `salt_partner`; `H_sk_partner`; Merkle paths.
- **Public:** `match_id`, `C_self`, `C_partner`, `EPOCH`, `merkle_root`.
- **Constraints:** recompute `rdv`, `dir_self`, `dir_partner`; `H_skself = Poseidon(sk_self)`; `C_self = Poseidon(rdv,dir_self,H_skself,salt_self)`; `C_partner = Poseidon(rdv,dir_partner,H_sk_partner,salt_partner)`; `dir_self ≠ dir_partner` AND both are the two canonical labels of `sorted(pk_self,pk_partner)`; `match_id = Poseidon(rdv,salt_lo,salt_hi,DOM_MATCH)`; Merkle membership of both leaves; subgroup checks; prover holds `sk_self`.

**Complexity:** ~2 scalar muls (~2k) + ~6 Poseidons + 2 Merkle paths ⇒ **~6–10k R1CS/circuit**; browser Groth16 proving ~1–3s; each on-chain verify = one BN254 pairing check (constant cost).

## 6. Threat model & mitigations (from the cross-attack)

| # | Risk | Severity | Status / fix |
|---|---|---|---|
| 1 | **Recipient probes via nullifier** | Critical | **FIXED** — `nf` bound to private `nf_key = Poseidon(sk_self, …)`; never use public `H_sk`. |
| 2 | **Relayer equality-token = same probe** | Critical | **FIXED** — no lookup/equality-test API; probing costs a real on-chain like. OPRF/PSI on roadmap. |
| 3 | `match_id` enumerable by participants | Medium | **HARDENED** — `match_id` salted with both per-like salts. |
| 4 | Forced/forged match if Circuit-2 binding loose | Critical-if-missing | Circuit-2 binds both commitments to opposite canonical dirs + exact registered `H_sk`/leaves. |
| 5 | baby-jubjub subgroup/cofactor/non-canonical points | High | Reject identity & small-subgroup; canonical encodings; prime-order checks in registration + both circuits + client; shared KAT vectors. |
| 6 | Stale/attacker-chosen Merkle root or epoch | High | Contract enforces `root ∈ accepted_roots[epoch]`, epoch match, per-epoch nullifiers, both records same epoch. |
| 7 | Unconstrained public signals (Groth16 footgun) | Critical | Every public value recomputed+equality-constrained; `dir` recomputed; negative tests mutate each signal → must fail. |
| 8 | Relayer metadata / traffic analysis | High (privacy) | Batch+delay+mix by epoch, padded sizes, no identity-tied channels, decoys; disclosed. |
| 9 | Trusted setup (CRS) | Med | Perpetual Powers-of-Tau + per-circuit phase-2; publish transcript. |
| 10 | Directory/handle→key MITM | Med | PoP at registration, signed entries, client key-pinning; key-transparency log on roadmap. |
| 11 | Endpoint compromise (stolen sk) | Med (inherent) | Per-epoch scoping; forward-secure per-epoch keys on roadmap. |

## 7. Walkthrough script (90s)
1. **Setup (30s):** "Privately tell someone you're into them. If they're into you too, you both find out. If not, nobody ever knows." Three phones (Alice, Bob, Judge-probe) + projector showing a live ledger explorer.
2. **Secret likes (45s):** Alice likes Bob → "sealing your crush…" → a **random 32-byte blob** appears on the ledger. "That's the *entire* on-chain footprint — no name, no target, no direction." Bob's phone: nothing.
3. **Wow moment (30s):** Bob independently likes Alice → **both phones buzz in sync**: "It's a Crossed! 🎉" — the chain went from noise to a mutual match with zero leak in between.
4. **Adversary challenge (45s, wins SDF judges):** hand the judge the probe phone — "you know both handles & pubkeys; find out if Carol secretly likes Alice." Tool returns *"Computationally infeasible — requires breaking Diffie-Hellman."* Then state the honest limit aloud.

## 8. Stack & references
- **Circuits:** Circom + circomlib (EscalarMulFix/Any, Poseidon, Merkle), snarkjs, perpetual ptau.
- **On-chain:** Soroban, Rust, BN254 + Poseidon host functions (P25 X-Ray / P26). Verifier patterns: `stellar/soroban-examples/groth16_verifier`, Nethermind `stellar-private-payments`, `indextree/ultrahonk_soroban_contract`.
- **Skills:** `skills.stellar.org` ZK Proofs skill + `stellar/stellar-dev-skill` (installed for Claude Code + Codex).
- **Client:** React/TS PWA, Freighter, noble-curves/circomlibjs, Stellar JS SDK / Wallets Kit.

## 9. Roadmap (explicitly out of v1 scope — do not scope-creep)
Server-blind oblivious matching (OPRF/PSI) · key-transparency log · forward-secure per-epoch keys · post-quantum note.

## 10. What makes it lose
1. **Soroban Groth16 verify fails live** → de-risk Days 1–2 with a one-proof testnet spike + carry a pre-generated fallback proof.
2. **Overclaiming** ("information-theoretic" / "even the recipient can't tell") → a judge breaks it in one question. The precise claim is a *winning* trait.
3. **Hiding the relayer trust** → disclose it; concealment loses.
4. **baby-jubjub JS↔Circom mismatch** → silent no-match-ever; catch with KAT vectors before rehearsal.
5. **Scope creep** into roadmap items → a half-working core. Ship the sound, forgery-proof, leak-free core, running reliably.
6. **A live forged/forced match** → the two-proof design prevents it; the Circuit-2 binding + subgroup + signal-constraint checks are non-negotiable and tested.
