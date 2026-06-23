# Crossed OTC Backend Wiring Plan

**Goal:** pivot `Crossed` from private mutual-like matching into **private bilateral OTC settlement** on Stellar/Soroban: two known counterparties submit opaque exact-term intents; only a mutual compatible match reveals terms and atomically settles.

**Current Grounding**

The repo is currently a mutual-like MVP, not settlement:

- `circuits/like.circom` proves BabyJub ECDH rendezvous, directory membership, `C_self`, and private-key-bound `nf_self`, with only `epoch, root` public inputs and outputs `C_self, nf_self` ([circuits/like.circom](/home/mimi/Stellar%20hack/circuits/like.circom:42), [162](/home/mimi/Stellar%20hack/circuits/like.circom:162)).
- `circuits/match.circom` proves opposite-direction commitments share rendezvous and emits `match_id, C_self, C_partner`; it has no asset/amount/expiry/chain binding ([circuits/match.circom](/home/mimi/Stellar%20hack/circuits/match.circom:35), [185](/home/mimi/Stellar%20hack/circuits/match.circom:185)).
- `register` ignores `pk_x/pk_y` and stores `leaf = h_sk`; `post_root` is unauthenticated ([contracts/crossed/src/lib.rs](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:84), [102](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:102)).
- `submit_like` verifies public signals `[c, nf, epoch, root]` and marks the nullifier at submission ([contracts/crossed/src/lib.rs](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:108), [122](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:122)).
- `publish_match` only checks both commitments exist and verifies `[match_id, c_self, c_partner, epoch, root]`; it performs no settlement ([contracts/crossed/src/lib.rs](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:143), [167](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:167)).
- Relayer `/like` accepts arbitrary `{ token, inbox, envelope, record_id }`; `record_id` is not checked against chain, so it is a cheap probe oracle ([relayer/server.js](/home/mimi/Stellar%20hack/relayer/server.js:20), [relayer/store.js](/home/mimi/Stellar%20hack/relayer/store.js:5)).
- Envelope is only a non-empty base64 string, not encrypted ([relayer/store.js](/home/mimi/Stellar%20hack/relayer/store.js:9)).
- Current Groth16/Soroban serialization tooling is usable: G1/G2/Fr conversion lives in [scripts/to_soroban.js](/home/mimi/Stellar%20hack/scripts/to_soroban.js:1), and invoke JSON generation in [scripts/to_invoke.js](/home/mimi/Stellar%20hack/scripts/to_invoke.js:1).
- Current compiled sizes: LIKE = 17,009 constraints; MATCH = 18,732 constraints. Existing `pot15` is close but the OTC circuits should move to `ptau16`.

---

## 1. Trade Spec

Use this canonical per-party trade spec. It is private inside intent proofs and revealed only in settlement.

```text
TradeSpec {
  sell_asset: BytesN<32>,      // raw Soroban token/SAC contract id
  buy_asset: BytesN<32>,       // raw Soroban token/SAC contract id
  sell_amount: i128,           // must be > 0, in token base units
  buy_amount: i128,            // must be > 0, in token base units
  direction: u1,               // 0 or 1; opposite parties must sum to 1
  counterparty_pk_x: Fr,
  counterparty_pk_y: Fr,
  epoch: u64,
  expiry: u64,                 // ledger timestamp seconds
  chain_id: BytesN<32>,
  contract_id: BytesN<32>,
  nonce: u128                  // unique per same exact trade
}
```

In-circuit representation:

- `sell_asset` and `buy_asset`: split into `hi128, lo128`; each limb constrained with `Num2Bits(128)`.
- `chain_id` and `contract_id`: split into `hi128, lo128`; each limb constrained with `Num2Bits(128)`.
- `sell_amount`, `buy_amount`: field values constrained with `Num2Bits(127)` and `IsZero == 0`; on-chain converted to positive `i128`.
- `epoch`, `expiry`: field values constrained with `Num2Bits(64)`.
- `direction`: boolean constraint `direction * (direction - 1) === 0`.
- `nonce`: `Num2Bits(128)`.
- BabyJub coordinates remain BN254 field elements.

Canonical hash:

```text
trade_hash = Poseidon(17)(
  DOM_TRADE,
  sell_asset_hi, sell_asset_lo,
  buy_asset_hi, buy_asset_lo,
  sell_amount, buy_amount,
  direction,
  counterparty_pk_x, counterparty_pk_y,
  epoch, expiry,
  chain_id_hi, chain_id_lo,
  contract_id_hi, contract_id_lo,
  nonce
)
```

