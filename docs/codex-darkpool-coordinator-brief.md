# Codex task: dark-pool coordinator backend (Phase-1, honest-operator)

> Superseded on 2026-06-21 by the client-order-proof privacy hardening. Current `/dp/order`
> must not accept `sk`; see `docs/DEPLOYMENT.md`, `README.md`, and
> `docs/claude-ui-privacy-handoff.md` for the active API/trust model.

Implement the coordinator-side support for the LIVE dark-pool contract. The contract is already
deployed + initialized + configured on testnet (do NOT redeploy; you have no network anyway).
You CAN run the snarkjs prover offline (no network needed) to self-verify proofs.

## Ground truth (read these first)
- `circuits/smoke_darkpool.js` — WORKING prover: Poseidon/baby-jubjub/merkle(depth 4), exact witness
  layout, `note`/`nf_*`/`match_id` formulas, midpoint+quote math. REUSE this logic verbatim.
  Domains: DOM_NFKEY=4, DOM_ORDER=9, DOM_NFORD=10, DOM_NFSPEND=11, DOM_MATCH=5. SCALE=1e7. DEPTH=4.
  note = Poseidon([DOM_ORDER, leaf, side, pair_id, size, limit, salt, batch_id]).
  nf_order = Poseidon([DOM_NFORD, nfk, note]); nf_spend = Poseidon([DOM_NFSPEND, nfk, note]).
  leaf = Poseidon([pk.Ax, pk.Ay, Poseidon([sk])]); nfk = Poseidon([DOM_NFKEY, sk]).
  match_id = Poseidon([DOM_MATCH, note_sell, note_buy, pair_id, batch_id]).
  Build artifacts: `circuits/build/order/order_js/order.wasm`, `circuits/build/order/order_final.zkey`,
  `circuits/build/order/order_vk.json`; same under `circuits/build/dpmatch/`. snarkjs is at
  `frontend/node_modules/snarkjs` (smoke_darkpool.js already requires it by abs path).
- Proof->Soroban byte conversion (port to node, EXACT): see `frontend/src/lib/crypto.ts`:
  `be32(decStr)` = 32-byte big-endian hex of a decimal field string;
  g1(p)=be32(p[0])+be32(p[1]); g2(p)=be32(p[0][1])+be32(p[0][0])+be32(p[1][1])+be32(p[1][0]) (imaginary-first);
  toContractProof(proof)={a:g1(pi_a)(64B hex), b:g2(pi_b)(128B hex), c:g1(pi_c)(64B hex)}.
- Contract fns (already live; signatures in `contracts/crossed/src/lib.rs`):
  - `place_order(proof, note:BytesN32, nf_order:BytesN32, pair_id:u32, batch_id:u64, root:BytesN32)` — coordinator.require_auth.
  - `settle_dp_match(proof, match_id, note_sell, note_buy, nf_sell, nf_buy, leaf_sell, leaf_buy, base_amount:i128, quote_amount:i128, pair_id:u32, batch_id:u64, root)` — coordinator.require_auth; debits escrow, atomic swap.
  - `deposit(from, token, amount)` — from.require_auth (TRADER signs; NOT coordinator — FE handles deposit directly).
  - Public-signal ORDER vector: [note, nf_order, pair_id, batch_id, root].
  - Public-signal MATCH vector: [match_id, note_sell, note_buy, nf_sell, nf_buy, leaf_sell, leaf_buy, base_amount, quote_amount, pair_id, batch_id, root].
  BytesN32 args are big-endian field bytes (use be32 hex). The contract reconstructs the public
  signals from these args, so they MUST equal the prover's public signals exactly.
- `coordinator/chain.js` — existing invoke()/serialize/withSeqRetry; existing register/post_root/mint/settle.
  Dark-pool live ids in `docs/DEPLOYMENT.md`:
  DP_CONTRACT_ID=CDAHUONCBLL4K5LZHCUXV57533L425PI7DD2G6SQLSYBK2GKD267TAMS, pair_id=1,
  base(AAA, seller gives)=CAZ2G2KVLXUZOPCIF5VHB5NSC7PJDLJ57VCPDFZTJG7E46I2Y5JNJ32O,
  quote(BBB, buyer gives)=CC6EOFWKZODPBQ2SHGA4HSVI4RM6WRRO7B6ZHANKEWYB4HIJ765JCDEX.

## Trust model (Phase-1, documented & intentional)
Operator is TRUSTED to see order terms (NOT operator-blind). Traders submit their order witness
(incl. sk) to the coordinator over TLS; the coordinator builds BOTH the order proof and the match
proof. Privacy is from the CHAIN (only commitments on-chain) + no front-running within a sealed
batch. Add a clear comment saying so. (Future: in-browser order proving so sk stays local.)

