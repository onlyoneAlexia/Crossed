pragma circom 2.0.0;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/escalarmulany.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/switcher.circom";

// Poseidon Merkle inclusion proof. pathIndices[i] == 0 means the running node
// is the LEFT child at level i (sibling on the right), 1 means it is the RIGHT child.
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
        pathIndices[i] * (pathIndices[i] - 1) === 0; // boolean
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

// "Crossed" LIKE circuit.
// Proves: the prover holds sk_self for a registered key pk_self, the target
// pk_partner is registered, and the on-chain record C_self / nullifier nf_self
// are correctly derived from the ECDH rendezvous secret of {pk_self, pk_partner}.
// The nullifier is bound to a SECRET derived from sk_self so the recipient
// cannot recompute it to probe for unmatched likes.
template Like(depth) {
    var DOM_RDV   = 1;
    var DOM_DIR   = 2;
    var DOM_NF    = 3;
    var DOM_NFKEY = 4;

    // ---- private inputs ----
    signal input sk_self;
    signal input pk_partner_x;
    signal input pk_partner_y;
    signal input salt_self;
    signal input H_sk_partner;
    signal input path_self_el[depth];
    signal input path_self_idx[depth];
    signal input path_partner_el[depth];
    signal input path_partner_idx[depth];

    // ---- public inputs ----
    signal input epoch;
    signal input root;

    // ---- public outputs ----
    signal output C_self;
    signal output nf_self;

    // 1. pk_self = sk_self * BASE8
    component pk = BabyPbk();
    pk.in <== sk_self;

    // 2. H_sk_self = Poseidon(sk_self) ; nf_key = Poseidon(sk_self, DOM_NFKEY)
    component hsk = Poseidon(1);
    hsk.inputs[0] <== sk_self;
    component nfk = Poseidon(2);
    nfk.inputs[0] <== sk_self;
    nfk.inputs[1] <== DOM_NFKEY;

    // 3. partner key must be on-curve (subgroup guaranteed by registration + membership)
    component chk = BabyCheck();
    chk.x <== pk_partner_x;
    chk.y <== pk_partner_y;

    // 4. ECDH: S = sk_self * pk_partner
    component skbits = Num2Bits(254);
    skbits.in <== sk_self;
    component ecdh = EscalarMulAny(254);
    for (var i = 0; i < 254; i++) { ecdh.e[i] <== skbits.out[i]; }
    ecdh.p[0] <== pk_partner_x;
    ecdh.p[1] <== pk_partner_y;

    component psec = Poseidon(2);
    psec.inputs[0] <== ecdh.out[0];
    psec.inputs[1] <== ecdh.out[1];

    // 5. symmetric pair binding (sum/product => order-independent, no in-circuit sort)
    signal x_sum;  x_sum  <== pk.Ax + pk_partner_x;
    signal x_prod; x_prod <== pk.Ax * pk_partner_x;
    signal y_sum;  y_sum  <== pk.Ay + pk_partner_y;
    signal y_prod; y_prod <== pk.Ay * pk_partner_y;

    component rdv = Poseidon(7);
    rdv.inputs[0] <== psec.out;
    rdv.inputs[1] <== x_sum;
    rdv.inputs[2] <== x_prod;
    rdv.inputs[3] <== y_sum;
    rdv.inputs[4] <== y_prod;
    rdv.inputs[5] <== epoch;
    rdv.inputs[6] <== DOM_RDV;

    // 6. dir_self (asymmetric: encodes self -> partner)
    component dir = Poseidon(5);
    dir.inputs[0] <== pk.Ax;
    dir.inputs[1] <== pk.Ay;
    dir.inputs[2] <== pk_partner_x;
    dir.inputs[3] <== pk_partner_y;
    dir.inputs[4] <== DOM_DIR;

    // 7. C_self = Poseidon(rdv, dir, H_sk_self, salt_self)
    component cc = Poseidon(4);
    cc.inputs[0] <== rdv.out;
    cc.inputs[1] <== dir.out;
    cc.inputs[2] <== hsk.out;
    cc.inputs[3] <== salt_self;
    C_self <== cc.out;

    // 8. nf_self = Poseidon(rdv, dir, nf_key, epoch, DOM_NF)  (recipient cannot recompute)
    component nf = Poseidon(5);
    nf.inputs[0] <== rdv.out;
    nf.inputs[1] <== dir.out;
    nf.inputs[2] <== nfk.out;
    nf.inputs[3] <== epoch;
    nf.inputs[4] <== DOM_NF;
    nf_self <== nf.out;

    // 9. leaves
    component lself = Poseidon(3);
    lself.inputs[0] <== pk.Ax;
    lself.inputs[1] <== pk.Ay;
    lself.inputs[2] <== hsk.out;
    component lpart = Poseidon(3);
    lpart.inputs[0] <== pk_partner_x;
    lpart.inputs[1] <== pk_partner_y;
    lpart.inputs[2] <== H_sk_partner;

    // 10. Merkle membership of both keys against the published directory root
    component mself = MerkleInclusion(depth);
    mself.leaf <== lself.out;
    mself.root <== root;
    for (var i = 0; i < depth; i++) {
        mself.pathElements[i] <== path_self_el[i];
        mself.pathIndices[i]  <== path_self_idx[i];
    }
    component mpart = MerkleInclusion(depth);
    mpart.leaf <== lpart.out;
    mpart.root <== root;
    for (var i = 0; i < depth; i++) {
        mpart.pathElements[i] <== path_partner_el[i];
        mpart.pathIndices[i]  <== path_partner_idx[i];
    }
}

component main {public [epoch, root]} = Like(4);