Domain constants:

```text
DOM_RDV = 1
DOM_DIR = 2
DOM_NF = 3
DOM_NFKEY = 4
DOM_MATCH = 5
DOM_TRADE = 6
DOM_TERMS = 7
DOM_COMMIT = 8
DOM_RELAY = 9
DOM_INBOX = 10
```

Canonical compatible-terms hash:

```text
terms_hash = Poseidon(13)(
  DOM_TERMS,
  leg0_asset_hi, leg0_asset_lo, leg0_amount,
  leg1_asset_hi, leg1_asset_lo, leg1_amount,
  epoch, expiry,
  chain_id_hi, chain_id_lo,
  contract_id_hi, contract_id_lo
)
```

`direction = 0` maps party sell leg to `leg0`; `direction = 1` maps party sell leg to `leg1`. This gives both counterparties the same `terms_hash` for reciprocal exact terms.

---

## 2. Circuits

Replace the “like” product language with intent/match.

### Files

Modify:

- `circuits/like.circom` -> either rename to `circuits/intent.circom` or keep file but rename template to `Intent`.
- `circuits/match.circom`
- `circuits/gen_like_input.js` -> `circuits/gen_intent_input.js`
- `circuits/gen_match_input.js`

Keep `MerkleInclusion(depth)` pattern from current circuits ([circuits/like.circom](/home/mimi/Stellar%20hack/circuits/like.circom:11), [circuits/match.circom](/home/mimi/Stellar%20hack/circuits/match.circom:10)).

### Intent Circuit

Template:

```circom
template Intent(depth)
component main {
  public [
    chain_id_hi,
    chain_id_lo,
    contract_id_hi,
    contract_id_lo,
    epoch,
    root
  ]
} = Intent(4);
```

Private inputs:

```text
sk_self
pk_partner_x
pk_partner_y
salt_self
H_sk_partner
path_self_el[depth]
path_self_idx[depth]
path_partner_el[depth]
path_partner_idx[depth]

sell_asset_hi
sell_asset_lo
buy_asset_hi
buy_asset_lo
sell_amount
buy_amount
direction
counterparty_pk_x
counterparty_pk_y
expiry
nonce
```

Public inputs:

```text
chain_id_hi
chain_id_lo
contract_id_hi
contract_id_lo
epoch
root
```

Public outputs, therefore first in `public.json`:

```text
C
nf
```

Verifier public signal order:

```text
[
  C,
  nf,
  chain_id_hi,
  chain_id_lo,
  contract_id_hi,
  contract_id_lo,
  epoch,
  root
]
```

Key constraints:

```text
pk_self = BabyPbk(sk_self)
H_sk_self = Poseidon(sk_self)
nf_key = Poseidon(DOM_NFKEY, sk_self)

BabyCheck(pk_partner_x, pk_partner_y)
partner8 = cofactor_clear_8(pk_partner)       // BabyDbl 3 times
partner8 != identity
ECDH = EscalarMulAny(sk_self_bits, partner8)

rdv = Poseidon(
  DOM_RDV,
  Poseidon(ECDH.x, ECDH.y),
  pk_x_sum, pk_x_product,
  pk_y_sum, pk_y_product,
  epoch,
  chain_id_hi, chain_id_lo,
  contract_id_hi, contract_id_lo
)

dir = Poseidon(DOM_DIR, pk_self_x, pk_self_y, pk_partner_x, pk_partner_y)

trade_hash = Poseidon(DOM_TRADE, ...)
C = Poseidon(DOM_COMMIT, rdv, dir, H_sk_self, trade_hash, salt_self)
nf = Poseidon(DOM_NF, nf_key, trade_hash, epoch, chain_id_hi, contract_id_hi)

leaf_self = Poseidon(pk_self_x, pk_self_y, H_sk_self)
leaf_partner = Poseidon(pk_partner_x, pk_partner_y, H_sk_partner)
both leaves must be in root
counterparty_pk_x/y == pk_partner_x/y
amounts > 0
direction boolean
limbs range checked
```

