#!/usr/bin/env node
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const fs = require("fs");

const DEPTH = 4;
const DOM_RDV = 1n;
const DOM_DIR = 2n;
const DOM_NF = 3n;
const DOM_NFKEY = 4n;
const DOM_MATCH = 5n;
const DOM_TRADE = 6n;
const DOM_TERMS = 7n;
const DOM_COMMIT = 8n;
const MASK_128 = (1n << 128n) - 1n;

const DEFAULTS = {
  ALICE_SK: "1842691506730593589715640265812303443278722616060409963675235883983912748183",
  BOB_SK: "2506352711390682365749481717887863839384675139060050738479224417377419301",
  ALICE_SALT: "1124295497777900374740323512669874727107805096124908416282364576285317191412",
  BOB_SALT: "3930684703325714052861339499361817089840455302262870223861594244112332918800",
  TOKEN_A_HEX: "0x1111111111111111111111111111111122222222222222222222222222222222",
  TOKEN_B_HEX: "0x3333333333333333333333333333333344444444444444444444444444444444",
  CHAIN_ID_HEX: "0x005354454c4c41525f544553544e455400000000000000000000000000000001",
  CONTRACT_ID_HEX: "0x0043524f535345445f4f54435f534554544c4500000000000000000000000002",
  SELL_AMOUNT: "10000000",
  BUY_AMOUNT: "25000000",
  EPOCH: "7",
  EXPIRY: "1800000000",
  ALICE_NONCE: "214155634893161648685286754786641707009",
  BOB_NONCE: "234857971505247323293691409963283382274",
};

function envBig(name) {
  return BigInt(process.env[name] ?? DEFAULTS[name]);
}

function envHex(name) {
  const value = process.env[name] ?? DEFAULTS[name];
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error(`${name} must be 0x-prefixed 32-byte hex`);
  }
  return value.toLowerCase();
}

function splitBytes32(hex) {
  const v = BigInt(hex);
  return { hi: v >> 128n, lo: v & MASK_128, hex };
}

function be32(value) {
  return value.toString(16).padStart(64, "0");
}

