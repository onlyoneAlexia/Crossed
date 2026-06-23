# Crossed → ZK Dark Pool — Phase 1 locked spec (2026-06-20)

Pivot from bilateral OTC to an anonymous-ish ZK dark pool. Decisions (user): more privacy (sealed batch),
partial fills (notes, Phase 2), midpoint clearing, escrow deposits. This doc LOCKS the Phase-1 design — above all
the Groth16 **public-signal layouts**, because changing public inputs after the contract/VK plumbing is wired is the
single biggest risk (Codex + workflow agree).

## Phase 1 scope (the working spine)
- ONE pair: BASE=AAA, QUOTE=BBB. Limit orders. **Full-fill only** (an order matches another in full or rests).
- **Sealed batch auction:** time in discrete batch windows (`batch_id`). Orders submitted during a window are sealed
  (terms encrypted to the operator, opened only at window close). Operator matches at close; uniform/**midpoint** price.
- **Escrow:** trader `deposit(token, amount)`; settlement releases from escrow → no live signature per fill.
- **ZK on-chain:** an `order` Groth16 proof (validity+membership+escrow) and a `match` Groth16 proof (two orders cross)
  verified inside Soroban; atomic SAC transfer from escrow. Satisfies the hackathon requirement.
- Privacy claim (honest): **order terms are hidden** (price/size sealed; chain sees only commitments) and the operator
  cannot front-run within a sealed batch. NOT yet: operator-blind matching (MPC) or unlinkable deposits (shielded pool).

## Integer encoding (lock)
- All amounts/prices are integers (Stellar 7-decimal atomic units). `size`, `limit_price`, `cross_price` are `u64`.
- Price scale `PRICE_SCALE = 10_000_000` (1.0 = 1e7). quote = floor(size * cross_price / PRICE_SCALE).
- Keep every product `< 2^128` (u64*u64) and range-check before comparisons. pairId is a small `u32` constant for AAA/BBB.

## Order NOTE model (designed now; partial fills in Phase 2)
An order is a NOTE so partial fills become "spend note → emit change note" later:
`note = Poseidon(DOM_ORDER, owner_field, side, pair_id, size, limit_price, salt)`
- `side`: 0 = SELL base (give AAA, want BBB), 1 = BUY base (give BBB, want AAA).
- `owner_field`: Poseidon(owner_sk) style binding (a private key the trader holds); used for the nullifier + escrow link.
- Phase 1: a note is fully consumed on match (one nullifier). Phase 2: emit a `change_note` for the remainder.

## ORDER circuit — `order.circom` (LOCKED, COMPILED ✓ — 6,517 constraints)
Open orders are FULLY OPAQUE on-chain: only the commitment + a placement nullifier appear; side/size/limit are hidden.
No give-token/amount is exposed (the earlier draft leaked side+size — dropped). Escrow is checked at SETTLE, not at
placement. Proves: note well-formed; owner is a registered member (depth-4 Merkle); ranges (side∈{0,1}, size/limit u64).
Private: sk, side, size, limit_price, salt, merkle path.
Identity (reused from intent.circom): pk = sk·G (BabyPbk), hsk = Poseidon1(sk), nfk = Poseidon(DOM_NFKEY=4, sk),
leaf = Poseidon(pk.Ax, pk.Ay, hsk).
`note = Poseidon(DOM_ORDER=9, leaf, side, pair_id, size, limit_price, salt)`
`nf_order = Poseidon(DOM_NFORD=10, nfk, note)`
Public signal vector (in snarkjs order = outputs then public inputs):
1. `note`     (field)
2. `nf_order` (field)
3. `pair_id`  (field, small)
4. `batch_id` (field, u64)
5. `root`     (field) — members merkle root

## MATCH circuit — `match.circom` (LOCKED public signals; pending Codex review of comparators)
Proves two opaque notes cross at the midpoint, revealing only executed-trade info (the two leaves → owners via the
on-chain Registration directory, and the fill amounts). Limits/sizes/cross_price stay hidden.
Constraints: recompute `note_sell`,`note_buy` from private (leaf, side, size, limit, salt); membership of both leaves;
`side_sell==0`, `side_buy==1`; same `pair_id`; `limit_sell <= cross_price <= limit_buy`;
`cross_price == floor((limit_sell+limit_buy)/2)`; full-fill `size_sell == size_buy == fill`;
`base_amount = fill`; `quote_amount = floor(fill*cross_price/PRICE_SCALE)`;
`nf_sell = Poseidon(DOM_NFSPEND=11, nfk_sell, note_sell)`, `nf_buy` likewise.
Private: both sides' sk/side/size/limit/salt + both merkle paths + cross_price.
Public signal vector:
1. `match_id`     (field) = Poseidon(DOM_MATCH=5, note_sell, note_buy, batch_id)
2. `note_sell`    (field)
3. `note_buy`     (field)
4. `nf_sell`      (field) — spend nullifier of the sell note
5. `nf_buy`       (field) — spend nullifier of the buy note
6. `leaf_sell`    (field) → contract maps to SELLER owner Address via RegistrationByLeaf
7. `leaf_buy`     (field) → contract maps to BUYER owner Address
8. `base_amount`  (field) = fill base (AAA) moved SELLER→BUYER
9. `quote_amount` (field) = quote (BBB) moved BUYER→SELLER
10. `pair_id`     (field)
11. `batch_id`    (field, u64)
12. `root`        (field)
Hidden: limits, sizes (equal in P1), cross_price.
NOTE: base/quote tokens are fixed by `pair_id` (contract maps pair_id→AAA/BBB), so they need not be public signals.

## Contract (Soroban) — changes (reuse Groth16 verify + atomic transfer + VK fixtures pipeline + Registration dir)
- `deposit(from, token, amount)` → escrow[(from,token)] += amount (from.require_auth + SAC transfer in). Public balances.
- `withdraw(owner, token, amount)` → owner.require_auth, escrow check, SAC transfer out.
- `place_order(proof, note, nf_order, pair_id, batch_id, root)` → verify ORDER Groth16; check root accepted; spend
  `nf_order` (reject dup); store `note` as OPEN for the batch. FULLY OPAQUE — no owner/side/size/price recorded or
  emitted, so open orders are unlinkable on-chain. (Operator submits + pays fee; trader's escrow funds the fill at settle.)
- `settle_match(proof, match_pubsignals)` → verify MATCH Groth16; both `note_sell`,`note_buy` must be OPEN + unspent;
  spend `nf_sell`,`nf_buy`; map `leaf_sell`/`leaf_buy` → owner Addresses via `RegistrationByLeaf` → `Registration.owner`;
  require escrow[seller][AAA] ≥ base_amount and escrow[buyer][BBB] ≥ quote_amount; debit escrow; SAC transfer base
  SELLER→BUYER and quote BUYER→SELLER from the contract; emit MatchSettled{leaf_sell, leaf_buy, base_amount, quote_amount}.
  No per-fill trader signature — the escrow deposit pre-authorized spending, and the ZK proof bounds it to a valid,
  price-compatible fill of the trader's own committed order.
- Griefing (order placed by an under-funded owner) is prevented OFF-CHAIN: the operator only matches orders whose owners
  have sufficient public escrow (it sees sealed terms at batch close). On-chain escrow check is the backstop.
- P1: one-shot full-fill (note fully consumed). Partial fills (P2): track remaining per note + change-note (UTXO).
- New VKs (order_vk, match_vk) baked as fixtures; **lock public-signal order above before generating VKs.**

## Coordinator = batch matching engine (evolve existing)
- `POST /order` { batch_id, note, sealed_terms (encrypted side/size/limit), order_proof, give_token, give_amount }.
  Coordinator submits `place_order` on-chain (it pays fees; escrow already funded by the trader's deposit).
- At batch close: decrypt sealed terms, run the book for the pair (price-time priority; cross compatible sell/buy at
  midpoint; full-fill pairs in P1), build `match` proof for each crossed pair, submit `settle_match`.
- Operator holds NO trader funds (escrow is in the contract); it can only submit valid proofs.

## FE (keep pixel/arcade theme)
- Replace "make a private offer to <desk>" with an **order ticket**: Side (Buy/Sell base), Size, Limit price. No counterparty.
- "Deposit" step (escrow AAA/BBB). "Your orders" (open/filled) + an anonymous "batch book depth" teaser (counts only).
- On batch close, show your fills (from MatchSettled / your records). Arcade timeline reframed to: Deposit → Seal order →
  Batch closes → Cross → Settle.

## Phasing (de-risked; working build each step)
- **P1 (days 1-4):** above — sealed batch, escrow, midpoint, full-fill, one pair, ZK order+match on-chain, live e2e of
  two strangers crossing. Bilateral system stays until P1 passes.
- **P2 (days 5-7):** partial fills via order-notes (spend + change note; held-bucket decrement; replay-safe match_id).
- **P3 (days 8-9, stretch):** shielded escrow pool (unlinkable deposits = full anonymity) + threshold/timelock decrypt
  (operator can't peek even at batch close). If time-boxed out → documented roadmap.

## Honest trust/privacy (UI/README)
"Crossed is a sealed-batch ZK dark pool. Your order's price and size are sealed during each batch and the chain only
ever stores commitments, so other traders and the public chain never see your terms, and the operator can't front-run
within a batch. The operator (a semi-trusted coordinator) does see terms at batch close to compute the match and can
never move your funds beyond a fill proven valid in zero-knowledge and pre-authorized by your escrow. Fully
operator-blind matching (MPC) and unlinkable deposits (a shielded pool) are on the roadmap."