Important fix: `EscalarMulAny` explicitly assumes the input point is already in subgroup and nonzero ([circuits/node_modules/circomlib/circuits/escalarmulany.circom](/home/mimi/Stellar%20hack/circuits/node_modules/circomlib/circuits/escalarmulany.circom:129)). The new circuit must not feed raw `pk_partner` into it as current code does ([circuits/like.circom](/home/mimi/Stellar%20hack/circuits/like.circom:86)). Cofactor-clear the partner point first and reject identity.

Estimated size: current LIKE is 17,009 constraints. Add address/amount/range/trade hashing/cofactor checks. Target estimate: **22k-25k constraints**.

### Match Circuit

Private inputs:

```text
sk_self
pk_partner_x
pk_partner_y
salt_self
salt_partner
H_sk_partner
path_self_el[depth]
path_self_idx[depth]
path_partner_el[depth]
path_partner_idx[depth]

self_sell_asset_hi
self_sell_asset_lo
self_buy_asset_hi
self_buy_asset_lo
self_sell_amount
self_buy_amount
self_direction
self_counterparty_pk_x
self_counterparty_pk_y
self_expiry
self_nonce

partner_sell_asset_hi
partner_sell_asset_lo
partner_buy_asset_hi
partner_buy_asset_lo
partner_sell_amount
partner_buy_amount
partner_direction
partner_counterparty_pk_x
partner_counterparty_pk_y
partner_expiry
partner_nonce
```

Public inputs:

```text
chain_id_hi
chain_id_lo
contract_id_hi
contract_id_lo
epoch
expiry
root
```

Public outputs:

```text
match_id
C_self
C_partner
terms_hash
a_sell_asset_hi
a_sell_asset_lo
a_buy_asset_hi
a_buy_asset_lo
a_sell_amount
a_buy_amount
```

Verifier public signal order:

```text
[
  match_id,
  C_self,
  C_partner,
  terms_hash,
  a_sell_asset_hi,
  a_sell_asset_lo,
  a_buy_asset_hi,
  a_buy_asset_lo,
  a_sell_amount,
  a_buy_amount,
  chain_id_hi,
  chain_id_lo,
  contract_id_hi,
  contract_id_lo,
  epoch,
  expiry,
  root
]
```

Key constraints:

```text
self_direction + partner_direction === 1

self_sell_asset == partner_buy_asset
self_buy_asset == partner_sell_asset
self_sell_amount == partner_buy_amount
self_buy_amount == partner_sell_amount

self_expiry == expiry
partner_expiry == expiry
both epoch/chain/contract equal public values

self_counterparty_pk == pk_partner
partner_counterparty_pk == pk_self

C_self = Poseidon(DOM_COMMIT, rdv, dir_self, H_sk_self, self_trade_hash, salt_self)
C_partner = Poseidon(DOM_COMMIT, rdv, dir_partner, H_sk_partner, partner_trade_hash, salt_partner)

terms_hash_self == terms_hash_partner
terms_hash output equals canonical terms_hash

salt_self, salt_partner constrained to < 2^252
match_id = Poseidon(DOM_MATCH, rdv, terms_hash, salt_lo, salt_hi)

both directory memberships against root
cofactor-clear partner before ECDH
```

Estimated size: current MATCH is 18,732 constraints. Target estimate: **27k-32k constraints**. Use `ptau16`; do not risk `ptau15`.

### Trusted Setup / Artifacts

Commands to document and run from `circuits/`:

```bash
mkdir -p build/intent build/match

circom intent.circom --r1cs --wasm --sym -o build/intent
circom match.circom --r1cs --wasm --sym -o build/match

npx snarkjs r1cs info build/intent/intent.r1cs
npx snarkjs r1cs info build/match/match.r1cs

npx snarkjs powersoftau new bn128 16 build/pot16_0000.ptau -v
npx snarkjs powersoftau contribute build/pot16_0000.ptau build/pot16_0001.ptau --name="crossed otc dev" -v
npx snarkjs powersoftau prepare phase2 build/pot16_0001.ptau build/pot16_final.ptau -v

npx snarkjs groth16 setup build/intent/intent.r1cs build/pot16_final.ptau build/intent/intent_0000.zkey
npx snarkjs zkey contribute build/intent/intent_0000.zkey build/intent/intent_final.zkey --name="intent" -v
npx snarkjs zkey export verificationkey build/intent/intent_final.zkey build/intent/verification_key.json

npx snarkjs groth16 setup build/match/match.r1cs build/pot16_final.ptau build/match/match_0000.zkey
npx snarkjs zkey contribute build/match/match_0000.zkey build/match/match_final.zkey --name="match" -v
npx snarkjs zkey export verificationkey build/match/match_final.zkey build/match/verification_key.json
```

