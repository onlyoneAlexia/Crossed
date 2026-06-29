// Public signal vector (LOCKED): [ match_id, note_sell, note_buy, nf_sell, nf_buy, leaf_sell, leaf_buy, fill_base, fill_quote, change_note_sell, change_note_buy, assigned_tier_sell, assigned_tier_buy, pair_id, batch_id, root ]
pragma circom 2.0.0;

// Crossed dark pool — MATCH circuit (v3, partial-fill change notes + assigned counterparty tiers).
// Proves two client-proved order openings cross, revealing executed-trade info, residual
// change-note commitments, and assigned counterparty tiers.
//
// Midpoint + fixed-point quote encoding follows v2:
//   sum = limit_sell + limit_buy ; sum = 2*cross + parity ; parity in {0,1}
//   limit_sell <= cross <= limit_buy
//   product = fill*cross ; product = quote_amount*PRICE_SCALE + rem ; 0 <= rem < PRICE_SCALE

include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";

// note = Poseidon(DOM_ORDER=9, leaf, side, pair_id, size, limit_price, salt, batch_id, expiry, maq, tier)
template OrderNote() {
    signal input leaf;
    signal input side;
    signal input pair_id;
    signal input size;
    signal input limit_price;
    signal input salt;
    signal input batch_id;
    signal input expiry;
    signal input maq;
    signal input tier;
    signal output note;
    component h = Poseidon(11);
    h.inputs[0] <== 9;       // DOM_ORDER
    h.inputs[1] <== leaf;
    h.inputs[2] <== side;
    h.inputs[3] <== pair_id;
    h.inputs[4] <== size;
    h.inputs[5] <== limit_price;
    h.inputs[6] <== salt;
    h.inputs[7] <== batch_id;
    h.inputs[8] <== expiry;
    h.inputs[9] <== maq;
    h.inputs[10] <== tier;
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
    signal input expiry_sell;
    signal input maq_sell;
    signal input tier_sell;
    // ---- private: BUY order ----
    signal input leaf_buy_w;
    signal input size_buy;
    signal input limit_buy;
    signal input salt_buy;
    signal input expiry_buy;
    signal input maq_buy;
    signal input tier_buy;
    // ---- private: clearing witness ----
    signal input fill_base_w;      // partial base fill
    signal input cross_price;      // midpoint, u64
    signal input parity;           // 0/1 floor bit of midpoint
    signal input quote_amount_w;   // floor(fill*cross/SCALE)
    signal input rem;              // remainder of the quote division
    signal input leaf_diff_inv;    // inverse witness for leaf_sell != leaf_buy
    signal input change_salt_sell;
    signal input change_salt_buy;
    signal input assigned_tier_sell_w;
    signal input assigned_tier_buy_w;

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
    signal output fill_base;
    signal output fill_quote;
    signal output change_note_sell;
    signal output change_note_buy;
    signal output assigned_tier_sell;
    signal output assigned_tier_buy;

    // range checks (sound comparators need bounded inputs)
    component size_sell_bits = Num2Bits(64); size_sell_bits.in <== size_sell;
    component size_buy_bits  = Num2Bits(64); size_buy_bits.in  <== size_buy;
    component limit_sell_bits = Num2Bits(64); limit_sell_bits.in <== limit_sell;
    component limit_buy_bits  = Num2Bits(64); limit_buy_bits.in  <== limit_buy;
    component fill_base_bits = Num2Bits(64); fill_base_bits.in <== fill_base_w;
    component cross_bits = Num2Bits(64); cross_bits.in <== cross_price;
    component rem_bits   = Num2Bits(64); rem_bits.in   <== rem;
    component quote_bits = Num2Bits(127); quote_bits.in <== quote_amount_w;
    component batch_bits = Num2Bits(64); batch_bits.in <== batch_id;
    component pair_bits  = Num2Bits(32); pair_bits.in  <== pair_id;
    component expiry_sell_bits = Num2Bits(64); expiry_sell_bits.in <== expiry_sell;
    component expiry_buy_bits = Num2Bits(64); expiry_buy_bits.in <== expiry_buy;
    component maq_sell_bits = Num2Bits(64); maq_sell_bits.in <== maq_sell;
    component maq_buy_bits = Num2Bits(64); maq_buy_bits.in <== maq_buy;
    component tier_sell_bits = Num2Bits(32); tier_sell_bits.in <== tier_sell;
    component tier_buy_bits = Num2Bits(32); tier_buy_bits.in <== tier_buy;
    component assigned_tier_sell_bits = Num2Bits(32); assigned_tier_sell_bits.in <== assigned_tier_sell_w;
    component assigned_tier_buy_bits = Num2Bits(32); assigned_tier_buy_bits.in <== assigned_tier_buy_w;

    // The order circuit already proved each note belongs to a registered member and the
    // contract requires both notes to be open. The match proof only consumes the one-time
    // openings needed to prove crossing, derive spend nullifiers, and commit residuals.
    leaf_sell <== leaf_sell_w;
    leaf_buy  <== leaf_buy_w;

    signal leaf_diff;
    leaf_diff <== leaf_sell_w - leaf_buy_w;
    leaf_diff * leaf_diff_inv === 1;

    // recompute the two notes (side fixed: sell=0, buy=1) -> binds opposite sides + same pair + same batch
    component nsell = OrderNote();
    nsell.leaf <== leaf_sell_w; nsell.side <== 0; nsell.pair_id <== pair_id;
    nsell.size <== size_sell; nsell.limit_price <== limit_sell; nsell.salt <== salt_sell; nsell.batch_id <== batch_id;
    nsell.expiry <== expiry_sell; nsell.maq <== maq_sell; nsell.tier <== tier_sell;
    note_sell <== nsell.note;
    component nbuy = OrderNote();
    nbuy.leaf <== leaf_buy_w; nbuy.side <== 1; nbuy.pair_id <== pair_id;
    nbuy.size <== size_buy; nbuy.limit_price <== limit_buy; nbuy.salt <== salt_buy; nbuy.batch_id <== batch_id;
    nbuy.expiry <== expiry_buy; nbuy.maq <== maq_buy; nbuy.tier <== tier_buy;
    note_buy <== nbuy.note;

    // spend nullifiers are scoped to the one-time order openings, not long-lived identity keys.
    component nfs = Poseidon(3);
    nfs.inputs[0] <== DOM_NFSPEND; nfs.inputs[1] <== salt_sell; nfs.inputs[2] <== note_sell;
    nf_sell <== nfs.out;
    component nfb = Poseidon(3);
    nfb.inputs[0] <== DOM_NFSPEND; nfb.inputs[1] <== salt_buy; nfb.inputs[2] <== note_buy;
    nf_buy <== nfb.out;

    // partial fill: nonzero, bounded by both orders, and at least each order's MAQ.
    fill_base <== fill_base_w;
    component fill_nz = IsZero(); fill_nz.in <== fill_base_w; fill_nz.out === 0;
    component fill_le_size_sell = LessEqThan(64); fill_le_size_sell.in[0] <== fill_base_w; fill_le_size_sell.in[1] <== size_sell; fill_le_size_sell.out === 1;
    component fill_le_size_buy = LessEqThan(64); fill_le_size_buy.in[0] <== fill_base_w; fill_le_size_buy.in[1] <== size_buy; fill_le_size_buy.out === 1;
    component fill_ge_maq_sell = LessEqThan(64); fill_ge_maq_sell.in[0] <== maq_sell; fill_ge_maq_sell.in[1] <== fill_base_w; fill_ge_maq_sell.out === 1;
    component fill_ge_maq_buy = LessEqThan(64); fill_ge_maq_buy.in[0] <== maq_buy; fill_ge_maq_buy.in[1] <== fill_base_w; fill_ge_maq_buy.out === 1;

    // Counterparty tier assignment: each order's required minimum tier must be met by its counterparty.
    assigned_tier_sell <== assigned_tier_sell_w;
    assigned_tier_buy <== assigned_tier_buy_w;
    component assigned_buy_ge_sell_req = GreaterEqThan(32);
    assigned_buy_ge_sell_req.in[0] <== assigned_tier_buy_w;
    assigned_buy_ge_sell_req.in[1] <== tier_sell;
    assigned_buy_ge_sell_req.out === 1;
    component assigned_sell_ge_buy_req = GreaterEqThan(32);
    assigned_sell_ge_buy_req.in[0] <== assigned_tier_sell_w;
    assigned_sell_ge_buy_req.in[1] <== tier_buy;
    assigned_sell_ge_buy_req.out === 1;

    // residual change notes. If residual is zero, expose zero; otherwise expose the v2 order-note hash.
    signal residual_sell;
    signal residual_buy;
    residual_sell <== size_sell - fill_base_w;
    residual_buy <== size_buy - fill_base_w;
    component residual_sell_bits = Num2Bits(64); residual_sell_bits.in <== residual_sell;
    component residual_buy_bits = Num2Bits(64); residual_buy_bits.in <== residual_buy;

    component residual_sell_zero = IsZero(); residual_sell_zero.in <== residual_sell;
    component residual_buy_zero = IsZero(); residual_buy_zero.in <== residual_buy;
    component residual_sell_ge_maq = GreaterEqThan(64);
    residual_sell_ge_maq.in[0] <== residual_sell;
    residual_sell_ge_maq.in[1] <== maq_sell;
    component residual_buy_ge_maq = GreaterEqThan(64);
    residual_buy_ge_maq.in[0] <== residual_buy;
    residual_buy_ge_maq.in[1] <== maq_buy;
    signal residual_sell_valid;
    signal residual_buy_valid;
    residual_sell_valid <== residual_sell_zero.out + residual_sell_ge_maq.out - residual_sell_zero.out * residual_sell_ge_maq.out;
    residual_buy_valid <== residual_buy_zero.out + residual_buy_ge_maq.out - residual_buy_zero.out * residual_buy_ge_maq.out;
    residual_sell_valid === 1;
    residual_buy_valid === 1;
    signal residual_sell_nonzero;
    signal residual_buy_nonzero;
    residual_sell_nonzero <== 1 - residual_sell_zero.out;
    residual_buy_nonzero <== 1 - residual_buy_zero.out;

    component csell = OrderNote();
    csell.leaf <== leaf_sell_w; csell.side <== 0; csell.pair_id <== pair_id;
    csell.size <== residual_sell; csell.limit_price <== limit_sell; csell.salt <== change_salt_sell; csell.batch_id <== batch_id;
    csell.expiry <== expiry_sell; csell.maq <== maq_sell; csell.tier <== tier_sell;
    change_note_sell <== residual_sell_nonzero * csell.note;
    component cbuy = OrderNote();
    cbuy.leaf <== leaf_buy_w; cbuy.side <== 1; cbuy.pair_id <== pair_id;
    cbuy.size <== residual_buy; cbuy.limit_price <== limit_buy; cbuy.salt <== change_salt_buy; cbuy.batch_id <== batch_id;
    cbuy.expiry <== expiry_buy; cbuy.maq <== maq_buy; cbuy.tier <== tier_buy;
    change_note_buy <== residual_buy_nonzero * cbuy.note;

    // midpoint: sum = 2*cross + parity (floor), parity bit
    parity * (parity - 1) === 0;
    limit_sell + limit_buy === 2 * cross_price + parity;

    // price compatibility: limit_sell <= cross <= limit_buy
    component le1 = LessEqThan(64); le1.in[0] <== limit_sell; le1.in[1] <== cross_price; le1.out === 1;
    component le2 = LessEqThan(64); le2.in[0] <== cross_price; le2.in[1] <== limit_buy; le2.out === 1;

    // quote = floor(fill*cross/SCALE):  fill*cross = quote*SCALE + rem ; 0 <= rem < SCALE
    signal product;
    product <== fill_base_w * cross_price;
    product === quote_amount_w * PRICE_SCALE + rem;
    component remlt = LessThan(64); remlt.in[0] <== rem; remlt.in[1] <== PRICE_SCALE; remlt.out === 1;
    component quote_nz = IsZero(); quote_nz.in <== quote_amount_w; quote_nz.out === 0;
    fill_quote <== quote_amount_w;

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
