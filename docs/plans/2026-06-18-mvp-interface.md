# Crossed MVP — FE ↔ BE Interface Contract

Shared boundary so frontend (Claude) and backend (Codex) build in parallel. **Backend owns:** `circuits/match.circom`, `contracts/crossed/` (app contract), `relayer/`. **Frontend owns:** `frontend/`. Do not edit each other's dirs. Reuse (read-only): `circuits/like.circom`, `contracts/verifier/` (proven reference), `scripts/to_soroban.js`.

## Established facts (done, do not change)
- BN254 Groth16 verifies in Soroban. Encoding: G1=64B `be(x)‖be(y)`; G2=128B `be(x_c1)‖be(x_c0)‖be(y_c1)‖be(y_c0)`; Fr=32B BE. Proof type `{a:BytesN<64>, b:BytesN<128>, c:BytesN<64>}`.
- LIKE circuit done: public signals `[C_self, nf_self, epoch, root]`; artifacts in `circuits/build/like/` and `circuits/build/like_js/`.
- Domain seps: DOM_RDV=1, DOM_DIR=2, DOM_NF=3, DOM_NFKEY=4. Merkle depth=4 (MVP). Poseidon = circomlib/circomlibjs.

## Contract: `contracts/crossed/` (deploy to testnet)
Embeds the Groth16 verify logic (copy from `verifier`) with the LIKE and MATCH verifying keys baked in (export from the circuits' `verification_key.json`).

```
register(pk_x: BytesN<32>, pk_y: BytesN<32>, h_sk: BytesN<32>) -> u32
    // appends leaf = Poseidon(pk_x, pk_y, h_sk) to the depth-4 directory, updates root.
    // emits Registered { index: u32, leaf: BytesN<32>, root: BytesN<32> }

submit_like(proof, c: BytesN<32>, nf: BytesN<32>, epoch: u64, root: BytesN<32>) -> u64
    // verifies LIKE proof over publics [c, nf, epoch, root]; root must be an accepted root;
    // nf must be unused. stores record, marks nf. emits LikePosted { id: u64, c }

publish_match(proof, match_id: BytesN<32>, c_self: BytesN<32>, c_partner: BytesN<32>, epoch: u64, root: BytesN<32>)
    // verifies MATCH proof over publics [match_id, c_self, c_partner, epoch, root];
    // both records must exist; match_id unused. emits Match { match_id }

// views
get_root() -> BytesN<32>
get_leaves() -> Vec<BytesN<32>>          // for clients to rebuild the tree & paths
leaf_count() -> u32
is_nullifier_used(nf: BytesN<32>) -> bool
is_matched(match_id: BytesN<32>) -> bool
```
MVP simplifications allowed: skip Schnorr PoP on register; if on-chain Poseidon Merkle is impractical, maintain `root` by recomputing via the Poseidon host fn on register (depth 4 is tiny). Accept current + previous root.

## MATCH circuit `circuits/match.circom`
Reuses LIKE gadgets. Private: `sk_self, pk_partner_x, pk_partner_y, salt_self, salt_partner, H_sk_partner`, both Merkle paths. Public: `[match_id, C_self, C_partner, epoch, root]`. Proves: recompute `rdv`, `dir_self`, `dir_partner`; `C_self=Poseidon(rdv,dir_self,H_sk_self,salt_self)`; `C_partner=Poseidon(rdv,dir_partner,H_sk_partner,salt_partner)`; `match_id=Poseidon(rdv, salt_lo, salt_hi, DOM_MATCH)` (salts ordered deterministically, e.g. by numeric value); both Merkle memberships; prover holds sk_self. Emit artifacts to `circuits/build/match/` + a JS input helper.

## Relayer `relayer/` (Node + Express, localhost:8787, MVP)
No equality-test/lookup API (privacy). Endpoints:
```
POST /like   { token: hex, inbox: hex, envelope: b64, record_id: number }   -> 200
GET  /poll/:inbox   -> { matched: bool, counterpart?: { envelope: b64, record_id: number } }
```
Relayer groups submissions by `token`; on a 2nd submission with the same token, marks both inboxes matched and stores each other's envelope. In-memory store is fine for MVP.

## Backend deliverable
Write `backend/INTEGRATION.md` with: deployed crossed contract id (testnet), the exact arg JSON shapes for each fn, event names/topics, the MATCH circuit artifact paths, and how to run the relayer. The frontend reads this to wire up.