Bake VKs using the existing serializer:

```bash
node scripts/to_soroban.js circuits/build/intent contracts/crossed/src/fixtures_intent.rs
node scripts/to_soroban.js circuits/build/match contracts/crossed/src/fixtures_match.rs
```

---

## 3. Contract Plan

Modify [contracts/crossed/src/lib.rs](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:1). Keep the embedded Groth16 verifier pattern from `verify` ([contracts/crossed/src/lib.rs](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:210)).

### New Types

```rust
pub struct Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

pub struct IntentRecord {
    pub id: u64,
    pub owner: Address,
    pub c: BytesN<32>,
    pub nf: BytesN<32>,
    pub epoch: u64,
    pub root: BytesN<32>,
    pub submitted_ledger: u32,
    pub cancelled: bool,
    pub settled: bool,
}

pub struct Registration {
    pub index: u32,
    pub owner: Address,
    pub pk_x: BytesN<32>,
    pub pk_y: BytesN<32>,
    pub h_sk: BytesN<32>,
    pub leaf: BytesN<32>,
}

pub struct SettlementTerms {
    pub a_sell_asset: BytesN<32>,
    pub a_buy_asset: BytesN<32>,
    pub a_sell_amount: i128,
    pub a_buy_amount: i128,
}
```

### Storage Layout

```rust
enum DataKey {
    Admin,
    Coordinator,
    ChainId,
    ContractId,

    LeafCount,
    Leaf(u32),
    Registration(u32),
    RegistrationByLeaf(BytesN<32>),

    CurrentRoot,
    PreviousRoot,
    RootPosted(BytesN<32>),

    IntentCount,
    Intent(u64),
    IntentByC(BytesN<32>),

    SubmittedNullifier(BytesN<32>),
    SpentNullifier(BytesN<32>),

    Match(BytesN<32>),
}
```

Use instance storage for config and current counters. Use persistent storage for registrations, intents, nullifiers, and matches.

### Function Signatures

```rust
pub fn initialize(
    env: Env,
    admin: Address,
    coordinator: Address,
    chain_id: BytesN<32>,
    contract_id: BytesN<32>,
)

pub fn set_coordinator(env: Env, new_coordinator: Address)

pub fn register(
    env: Env,
    owner: Address,
    pk_x: BytesN<32>,
    pk_y: BytesN<32>,
    h_sk: BytesN<32>,
    leaf: BytesN<32>,
) -> u32

pub fn post_root(
    env: Env,
    root: BytesN<32>,
    leaf_count: u32,
    leaves_digest: BytesN<32>,
)

pub fn submit_intent(
    env: Env,
    owner: Address,
    proof: Proof,
    c: BytesN<32>,
    nf: BytesN<32>,
    epoch: u64,
    root: BytesN<32>,
) -> u64

pub fn cancel_intent(
    env: Env,
    owner: Address,
    intent_id: u64,
)

pub fn settle_match(
    env: Env,
    proof: Proof,
    match_id: BytesN<32>,
    c_a: BytesN<32>,
    c_b: BytesN<32>,
    terms_hash: BytesN<32>,
    a_sell_asset: BytesN<32>,
    a_buy_asset: BytesN<32>,
    a_sell_amount: i128,
    a_buy_amount: i128,
    epoch: u64,
    expiry: u64,
    root: BytesN<32>,
)
```

Views:

```rust
pub fn get_root(env: Env) -> BytesN<32>
pub fn get_previous_root(env: Env) -> BytesN<32>
pub fn leaf_count(env: Env) -> u32
pub fn get_registration(env: Env, index: u32) -> Registration
pub fn get_intent(env: Env, id: u64) -> IntentRecord
pub fn get_intent_by_c(env: Env, c: BytesN<32>) -> IntentRecord
pub fn is_submitted_nullifier(env: Env, nf: BytesN<32>) -> bool
pub fn is_spent_nullifier(env: Env, nf: BytesN<32>) -> bool
pub fn is_matched(env: Env, match_id: BytesN<32>) -> bool
```

### Root / Registration Choice

Use an authenticated coordinator-posted root for the 10-day MVP.

