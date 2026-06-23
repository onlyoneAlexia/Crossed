#!/usr/bin/env node
// Generate witness inputs for like.circom: two baby-jubjub identities, a depth-4
// Poseidon Merkle directory containing both, and all private inputs. Also computes
// the expected public outputs (C_self, nf_self) to confirm JS<->circom parity.
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const crypto = require("crypto");
const fs = require("fs");

const DEPTH = 4;
const DOM_RDV = 1n, DOM_DIR = 2n, DOM_NF = 3n, DOM_NFKEY = 4n;

function randBelow(max) {
  while (true) {
    const x = BigInt("0x" + crypto.randomBytes(32).toString("hex"));
    if (x < max) return x;
  }
}

(async () => {
  const babyJub = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (arr) => F.toObject(poseidon(arr));            // Poseidon -> BigInt
  const Fadd = (a, b) => F.toObject(F.add(F.e(a), F.e(b)));
  const Fmul = (a, b) => F.toObject(F.mul(F.e(a), F.e(b)));
  const l = babyJub.subOrder;

  const sk_self = randBelow(l);
  const sk_partner = randBelow(l);

  const pkSpt = babyJub.mulPointEscalar(babyJub.Base8, sk_self);
  const pkPpt = babyJub.mulPointEscalar(babyJub.Base8, sk_partner);
  const pkS_x = babyJub.F.toObject(pkSpt[0]), pkS_y = babyJub.F.toObject(pkSpt[1]);
  const pkP_x = babyJub.F.toObject(pkPpt[0]), pkP_y = babyJub.F.toObject(pkPpt[1]);

  const Hsk_self = H([sk_self]);
  const Hsk_partner = H([sk_partner]);
  const leaf_self = H([pkS_x, pkS_y, Hsk_self]);
  const leaf_partner = H([pkP_x, pkP_y, Hsk_partner]);

  // depth-4 Merkle tree (16 leaves), node = Poseidon(left,right)
  const n = 1 << DEPTH;
  const leaves = new Array(n).fill(0n);
  const idxSelf = 3, idxPartner = 10;
  leaves[idxSelf] = leaf_self;
  leaves[idxPartner] = leaf_partner;
  const levels = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const lv = levels[levels.length - 1], next = [];
    for (let i = 0; i < lv.length; i += 2) next.push(H([lv[i], lv[i + 1]]));
    levels.push(next);
  }
  const root = levels[levels.length - 1][0];
  const pathOf = (idx) => {
    const el = [], id = [];
    let i = idx;
    for (let d = 0; d < DEPTH; d++) { el.push(levels[d][i ^ 1]); id.push(BigInt(i & 1)); i >>= 1; }
    return { el, id };
  };
  const ps = pathOf(idxSelf), pp = pathOf(idxPartner);

  const salt_self = randBelow(l);
  const epoch = 7n;

  const input = {
    sk_self: sk_self.toString(),
    pk_partner_x: pkP_x.toString(),
    pk_partner_y: pkP_y.toString(),
    salt_self: salt_self.toString(),
    H_sk_partner: Hsk_partner.toString(),
    path_self_el: ps.el.map(String),
    path_self_idx: ps.id.map(String),
    path_partner_el: pp.el.map(String),
    path_partner_idx: pp.id.map(String),
    epoch: epoch.toString(),
    root: root.toString(),
  };
  fs.mkdirSync("build", { recursive: true });
  fs.writeFileSync("build/like_input.json", JSON.stringify(input, null, 1));

  // expected public outputs (parity check vs circuit)
  const Spt = babyJub.mulPointEscalar(pkPpt, sk_self);
  const Sx = babyJub.F.toObject(Spt[0]), Sy = babyJub.F.toObject(Spt[1]);
  const psec = H([Sx, Sy]);
  const rdv = H([psec, Fadd(pkS_x, pkP_x), Fmul(pkS_x, pkP_x), Fadd(pkS_y, pkP_y), Fmul(pkS_y, pkP_y), epoch, DOM_RDV]);
  const dir = H([pkS_x, pkS_y, pkP_x, pkP_y, DOM_DIR]);
  const nfk = H([sk_self, DOM_NFKEY]);
  const C_self = H([rdv, dir, Hsk_self, salt_self]);
  const nf_self = H([rdv, dir, nfk, epoch, DOM_NF]);
  fs.writeFileSync("build/like_expected.json", JSON.stringify({ C_self: C_self.toString(), nf_self: nf_self.toString() }, null, 1));
  console.log("wrote build/like_input.json");
  console.log("expected C_self =", C_self.toString());
  console.log("expected nf_self =", nf_self.toString());
})().catch((e) => { console.error(e); process.exit(1); });
