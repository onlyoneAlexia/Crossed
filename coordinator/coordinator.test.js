import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createMatcher } from "./matcher.js";
import { buildTreeFromLeaves, proveOrder } from "./darkpool.js";
import { computeLeaf, computeRoot, createDirectory, fieldToHex } from "./directory.js";
import { registerDpLeaf, registerLeaf } from "./server.js";

const skSell = "1842691506730593589715640265812303443278722616060409963675235883983912748183";
const skBuy = "2506352711390682365749481717887863839384675139060050738479224417377419301";
const dpRegistrations = [
  {
    pk_x: "12687799684184602287013427252911734969197142080880228106992503661977094739859",
    pk_y: "17012664891403336410326685643969223506868268510312459373628401289417343652080",
    h_sk: "7468010056132676029338864687252430967195512320768897625685386588663886933191",
    leaf: "0x0196952886ebfb31cf44429b61d4614e1cf144c3c78443bd3bc56fddf6b2afd0",
  },
  {
    pk_x: "8786631853519632738182591870531851875965198383348374029942913716271500498034",
    pk_y: "5549077401385939457880598314090713029925467715168448641063833031389170809186",
    h_sk: "11211103954442107903149289523828883066837582018638814853343666545869152939254",
    leaf: "0x28e20421509a51d329e02d4f096d3813effaeb5104ffef7c9f9708ea723b3856",
  },
];

async function readFixture() {
  const json = await readFile(new URL("../circuits/build/otc_fixture.json", import.meta.url), "utf8");
  return JSON.parse(json);
}

test("computes circuit-compatible Poseidon leaves and depth-4 Merkle root", async () => {
  const fixture = await readFixture();
  const aliceLeaf = await computeLeaf(fixture.alice.pk_x, fixture.alice.pk_y, fixture.alice.h_sk);
  const bobLeaf = await computeLeaf(fixture.bob.pk_x, fixture.bob.pk_y, fixture.bob.h_sk);

  assert.equal(aliceLeaf.toString(), fixture.alice.leaf);
  assert.equal(bobLeaf.toString(), fixture.bob.leaf);

  const leaves = Array.from({ length: 16 }, () => 0n);
  leaves[fixture.alice.index] = aliceLeaf;
  leaves[fixture.bob.index] = bobLeaf;

  assert.equal(fieldToHex(await computeRoot(leaves)), fixture.root_hex);
});

test("POST /register verifies leaf locally before using the chain", async () => {
  const fixture = await readFixture();
  const directory = await createDirectory();
  const calls = [];
  const chain = {
    address: "GCCOORDINATORADDRESS",
    contractId: "CBXFJMEVB3QKKTLKVCWXQMNRZ2OKCBP4EX4KOZXFJ4TYEHBKCQUX5FN4",
    tokenA: "CAYSHVNZ6262YLKUYQRHY7OBMFMR7S3ZAJBMAHAXDFHEBB7YEUOQUJI6",
    tokenB: "CDVD2IOLUSIEBMYKX2NV76QPFCZJ327BMIIVXQX4OYQDISDCTLTS7OWR",
    async register(entry) {
      calls.push(["register", entry]);
      return { tx: "register-tx" };
    },
    async waitForLeafCount(count) {
      calls.push(["waitForLeafCount", count]);
    },
    async postRoot(entry) {
      calls.push(["postRoot", entry]);
      return { tx: "root-tx" };
    },
  };
  const base = {
    pk_x: fixture.alice.pk_x,
    pk_y: fixture.alice.pk_y,
    h_sk: fixture.alice.h_sk,
  };

  await assert.rejects(
    registerLeaf({ directory, chain, body: { ...base, leaf: "0x" + "11".repeat(32) } }),
    /leaf mismatch/,
  );
  assert.deepEqual(calls, []);

  const accepted = await registerLeaf({
    directory,
    chain,
    body: { ...base, leaf: fieldToHex(fixture.alice.leaf) },
  });
  assert.equal(accepted.index, 0);
  assert.equal(accepted.leaf, fieldToHex(fixture.alice.leaf));
  assert.match(accepted.root_hex, /^0x[0-9a-f]{64}$/);
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], "register");
  assert.equal(calls[0][1].owner, chain.address);
  assert.deepEqual(calls[1], ["waitForLeafCount", 1]);
  assert.equal(calls[2][0], "postRoot");
  assert.equal(calls[2][1].leaf_count, 1);
  assert.equal(calls[2][1].root, accepted.root_hex);

  const duplicate = await registerLeaf({
    directory,
    chain,
    body: { ...base, leaf: fieldToHex(fixture.alice.leaf) },
  });
  assert.equal(duplicate.index, 0);
  assert.equal(duplicate.root_hex, accepted.root_hex);
  assert.equal(calls.length, 3);
});