Reason: existing docs already note SDK 26 lacks a convenient circomlib-compatible Poseidon helper for on-chain Merkle recomputation ([docs/plans/2026-06-18-mvp-complete.md](/home/mimi/Stellar%20hack/docs/plans/2026-06-18-mvp-complete.md:28)). On-chain incremental Merkle is a stretch unless a compatible Poseidon hash is proven locally.

`register` must no longer store `h_sk` as leaf. It stores the coordinator-supplied real leaf:

```text
leaf = Poseidon(pk_x, pk_y, h_sk)
```

Hardening:

- `owner.require_auth()`
- stored `coordinator.require_auth()`
- coordinator must off-chain validate:
  - `leaf == Poseidon(pk_x, pk_y, h_sk)`
  - `pk` is valid BabyJub prime-subgroup or generated as `BabyPbk(sk)`
  - no duplicate leaf
- `post_root` also requires coordinator auth.

This makes coordinator trust explicit, but removes unauthenticated root injection and fake leaf insertion.

### Intent Submission

`submit_intent`:

1. `owner.require_auth()`.
2. Require accepted root: current or previous, preserving the current pattern ([contracts/crossed/src/lib.rs](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:298)).
3. Reject duplicate `SubmittedNullifier(nf)`.
4. Build public signal vector:

```text
[
  c,
  nf,
  chain_id_hi,
  chain_id_lo,
  contract_id_hi,
  contract_id_lo,
  epoch,
  root
]
```

5. Verify with `intent_vk`.
6. Store `IntentRecord`.
7. Store `IntentByC(c) = id`.
8. Mark `SubmittedNullifier(nf) = true`.
9. Emit `IntentSubmitted`.

### Settlement

Choose **dual-auth direct settlement**, not escrow-first.

Reason: escrow-first would require revealing asset/amount or locking opaque funds before match, weakening the “unmatched intent stays hidden” claim. Dual-auth keeps unmatched intents opaque and avoids custody, at the cost of liveness: after match, either party can refuse to sign settlement.

`settle_match` sequence:

1. Reject expired: `env.ledger().timestamp() <= expiry`.
2. Require `a_sell_amount > 0` and `a_buy_amount > 0`.
3. Require `match_id` unused.
4. Load `IntentRecord` for `c_a` and `c_b`.
5. Reject cancelled or already settled intents.
6. Require both records have matching `epoch` and `root`.
7. Reject `SpentNullifier(record_a.nf)` or `SpentNullifier(record_b.nf)`.
8. Build public signals in the match order above.
9. Verify `match_vk`.
10. Require both owners’ auth using `require_auth_for_args` over match id, commitments, assets, amounts, epoch, expiry.
11. Mark `Match(match_id) = true`.
12. Mark both `SpentNullifier(nf) = true`; mark both records settled.
13. Convert token IDs to token contract addresses:
    - `Address::from_contract_id(&a_sell_asset)`
    - `Address::from_contract_id(&a_buy_asset)`
14. Atomic transfers:
    - `TokenClient(a_sell_asset).transfer(&owner_a, &owner_b, &a_sell_amount)`
    - `TokenClient(a_buy_asset).transfer(&owner_b, &owner_a, &a_buy_amount)`
15. Emit `MatchSettled`.

Soroban transaction atomicity handles failure: if either token transfer fails because of underfunding, missing trustline, missing auth, or token error, all storage writes and the first transfer roll back.

`cancel_intent` is the abort path. It requires owner auth, marks the intent cancelled if not settled, and emits `IntentCancelled`. Since there is no escrow, no refund logic is needed.

### Events

```rust
Registered { index, owner, leaf }
RootPosted { root, leaf_count, leaves_digest }
IntentSubmitted { id, owner, c, nf, epoch, root }
IntentCancelled { id, owner }
MatchSettled {
  match_id,
  intent_a,
  intent_b,
  owner_a,
  owner_b,
  a_sell_asset,
  a_buy_asset,
  a_sell_amount,
  a_buy_amount,
  terms_hash
}
```

---

## 4. Security Fixes

1. **Relayer free probe oracle**
   - Fixed in `relayer/server.js` and `relayer/store.js`.
   - `/intent` must require a real on-chain `IntentSubmitted` receipt before accepting a relay token.
   - Store must reject unknown `record_id`, mismatched `c`, duplicate receipt, and missing finalized tx.

