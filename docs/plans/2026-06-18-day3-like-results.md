# Day-3 LIKE Circuit — RESULT: ✅ SUCCESS

**Date:** 2026-06-18 · Goal: the real "Crossed" LIKE circuit (baby-jubjub ECDH rendezvous + Poseidon `C`/`nf` with the private-key-bound nullifier + Merkle membership), proving against the Day-1 generic verifier. Done.

## Outcome
- Circuit `circuits/like.circom` compiles: **~11,030 non-linear + 5,979 linear constraints**, 4 public signals `[C_self, nf_self, epoch, root]`.
- Witness generates; **JS↔circom parity confirmed** — circuit `C_self`/`nf_self` exactly equal the circomlibjs-computed values (retires the silent "no-match-ever" risk).
- snarkjs self-verify: OK.
- Native tests (`cargo test -p verifier`): `verifies_real_like_proof` ✅, `rejects_tampered_like_nullifier` ✅ (plus the two multiplier tests).
- **Live testnet** (same generic verifier `CDICWPWA47VIHI3QVAOQOEATJEIMFUKLXNRQQJS3GCCG7LGX2VAVTWLA`): `verify(LIKE proof)` → **true**, tampered nullifier → **false**.

## What the circuit proves (matches design §4–5)
1. `pk_self = sk_self·BASE8` (BabyPbk)
2. `H_sk_self = Poseidon(sk_self)`, `nf_key = Poseidon(sk_self, DOM_NFKEY)` — nullifier seed is **private** (recipient can't recompute → no silent probing)
3. `pk_partner` on-curve (BabyCheck); subgroup guaranteed by registration + Merkle membership
4. ECDH `S = sk_self·pk_partner`; `pair_secret = Poseidon(S.x, S.y)` (only the two parties can compute it)
5. `rdv = Poseidon(pair_secret, x_sum, x_prod, y_sum, y_prod, epoch, DOM_RDV)`
6. `dir_self = Poseidon(pk_self, pk_partner, DOM_DIR)` (asymmetric)
7. `C_self = Poseidon(rdv, dir_self, H_sk_self, salt_self)` (public output)
8. `nf_self = Poseidon(rdv, dir_self, nf_key, epoch, DOM_NF)` (public output)
9. Merkle membership of `leaf_self` and `leaf_partner` against `root` (depth 4 for the spike)

## Design refinement (recorded)
The design said `rdv` binds `sorted(pk_self, pk_partner)`. Sorting requires a 254-bit field comparison in-circuit, which is unsafe/costly near the field modulus. **Replaced with a symmetric (order-independent) binding**: `x_sum=x_s+x_p, x_prod=x_s·x_p, y_sum, y_prod`. Both parties compute the same `rdv` without sorting. Soundness: `rdv` is already fundamentally bound by `pair_secret` (the ECDH secret, computable only by the two parties); the sum/product add multiset binding. Equivalent guarantee, cheaper circuit.

## Artifacts
- `circuits/like.circom` (+ `MerkleInclusion`), `circuits/gen_like_input.js` (keys/ECDH/Merkle + parity check).
- `contracts/verifier/src/fixtures_like.rs`, `contracts/verifier/src/test_like.rs`.
- Reused unchanged: `scripts/to_soroban.js`, `scripts/to_invoke.js`, the generic `verifier` contract.

## Next (Day 4): MATCH circuit
Reuses the same gadgets to prove two opposite-direction records `C_self`/`C_partner` open to the same `rdv` (the reciprocity certificate), plus `match_id = Poseidon(rdv, salt_lo, salt_hi, DOM_MATCH)`. Then the contract (`register`/`submit_like`/`publish_match`) + relayer + UI. Depth-4 Merkle is a spike value; production depth (e.g. 20–32) is a parameter bump.
