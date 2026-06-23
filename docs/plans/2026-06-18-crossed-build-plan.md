# Crossed — 11-Day Build Plan

**Window:** 2026-06-18 → 2026-06-29 (submission). Solo, ZK-strong, Soroban-new. Companion to [crossed-design.md](2026-06-18-crossed-design.md).

## Guiding rules
- **Critical path first:** the Soroban Groth16 verifier is the single thing that kills the project. Prove ONE proof verifies on testnet (Day 1–2) before building anything else.
- **Parity vectors are sacred:** baby-jubjub ECDH + Poseidon must byte-match across JS, Circom, and Soroban. Ship known-answer test (KAT) vectors early; a mismatch = silent "no match ever."
- **Build the sound core, not the roadmap.** OPRF/PSI, key-transparency, forward secrecy = explicitly out of scope.
- **Every day ends green:** something runs/tests pass. Keep a pre-generated fallback proof for the stage.

## Day-by-day

| Day | Goal | Done when |
|---|---|---|
| **1** | **Verifier spike (highest risk).** Rust/soroban-cli/testnet up; run an existing BN254 Groth16 verifier example (or `circom2soroban`) end-to-end; verify ONE hand-made snarkjs proof on testnet. | A real testnet tx verifies a Groth16 proof. Nothing else until this is green. |
| **2** | **Lock serialization.** Nail snarkjs→Soroban vk/proof encoding (field endianness, G2 layout). Wrap the BN254 verifier as a reusable module + committed KAT proof + on-chain verify test. | Reusable verify module + passing KAT; serialization documented. |
| **3** | **Circuit 1 — LIKE.** baby-jubjub keygen, EscalarMulFix/Any ECDH, Poseidon `rdv/C/nf` (with private `nf_key`), Merkle membership, on-curve+subgroup+canonical checks. Local witness+proof. | Like proof verifies locally; JS↔Circom KAT vectors for ECDH/Poseidon/rdv/C/nf match exactly. |
| **4** | **Circuit 2 — MATCH** (reuses Like gadgets) + both phase-2 trusted setups from perpetual ptau. Verify BOTH vks on Soroban testnet. | Both proofs verify on testnet; `match_id` salted; dir-opposite + H_sk binding enforced. |
| **5** | **Contract core.** `register()` (Schnorr PoP + address binding + dup-pk reject + incremental Merkle root); storage layout; `submit_like` (proof verify, nullifier, per-epoch cap, refundable stake). | A like lands on-chain as an opaque record; double-like rejected. |
| **6** | **Contract match + lifecycle.** `publish_match` (idempotent per `match_id`, both-records-exist, refund), `is_matched`, `advance_epoch` + TTL `prune`, `accepted_roots[epoch]`. Unit tests incl. **forgery attempts** (one-party double-submit must NOT match). | Full register→like→like→match passes in contract tests; forgery tests fail to forge. |
| **7** | **Client crypto.** baby-jubjub keys from Freighter-signed seed; ECDH/Poseidon/`rdv/C/nf`; `HKDF(rdv)` envelope encrypt/decrypt; in-browser snarkjs proving for both circuits; verify against KAT vectors. | Browser produces both proofs; cross-client parity confirmed. |
| **8** | **Relayer + first e2e match.** Node service: encrypted-envelope intake, internal rendezvous grouping (NO lookup API), batch+delay, match notify/forward. Wire `submit_like` + `publish_match` to testnet. | First real A↔B match end-to-end on testnet. |
| **9** | **UI (2–3 screens) + adversary tool.** register, browse/like, match notification + "sealing your crush" proving animation; live ledger explorer page; built-in **probe tool that demonstrably fails**. | A non-dev can run the happy path; probe tool returns "infeasible." |
| **10** | **Harden + honesty layer.** Fee/stake + TTL GC paths; write the precise privacy claim into the app; pre-generate fallback proofs; record backup walkthrough video; relayer batching/decoys/timing. | All threat-model fixes (§6) present; backup video recorded. |
| **11** | **Buffer + rehearsal.** Three-phone on-stage rehearsal ×3 on fresh browser+accounts; confirm fallbacks; rehearse adversary challenge + honest-boundary statement; freeze build; finalize README + submission (repo + walkthrough video). | Full flow runs cold start ×3; repo + video submitted on DoraHacks. |

## Non-negotiable checks before "done" (from cross-attack)
- [ ] `nf = Poseidon(rdv, dir, Poseidon(sk,DOM_NF_KEY), epoch, DOM_NF)` — recipient **cannot** recompute.
- [ ] Relayer exposes **no** equality-test/lookup API.
- [ ] Every public signal recomputed + equality-constrained in-circuit; `dir` recomputed not witnessed; negative tests mutate each signal → must fail.
- [ ] Prime-order subgroup + canonical-encoding checks on every `pk` and `S`, in registration + both circuits + client.
- [ ] Contract enforces `root ∈ accepted_roots[epoch]`, epoch match, per-epoch nullifiers, both match-records same epoch.
- [ ] Circuit-2 binds both commitments to opposite canonical directions + exact registered `H_sk`/leaves.
- [ ] One pre-generated fallback proof on the presenting machine.

## Slip plan (if behind)
- Drop UI polish to one screen before dropping any §6 security check.
- Acceptable MVP simplification (from Codex): if in-circuit Merkle proves too slow, store registered commitments publicly and have the contract check registration by lookup — **but** keep the liker-anonymity property (don't expose who liked) and re-confirm no new probe is opened.
- Never drop: verifier spike, the two-proof unforgeability, the nullifier fix, the no-lookup relayer.