2. **Bad registration and unauthenticated roots**
   - Fixed in `contracts/crossed/src/lib.rs`.
   - `register` stores real `leaf = Poseidon(pk_x, pk_y, h_sk)`.
   - `post_root` requires coordinator auth.
   - Coordinator signs root updates and registrations.

3. **BabyJub subgroup issue**
   - Fixed in circuits by cofactor-clearing partner public key before ECDH and rejecting identity.
   - Also fixed operationally by coordinator off-chain subgroup validation before registration.
   - This addresses the current unsafe use of `EscalarMulAny`, which assumes subgroup input.

4. **Envelope not encrypted**
   - Fixed in relayer and FE-facing interface.
   - Envelope becomes AEAD ciphertext, not base64 salt.

5. **No chain/contract replay binding**
   - Fixed in both circuits.
   - `chain_id_hi/lo` and `contract_id_hi/lo` are public proof inputs supplied by contract storage, and are also inside `trade_hash`, `terms_hash`, `rdv`, and `nf`.

Residual trust:

- Coordinator can censor registrations, roots, and relay acceptance.
- Coordinator can see timing, receipt IDs, relay token equality, and inbox IDs.
- Coordinator cannot decrypt terms/envelopes or fabricate a settlement proof.
- Either counterparty can refuse dual-auth settlement after match.

---

## 5. Verifier Wiring

Current contract already embeds two VKs through fixture modules and helpers ([contracts/crossed/src/lib.rs](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:238), [249](/home/mimi/Stellar%20hack/contracts/crossed/src/lib.rs:249)).

Change modules:

```rust
mod fixtures_intent;
mod fixtures_match;
```

Helpers:

```rust
fn intent_vk(env: &Env) -> VerifyingKey
fn match_vk(env: &Env) -> VerifyingKey
```

Keep generic `verify(env, vk, proof, pub_signals)` unchanged.

Regenerate fixtures:

```bash
node scripts/to_soroban.js circuits/build/intent contracts/crossed/src/fixtures_intent.rs
node scripts/to_soroban.js circuits/build/match contracts/crossed/src/fixtures_match.rs
```

Regenerate test fixture proofs/public arrays from:

```text
circuits/build/intent/proof.json
circuits/build/intent/public.json
circuits/build/match/proof.json
circuits/build/match/public.json
```

---

## 6. Relayer Hardening

Modify:

- [relayer/server.js](/home/mimi/Stellar%20hack/relayer/server.js:1)
- [relayer/store.js](/home/mimi/Stellar%20hack/relayer/store.js:1)
- [relayer/store.test.js](/home/mimi/Stellar%20hack/relayer/store.test.js:1)

Endpoint replacement:

```http
POST /intent
```

Request:

```json
{
  "network": "testnet",
  "contract_id": "<C... or raw hex>",
  "tx_hash": "<stellar tx hash>",
  "record_id": 0,
  "c": "<hex32>",
  "token": "<hex32>",
  "inbox": "<hex32>",
  "envelope": {
    "v": 1,
    "alg": "AES-256-GCM",
    "nonce": "<base64url>",
    "ciphertext": "<base64url>",
    "tag": "<base64url>"
  }
}
```

Relayer validation:

1. Query Soroban RPC for `tx_hash`.
2. Require successful finalized transaction.
3. Require `IntentSubmitted` event from configured contract.
4. Require event `id == record_id` and `c == c`.
5. Optionally call `get_intent(record_id)` to confirm active, not cancelled, not settled.
6. Reject duplicate `record_id` or duplicate `c`.
7. Only then insert into rendezvous map by `token`.

AEAD key derivation:

```text
relay_key = HKDF-SHA256(
  ikm = rdv_field_be32,
  salt = chain_id || contract_id || epoch_be8,
  info = "CrossedOTC envelope v1"
)
```

AEAD AAD:

```text
chain_id || contract_id || record_id || c || token || inbox || epoch
```

Envelope plaintext:

```json
{
  "salt": "<field decimal or hex32>",
  "trade_spec": { "...": "partner private trade fields" },
  "h_sk": "<field>",
  "pk_x": "<field>",
  "pk_y": "<field>",
  "leaf_index": 0
}
```

Relayer learns:

- two submissions share a token,
- record IDs,
- timing,
- inbox IDs,
- configured chain/contract.

Relayer does not learn:

- assets,
- amounts,
- direction,
- expiry,
- nonce,
- salts,
- BabyJub private keys,
- match proof witness.

---

## 7. Testing Plan