function leafHex(value) {
  return "0x" + be32(value);
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

function intentInput({ sk, partnerPk, salt, partnerHsk, selfPath, partnerPath, spec, root }) {
  return {
    sk_self: sk.toString(),
    pk_partner_x: partnerPk[0].toString(),
    pk_partner_y: partnerPk[1].toString(),
    salt_self: salt.toString(),
    H_sk_partner: partnerHsk.toString(),
    path_self_el: selfPath.el.map(String),
    path_self_idx: selfPath.id.map(String),
    path_partner_el: partnerPath.el.map(String),
    path_partner_idx: partnerPath.id.map(String),
    sell_asset_hi: spec.sellAsset.hi.toString(),
    sell_asset_lo: spec.sellAsset.lo.toString(),
    buy_asset_hi: spec.buyAsset.hi.toString(),
    buy_asset_lo: spec.buyAsset.lo.toString(),
    sell_amount: spec.sellAmount.toString(),
    buy_amount: spec.buyAmount.toString(),
    direction: spec.direction.toString(),
    counterparty_pk_x: spec.counterparty[0].toString(),
    counterparty_pk_y: spec.counterparty[1].toString(),
    expiry: spec.expiry.toString(),
    nonce: spec.nonce.toString(),
    chain_id_hi: spec.chainId.hi.toString(),
    chain_id_lo: spec.chainId.lo.toString(),
    contract_id_hi: spec.contractId.hi.toString(),
    contract_id_lo: spec.contractId.lo.toString(),
    epoch: spec.epoch.toString(),
    root: root.toString(),
  };
}

(async () => {
  const babyJub = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (arr) => F.toObject(poseidon(arr));
  const Fadd = (a, b) => F.toObject(F.add(F.e(a), F.e(b)));
  const Fmul = (a, b) => F.toObject(F.mul(F.e(a), F.e(b)));

  const skAlice = envBig("ALICE_SK");
  const skBob = envBig("BOB_SK");
  const saltAlice = envBig("ALICE_SALT");
  const saltBob = envBig("BOB_SALT");
  if (skAlice <= 0n || skAlice >= babyJub.subOrder) throw new Error("ALICE_SK out of range");
  if (skBob <= 0n || skBob >= babyJub.subOrder) throw new Error("BOB_SK out of range");

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

  const tokenA = splitBytes32(envHex("TOKEN_A_HEX"));
  const tokenB = splitBytes32(envHex("TOKEN_B_HEX"));
  const chainId = splitBytes32(envHex("CHAIN_ID_HEX"));
  const contractId = splitBytes32(envHex("CONTRACT_ID_HEX"));
  const epoch = envBig("EPOCH");
  const expiry = envBig("EXPIRY");
  const sellAmount = envBig("SELL_AMOUNT");
  const buyAmount = envBig("BUY_AMOUNT");

  const aliceSpec = {
    sellAsset: tokenA,
    buyAsset: tokenB,
    sellAmount,
    buyAmount,
    direction: 0n,
    counterparty: pkBob,
    epoch,
    expiry,
    chainId,
    contractId,
    nonce: envBig("ALICE_NONCE"),
  };
  const bobSpec = {
    sellAsset: tokenB,
    buyAsset: tokenA,
    sellAmount: buyAmount,
    buyAmount: sellAmount,
    direction: 1n,
    counterparty: pkAlice,
    epoch,
    expiry,
    chainId,
    contractId,
    nonce: envBig("BOB_NONCE"),
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

  const aliceTradeHash = tradeHash(H, aliceSpec);
  const bobTradeHash = tradeHash(H, bobSpec);
  const dirAlice = H([DOM_DIR, pkAlice[0], pkAlice[1], pkBob[0], pkBob[1]]);
  const dirBob = H([DOM_DIR, pkBob[0], pkBob[1], pkAlice[0], pkAlice[1]]);
  const nfKeyAlice = H([DOM_NFKEY, skAlice]);
  const nfKeyBob = H([DOM_NFKEY, skBob]);
  const C_alice = H([DOM_COMMIT, rdv, dirAlice, HskAlice, aliceTradeHash, saltAlice]);
  const C_bob = H([DOM_COMMIT, rdv, dirBob, HskBob, bobTradeHash, saltBob]);
  const nfAlice = H([DOM_NF, nfKeyAlice, aliceTradeHash, epoch, chainId.hi, contractId.hi]);
  const nfBob = H([DOM_NF, nfKeyBob, bobTradeHash, epoch, chainId.hi, contractId.hi]);
  const terms = termsHash(H, aliceSpec);
  if (terms !== termsHash(H, bobSpec)) throw new Error("terms hash mismatch");
  const [saltLo, saltHi] = saltAlice < saltBob ? [saltAlice, saltBob] : [saltBob, saltAlice];
  const matchId = H([DOM_MATCH, rdv, terms, saltLo, saltHi]);

  const intentA = intentInput({
    sk: skAlice,
    partnerPk: pkBob,
    salt: saltAlice,
    partnerHsk: HskBob,
    selfPath: pathAlice,
    partnerPath: pathBob,
    spec: aliceSpec,
    root,
  });
  const intentB = intentInput({
    sk: skBob,
    partnerPk: pkAlice,
    salt: saltBob,
    partnerHsk: HskAlice,
    selfPath: pathBob,
    partnerPath: pathAlice,
    spec: bobSpec,
    root,
  });

  const matchInput = {
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
    self_sell_amount: sellAmount.toString(),
    self_buy_amount: buyAmount.toString(),
    self_direction: "0",
    self_counterparty_pk_x: pkBob[0].toString(),
    self_counterparty_pk_y: pkBob[1].toString(),
    self_expiry: expiry.toString(),
    self_nonce: aliceSpec.nonce.toString(),
    partner_sell_asset_hi: tokenB.hi.toString(),
    partner_sell_asset_lo: tokenB.lo.toString(),
    partner_buy_asset_hi: tokenA.hi.toString(),
    partner_buy_asset_lo: tokenA.lo.toString(),
    partner_sell_amount: buyAmount.toString(),
    partner_buy_amount: sellAmount.toString(),
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

  const intentExpectedA = {
    C: C_alice.toString(),
    nf: nfAlice.toString(),
    chain_id_hi: chainId.hi.toString(),
    chain_id_lo: chainId.lo.toString(),
    contract_id_hi: contractId.hi.toString(),
    contract_id_lo: contractId.lo.toString(),
    epoch: epoch.toString(),
    root: root.toString(),
    public: [C_alice, nfAlice, chainId.hi, chainId.lo, contractId.hi, contractId.lo, epoch, root].map(String),
  };
  const intentExpectedB = {
    C: C_bob.toString(),
    nf: nfBob.toString(),
    chain_id_hi: chainId.hi.toString(),
    chain_id_lo: chainId.lo.toString(),
    contract_id_hi: contractId.hi.toString(),
    contract_id_lo: contractId.lo.toString(),
    epoch: epoch.toString(),
    root: root.toString(),
    public: [C_bob, nfBob, chainId.hi, chainId.lo, contractId.hi, contractId.lo, epoch, root].map(String),
  };
  const matchExpected = {
    match_id: matchId.toString(),
    C_self: C_alice.toString(),
    C_partner: C_bob.toString(),
    terms_hash: terms.toString(),
    a_sell_asset_hi: tokenA.hi.toString(),
    a_sell_asset_lo: tokenA.lo.toString(),
    a_buy_asset_hi: tokenB.hi.toString(),
    a_buy_asset_lo: tokenB.lo.toString(),
    a_sell_amount: sellAmount.toString(),
    a_buy_amount: buyAmount.toString(),
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
      sellAmount,
      buyAmount,
      chainId.hi,
      chainId.lo,
      contractId.hi,
      contractId.lo,
      epoch,
      expiry,
      root,
    ].map(String),
  };

  fs.mkdirSync("build/intent", { recursive: true });
  fs.mkdirSync("build/intent_b", { recursive: true });
  fs.mkdirSync("build/match", { recursive: true });
  fs.writeFileSync("build/intent/intent_input.json", JSON.stringify(intentA, null, 1));
  fs.writeFileSync("build/intent/intent_expected.json", JSON.stringify(intentExpectedA, null, 1));
  fs.writeFileSync("build/intent_b/intent_input.json", JSON.stringify(intentB, null, 1));
  fs.writeFileSync("build/intent_b/intent_expected.json", JSON.stringify(intentExpectedB, null, 1));
  fs.writeFileSync("build/match/match_input.json", JSON.stringify(matchInput, null, 1));
  fs.writeFileSync("build/match/match_expected.json", JSON.stringify(matchExpected, null, 1));
  fs.writeFileSync("build/otc_fixture.json", JSON.stringify({
    chain_id_hex: chainId.hex,
    contract_id_hex: contractId.hex,
    token_a_hex: tokenA.hex,
    token_b_hex: tokenB.hex,
    epoch: epoch.toString(),
    expiry: expiry.toString(),
    root: root.toString(),
    root_hex: leafHex(root),
    alice: {
      index: idxAlice,
      sk: skAlice.toString(),
      pk_x: pkAlice[0].toString(),
      pk_y: pkAlice[1].toString(),
      h_sk: HskAlice.toString(),
      leaf: leafAlice.toString(),
      c: C_alice.toString(),
      nf: nfAlice.toString(),
    },
    bob: {
      index: idxBob,
      sk: skBob.toString(),
      pk_x: pkBob[0].toString(),
      pk_y: pkBob[1].toString(),
      h_sk: HskBob.toString(),
      leaf: leafBob.toString(),
      c: C_bob.toString(),
      nf: nfBob.toString(),
    },
    match: {
      match_id: matchId.toString(),
      terms_hash: terms.toString(),
    },
  }, null, 1));

  console.log("wrote deterministic OTC inputs");
  console.log("intent A C =", intentExpectedA.C);
  console.log("intent B C =", intentExpectedB.C);
  console.log("match_id =", matchExpected.match_id);
})();
