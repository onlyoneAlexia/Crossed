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

template Match(depth) {
    var DOM_RDV    = 1;
    var DOM_DIR    = 2;
    var DOM_MATCH  = 5;
    var DOM_TRADE  = 6;
    var DOM_TERMS  = 7;
    var DOM_COMMIT = 8;

    signal input sk_self;
    signal input pk_partner_x;
    signal input pk_partner_y;
    signal input salt_self;
    signal input salt_partner;
    signal input H_sk_partner;
    signal input path_self_el[depth];
    signal input path_self_idx[depth];
    signal input path_partner_el[depth];
    signal input path_partner_idx[depth];

    signal input self_sell_asset_hi;
    signal input self_sell_asset_lo;
    signal input self_buy_asset_hi;
    signal input self_buy_asset_lo;
    signal input self_sell_amount;
    signal input self_buy_amount;
    signal input self_direction;
    signal input self_counterparty_pk_x;
    signal input self_counterparty_pk_y;
    signal input self_expiry;
    signal input self_nonce;

    signal input partner_sell_asset_hi;
    signal input partner_sell_asset_lo;
    signal input partner_buy_asset_hi;
    signal input partner_buy_asset_lo;
    signal input partner_sell_amount;
    signal input partner_buy_amount;
    signal input partner_direction;
    signal input partner_counterparty_pk_x;
    signal input partner_counterparty_pk_y;
    signal input partner_expiry;
    signal input partner_nonce;

    signal input chain_id_hi;
    signal input chain_id_lo;
    signal input contract_id_hi;
    signal input contract_id_lo;
    signal input epoch;
    signal input expiry;
    signal input root;

    signal output match_id;
    signal output C_self;
    signal output C_partner;
    signal output terms_hash;
    signal output a_sell_asset_hi;
    signal output a_sell_asset_lo;
    signal output a_buy_asset_hi;
    signal output a_buy_asset_lo;
    signal output a_sell_amount;
    signal output a_buy_amount;

    component self_sell_asset_hi_bits = Num2Bits(128);
    self_sell_asset_hi_bits.in <== self_sell_asset_hi;
    component self_sell_asset_lo_bits = Num2Bits(128);
    self_sell_asset_lo_bits.in <== self_sell_asset_lo;
    component self_buy_asset_hi_bits = Num2Bits(128);
    self_buy_asset_hi_bits.in <== self_buy_asset_hi;
    component self_buy_asset_lo_bits = Num2Bits(128);
    self_buy_asset_lo_bits.in <== self_buy_asset_lo;
    component partner_sell_asset_hi_bits = Num2Bits(128);
    partner_sell_asset_hi_bits.in <== partner_sell_asset_hi;
    component partner_sell_asset_lo_bits = Num2Bits(128);
    partner_sell_asset_lo_bits.in <== partner_sell_asset_lo;
    component partner_buy_asset_hi_bits = Num2Bits(128);
    partner_buy_asset_hi_bits.in <== partner_buy_asset_hi;
    component partner_buy_asset_lo_bits = Num2Bits(128);
    partner_buy_asset_lo_bits.in <== partner_buy_asset_lo;
    component chain_id_hi_bits = Num2Bits(128);
    chain_id_hi_bits.in <== chain_id_hi;
    component chain_id_lo_bits = Num2Bits(128);
    chain_id_lo_bits.in <== chain_id_lo;
    component contract_id_hi_bits = Num2Bits(128);
    contract_id_hi_bits.in <== contract_id_hi;
    component contract_id_lo_bits = Num2Bits(128);
    contract_id_lo_bits.in <== contract_id_lo;
    component self_sell_amount_bits = Num2Bits(127);
    self_sell_amount_bits.in <== self_sell_amount;
    component self_buy_amount_bits = Num2Bits(127);
    self_buy_amount_bits.in <== self_buy_amount;
    component partner_sell_amount_bits = Num2Bits(127);
    partner_sell_amount_bits.in <== partner_sell_amount;
    component partner_buy_amount_bits = Num2Bits(127);
    partner_buy_amount_bits.in <== partner_buy_amount;
    component self_sell_amount_nonzero = IsZero();
    self_sell_amount_nonzero.in <== self_sell_amount;
    self_sell_amount_nonzero.out === 0;
    component self_buy_amount_nonzero = IsZero();
    self_buy_amount_nonzero.in <== self_buy_amount;
    self_buy_amount_nonzero.out === 0;
    component partner_sell_amount_nonzero = IsZero();
    partner_sell_amount_nonzero.in <== partner_sell_amount;
    partner_sell_amount_nonzero.out === 0;
    component partner_buy_amount_nonzero = IsZero();
    partner_buy_amount_nonzero.in <== partner_buy_amount;
    partner_buy_amount_nonzero.out === 0;
    component epoch_bits = Num2Bits(64);
    epoch_bits.in <== epoch;
    component expiry_bits = Num2Bits(64);
    expiry_bits.in <== expiry;
    component self_expiry_bits = Num2Bits(64);
    self_expiry_bits.in <== self_expiry;
    component partner_expiry_bits = Num2Bits(64);
    partner_expiry_bits.in <== partner_expiry;
    component self_nonce_bits = Num2Bits(128);
    self_nonce_bits.in <== self_nonce;
    component partner_nonce_bits = Num2Bits(128);
    partner_nonce_bits.in <== partner_nonce;
    component salt_self_bits = Num2Bits(252);
    salt_self_bits.in <== salt_self;
    component salt_partner_bits = Num2Bits(252);
    salt_partner_bits.in <== salt_partner;
    self_direction * (self_direction - 1) === 0;
    partner_direction * (partner_direction - 1) === 0;

    self_direction + partner_direction === 1;
    self_expiry === expiry;
    partner_expiry === expiry;
    self_sell_asset_hi === partner_buy_asset_hi;
    self_sell_asset_lo === partner_buy_asset_lo;
    self_buy_asset_hi === partner_sell_asset_hi;
    self_buy_asset_lo === partner_sell_asset_lo;
    self_sell_amount === partner_buy_amount;
    self_buy_amount === partner_sell_amount;

    a_sell_asset_hi <== self_sell_asset_hi;
    a_sell_asset_lo <== self_sell_asset_lo;
    a_buy_asset_hi <== self_buy_asset_hi;
    a_buy_asset_lo <== self_buy_asset_lo;
    a_sell_amount <== self_sell_amount;
    a_buy_amount <== self_buy_amount;

    component pk = BabyPbk();
    pk.in <== sk_self;

    component hsk = Poseidon(1);
    hsk.inputs[0] <== sk_self;

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

    component dir_self = Poseidon(5);
    dir_self.inputs[0] <== DOM_DIR;
    dir_self.inputs[1] <== pk.Ax;
    dir_self.inputs[2] <== pk.Ay;
    dir_self.inputs[3] <== pk_partner_x;
    dir_self.inputs[4] <== pk_partner_y;

    component dir_partner = Poseidon(5);
    dir_partner.inputs[0] <== DOM_DIR;
    dir_partner.inputs[1] <== pk_partner_x;
    dir_partner.inputs[2] <== pk_partner_y;
    dir_partner.inputs[3] <== pk.Ax;
    dir_partner.inputs[4] <== pk.Ay;

    self_counterparty_pk_x === pk_partner_x;
    self_counterparty_pk_y === pk_partner_y;
    partner_counterparty_pk_x === pk.Ax;
    partner_counterparty_pk_y === pk.Ay;

    component self_trade_left = Poseidon(9);
    self_trade_left.inputs[0] <== DOM_TRADE;
    self_trade_left.inputs[1] <== self_sell_asset_hi;
    self_trade_left.inputs[2] <== self_sell_asset_lo;
    self_trade_left.inputs[3] <== self_buy_asset_hi;
    self_trade_left.inputs[4] <== self_buy_asset_lo;
    self_trade_left.inputs[5] <== self_sell_amount;
    self_trade_left.inputs[6] <== self_buy_amount;
    self_trade_left.inputs[7] <== self_direction;
    self_trade_left.inputs[8] <== self_counterparty_pk_x;

    component self_trade_right = Poseidon(9);
    self_trade_right.inputs[0] <== DOM_TRADE;
    self_trade_right.inputs[1] <== self_counterparty_pk_y;
    self_trade_right.inputs[2] <== epoch;
    self_trade_right.inputs[3] <== self_expiry;
    self_trade_right.inputs[4] <== chain_id_hi;
    self_trade_right.inputs[5] <== chain_id_lo;
    self_trade_right.inputs[6] <== contract_id_hi;
    self_trade_right.inputs[7] <== contract_id_lo;
    self_trade_right.inputs[8] <== self_nonce;

    component self_trade_hash = Poseidon(3);
    self_trade_hash.inputs[0] <== DOM_TRADE;
    self_trade_hash.inputs[1] <== self_trade_left.out;
    self_trade_hash.inputs[2] <== self_trade_right.out;

    component partner_trade_left = Poseidon(9);
    partner_trade_left.inputs[0] <== DOM_TRADE;
    partner_trade_left.inputs[1] <== partner_sell_asset_hi;
    partner_trade_left.inputs[2] <== partner_sell_asset_lo;
    partner_trade_left.inputs[3] <== partner_buy_asset_hi;
    partner_trade_left.inputs[4] <== partner_buy_asset_lo;
    partner_trade_left.inputs[5] <== partner_sell_amount;
    partner_trade_left.inputs[6] <== partner_buy_amount;
    partner_trade_left.inputs[7] <== partner_direction;
    partner_trade_left.inputs[8] <== partner_counterparty_pk_x;

    component partner_trade_right = Poseidon(9);
    partner_trade_right.inputs[0] <== DOM_TRADE;
    partner_trade_right.inputs[1] <== partner_counterparty_pk_y;
    partner_trade_right.inputs[2] <== epoch;
    partner_trade_right.inputs[3] <== partner_expiry;
    partner_trade_right.inputs[4] <== chain_id_hi;
    partner_trade_right.inputs[5] <== chain_id_lo;
    partner_trade_right.inputs[6] <== contract_id_hi;
    partner_trade_right.inputs[7] <== contract_id_lo;
    partner_trade_right.inputs[8] <== partner_nonce;

    component partner_trade_hash = Poseidon(3);
    partner_trade_hash.inputs[0] <== DOM_TRADE;
    partner_trade_hash.inputs[1] <== partner_trade_left.out;
    partner_trade_hash.inputs[2] <== partner_trade_right.out;

    component cc_self = Poseidon(6);
    cc_self.inputs[0] <== DOM_COMMIT;
    cc_self.inputs[1] <== rdv.out;
    cc_self.inputs[2] <== dir_self.out;
    cc_self.inputs[3] <== hsk.out;
    cc_self.inputs[4] <== self_trade_hash.out;
    cc_self.inputs[5] <== salt_self;
    C_self <== cc_self.out;

    component cc_partner = Poseidon(6);
    cc_partner.inputs[0] <== DOM_COMMIT;
    cc_partner.inputs[1] <== rdv.out;
    cc_partner.inputs[2] <== dir_partner.out;
    cc_partner.inputs[3] <== H_sk_partner;
    cc_partner.inputs[4] <== partner_trade_hash.out;
    cc_partner.inputs[5] <== salt_partner;
    C_partner <== cc_partner.out;

    signal self_leg0_asset_hi;
    signal self_leg0_asset_lo;
    signal self_leg0_amount;
    signal self_leg1_asset_hi;
    signal self_leg1_asset_lo;
    signal self_leg1_amount;
    self_leg0_asset_hi <== self_sell_asset_hi + self_direction * (self_buy_asset_hi - self_sell_asset_hi);
    self_leg0_asset_lo <== self_sell_asset_lo + self_direction * (self_buy_asset_lo - self_sell_asset_lo);
    self_leg0_amount <== self_sell_amount + self_direction * (self_buy_amount - self_sell_amount);
    self_leg1_asset_hi <== self_buy_asset_hi + self_direction * (self_sell_asset_hi - self_buy_asset_hi);
    self_leg1_asset_lo <== self_buy_asset_lo + self_direction * (self_sell_asset_lo - self_buy_asset_lo);
    self_leg1_amount <== self_buy_amount + self_direction * (self_sell_amount - self_buy_amount);

    signal partner_leg0_asset_hi;
    signal partner_leg0_asset_lo;
    signal partner_leg0_amount;
    signal partner_leg1_asset_hi;
    signal partner_leg1_asset_lo;
    signal partner_leg1_amount;
    partner_leg0_asset_hi <== partner_sell_asset_hi + partner_direction * (partner_buy_asset_hi - partner_sell_asset_hi);
    partner_leg0_asset_lo <== partner_sell_asset_lo + partner_direction * (partner_buy_asset_lo - partner_sell_asset_lo);
    partner_leg0_amount <== partner_sell_amount + partner_direction * (partner_buy_amount - partner_sell_amount);
    partner_leg1_asset_hi <== partner_buy_asset_hi + partner_direction * (partner_sell_asset_hi - partner_buy_asset_hi);
    partner_leg1_asset_lo <== partner_buy_asset_lo + partner_direction * (partner_sell_asset_lo - partner_buy_asset_lo);
    partner_leg1_amount <== partner_buy_amount + partner_direction * (partner_sell_amount - partner_buy_amount);

    component terms_self = Poseidon(13);
    terms_self.inputs[0] <== DOM_TERMS;
    terms_self.inputs[1] <== self_leg0_asset_hi;
    terms_self.inputs[2] <== self_leg0_asset_lo;
    terms_self.inputs[3] <== self_leg0_amount;
    terms_self.inputs[4] <== self_leg1_asset_hi;
    terms_self.inputs[5] <== self_leg1_asset_lo;
    terms_self.inputs[6] <== self_leg1_amount;
    terms_self.inputs[7] <== epoch;
    terms_self.inputs[8] <== expiry;
    terms_self.inputs[9] <== chain_id_hi;
    terms_self.inputs[10] <== chain_id_lo;
    terms_self.inputs[11] <== contract_id_hi;
    terms_self.inputs[12] <== contract_id_lo;

    component terms_partner = Poseidon(13);
    terms_partner.inputs[0] <== DOM_TERMS;
    terms_partner.inputs[1] <== partner_leg0_asset_hi;
    terms_partner.inputs[2] <== partner_leg0_asset_lo;
    terms_partner.inputs[3] <== partner_leg0_amount;
    terms_partner.inputs[4] <== partner_leg1_asset_hi;
    terms_partner.inputs[5] <== partner_leg1_asset_lo;
    terms_partner.inputs[6] <== partner_leg1_amount;
    terms_partner.inputs[7] <== epoch;
    terms_partner.inputs[8] <== expiry;
    terms_partner.inputs[9] <== chain_id_hi;
    terms_partner.inputs[10] <== chain_id_lo;
    terms_partner.inputs[11] <== contract_id_hi;
    terms_partner.inputs[12] <== contract_id_lo;
    terms_self.out === terms_partner.out;
    terms_hash <== terms_self.out;

    component salt_lt = LessThan(252);
    salt_lt.in[0] <== salt_self;
    salt_lt.in[1] <== salt_partner;
    component salt_order = Switcher();
    salt_order.sel <== 1 - salt_lt.out;
    salt_order.L <== salt_self;
    salt_order.R <== salt_partner;

    component mid = Poseidon(5);
    mid.inputs[0] <== DOM_MATCH;
    mid.inputs[1] <== rdv.out;
    mid.inputs[2] <== terms_self.out;
    mid.inputs[3] <== salt_order.outL;
    mid.inputs[4] <== salt_order.outR;
    match_id <== mid.out;

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
        expiry,
        root
    ]
} = Match(4);
