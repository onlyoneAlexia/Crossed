pragma circom 2.0.0;

include "circomlib/circuits/babyjub.circom";
include "circomlib/circuits/escalarmulany.circom";
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

template CofactorClearNonIdentity() {
    signal input x;
    signal input y;
    signal output out_x;
    signal output out_y;

    component chk = BabyCheck();
    chk.x <== x;
    chk.y <== y;

    component dbl1 = BabyDbl();
    dbl1.x <== x;
    dbl1.y <== y;
    component dbl2 = BabyDbl();
    dbl2.x <== dbl1.xout;
    dbl2.y <== dbl1.yout;
    component dbl3 = BabyDbl();
    dbl3.x <== dbl2.xout;
    dbl3.y <== dbl2.yout;

    component is_x_zero = IsZero();
    is_x_zero.in <== dbl3.xout;
    component is_y_one = IsZero();
    is_y_one.in <== dbl3.yout - 1;
    is_x_zero.out * is_y_one.out === 0;

    out_x <== dbl3.xout;
    out_y <== dbl3.yout;
}

template Intent(depth) {
    var DOM_RDV    = 1;
    var DOM_DIR    = 2;
    var DOM_NF     = 3;
    var DOM_NFKEY  = 4;
    var DOM_TRADE  = 6;
    var DOM_COMMIT = 8;

    signal input sk_self;
    signal input pk_partner_x;
    signal input pk_partner_y;
    signal input salt_self;
    signal input H_sk_partner;
    signal input path_self_el[depth];
    signal input path_self_idx[depth];
    signal input path_partner_el[depth];
    signal input path_partner_idx[depth];

    signal input sell_asset_hi;
    signal input sell_asset_lo;
    signal input buy_asset_hi;
    signal input buy_asset_lo;
    signal input sell_amount;
    signal input buy_amount;
    signal input direction;
    signal input counterparty_pk_x;
    signal input counterparty_pk_y;
    signal input expiry;
    signal input nonce;

    signal input chain_id_hi;
    signal input chain_id_lo;
    signal input contract_id_hi;
    signal input contract_id_lo;
    signal input epoch;
    signal input root;

    signal output C;
    signal output nf;

    component sell_asset_hi_bits = Num2Bits(128);
    sell_asset_hi_bits.in <== sell_asset_hi;
    component sell_asset_lo_bits = Num2Bits(128);
    sell_asset_lo_bits.in <== sell_asset_lo;
    component buy_asset_hi_bits = Num2Bits(128);
    buy_asset_hi_bits.in <== buy_asset_hi;
    component buy_asset_lo_bits = Num2Bits(128);
    buy_asset_lo_bits.in <== buy_asset_lo;
    component chain_id_hi_bits = Num2Bits(128);
    chain_id_hi_bits.in <== chain_id_hi;
    component chain_id_lo_bits = Num2Bits(128);
    chain_id_lo_bits.in <== chain_id_lo;
    component contract_id_hi_bits = Num2Bits(128);
    contract_id_hi_bits.in <== contract_id_hi;
    component contract_id_lo_bits = Num2Bits(128);
    contract_id_lo_bits.in <== contract_id_lo;
    component sell_amount_bits = Num2Bits(127);
    sell_amount_bits.in <== sell_amount;
    component buy_amount_bits = Num2Bits(127);
    buy_amount_bits.in <== buy_amount;
    component sell_amount_nonzero = IsZero();
    sell_amount_nonzero.in <== sell_amount;
    sell_amount_nonzero.out === 0;
    component buy_amount_nonzero = IsZero();
    buy_amount_nonzero.in <== buy_amount;
    buy_amount_nonzero.out === 0;
    component epoch_bits = Num2Bits(64);
    epoch_bits.in <== epoch;
    component expiry_bits = Num2Bits(64);
    expiry_bits.in <== expiry;
    component nonce_bits = Num2Bits(128);
    nonce_bits.in <== nonce;
    direction * (direction - 1) === 0;

    component pk = BabyPbk();
    pk.in <== sk_self;

    component hsk = Poseidon(1);
    hsk.inputs[0] <== sk_self;
    component nfk = Poseidon(2);
    nfk.inputs[0] <== DOM_NFKEY;
    nfk.inputs[1] <== sk_self;

    component partner8 = CofactorClearNonIdentity();
    partner8.x <== pk_partner_x;
    partner8.y <== pk_partner_y;

    component skbits = Num2Bits(254);
    skbits.in <== sk_self;
    component ecdh = EscalarMulAny(254);
    for (var i = 0; i < 254; i++) {
        ecdh.e[i] <== skbits.out[i];
    }
    ecdh.p[0] <== partner8.out_x;
    ecdh.p[1] <== partner8.out_y;

    component psec = Poseidon(2);
    psec.inputs[0] <== ecdh.out[0];
    psec.inputs[1] <== ecdh.out[1];

    signal x_sum;
    signal x_prod;
    signal y_sum;
    signal y_prod;
    x_sum <== pk.Ax + pk_partner_x;
    x_prod <== pk.Ax * pk_partner_x;
    y_sum <== pk.Ay + pk_partner_y;
    y_prod <== pk.Ay * pk_partner_y;

    component rdv = Poseidon(11);
    rdv.inputs[0] <== DOM_RDV;
    rdv.inputs[1] <== psec.out;
    rdv.inputs[2] <== x_sum;
    rdv.inputs[3] <== x_prod;
    rdv.inputs[4] <== y_sum;
    rdv.inputs[5] <== y_prod;
    rdv.inputs[6] <== epoch;
    rdv.inputs[7] <== chain_id_hi;
    rdv.inputs[8] <== chain_id_lo;
    rdv.inputs[9] <== contract_id_hi;
    rdv.inputs[10] <== contract_id_lo;

    component dir = Poseidon(5);
    dir.inputs[0] <== DOM_DIR;
    dir.inputs[1] <== pk.Ax;
    dir.inputs[2] <== pk.Ay;
    dir.inputs[3] <== pk_partner_x;
    dir.inputs[4] <== pk_partner_y;

    counterparty_pk_x === pk_partner_x;
    counterparty_pk_y === pk_partner_y;

    component trade_left = Poseidon(9);
    trade_left.inputs[0] <== DOM_TRADE;
    trade_left.inputs[1] <== sell_asset_hi;
    trade_left.inputs[2] <== sell_asset_lo;
    trade_left.inputs[3] <== buy_asset_hi;
    trade_left.inputs[4] <== buy_asset_lo;
    trade_left.inputs[5] <== sell_amount;
    trade_left.inputs[6] <== buy_amount;
    trade_left.inputs[7] <== direction;
    trade_left.inputs[8] <== counterparty_pk_x;

    component trade_right = Poseidon(9);
    trade_right.inputs[0] <== DOM_TRADE;
    trade_right.inputs[1] <== counterparty_pk_y;
    trade_right.inputs[2] <== epoch;
    trade_right.inputs[3] <== expiry;
    trade_right.inputs[4] <== chain_id_hi;
    trade_right.inputs[5] <== chain_id_lo;
    trade_right.inputs[6] <== contract_id_hi;
    trade_right.inputs[7] <== contract_id_lo;
    trade_right.inputs[8] <== nonce;

    component trade_hash = Poseidon(3);
    trade_hash.inputs[0] <== DOM_TRADE;
    trade_hash.inputs[1] <== trade_left.out;
    trade_hash.inputs[2] <== trade_right.out;

    component cc = Poseidon(6);
    cc.inputs[0] <== DOM_COMMIT;
    cc.inputs[1] <== rdv.out;
    cc.inputs[2] <== dir.out;
    cc.inputs[3] <== hsk.out;
    cc.inputs[4] <== trade_hash.out;
    cc.inputs[5] <== salt_self;
    C <== cc.out;

    component nullifier = Poseidon(6);
    nullifier.inputs[0] <== DOM_NF;
    nullifier.inputs[1] <== nfk.out;
    nullifier.inputs[2] <== trade_hash.out;
    nullifier.inputs[3] <== epoch;
    nullifier.inputs[4] <== chain_id_hi;
    nullifier.inputs[5] <== contract_id_hi;
    nf <== nullifier.out;

    component lself = Poseidon(3);
    lself.inputs[0] <== pk.Ax;
    lself.inputs[1] <== pk.Ay;
    lself.inputs[2] <== hsk.out;
    component lpart = Poseidon(3);
    lpart.inputs[0] <== pk_partner_x;
    lpart.inputs[1] <== pk_partner_y;
    lpart.inputs[2] <== H_sk_partner;

    component mself = MerkleInclusion(depth);
    mself.leaf <== lself.out;
    mself.root <== root;
    for (var j = 0; j < depth; j++) {
        mself.pathElements[j] <== path_self_el[j];
        mself.pathIndices[j] <== path_self_idx[j];
    }

    component mpart = MerkleInclusion(depth);
    mpart.leaf <== lpart.out;
    mpart.root <== root;
    for (var k = 0; k < depth; k++) {
        mpart.pathElements[k] <== path_partner_el[k];
        mpart.pathIndices[k] <== path_partner_idx[k];
    }
}

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
