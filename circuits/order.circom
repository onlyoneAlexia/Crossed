pragma circom 2.0.0;

// Crossed dark pool — ORDER circuit (Phase 1).
// Proves: the order note is well-formed and its owner is a registered member, WITHOUT revealing
// side, size, or limit price. Open orders are fully opaque on-chain (only the commitment + a
// placement nullifier appear). Owner/fill are revealed only at settlement (see match.circom).
//
// Public signal vector (LOCKED): [ note, nf_order, pair_id, batch_id, root ]

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";
include "circomlib/circuits/comparators.circom";

template MerkleInclusion(depth) {
    signal input leaf;
    signal input root;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    component sw[depth];
    component h[depth];
    signal cur[depth + 1];
    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (pathIndices[i] - 1) === 0;
        sw[i] = Switcher();
        sw[i].sel <== pathIndices[i];
        sw[i].L <== cur[i];
        sw[i].R <== pathElements[i];
        h[i] = Poseidon(2);
        h[i].inputs[0] <== sw[i].outL;
        h[i].inputs[1] <== sw[i].outR;
        cur[i + 1] <== h[i].out;
    }
    root === cur[depth];
}

template Order(depth) {
    var DOM_ORDER = 9;   // order-note domain
    var DOM_NFORD = 10;  // order-placement-nullifier domain

    // ---- private ----
    signal input sk;            // baby-jubjub secret key of a registered member
    signal input side;          // 0 = SELL base, 1 = BUY base
    signal input size;          // u64 base size (atomic units)
    signal input limit_price;   // u64 price, scaled by PRICE_SCALE (1e7)
    signal input salt;          // note blinding
    signal input path_el[depth];
    signal input path_idx[depth];

    // ---- public ----
    signal input pair_id;       // small pair identifier (e.g. 1 = AAA/BBB)
    signal input batch_id;      // auction batch window
    signal input root;          // members merkle root

    // ---- public outputs ----
    signal output note;
    signal output nf_order;

    // ranges / well-formedness
    side * (side - 1) === 0;
    component size_bits = Num2Bits(64); size_bits.in <== size;
    component price_bits = Num2Bits(64); price_bits.in <== limit_price;
    component pair_bits = Num2Bits(32); pair_bits.in <== pair_id;
    component batch_bits = Num2Bits(64); batch_bits.in <== batch_id;
    component size_nz = IsZero(); size_nz.in <== size; size_nz.out === 0;
    component price_nz = IsZero(); price_nz.in <== limit_price; price_nz.out === 0;

    // identity: pk = sk*G, hsk = Poseidon(sk), leaf = Poseidon(pk.x, pk.y, hsk)
    component pk = BabyPbk();
    pk.in <== sk;
    component hsk = Poseidon(1);
    hsk.inputs[0] <== sk;
    component leafH = Poseidon(3);
    leafH.inputs[0] <== pk.Ax;
    leafH.inputs[1] <== pk.Ay;
    leafH.inputs[2] <== hsk.out;

    // membership of the owner's leaf in the on-chain directory
    component m = MerkleInclusion(depth);
    m.leaf <== leafH.out;
    m.root <== root;
    for (var i = 0; i < depth; i++) {
        m.pathElements[i] <== path_el[i];
        m.pathIndices[i] <== path_idx[i];
    }

    // note = Poseidon(DOM_ORDER, leaf, side, pair_id, size, limit_price, salt, batch_id)
    // batch_id is bound IN so a note is cryptographically scoped to its auction batch (Codex review #3).
    component noteH = Poseidon(8);
    noteH.inputs[0] <== DOM_ORDER;
    noteH.inputs[1] <== leafH.out;
    noteH.inputs[2] <== side;
    noteH.inputs[3] <== pair_id;
    noteH.inputs[4] <== size;
    noteH.inputs[5] <== limit_price;
    noteH.inputs[6] <== salt;
    noteH.inputs[7] <== batch_id;
    note <== noteH.out;

    // placement nullifier = Poseidon(DOM_NFORD, salt, note). The coordinator only receives
    // this per-order opening after the client has proven membership; long-lived sk never
    // leaves the browser.
    component nfo = Poseidon(3);
    nfo.inputs[0] <== DOM_NFORD;
    nfo.inputs[1] <== salt;
    nfo.inputs[2] <== noteH.out;
    nf_order <== nfo.out;
}

component main {
    public [ pair_id, batch_id, root ]
} = Order(4);
