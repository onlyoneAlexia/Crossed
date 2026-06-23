pragma circom 2.0.0;

// Crossed dark pool — CANCEL_ORDER circuit.
// Proves: the caller knows the same hidden order opening and registered identity that created an
// opaque order note. Cancellation reveals the registered leaf for ownership enforcement, but keeps
// side, size, limit price, and salt private.
//
// Public signal vector (LOCKED): [ note, nf_cancel, leaf, pair_id, batch_id, root ]

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

template CancelOrder(depth) {
    var DOM_ORDER = 9;
    var DOM_NFCANCEL = 12;

    // ---- private ----
    signal input sk;
    signal input side;
    signal input size;
    signal input limit_price;
    signal input salt;
    signal input path_el[depth];
    signal input path_idx[depth];

    // ---- public ----
    signal input pair_id;
    signal input batch_id;
    signal input root;

    // ---- public outputs ----
    signal output note;
    signal output nf_cancel;
    signal output leaf;

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
    leaf <== leafH.out;

    // membership of the owner's leaf in the accepted member directory
    component m = MerkleInclusion(depth);
    m.leaf <== leafH.out;
    m.root <== root;
    for (var i = 0; i < depth; i++) {
        m.pathElements[i] <== path_el[i];
        m.pathIndices[i] <== path_idx[i];
    }

    // Recompute the opaque order note from the hidden opening.
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

    // Cancellation nullifier is separate from placement/settlement nullifiers.
    component nfc = Poseidon(3);
    nfc.inputs[0] <== DOM_NFCANCEL;
    nfc.inputs[1] <== salt;
    nfc.inputs[2] <== noteH.out;
    nf_cancel <== nfc.out;
}

component main {
    public [ pair_id, batch_id, root ]
} = CancelOrder(4);