test("POST /dp/register uses DP chain methods and only commits after chain success", async () => {
  const directory = await createDirectory();
  const calls = [];
  const owner = "GALICEDARKPOOL";
  const body = { ...dpRegistrations[0], owner, auth_entry: "signed-auth" };
  const failingChain = {
    async dpRegister(entry, authEntry) {
      calls.push(["dpRegister", entry, authEntry]);
      throw new Error("dp register failed");
    },
    async dpPostRoot(entry) {
      calls.push(["dpPostRoot", entry]);
      return { tx: "root-tx" };
    },
  };

  await assert.rejects(registerDpLeaf({ directory, chain: failingChain, body }), /dp register failed/);
  assert.equal(directory.count(), 0);
  assert.equal(directory.has(body.leaf), false);
  assert.equal(calls.length, 1);

  calls.length = 0;
  const chain = {
    async dpRegister(entry, authEntry) {
      calls.push(["dpRegister", entry, authEntry]);
      return { tx: "register-tx" };
    },
    async waitForLeafCount(count, opts) {
      calls.push(["waitForLeafCount", count, opts]);
    },
    async dpPostRoot(entry) {
      calls.push(["dpPostRoot", entry]);
      return { tx: "root-tx" };
    },
  };

  const accepted = await registerDpLeaf({ directory, chain, body });
  assert.equal(accepted.index, 0);
  assert.equal(accepted.leaf, body.leaf);
  assert.equal(directory.count(), 1);
  assert.equal(directory.get(body.leaf).owner, owner);
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], "dpRegister");
  assert.equal(calls[0][1].owner, owner);
  assert.equal(calls[0][2], "signed-auth");
  assert.deepEqual(calls[1], ["waitForLeafCount", 1, { dp: true }]);
  assert.equal(calls[2][0], "dpPostRoot");
  assert.equal(calls[2][1].leaf_count, 1);
  assert.equal(calls[2][1].root, accepted.root_hex);

  const duplicate = await registerDpLeaf({ directory, chain, body });
  assert.equal(duplicate.index, 0);
  assert.equal(calls.length, 3);
});

test("dark-pool orders reject unconfigured pair_id before mutating matcher state", async () => {
  const matcher = createMatcher({ pairId: 1, validPairs: new Set([1]) });
  const directory = await createDirectory();
  const chain = { dpPairId: 1 };

  await assert.rejects(
    matcher.submitOrder(chain, directory, {
      owner: "GALICE",
      side: 0,
      size: "100000000",
      limit_price: "24000000",
      salt: "111",
      pair_id: 2,
    }),
    /pair_id .*configured/i,
  );
  assert.deepEqual(matcher.orders(), []);
});