### Rust Unit Tests

Modify [contracts/crossed/src/test.rs](/home/mimi/Stellar%20hack/contracts/crossed/src/test.rs:53).

Add tests:

```text
initialize_once
register_requires_owner_and_coordinator_auth
register_stores_real_leaf_not_h_sk
post_root_requires_coordinator
submit_intent_accepts_real_proof
submit_intent_rejects_wrong_root
submit_intent_rejects_wrong_chain_or_contract_publics
submit_intent_rejects_duplicate_nf
settle_match_accepts_real_proof_and_transfers_both_tokens
settle_match_rejects_wrong_terms
settle_match_rejects_tampered_match_id
settle_match_rejects_expired
settle_match_rejects_replay_same_match_id
settle_match_rejects_spent_nullifier
settle_match_rejects_cancelled_intent
settle_match_underfunded_aborts_without_spending
settle_match_requires_both_party_auth
```

Use `soroban_sdk::token` test token or SAC-compatible token client in testutils. Use `env.mock_auths` for the success path and missing-auth negative tests.

Run:

```bash
cargo test -p crossed
```

### Circuit Tests

Add scripts:

```bash
cd circuits
node gen_intent_input.js
node gen_match_input.js

npx snarkjs wtns calculate build/intent/intent_js/intent.wasm build/intent_input.json build/intent/intent.wtns
npx snarkjs groth16 prove build/intent/intent_final.zkey build/intent/intent.wtns build/intent/proof.json build/intent/public.json
npx snarkjs groth16 verify build/intent/verification_key.json build/intent/public.json build/intent/proof.json

npx snarkjs wtns calculate build/match/match_js/match.wasm build/match_input.json build/match/match.wtns
npx snarkjs groth16 prove build/match/match_final.zkey build/match/match.wtns build/match/proof.json build/match/public.json
npx snarkjs groth16 verify build/match/verification_key.json build/match/public.json build/match/proof.json
```

Negative circuit fixtures:

```text
wrong counterparty pk
same direction both sides
asset mismatch
amount mismatch
expiry mismatch
chain_id mismatch
contract_id mismatch
zero amount
partner small-subgroup / identity-cleared key
```

### Relayer Tests

Add tests:

```text
rejects submission without tx_hash
rejects unknown tx_hash
rejects event from wrong contract
rejects record_id/c mismatch
rejects duplicate record_id
does not match before receipt validation
cross-links only two validated receipts with same token
stores opaque AEAD envelope without decoding plaintext
```

Run:

```bash
cd relayer
npm test
```

### Testnet Smoke

1. Deploy contract.
2. Initialize with admin, coordinator, `chain_id`, `contract_id`.
3. Register Alice and Bob BabyJub keys.
4. Coordinator posts root.
5. Alice submits intent proof.
6. Bob submits reciprocal intent proof.
7. Both POST validated receipts to relayer.
8. Relayer returns encrypted counterpart envelope.
9. Build match proof.
10. Invoke `settle_match` with both auth signatures.
11. Verify:
    - both token balances changed exactly,
    - both nullifiers spent,
    - match id marked,
    - replay fails.

---

## 8. Deploy and FE Interface

Build:

```bash
cargo build --target wasm32v1-none --release -p crossed
```

Deploy:

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/crossed.wasm \
  --source crossed-deployer \
  --network testnet
