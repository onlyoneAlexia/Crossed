pragma circom 2.0.0;

// Crossed dark pool — MATCH circuit (Phase 1, full-fill at midpoint).
// Proves two client-proved order openings cross, revealing ONLY executed-trade info: each party's
// leaf (the contract maps leaf -> owner Address via its Registration directory) and the fill
// amounts. Limits, sizes, and the crossing price stay hidden.
//
// Public signal vector (LOCKED):
//   [ match_id, note_sell, note_buy, nf_sell, nf_buy, leaf_sell, leaf_buy,
//     base_amount, quote_amount, pair_id, batch_id, root ]
//
// Midpoint + fixed-point quote encoding follows the Codex review:
//   sum = limit_sell + limit_buy ; sum = 2*cross + parity ; parity in {0,1}
//   limit_sell <= cross <= limit_buy
//   product = fill*cross ; product = quote_amount*PRICE_SCALE + rem ; 0 <= rem < PRICE_SCALE

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// note = Poseidon(DOM_ORDER=9, leaf, side, pair_id, size, limit_price, salt, batch_id)
template OrderNote() {
    signal input leaf;
    signal input side;
    signal input pair_id;
    signal input size;
    signal input limit_price;
    signal input salt;
    signal input batch_id;
    signal output note;
    component h = Poseidon(8);
    h.inputs[0] <== 9;       // DOM_ORDER
    h.inputs[1] <== leaf;
    h.inputs[2] <== side;
    h.inputs[3] <== pair_id;
    h.inputs[4] <== size;
    h.inputs[5] <== limit_price;
    h.inputs[6] <== salt;
    h.inputs[7] <== batch_id;
    note <== h.out;
}

template DpMatch() {
    var DOM_MATCH   = 5;
    var DOM_NFSPEND = 11;
    var PRICE_SCALE = 10000000;  // 1e7

    // ---- private: SELL order ----
    signal input leaf_sell_w;
    signal input size_sell;
    signal input limit_sell;
    signal input salt_sell;
    // ---- private: BUY order ----
    signal input leaf_buy_w;
    signal input size_buy;
    signal input limit_buy;
    signal input salt_buy;
    // ---- private: clearing witness ----
    signal input cross_price;    // midpoint, u64
    signal input parity;         // 0/1 floor bit of midpoint
    signal input quote_amount_w; // floor(fill*cross/SCALE)
    signal input rem;            // remainder of the quote division

    // ---- public inputs ----
    signal input pair_id;
    signal input batch_id;
    signal input root;

    // ---- public outputs ----
    signal output match_id;
    signal output note_sell;
    signal output note_buy;
    signal output nf_sell;
    signal output nf_buy;
    signal output leaf_sell;
    signal output leaf_buy;
    signal output base_amount;
    signal output quote_amount;

    // range checks (sound comparators need bounded inputs)
    component size_sell_bits = Num2Bits(64); size_sell_bits.in <== size_sell;
    component size_buy_bits  = Num2Bits(64); size_buy_bits.in  <== size_buy;
    component limit_sell_bits = Num2Bits(64); limit_sell_bits.in <== limit_sell;
    component limit_buy_bits  = Num2Bits(64); limit_buy_bits.in  <== limit_buy;
    component cross_bits = Num2Bits(64); cross_bits.in <== cross_price;
    component rem_bits   = Num2Bits(64); rem_bits.in   <== rem;
    component quote_bits = Num2Bits(127); quote_bits.in <== quote_amount_w;
    component batch_bits = Num2Bits(64); batch_bits.in <== batch_id;
    component pair_bits  = Num2Bits(32); pair_bits.in  <== pair_id;

    // The order circuit already proved each note belongs to a registered member and the
    // contract requires both notes to be open. The match proof only consumes the one-time
    // openings needed to prove crossing and derive spend nullifiers.
    leaf_sell <== leaf_sell_w;
    leaf_buy  <== leaf_buy_w;

    // recompute the two notes (side fixed: sell=0, buy=1) -> binds opposite sides + same pair + same batch
    component nsell = OrderNote();
    nsell.leaf <== leaf_sell_w; nsell.side <== 0; nsell.pair_id <== pair_id;
    nsell.size <== size_sell; nsell.limit_price <== limit_sell; nsell.salt <== salt_sell; nsell.batch_id <== batch_id;
    note_sell <== nsell.note;
    component nbuy = OrderNote();
    nbuy.leaf <== leaf_buy_w; nbuy.side <== 1; nbuy.pair_id <== pair_id;
    nbuy.size <== size_buy; nbuy.limit_price <== limit_buy; nbuy.salt <== salt_buy; nbuy.batch_id <== batch_id;
    note_buy <== nbuy.note;

    // spend nullifiers are scoped to the one-time order openings, not long-lived identity keys.
    component nfs = Poseidon(3);
    nfs.inputs[0] <== DOM_NFSPEND; nfs.inputs[1] <== salt_sell; nfs.inputs[2] <== note_sell;
    nf_sell <== nfs.out;
    component nfb = Poseidon(3);
    nfb.inputs[0] <== DOM_NFSPEND; nfb.inputs[1] <== salt_buy; nfb.inputs[2] <== note_buy;
    nf_buy <== nfb.out;

    // full fill: equal sizes, nonzero
    size_sell === size_buy;
    component fill_nz = IsZero(); fill_nz.in <== size_sell; fill_nz.out === 0;
    base_amount <== size_sell;

    // midpoint: sum = 2*cross + parity (floor), parity bit
    parity * (parity - 1) === 0;
    limit_sell + limit_buy === 2 * cross_price + parity;

    // price compatibility: limit_sell <= cross <= limit_buy
    component le1 = LessEqThan(64); le1.in[0] <== limit_sell; le1.in[1] <== cross_price; le1.out === 1;
    component le2 = LessEqThan(64); le2.in[0] <== cross_price; le2.in[1] <== limit_buy; le2.out === 1;

    // quote = floor(fill*cross/SCALE):  fill*cross = quote*SCALE + rem ; 0 <= rem < SCALE
    signal product;
    product <== base_amount * cross_price;
    product === quote_amount_w * PRICE_SCALE + rem;
    component remlt = LessThan(64); remlt.in[0] <== rem; remlt.in[1] <== PRICE_SCALE; remlt.out === 1;
    component quote_nz = IsZero(); quote_nz.in <== quote_amount_w; quote_nz.out === 0;
    quote_amount <== quote_amount_w;

    // match id (binds both notes + pair + batch + accepted root)
    component mid = Poseidon(6);
    mid.inputs[0] <== DOM_MATCH;
    mid.inputs[1] <== note_sell;
    mid.inputs[2] <== note_buy;
    mid.inputs[3] <== pair_id;
    mid.inputs[4] <== batch_id;
    mid.inputs[5] <== root;
    match_id <== mid.out;
}

component main {
    public [ pair_id, batch_id, root ]
} = DpMatch();
