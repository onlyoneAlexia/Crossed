# Crossed OTC Backend Integration

## Deployment

Current testnet contract id: `CBXFJMEVB3QKKTLKVCWXQMNRZ2OKCBP4EX4KOZXFJ4TYEHBKCQUX5FN4`.

Last deploy attempt from this workspace:

```text
stellar contract deploy --wasm target/wasm32v1-none/release/crossed.wasm --source crossed-deployer --network testnet
Uploading contract WASM...
error: client error (Connect)

curl -I --max-time 10 https://soroban-testnet.stellar.org
curl: (6) Could not resolve host: soroban-testnet.stellar.org
```

Build:

```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
stellar contract build
```

Deploy:

```bash
stellar contract deploy \
  --wasm target/wasm32v1-none/release/crossed.wasm \
  --source crossed-deployer \
  --network testnet
```

Initialize after deploy with the real testnet network id and deployed contract id payload:

```json
{
  "admin": "<G...>",
  "coordinator": "<G...>",
  "chain_id": "<hex32 network id>",
  "contract_id": "<hex32 raw deployed C... contract id payload>"
}
```

The contract checks `chain_id == env.ledger().network_id()` and `contract_id == env.current_contract_address()` payload.

## Public Signal Orders

Intent verifier public signals:

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

Match verifier public signals:

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

For raw `BytesN<32>` IDs, `*_hi` is the first 16 bytes encoded as a 32-byte field element and `*_lo` is the last 16 bytes encoded as a 32-byte field element.

## Contract Arguments

All `BytesN<32>` values are 64-char hex strings. `Proof` is:

```json
{ "a": "<hex64>", "b": "<hex128>", "c": "<hex64>" }
```

`initialize(admin, coordinator, chain_id, contract_id)`

```json
{
  "admin": "<G...>",
  "coordinator": "<G...>",
  "chain_id": "<hex32>",
  "contract_id": "<hex32>"
}
```

`set_coordinator(new_coordinator)` requires admin auth.

```json
{ "new_coordinator": "<G...>" }
```

`register(owner, pk_x, pk_y, h_sk, leaf) -> u32` requires owner and coordinator auth.

```json
{
  "owner": "<G...>",
  "pk_x": "<hex32>",
  "pk_y": "<hex32>",
  "h_sk": "<hex32>",
  "leaf": "<hex32 Poseidon(pk_x,pk_y,h_sk)>"
}
```

`post_root(root, leaf_count, leaves_digest)` requires coordinator auth.

```json
{
  "root": "<hex32>",
  "leaf_count": 2,
  "leaves_digest": "<hex32>"
}
```

`submit_intent(owner, proof, c, nf, epoch, root) -> u64` requires owner auth.

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

`cancel_intent(owner, intent_id)` requires intent owner auth.

```json
{ "owner": "<G...>", "intent_id": 0 }
```

`settle_match(...)` requires both intent owners to authorize the same settlement args and performs both token transfers atomically.

```json
{
  "proof": { "a": "<hex64>", "b": "<hex128>", "c": "<hex64>" },
  "match_id": "<hex32>",
  "c_a": "<hex32>",
  "c_b": "<hex32>",
  "terms_hash": "<hex32>",
  "a_sell_asset": "<hex32 token contract id payload>",
  "a_buy_asset": "<hex32 token contract id payload>",
  "a_sell_amount": "10000000",
  "a_buy_amount": "25000000",
  "epoch": 7,
  "expiry": 1800000000,
  "root": "<hex32>"
}
```

Views:

```text
get_root() -> BytesN<32>
get_previous_root() -> BytesN<32>
leaf_count() -> u32
get_registration(index: u32) -> Registration
get_intent(id: u64) -> IntentRecord
get_intent_by_c(c: BytesN<32>) -> IntentRecord
is_submitted_nullifier(nf: BytesN<32>) -> bool
is_spent_nullifier(nf: BytesN<32>) -> bool
is_matched(match_id: BytesN<32>) -> bool
```

## Events

Topics:

```text
Registered
RootPosted
IntentSubmitted
IntentCancelled
MatchSettled
```

Event data shapes:

```json
{ "Registered": { "index": 0, "owner": "<G...>", "leaf": "<hex32>" } }
{ "RootPosted": { "root": "<hex32>", "leaf_count": 2, "leaves_digest": "<hex32>" } }
{ "IntentSubmitted": { "id": 0, "owner": "<G...>", "c": "<hex32>", "nf": "<hex32>", "epoch": 7, "root": "<hex32>" } }
{ "IntentCancelled": { "id": 0, "owner": "<G...>" } }
{ "MatchSettled": { "match_id": "<hex32>", "intent_a": 0, "intent_b": 1, "owner_a": "<G...>", "owner_b": "<G...>", "a_sell_asset": "<hex32>", "a_buy_asset": "<hex32>", "a_sell_amount": "10000000", "a_buy_amount": "25000000", "terms_hash": "<hex32>" } }
```

## Relayer

Run:

```bash
cd relayer
npm install
npm start
```

Default: `http://127.0.0.1:8787`.

Optional environment:

```bash
PORT=8787
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

`POST /intent` requires a successful finalized Soroban RPC transaction containing this contract's `IntentSubmitted` event matching `record_id` and `c`.

```json
{
  "network": "testnet",
  "contract_id": "<C... or hex32>",
  "tx_hash": "<64-char tx hash>",
  "record_id": 0,
  "c": "<hex32>",
  "token": "<hex32 rendezvous token>",
  "inbox": "<hex32 inbox id>",
  "envelope": {
    "v": 1,
    "alg": "AES-256-GCM",
    "nonce": "<base64url>",
    "ciphertext": "<base64url>",
    "tag": "<base64url>"
  }
}
```

`GET /poll/:inbox`

```json
{ "matched": false }
```

or:

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

Envelope key derivation expected on the client side:

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

The relayer stores only the opaque AES-256-GCM envelope and never decodes trade terms.

## Fixture Regeneration

Deterministic local OTC fixtures:

```bash
cd circuits
node gen_otc_inputs.js
npx snarkjs wtns calculate build/intent/intent_js/intent.wasm build/intent/intent_input.json build/intent/intent.wtns
npx snarkjs groth16 prove build/intent/intent_final.zkey build/intent/intent.wtns build/intent/intent_proof.json build/intent/intent_public.json
npx snarkjs wtns calculate build/intent/intent_js/intent.wasm build/intent_b/intent_input.json build/intent_b/intent_b.wtns
npx snarkjs groth16 prove build/intent/intent_final.zkey build/intent_b/intent_b.wtns build/intent_b/intent_b_proof.json build/intent_b/intent_b_public.json
cp build/intent/verification_key.json build/intent_b/verification_key.json
npx snarkjs wtns calculate build/match/match_js/match.wasm build/match/match_input.json build/match/match.wtns
npx snarkjs groth16 prove build/match/match_final.zkey build/match/match.wtns build/match/match_proof.json build/match/match_public.json
cd ..
node scripts/to_soroban.js circuits/build/intent contracts/crossed/src/fixtures_intent.rs
node scripts/to_soroban.js circuits/build/intent_b contracts/crossed/src/fixtures_intent_b.rs
node scripts/to_soroban.js circuits/build/match contracts/crossed/src/fixtures_match.rs
```

For testnet smoke, rerun `gen_otc_inputs.js` with:

```bash
CHAIN_ID_HEX=0x... CONTRACT_ID_HEX=0x... TOKEN_A_HEX=0x... TOKEN_B_HEX=0x... node gen_otc_inputs.js
```
