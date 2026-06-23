#!/usr/bin/env node
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const crypto = require("crypto");
const fs = require("fs");

const DEPTH = 4;
const DOM_RDV = 1n;
const DOM_DIR = 2n;
const DOM_NF = 3n;
const DOM_NFKEY = 4n;
const DOM_TRADE = 6n;
const DOM_COMMIT = 8n;
const MASK_128 = (1n << 128n) - 1n;

function randBelow(max) {
  while (true) {
    const x = BigInt("0x" + crypto.randomBytes(32).toString("hex"));
    if (x > 0n && x < max) return x;
  }
}

function splitBytes32(hex) {
  const v = BigInt(hex);
  return { hi: v >> 128n, lo: v & MASK_128 };
}

function merkleTree(leaves, H) {
  const levels = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const lv = levels[levels.length - 1];
    const next = [];
    for (let i = 0; i < lv.length; i += 2) next.push(H([lv[i], lv[i + 1]]));
    levels.push(next);
  }
  return levels;
}

function pathOf(levels, idx) {
  const el = [];
  const id = [];
  let i = idx;
  for (let d = 0; d < DEPTH; d++) {
    el.push(levels[d][i ^ 1]);
    id.push(BigInt(i & 1));
    i >>= 1;
  }
  return { el, id };
}

(async () => {
  const babyJub = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (arr) => F.toObject(poseidon(arr));
  const Fadd = (a, b) => F.toObject(F.add(F.e(a), F.e(b)));
  const Fmul = (a, b) => F.toObject(F.mul(F.e(a), F.e(b)));

  const skAlice = randBelow(babyJub.subOrder);
  const skBob = randBelow(babyJub.subOrder);
  const saltAlice = randBelow(babyJub.subOrder);

  const pkAlicePt = babyJub.mulPointEscalar(babyJub.Base8, skAlice);
  const pkBobPt = babyJub.mulPointEscalar(babyJub.Base8, skBob);
  const pkAlice = [babyJub.F.toObject(pkAlicePt[0]), babyJub.F.toObject(pkAlicePt[1])];
  const pkBob = [babyJub.F.toObject(pkBobPt[0]), babyJub.F.toObject(pkBobPt[1])];

  const HskAlice = H([skAlice]);
  const HskBob = H([skBob]);
  const leafAlice = H([pkAlice[0], pkAlice[1], HskAlice]);
  const leafBob = H([pkBob[0], pkBob[1], HskBob]);

  const leaves = new Array(1 << DEPTH).fill(0n);
  const idxAlice = 3;
  const idxBob = 10;
  leaves[idxAlice] = leafAlice;
  leaves[idxBob] = leafBob;
  const levels = merkleTree(leaves, H);
  const root = levels[levels.length - 1][0];
  const pathAlice = pathOf(levels, idxAlice);
  const pathBob = pathOf(levels, idxBob);

  const tokenA = splitBytes32("0x1111111111111111111111111111111122222222222222222222222222222222");
  const tokenB = splitBytes32("0x3333333333333333333333333333333344444444444444444444444444444444");
  const chainId = splitBytes32("0x5354454c4c41525f544553544e455400000000000000000000000000000001");
  const contractId = splitBytes32("0x43524f535345445f4f54435f534554544c4500000000000000000000000002");
  const sellAmount = 10_000_000n;
  const buyAmount = 25_000_000n;
  const direction = 0n;
  const epoch = 7n;
  const expiry = 1_800_000_000n;
  const nonce = 0xA11CE000000000000000000000000001n;

  const tradeHash = H([
    DOM_TRADE,
    H([
      DOM_TRADE,
      tokenA.hi,
      tokenA.lo,
      tokenB.hi,
      tokenB.lo,
      sellAmount,
      buyAmount,
      direction,
      pkBob[0],
    ]),
    H([
      DOM_TRADE,
      pkBob[1],
      epoch,
      expiry,
      chainId.hi,
      chainId.lo,
      contractId.hi,
      contractId.lo,
      nonce,
    ]),
  ]);

  const bob8 = babyJub.mulPointEscalar(pkBobPt, 8n);
  const shared = babyJub.mulPointEscalar(bob8, skAlice);
  const sharedXY = [babyJub.F.toObject(shared[0]), babyJub.F.toObject(shared[1])];
  const psec = H(sharedXY);
  const rdv = H([
    DOM_RDV,
    psec,
    Fadd(pkAlice[0], pkBob[0]),
    Fmul(pkAlice[0], pkBob[0]),
    Fadd(pkAlice[1], pkBob[1]),
    Fmul(pkAlice[1], pkBob[1]),
    epoch,
    chainId.hi,
    chainId.lo,
    contractId.hi,
    contractId.lo,
  ]);
  const dir = H([DOM_DIR, pkAlice[0], pkAlice[1], pkBob[0], pkBob[1]]);
  const nfKey = H([DOM_NFKEY, skAlice]);
  const C = H([DOM_COMMIT, rdv, dir, HskAlice, tradeHash, saltAlice]);
  const nf = H([DOM_NF, nfKey, tradeHash, epoch, chainId.hi, contractId.hi]);

  const input = {
    sk_self: skAlice.toString(),
    pk_partner_x: pkBob[0].toString(),
    pk_partner_y: pkBob[1].toString(),
    salt_self: saltAlice.toString(),
    H_sk_partner: HskBob.toString(),
    path_self_el: pathAlice.el.map(String),
    path_self_idx: pathAlice.id.map(String),
    path_partner_el: pathBob.el.map(String),
    path_partner_idx: pathBob.id.map(String),
    sell_asset_hi: tokenA.hi.toString(),
    sell_asset_lo: tokenA.lo.toString(),
    buy_asset_hi: tokenB.hi.toString(),
    buy_asset_lo: tokenB.lo.toString(),
    sell_amount: sellAmount.toString(),
    buy_amount: buyAmount.toString(),
    direction: direction.toString(),
    counterparty_pk_x: pkBob[0].toString(),
    counterparty_pk_y: pkBob[1].toString(),
    expiry: expiry.toString(),
    nonce: nonce.toString(),
    chain_id_hi: chainId.hi.toString(),
    chain_id_lo: chainId.lo.toString(),
    contract_id_hi: contractId.hi.toString(),
    contract_id_lo: contractId.lo.toString(),
    epoch: epoch.toString(),
    root: root.toString(),
  };

  const expected = {
    C: C.toString(),
    nf: nf.toString(),
    chain_id_hi: chainId.hi.toString(),
    chain_id_lo: chainId.lo.toString(),
    contract_id_hi: contractId.hi.toString(),
    contract_id_lo: contractId.lo.toString(),
    epoch: epoch.toString(),
    root: root.toString(),
    public: [
      C,
      nf,
      chainId.hi,
      chainId.lo,
      contractId.hi,
      contractId.lo,
      epoch,
      root,
    ].map(String),
  };

  fs.mkdirSync("build/intent", { recursive: true });
  fs.writeFileSync("build/intent/intent_input.json", JSON.stringify(input, null, 1));
  fs.writeFileSync("build/intent/intent_expected.json", JSON.stringify(expected, null, 1));
  console.log("wrote build/intent/intent_input.json");
  console.log("expected C =", expected.C);
  console.log("expected nf =", expected.nf);
})();
