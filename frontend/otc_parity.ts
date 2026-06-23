// Parity: confirm otc.ts mirrors gen_otc_inputs.js (compare to the proven fixture).
import { readFileSync } from "fs";
import { init, buildIntent, buildMatch, splitBytes32, type Identity, type Party, type TradeSpec } from "./src/lib/otc";

const fx = JSON.parse(readFileSync("../circuits/build/otc_fixture.json", "utf8"));
const D = {
  ALICE_SALT: 1124295497777900374740323512669874727107805096124908416282364576285317191412n,
  BOB_SALT: 3930684703325714052861339499361817089840455302262870223861594244112332918800n,
  ALICE_NONCE: 214155634893161648685286754786641707009n,
  BOB_NONCE: 234857971505247323293691409963283382274n,
  SELL: 10000000n, BUY: 25000000n, EPOCH: 7n, EXPIRY: 1800000000n,
};

(async () => {
  await init();
  const chainId = splitBytes32(fx.chain_id_hex);
  const contractId = splitBytes32(fx.contract_id_hex);
  const tokenA = splitBytes32(fx.token_a_hex);
  const tokenB = splitBytes32(fx.token_b_hex);

  const alice: Identity = { sk: BigInt(fx.alice.sk), pkX: BigInt(fx.alice.pk_x), pkY: BigInt(fx.alice.pk_y), hSk: BigInt(fx.alice.h_sk) };
  const bobParty: Party = { handle: "bob", index: fx.bob.index, pkX: BigInt(fx.bob.pk_x), pkY: BigInt(fx.bob.pk_y), hSk: BigInt(fx.bob.h_sk) };
  const aliceParty: Party = { handle: "alice", index: fx.alice.index, pkX: alice.pkX, pkY: alice.pkY, hSk: alice.hSk };

  const leaves: bigint[] = new Array(16).fill(0n);
  leaves[fx.alice.index] = BigInt(fx.alice.leaf);
  leaves[fx.bob.index] = BigInt(fx.bob.leaf);

  const aliceSpec: TradeSpec = { sellAsset: tokenA, buyAsset: tokenB, sellAmount: D.SELL, buyAmount: D.BUY, direction: 0n, counterparty: [bobParty.pkX, bobParty.pkY], epoch: D.EPOCH, expiry: D.EXPIRY, chainId, contractId, nonce: D.ALICE_NONCE };
  const bobSpec: TradeSpec = { sellAsset: tokenB, buyAsset: tokenA, sellAmount: D.BUY, buyAmount: D.SELL, direction: 1n, counterparty: [alice.pkX, alice.pkY], epoch: D.EPOCH, expiry: D.EXPIRY, chainId, contractId, nonce: D.BOB_NONCE };

  const intent = buildIntent(alice, fx.alice.index, bobParty, D.ALICE_SALT, aliceSpec, leaves);
  const m = buildMatch(alice, fx.alice.index, bobParty, D.ALICE_SALT, D.BOB_SALT, aliceSpec, bobSpec, leaves);

  const ck = (name: string, got: bigint, exp: string) => console.log(`${got.toString() === exp ? "OK " : "FAIL"} ${name} got=${got.toString().slice(0,18)}… exp=${exp.slice(0,18)}…`);
  ck("intent C ", intent.C, fx.alice.c);
  ck("intent nf", intent.nf, fx.alice.nf);
  ck("match_id ", m.matchId, fx.match.match_id);
  ck("terms    ", m.termsHash, fx.match.terms_hash);
  ck("cPartner ", m.cPartner, fx.bob.c);
})().catch(e => { console.error(e); process.exit(1); });
