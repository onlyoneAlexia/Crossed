#!/usr/bin/env node
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const crypto = require("crypto");
const fs = require("fs");

const DEPTH = 4;
const DOM_RDV = 1n;
const DOM_DIR = 2n;
const DOM_MATCH = 5n;
const DOM_TRADE = 6n;
const DOM_TERMS = 7n;
const DOM_COMMIT = 8n;
const MASK_128 = (1n << 128n) - 1n;
const SALT_MAX = 1n << 252n;

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

function tradeHash(H, spec) {
  return H([
    DOM_TRADE,
    H([
      DOM_TRADE,
      spec.sellAsset.hi,
      spec.sellAsset.lo,
      spec.buyAsset.hi,
      spec.buyAsset.lo,
      spec.sellAmount,
      spec.buyAmount,
      spec.direction,
      spec.counterparty[0],
    ]),
    H([
      DOM_TRADE,
      spec.counterparty[1],
      spec.epoch,
      spec.expiry,
      spec.chainId.hi,
      spec.chainId.lo,
      spec.contractId.hi,
      spec.contractId.lo,
      spec.nonce,
    ]),
  ]);
}

function termsHash(H, spec) {
  const leg0Asset = spec.direction === 0n ? spec.sellAsset : spec.buyAsset;
  const leg0Amount = spec.direction === 0n ? spec.sellAmount : spec.buyAmount;
  const leg1Asset = spec.direction === 0n ? spec.buyAsset : spec.sellAsset;
  const leg1Amount = spec.direction === 0n ? spec.buyAmount : spec.sellAmount;
  return H([
    DOM_TERMS,
    leg0Asset.hi,
    leg0Asset.lo,
    leg0Amount,
    leg1Asset.hi,
    leg1Asset.lo,
    leg1Amount,
    spec.epoch,
    spec.expiry,
    spec.chainId.hi,
    spec.chainId.lo,
    spec.contractId.hi,
    spec.contractId.lo,
  ]);
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
  const saltAlice = randBelow(SALT_MAX);
  const saltBob = randBelow(SALT_MAX);

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
  const epoch = 7n;
  const expiry = 1_800_000_000n;
  const aliceSellAmount = 10_000_000n;
  const aliceBuyAmount = 25_000_000n;

  const aliceSpec = {
    sellAsset: tokenA,
    buyAsset: tokenB,
    sellAmount: aliceSellAmount,
    buyAmount: aliceBuyAmount,
    direction: 0n,
    counterparty: pkBob,
    epoch,
    expiry,
    chainId,
    contractId,
    nonce: 0xA11CE000000000000000000000000001n,
  };
  const bobSpec = {
    sellAsset: tokenB,
    buyAsset: tokenA,
    sellAmount: aliceBuyAmount,
    buyAmount: aliceSellAmount,
    direction: 1n,
    counterparty: pkAlice,
    epoch,
    expiry,
    chainId,
    contractId,
    nonce: 0xB0B00000000000000000000000000002n,
  };

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

  const dirAlice = H([DOM_DIR, pkAlice[0], pkAlice[1], pkBob[0], pkBob[1]]);
  const dirBob = H([DOM_DIR, pkBob[0], pkBob[1], pkAlice[0], pkAlice[1]]);
  const aliceTradeHash = tradeHash(H, aliceSpec);
  const bobTradeHash = tradeHash(H, bobSpec);
  const C_alice = H([DOM_COMMIT, rdv, dirAlice, HskAlice, aliceTradeHash, saltAlice]);
  const C_bob = H([DOM_COMMIT, rdv, dirBob, HskBob, bobTradeHash, saltBob]);
  const terms = termsHash(H, aliceSpec);
  const bobTerms = termsHash(H, bobSpec);
  if (terms !== bobTerms) throw new Error("terms hash mismatch");
  const [saltLo, saltHi] = saltAlice < saltBob ? [saltAlice, saltBob] : [saltBob, saltAlice];
  const matchId = H([DOM_MATCH, rdv, terms, saltLo, saltHi]);

  const input = {
    sk_self: skAlice.toString(),
    pk_partner_x: pkBob[0].toString(),
    pk_partner_y: pkBob[1].toString(),
    salt_self: saltAlice.toString(),
    salt_partner: saltBob.toString(),
    H_sk_partner: HskBob.toString(),
    path_self_el: pathAlice.el.map(String),
    path_self_idx: pathAlice.id.map(String),
    path_partner_el: pathBob.el.map(String),
    path_partner_idx: pathBob.id.map(String),
    self_sell_asset_hi: tokenA.hi.toString(),
    self_sell_asset_lo: tokenA.lo.toString(),
    self_buy_asset_hi: tokenB.hi.toString(),
    self_buy_asset_lo: tokenB.lo.toString(),
    self_sell_amount: aliceSellAmount.toString(),
    self_buy_amount: aliceBuyAmount.toString(),
    self_direction: "0",
    self_counterparty_pk_x: pkBob[0].toString(),
    self_counterparty_pk_y: pkBob[1].toString(),
    self_expiry: expiry.toString(),
    self_nonce: aliceSpec.nonce.toString(),
    partner_sell_asset_hi: tokenB.hi.toString(),
    partner_sell_asset_lo: tokenB.lo.toString(),
    partner_buy_asset_hi: tokenA.hi.toString(),
    partner_buy_asset_lo: tokenA.lo.toString(),
    partner_sell_amount: aliceBuyAmount.toString(),
    partner_buy_amount: aliceSellAmount.toString(),
    partner_direction: "1",
    partner_counterparty_pk_x: pkAlice[0].toString(),
    partner_counterparty_pk_y: pkAlice[1].toString(),
    partner_expiry: expiry.toString(),
    partner_nonce: bobSpec.nonce.toString(),
    chain_id_hi: chainId.hi.toString(),
    chain_id_lo: chainId.lo.toString(),
    contract_id_hi: contractId.hi.toString(),
    contract_id_lo: contractId.lo.toString(),
    epoch: epoch.toString(),
    expiry: expiry.toString(),
    root: root.toString(),
  };

  const expected = {
    match_id: matchId.toString(),
    C_self: C_alice.toString(),
    C_partner: C_bob.toString(),
    terms_hash: terms.toString(),
    a_sell_asset_hi: tokenA.hi.toString(),
    a_sell_asset_lo: tokenA.lo.toString(),
    a_buy_asset_hi: tokenB.hi.toString(),
    a_buy_asset_lo: tokenB.lo.toString(),
    a_sell_amount: aliceSellAmount.toString(),
    a_buy_amount: aliceBuyAmount.toString(),
    chain_id_hi: chainId.hi.toString(),
    chain_id_lo: chainId.lo.toString(),
    contract_id_hi: contractId.hi.toString(),
    contract_id_lo: contractId.lo.toString(),
    epoch: epoch.toString(),
    expiry: expiry.toString(),
    root: root.toString(),
    public: [
      matchId,
      C_alice,
      C_bob,
      terms,
      tokenA.hi,
      tokenA.lo,
      tokenB.hi,
      tokenB.lo,
      aliceSellAmount,
      aliceBuyAmount,
      chainId.hi,
      chainId.lo,
      contractId.hi,
      contractId.lo,
      epoch,
      expiry,
      root,
    ].map(String),
  };

  fs.mkdirSync("build/match", { recursive: true });
  fs.writeFileSync("build/match/match_input.json", JSON.stringify(input, null, 1));
  fs.writeFileSync("build/match/match_expected.json", JSON.stringify(expected, null, 1));
  console.log("wrote build/match/match_input.json");
  console.log("expected match_id =", expected.match_id);
  console.log("expected terms_hash =", expected.terms_hash);
  console.log("expected C_self =", expected.C_self);
  console.log("expected C_partner =", expected.C_partner);
})();