test("dark-pool orders require the submitted owner to match the registered leaf owner", async () => {
  const matcher = createMatcher({ pairId: 1 });
  const directory = await createDirectory();
  await directory.add({ ...dpRegistrations[0], owner: "GALICE" });
  const { leaves } = await directory.snapshot();
  const tree = await buildTreeFromLeaves(leaves);
  const orderProof = await proveOrder({
    sk: skSell,
    side: 0,
    size: "100000000",
    limit_price: "24000000",
    salt: "111",
    pair_id: 1,
    batch_id: 1,
    tree,
    leafIndex: 0,
  });
  const calls = [];
  const chain = {
    dpPairId: 1,
    async dpPostRoot(entry) {
      calls.push(["dpPostRoot", entry]);
      return { tx: "root-tx" };
    },
    async placeOrder(args) {
      calls.push(["placeOrder", args]);
      return { tx: "order-tx" };
    },
  };

  await assert.rejects(
    matcher.submitOrder(chain, directory, {
      owner: "GMALLORY",
      leaf: dpRegistrations[0].leaf,
      proof: orderProof.proof,
      note: orderProof.note,
      nf_order: orderProof.nf_order,
      root: orderProof.root,
      side: 0,
      size: "100000000",
      limit_price: "24000000",
      salt: "111",
      pair_id: 1,
    }),
    /registered owner/i,
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(matcher.orders(), []);
});

test("dark-pool matcher accepts client-proved orders without retaining identity secrets", async () => {
  const matcher = createMatcher({ pairId: 1 });
  const directory = await createDirectory();
  await directory.add({ ...dpRegistrations[0], owner: "GALICE" });
  const { leaves } = await directory.snapshot();
  const tree = await buildTreeFromLeaves(leaves);
  const orderProof = await proveOrder({
    sk: skSell,
    side: 0,
    size: "100000000",
    limit_price: "24000000",
    salt: "111",
    pair_id: 1,
    batch_id: 1,
    tree,
    leafIndex: 0,
  });
  const calls = [];
  const chain = {
    dpPairId: 1,
    async dpPostRoot(entry) {
      calls.push(["dpPostRoot", entry]);
      return { tx: "root-tx" };
    },
    async placeOrder(args) {
      calls.push(["placeOrder", args]);
      return { tx: "order-tx" };
    },
  };

  const accepted = await matcher.submitOrder(chain, directory, {
    owner: "GALICE",
    leaf: dpRegistrations[0].leaf,
    proof: orderProof.proof,
    note: orderProof.note,
    nf_order: orderProof.nf_order,
    root: orderProof.root,
    side: 0,
    size: "100000000",
    limit_price: "24000000",
    salt: "111",
    pair_id: 1,
  });

  assert.equal(accepted.note, orderProof.note);
  assert.equal(accepted.nf_order, orderProof.nf_order);
  assert.equal(calls[1][0], "placeOrder");
  assert.equal(calls[1][1].note, orderProof.note);
  assert.equal(calls[1][1].nf_order, orderProof.nf_order);
  assert.equal(matcher.state.orders.length, 1);
  assert.equal(Object.hasOwn(matcher.state.orders[0], "sk"), false);
  assert.equal(Object.hasOwn(matcher.state.orders[0], "proof"), false);
});

test("dark-pool cancel removes only the owner's open order from matcher state", async () => {
  const matcher = createMatcher({ pairId: 1 });
  matcher.state.orders.push({
    owner: "GALICE",
    side: 0,
    size: "100000000",
    limit_price: "24000000",
    salt: "111",
    leaf: dpRegistrations[0].leaf.slice(2),
    pair_id: 1,
    batch_id: "1",
    note: "a".repeat(64),
    nf_order: "b".repeat(64),
    root: "c".repeat(64),
    placed: true,
    filled: false,
    base_amount: null,
    quote_amount: null,
    _createdAt: Date.now(),
    _updatedAt: Date.now(),
  });

  await assert.rejects(
    matcher.cancelOrder({}, {}, { owner: "GMALLORY", note: "a".repeat(64) }),
    /open order not found/i,
  );
  assert.equal(matcher.batch().open_count, 1);

  const cancelled = await matcher.cancelOrder({}, {}, { owner: "GALICE", note: "0x" + "a".repeat(64) });
  assert.equal(cancelled.note, "a".repeat(64));
  assert.equal(cancelled.cancelled, true);
  assert.equal(matcher.batch().open_count, 0);
  assert.equal(matcher.orders()[0].cancelled, true);
});

test("dark-pool matcher rejects submitted long-lived identity secrets", async () => {
  const matcher = createMatcher({
    pairId: 1,
    proveOrderFn: async () => {
      throw new Error("server should not build order proofs");
    },
  });
  const directory = await createDirectory();
  await directory.add({ ...dpRegistrations[0], owner: "GALICE" });
  const chain = {
    dpPairId: 1,
    async dpPostRoot() {
      return { tx: "root-tx" };
    },
    async placeOrder() {
      return { tx: "order-tx" };
    },
  };

  await assert.rejects(
    matcher.submitOrder(chain, directory, {
      owner: "GALICE",
      sk: skSell,
      side: 0,
      size: "100000000",
      limit_price: "24000000",
      salt: "111",
      pair_id: 1,
    }),
    /identity secret/i,
  );
});

test("closeBatch skips a failed match and continues closing other valid matches", async () => {
  const matcher = createMatcher({
    pairId: 1,
    proveMatchFn: async ({ sell, buy }) => ({
      proof: { a: "aa", b: "bb", c: "cc" },
      match_id: `${sell.salt}-${buy.salt}`,
      note_sell: `sell-${sell.salt}`,
      note_buy: `buy-${buy.salt}`,
      nf_sell: `nf-sell-${sell.salt}`,
      nf_buy: `nf-buy-${buy.salt}`,
      leaf_sell: "leaf-sell",
      leaf_buy: "leaf-buy",
      base_amount: sell.size,
      quote_amount: "250000000",
    }),
  });
  const directory = await createDirectory();
  matcher.state.orders.push(
    { owner: "GSELLER", leaf: dpRegistrations[0].leaf.slice(2), side: 0, size: "100000000", limit_price: "24000000", salt: "111", batch_id: "1", placed: true, filled: false },
    { owner: "GBUYER", leaf: dpRegistrations[1].leaf.slice(2), side: 1, size: "100000000", limit_price: "26000000", salt: "222", batch_id: "1", placed: true, filled: false },
    { owner: "GSELLER", leaf: dpRegistrations[0].leaf.slice(2), side: 0, size: "100000000", limit_price: "24000000", salt: "333", batch_id: "1", placed: true, filled: false },
    { owner: "GBUYER", leaf: dpRegistrations[1].leaf.slice(2), side: 1, size: "100000000", limit_price: "26000000", salt: "444", batch_id: "1", placed: true, filled: false },
  );
  let settleCalls = 0;
  const chain = {
    dpPairId: 1,
    async dpPostRoot() {
      return { tx: "root-tx" };
    },
    async settleDpMatch() {
      settleCalls += 1;
      if (settleCalls === 1) throw new Error("insufficient escrow");
      return { tx: `settle-${settleCalls}` };
    },
  };

  const closed = await matcher.closeBatch(chain, directory);
  assert.equal(closed.batch_id, "1");
  assert.equal(closed.fills.length, 2);
  assert.equal(closed.fills[0].tx, "settle-2");
  assert.equal(closed.fills[1].tx, "settle-3");
  assert.equal(settleCalls, 3);
});

test("concurrent closeBatch calls share the in-flight close", async () => {
  const matcher = createMatcher({ pairId: 1 });
  const directory = await createDirectory();
  let posted = 0;
  const chain = {
    dpPairId: 1,
    async dpPostRoot() {
      posted += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { tx: "root-tx" };
    },
  };

  const [first, second] = await Promise.all([
    matcher.closeBatch(chain, directory),
    matcher.closeBatch(chain, directory),
  ]);
  assert.equal(first.batch_id, "1");
  assert.equal(second.batch_id, "1");
  assert.equal(first.pending, true);
  assert.equal(first.open_count, 0);
  assert.equal(first.min_open_count, 2);
  assert.equal(matcher.batch().batch_id, "1");
  assert.equal(posted, 1);
});