```

Initialize:

```json
{
  "admin": "<G...>",
  "coordinator": "<G...>",
  "chain_id": "<hex32>",
  "contract_id": "<hex32 raw deployed contract id>"
}
```

Register:

```json
{
  "owner": "<G...>",
  "pk_x": "<hex32>",
  "pk_y": "<hex32>",
  "h_sk": "<hex32>",
  "leaf": "<hex32 Poseidon(pk_x,pk_y,h_sk)>"
}
```

Post root:

```json
{
  "root": "<hex32>",
  "leaf_count": 2,
  "leaves_digest": "<hex32>"
}
```

Submit intent:

```json
{
  "owner": "<G...>",
  "proof": { "a": "<hex64>", "b": "<hex128>", "c": "<hex64>" },
  "c": "<hex32>",
  "nf": "<hex32>",
  "epoch": 7,
  "root": "<hex32>"
}
```

Settle match:

```json
{
  "proof": { "a": "<hex64>", "b": "<hex128>", "c": "<hex64>" },
  "match_id": "<hex32>",
  "c_a": "<hex32>",
  "c_b": "<hex32>",
  "terms_hash": "<hex32>",
  "a_sell_asset": "<hex32 token contract id>",
  "a_buy_asset": "<hex32 token contract id>",
  "a_sell_amount": "10000000",
  "a_buy_amount": "25000000",
  "epoch": 7,
  "expiry": 1781740800,
  "root": "<hex32>"
}
```

Relayer POST:

```json
{
  "network": "testnet",
  "contract_id": "<hex32>",
  "tx_hash": "<tx hash>",
  "record_id": 0,
  "c": "<hex32>",
  "token": "<hex32>",
  "inbox": "<hex32>",
  "envelope": {
    "v": 1,
    "alg": "AES-256-GCM",
    "nonce": "<base64url>",
    "ciphertext": "<base64url>",
    "tag": "<base64url>"
  }
}
```

Relayer poll:

```json
{
  "matched": true,
  "counterpart": {
    "record_id": 1,
    "c": "<hex32>",
    "envelope": {
      "v": 1,
      "alg": "AES-256-GCM",
      "nonce": "<base64url>",
      "ciphertext": "<base64url>",
      "tag": "<base64url>"
    }
  }
}
```

---

## 9. Day-by-Day Sequence

**Day 1: circuit risk first**

- Implement OTC `Intent` and `Match` circuit shape.
- Add cofactor-clear partner key before ECDH.
- Add trade/terms hash constraints and public signal ordering.
- Generate witnesses only; confirm expected hashes in JS.

**Day 2: proof generation**

- Regenerate `ptau16`, zkeys, VKs.
- Run `snarkjs verify`.
- Update `gen_intent_input.js` and `gen_match_input.js`.
- Freeze public signal order in comments and docs.

**Day 3: contract config and verifier**

- Add `initialize`, config storage, `intent_vk`, `match_vk`.
- Bake `fixtures_intent.rs` and `fixtures_match.rs`.
- Add proof verification tests for both circuits.

**Day 4: registration and roots**

- Replace current `register` and `post_root`.
- Add coordinator/admin auth.
- Store real leaves and registration records.
- Add tests for fake leaves/root auth.

**Day 5: intent submission**

- Implement `submit_intent`, intent storage, submitted nullifiers.
- Add wrong-root, duplicate-nf, wrong-chain/contract tests.

**Day 6: settlement**

- Implement `settle_match`.
- Add token test setup and dual-auth transfer tests.
- Add replay, expired, wrong-terms, cancelled, underfunded tests.

**Day 7: relayer hardening**

- Replace `/like` with `/intent`.
- Add Soroban RPC receipt validation.
- Add AEAD envelope shape and duplicate defenses.
- Update relayer tests.

**Day 8: integration docs and scripts**

- Update `backend/INTEGRATION.md`.
- Add exact FE JSON shapes.
- Add deploy and smoke commands.
- Add fixture regeneration checklist.

**Day 9: local/testnet smoke**

- Deploy to testnet.
- Register two parties.
- Submit two intents.
- Relay validated receipts.
- Settle token swap.

**Day 10: cleanup and hardening pass**

- Verify event names and docs.
- Run all Rust, relayer, and circuit tests.
- Record known limitations and final contract ID.

---

## Cut List

Cut first if behind:

1. `leaves_digest` view/event support.
2. `get_registration` public detail view; keep only `get_leaves`.
3. `cancel_intent` before expiry; keep only post-expiry cancellation.
4. Previous-root acceptance; accept only current root.
5. Relayer profile directory.
6. Oracle/Reflector peg support.

Do not cut:

1. Chain/contract binding.
2. Coordinator auth on roots.
3. On-chain receipt requirement before relayer matching.
4. AEAD envelope.
5. Dual-auth atomic token transfer.
6. Replay/nullifier checks.
7. Exact asset/amount compatibility in match proof.

---

## Honest Claim

This ships as **private bilateral OTC settlement with a hardened, semi-trusted coordinator**.

It is not a dark pool, not price discovery, and not operator-free. Unmatched intents reveal only opaque on-chain commitments/nullifiers plus timing and submitter metadata. Exact trade terms and counterparties’ reciprocal terms are revealed only when both sides have submitted compatible intents and the match is settled. The coordinator can censor and observe matching metadata, but cannot decrypt envelopes, forge proofs, or move funds without both parties’ Soroban authorization.