## Deliverables
1. `coordinator/darkpool.js` (NEW): port smoke_darkpool.js crypto (buildPoseidon/buildBabyjub, merkle
   depth 4, pathOf). Export:
   - `async function buildDirectoryTree(registrations)` -> { leaves, levels, root, indexByLeaf }.
     registrations come from `chain.getRegistrations()` (array of {pk_x,pk_y,h_sk,leaf} decimal/hex).
     Pad to 2^4 leaves with 0n, leaf at its registration index. leaf recomputed = Poseidon([pk_x,pk_y,h_sk]).
   - `async function proveOrder({ sk, side, size, limit_price, salt, pair_id, batch_id, tree, leafIndex })`
     -> { proof:{a,b,c}, note, nf_order, root } (note/nf_order/root as be32 hex; pair_id u32, batch_id u64).
     Self-check with snarkjs.groth16.verify(order_vk,...).
   - `async function proveMatch({ sell, buy, pair_id, batch_id, tree })` where sell/buy each =
     { sk, size, limit_price, salt, leafIndex } -> { proof:{a,b,c}, match_id, note_sell, note_buy,
     nf_sell, nf_buy, leaf_sell, leaf_buy, base_amount, quote_amount } (hex/decimal as appropriate).
     cross=floor((limit_sell+limit_buy)/2); require limit_sell<=cross<=limit_buy and size_sell==size_buy;
     base_amount=size; quote_amount=floor(size*cross/SCALE). Self-check with dpmatch_vk.
   Mirror the EXACT matchInput/orderInput field names the circuits expect (copy from smoke_darkpool.js).
2. `coordinator/chain.js` (MODIFY, keep bilateral intact): add env DP_CONTRACT_ID (default the id above),
   DP_PAIR_ID (default 1). Add builders placeOrderArgs / settleDpMatchArgs (use existing bytes32ScVal/
   u32ScVal/u64ScVal/i128ScVal/proofScVal). Add methods:
   - `placeOrder({proof, note, nf_order, pair_id, batch_id, root})` -> invoke(DP_CONTRACT_ID,"place_order",...) (coordinator source-auth; default invoke branch).
   - `settleDpMatch(args)` -> invoke(DP_CONTRACT_ID,"settle_dp_match",...) (coordinator source-auth).
   - `dpEscrowBalance({owner, token})` and `isOrderOpen(note)` via simulate (like getRegistrations).
   Note BytesN32 args must be hex (bytes32ScVal expects hex). proof a/b/c already hex from darkpool.js.
3. `coordinator/matcher.js` (NEW): in-memory sealed-batch matcher.
   - state: currentBatchId (u64, start 1), orders[] = {owner, side, size, limit_price, salt, sk, leafIndex,
     note, nf_order, placed, filled, base_amount, quote_amount}.
   - `submitOrder(chain, directory, body)`: validate; ensure member registered (derive leaf from sk, find
     index via directory/registrations; if not registered -> error telling FE to register first);
     ensure root accepted (post_root current tree if needed, reuse directory.js/chain.postRoot);
     proveOrder; chain.placeOrder; push order. Return {note, nf_order, batch_id, tx}.
   - `closeBatch(chain, directory)`: pair the first crossing SELL(side0)+BUY(side1) with size_sell==size_buy
     and limit_sell<=limit_buy; proveMatch; chain.settleDpMatch; mark filled; advance batch id for new orders.
     Support multiple pairs in a batch if present. Return fills[].
   - `fillsFor(owner)`.
4. `coordinator/server.js` (MODIFY, keep existing routes): add
   - POST `/dp/order` -> matcher.submitOrder
   - POST `/dp/close` -> matcher.closeBatch (dev/admin trigger; also optional auto-close timer via env DP_BATCH_MS)
   - GET `/dp/batch` -> {batch_id, open_count}
   - GET `/dp/fills/:owner` -> fills
   Wire matcher into createApp (alongside directory/chain).
5. Tests: extend `coordinator/coordinator.test.js` or add `coordinator/darkpool.test.js` with a PURE-OFFLINE
   test: build a 2-member tree, proveOrder x2, proveMatch, and assert snarkjs verify passes + public signals
   line up (note==note_sell etc.) — mirror smoke_darkpool.js asserts. DO NOT call the chain in tests.

## Constraints
- Node ESM (match existing import style). No network calls in code paths you self-test.
- Keep all existing bilateral endpoints/behaviour working.
- Run `node coordinator/darkpool.test.js` (or `node --test`) yourself and confirm it passes before finishing.
- Report: files changed, the exact `/dp/order` request body shape, and the test output.
