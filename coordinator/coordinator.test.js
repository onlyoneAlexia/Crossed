import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@stellar/stellar-sdk";

import { createMatcher } from "./matcher.js";
import { buildTreeFromLeaves, orderCommitmentV2, proveOrder } from "./darkpool.js";
import { computeLeaf, computeRoot, createDirectory, fieldToHex } from "./directory.js";
import { createApp, registerDpLeaf, registerLeaf } from "./server.js";
import { ownerAuthorizationPayload, createAuthMiddleware } from "./security.js";
import { createJsonStore } from "./store.js";

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

test("JSON store persists registrations, open orders, and fills for restart", async (t) => {
  const tmp = await t.testContext?.tmpdir?.() ?? await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "crossed-store-")));
  const statePath = join(tmp, "state.json");
  const store = createJsonStore({ statePath, decisionsPath: join(tmp, "decisions.log") });
  const directory = await createDirectory();
  await directory.add({ ...dpRegistrations[0], owner: "GALICE" });
  const matcher = createMatcher({ pairId: 1 });
  matcher.state.currentBatchId = 2n;
  matcher.state.orders.push(
    {
      owner: "GALICE",
      side: 0,
      size: "100000000",
      limit_price: "24000000",
      salt: "111",
      leaf: dpRegistrations[0].leaf.slice(2),
      pair_id: 1,
      batch_id: "2",
      note: "a".repeat(64),
      nf_order: "b".repeat(64),
      root: "c".repeat(64),
      placed: true,
      filled: false,
      cancelled: false,
      _createdAt: 1,
      _updatedAt: 2,
    },
    {
      owner: "GBUYER",
      side: 1,
      size: "100000000",
      limit_price: "26000000",
      salt: "222",
      leaf: dpRegistrations[1].leaf.slice(2),
      pair_id: 1,
      batch_id: "1",
      note: "d".repeat(64),
      nf_order: "e".repeat(64),
      root: "f".repeat(64),
      placed: true,
      filled: true,
      cancelled: false,
      _createdAt: 1,
      _updatedAt: 2,
    },
  );
  matcher.state.fills.push({
    match_id: "m1",
    batch_id: "1",
    pair_id: 1,
    sell_owner: "GALICE",
    buy_owner: "GBUYER",
    note_sell: "d".repeat(64),
    note_buy: "e".repeat(64),
    base_amount: "100000000",
    quote_amount: "250000000",
    tx: "settle-tx",
    _createdAt: 3,
  });

  await store.save({ directory, matcher });

  const raw = JSON.parse(await readFile(statePath, "utf8"));
  assert.equal(raw.registrations.length, 1);
  assert.equal(raw.orders.length, 1);
  assert.equal(raw.fills.length, 1);

  const loaded = await store.load();
  const reloaded = createMatcher({ pairId: 1, initialState: loaded });
  assert.equal(loaded.registrations[0].owner, "GALICE");
  assert.equal(reloaded.batch().batch_id, "2");
  assert.equal(reloaded.orders().length, 1);
  assert.equal(reloaded.fillsFor("GALICE").length, 1);
});

test("JSON store rejects malformed persisted state", async (t) => {
  const tmp = await t.testContext?.tmpdir?.() ?? await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "crossed-store-invalid-")));
  const statePath = join(tmp, "state.json");
  const store = createJsonStore({ statePath, decisionsPath: join(tmp, "decisions.log") });
  await writeFile(statePath, JSON.stringify({
    registrations: "not-an-array",
    currentBatchId: {},
    orders: [{ owner: 12, placed: true }],
    fills: [{ sell_owner: 12 }],
    postedRoots: [1],
  }), "utf8");

  await assert.rejects(store.load(), /invalid persisted state/i);
});

test("decision log rotates when it reaches the configured size", async (t) => {
  const tmp = await t.testContext?.tmpdir?.() ?? await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "crossed-decisions-rotate-")));
  const decisionsPath = join(tmp, "decisions.log");
  const store = createJsonStore({
    statePath: join(tmp, "state.json"),
    decisionsPath,
    decisionLogMaxBytes: 260,
  });

  await store.appendDecision({ batch_id: "1", considered: [{ note: "a".repeat(64) }], matched: [] });
  await store.appendDecision({ batch_id: "2", considered: [{ note: "b".repeat(64) }], matched: [] });

  const files = await readdir(tmp);
  const rotated = files.filter((file) => file.startsWith("decisions.log.") && file.endsWith(".old"));
  assert.equal(rotated.length, 1);
  assert.ok((await stat(join(tmp, rotated[0]))).size > 0);
  assert.match(await readFile(decisionsPath, "utf8"), /"batch_id":"2"/);
});

test("required API auth fails closed when no shared secret is configured", () => {
  const middleware = createAuthMiddleware({ secret: "", required: true, service: "test" });
  let nextCalled = false;
  let statusCode = 0;
  let payload = null;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };

  middleware({ headers: {} }, res, () => { nextCalled = true; });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 401);
  assert.deepEqual(payload, { error: "unauthorized" });
});

async function withServer(t, app) {
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  t.after(() => server.close());
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

test("/auth/check validates the coordinator API token", async (t) => {
  const previous = process.env.COORDINATOR_API_TOKEN;
  process.env.COORDINATOR_API_TOKEN = "test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.COORDINATOR_API_TOKEN;
    else process.env.COORDINATOR_API_TOKEN = previous;
  });

  const app = createApp({
    directory: { snapshot: async () => ({ count: 0, root_hex: "0x" + "0".repeat(64), leaves: [] }) },
    chain: {},
    matcher: { batch: () => ({ batch_id: "1", open_count: 0 }), fillsFor: () => [] },
  });
  const baseUrl = await withServer(t, app);

  const rejected = await fetch(`${baseUrl}/auth/check`, {
    headers: { authorization: "Bearer wrong-secret" },
  });
  assert.equal(rejected.status, 401);

  const accepted = await fetch(`${baseUrl}/auth/check`, {
    headers: { authorization: "Bearer test-secret" },
  });
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { ok: true });
});

test("/dp/cancel requires an owner wallet signature in addition to API auth", async (t) => {
  const previous = process.env.COORDINATOR_API_TOKEN;
  process.env.COORDINATOR_API_TOKEN = "test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.COORDINATOR_API_TOKEN;
    else process.env.COORDINATOR_API_TOKEN = previous;
  });

  let cancelled = false;
  const matcher = {
    async cancelOrder() {
      cancelled = true;
      return { cancelled: true };
    },
    batch() { return { batch_id: "1", open_count: 1 }; },
    fillsFor() { return []; },
  };
  const app = createApp({ directory: {}, chain: {}, matcher });
  const baseUrl = await withServer(t, app);
  const response = await fetch(`${baseUrl}/dp/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-secret" },
    body: JSON.stringify({ owner: "G".padEnd(56, "A"), note: "a".repeat(64) }),
  });

  assert.equal(response.status, 401);
  assert.equal(cancelled, false);
});

test("/dp/cancel accepts an on-chain-confirmed cancellation without a second owner signature", async (t) => {
  const previous = process.env.COORDINATOR_API_TOKEN;
  process.env.COORDINATOR_API_TOKEN = "test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.COORDINATOR_API_TOKEN;
    else process.env.COORDINATOR_API_TOKEN = previous;
  });

  const owner = Keypair.random().publicKey();
  const note = "b".repeat(64);
  let checkedNote = "";
  let cancelled = false;
  const matcher = {
    async cancelOrder(_chain, _directory, body) {
      cancelled = true;
      assert.equal(body.owner, owner);
      assert.equal(body.note, note);
      return { note, cancelled: true };
    },
    batch() { return { batch_id: "1", open_count: 1 }; },
    fillsFor() { return []; },
  };
  const chain = {
    async isOrderOpen(candidate) {
      checkedNote = candidate;
      return false;
    },
  };
  const app = createApp({ directory: {}, chain, matcher });
  const baseUrl = await withServer(t, app);
  const response = await fetch(`${baseUrl}/dp/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-secret" },
    body: JSON.stringify({ owner, note, onchain_cancelled: true }),
  });

  assert.equal(response.status, 200);
  assert.equal(checkedNote, note);
  assert.equal(cancelled, true);
  assert.deepEqual(await response.json(), { note, cancelled: true });
});

test("/dp/cancel accepts a canonical signature from the owner wallet", async (t) => {
  const previous = process.env.COORDINATOR_API_TOKEN;
  process.env.COORDINATOR_API_TOKEN = "test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.COORDINATOR_API_TOKEN;
    else process.env.COORDINATOR_API_TOKEN = previous;
  });

  const owner = Keypair.random();
  const note = "a".repeat(64);
  const timestamp = Date.now().toString();
  const signature = owner.sign(Buffer.from(ownerAuthorizationPayload({
    action: "dp_cancel",
    owner: owner.publicKey(),
    note,
    timestamp,
  }), "utf8")).toString("base64");
  const matcher = {
    async cancelOrder(_chain, _directory, body) {
      assert.equal(body.owner, owner.publicKey());
      assert.equal(body.note, note);
      return { note, cancelled: true };
    },
    batch() { return { batch_id: "1", open_count: 1 }; },
    fillsFor() { return []; },
  };
  const app = createApp({ directory: {}, chain: {}, matcher });
  const baseUrl = await withServer(t, app);
  const response = await fetch(`${baseUrl}/dp/cancel`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer test-secret" },
    body: JSON.stringify({ owner: owner.publicKey(), note, timestamp, signature }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { note, cancelled: true });
});

test("/dp/fills/:owner requires owner proof and does not trust bearer auth alone", async (t) => {
  const previous = process.env.COORDINATOR_API_TOKEN;
  process.env.COORDINATOR_API_TOKEN = "test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.COORDINATOR_API_TOKEN;
    else process.env.COORDINATOR_API_TOKEN = previous;
  });

  const matcher = {
    batch() { return { batch_id: "1", open_count: 0 }; },
    fillsFor() { return [{ match_id: "secret-fill" }]; },
    async cancelOrder() { return { cancelled: true }; },
  };
  const app = createApp({ directory: {}, chain: {}, matcher });
  const baseUrl = await withServer(t, app);
  const owner = Keypair.random().publicKey();
  const response = await fetch(`${baseUrl}/dp/fills/${owner}`, {
    headers: { authorization: "Bearer test-secret" },
  });

  assert.equal(response.status, 401);
});

test("/dp/activity/:owner returns owner orders and fills with owner proof", async (t) => {
  const previous = process.env.COORDINATOR_API_TOKEN;
  process.env.COORDINATOR_API_TOKEN = "test-secret";
  t.after(() => {
    if (previous === undefined) delete process.env.COORDINATOR_API_TOKEN;
    else process.env.COORDINATOR_API_TOKEN = previous;
  });

  const owner = Keypair.random();
  const timestamp = Date.now().toString();
  const signature = owner.sign(Buffer.from(ownerAuthorizationPayload({
    action: "dp_activity",
    owner: owner.publicKey(),
    timestamp,
  }), "utf8")).toString("base64");
  const matcher = {
    batch() { return { batch_id: "1", open_count: 1 }; },
    ordersFor(who) {
      assert.equal(who, owner.publicKey());
      return [{ note: "open-order", owner: who }];
    },
    fillsFor(who) {
      assert.equal(who, owner.publicKey());
      return [{ match_id: "fill", buy_owner: who }];
    },
    async cancelOrder() { return { cancelled: true }; },
  };
  const app = createApp({ directory: {}, chain: {}, matcher });
  const baseUrl = await withServer(t, app);
  const response = await fetch(`${baseUrl}/dp/activity/${owner.publicKey()}`, {
    headers: {
      authorization: "Bearer test-secret",
      "x-crossed-wallet-timestamp": timestamp,
      "x-crossed-wallet-signature": signature,
    },
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    orders: [{ note: "open-order", owner: owner.publicKey() }],
    fills: [{ match_id: "fill", buy_owner: owner.publicKey() }],
  });
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

test("dark-pool matcher places v2 orders when enabled", async () => {
  const matcher = createMatcher({ pairId: 1, orderV2: true });
  const directory = await createDirectory();
  await directory.add({ ...dpRegistrations[0], owner: "GALICE" });
  const snapshot = await directory.snapshot();
  const commitment = await orderCommitmentV2({
    leaf: dpRegistrations[0].leaf,
    side: 0,
    size: "100000000",
    limit_price: "24000000",
    salt: "111",
    pair_id: 1,
    batch_id: 1,
    expiry: "1800000000",
    maq: "1",
    tier: 2,
  });
  const calls = [];
  const chain = {
    dpPairId: 1,
    async dpPostRoot(entry) {
      calls.push(["dpPostRoot", entry]);
      return { tx: "root-tx" };
    },
    async placeOrderV2(args) {
      calls.push(["placeOrderV2", args]);
      return { tx: "order-v2-tx" };
    },
  };

  const accepted = await matcher.submitOrder(chain, directory, {
    owner: "GALICE",
    leaf: dpRegistrations[0].leaf,
    proof: { a: "aa", b: "bb", c: "cc" },
    note: commitment.note,
    nf_order: commitment.nf_order,
    root: snapshot.root_hex,
    side: 0,
    size: "100000000",
    limit_price: "24000000",
    salt: "111",
    pair_id: 1,
    expiry: "1800000000",
    maq: "1",
    tier: 2,
  });

  assert.equal(accepted.tx, "order-v2-tx");
  assert.equal(calls[1][0], "placeOrderV2");
  assert.equal(calls[1][1].expiry, "1800000000");
  assert.equal(calls[1][1].maq, "1");
  assert.equal(calls[1][1].tier, 2);
  assert.equal(matcher.state.orders[0].expiry, "1800000000");
  assert.equal(matcher.state.orders[0].maq, "1");
  assert.equal(matcher.state.orders[0].tier, 2);
});

test("closeBatch settles v2 matches when enabled", async () => {
  const matcher = createMatcher({
    pairId: 1,
    orderV2: true,
    matchV3: false,
    proveMatchFn: async ({ sell, buy }) => ({
      proof: { a: "aa", b: "bb", c: "cc" },
      match_id: "1".repeat(64),
      note_sell: sell.note,
      note_buy: buy.note,
      nf_sell: "2".repeat(64),
      nf_buy: "3".repeat(64),
      leaf_sell: sell.leaf,
      leaf_buy: buy.leaf,
      fill_base: sell.size,
      fill_quote: "250000000",
      base_amount: sell.size,
      quote_amount: "250000000",
    }),
  });
  const directory = await createDirectory();
  matcher.state.orders.push(
    {
      owner: "GSELLER", leaf: dpRegistrations[0].leaf.slice(2), side: 0, size: "100000000",
      limit_price: "24000000", salt: "111", batch_id: "1", note: "a".repeat(64),
      nf_order: "b".repeat(64), pair_id: 1, expiry: "1800000000", maq: "1", tier: 1,
      placed: true, filled: false,
    },
    {
      owner: "GBUYER", leaf: dpRegistrations[1].leaf.slice(2), side: 1, size: "100000000",
      limit_price: "26000000", salt: "222", batch_id: "1", note: "c".repeat(64),
      nf_order: "d".repeat(64), pair_id: 1, expiry: "1800000000", maq: "1", tier: 1,
      placed: true, filled: false,
    },
  );
  const calls = [];
  const chain = {
    dpPairId: 1,
    async dpPostRoot() {
      return { tx: "root-tx" };
    },
    async settleDpMatchV2(args) {
      calls.push(args);
      return { tx: "settle-v2-tx" };
    },
  };

  const closed = await matcher.closeBatch(chain, directory);

  assert.equal(closed.fills.length, 1);
  assert.equal(closed.fills[0].tx, "settle-v2-tx");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fill_base, "100000000");
  assert.equal(calls[0].fill_quote, "250000000");
});

test("closeBatch exposes v3 residual change order details for partial fills", async () => {
  const residualNote = "e".repeat(64);
  const residualNf = "f".repeat(64);
  const matcher = createMatcher({
    pairId: 1,
    orderV2: true,
    matchV3: true,
    proveMatchFn: async ({ sell, buy }) => ({
      proof: { a: "aa", b: "bb", c: "cc" },
      match_id: "1".repeat(64),
      note_sell: sell.note,
      note_buy: buy.note,
      nf_sell: "2".repeat(64),
      nf_buy: "3".repeat(64),
      leaf_sell: sell.leaf,
      leaf_buy: buy.leaf,
      fill_base: "800000000",
      fill_quote: "1000000000",
      base_amount: "800000000",
      quote_amount: "1000000000",
      change_note_sell: "0".repeat(64),
      change_note_buy: residualNote,
      assigned_tier_sell: 0,
      assigned_tier_buy: 0,
      changeSell: {
        size: "0",
        change_salt: "1111",
        note: "0".repeat(64),
        nf_order: "0".repeat(64),
      },
      changeBuy: {
        size: "7200000000",
        change_salt: "3333",
        note: residualNote,
        nf_order: residualNf,
      },
    }),
  });
  const directory = await createDirectory();
  matcher.state.orders.push(
    {
      owner: "GSELLER", leaf: dpRegistrations[0].leaf.slice(2), side: 0, size: "800000000",
      limit_price: "12500000", salt: "111", batch_id: "1", note: "a".repeat(64),
      nf_order: "b".repeat(64), pair_id: 1, expiry: "1800000000", maq: "1", tier: 0,
      placed: true, filled: false,
    },
    {
      owner: "GBUYER", leaf: dpRegistrations[1].leaf.slice(2), side: 1, size: "8000000000",
      limit_price: "12500000", salt: "222", batch_id: "1", note: "c".repeat(64),
      nf_order: "d".repeat(64), pair_id: 1, expiry: "1800000000", maq: "1", tier: 0,
      placed: true, filled: false,
    },
  );
  const calls = [];
  const chain = {
    dpPairId: 1,
    async dpPostRoot() {
      return { tx: "root-tx" };
    },
    async settleDpMatchV3(args) {
      calls.push(args);
      return { tx: "settle-v3-tx" };
    },
  };

  const closed = await matcher.closeBatch(chain, directory);
  const buyerFill = matcher.fillsFor("GBUYER")[0];

  assert.equal(closed.fills.length, 1);
  assert.equal(closed.fills[0].tx, "settle-v3-tx");
  assert.equal(closed.fills[0].fill_base, "800000000");
  assert.equal(closed.fills[0].fill_quote, "1000000000");
  assert.equal(closed.fills[0].change_note_buy, residualNote);
  assert.equal(closed.fills[0].residual_buy, "7200000000");
  assert.equal(closed.fills[0].change_salt_buy, "3333");
  assert.equal(buyerFill.change_note_buy, residualNote);
  assert.equal(buyerFill.residual_buy, "7200000000");
  assert.equal(matcher.batch().open_count, 1);
  assert.equal(matcher.orders().find((order) => order.note === residualNote)?.size, "7200000000");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].fill_base, "800000000");
  assert.equal(calls[0].fill_quote, "1000000000");
  assert.equal(calls[0].change_note_buy, residualNote);
});

test("fillsFor enriches legacy partial fills from open residual orders", () => {
  const residualNote = "e".repeat(64);
  const matcher = createMatcher({ pairId: 1, orderV2: true, matchV3: true });
  matcher.state.orders.push({
    owner: "GBUYER",
    leaf: dpRegistrations[1].leaf.slice(2),
    side: 1,
    size: "7200000000",
    limit_price: "12500000",
    salt: "3333",
    batch_id: "1",
    note: residualNote,
    nf_order: "f".repeat(64),
    pair_id: 1,
    expiry: "1800000000",
    maq: "1",
    tier: 0,
    placed: true,
    filled: false,
    cancelled: false,
    tx: "settle-v3-tx",
  });
  matcher.state.fills.push({
    match_id: "1".repeat(64),
    batch_id: "1",
    pair_id: 1,
    sell_owner: "GSELLER",
    buy_owner: "GBUYER",
    note_sell: "a".repeat(64),
    note_buy: "c".repeat(64),
    base_amount: "800000000",
    quote_amount: "1000000000",
    tx: "settle-v3-tx",
    _createdAt: Date.now(),
  });

  const [fill] = matcher.fillsFor("GBUYER");

  assert.equal(fill.change_note_buy, residualNote);
  assert.equal(fill.residual_buy, "7200000000");
  assert.equal(fill.change_salt_buy, "3333");
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

test("closeBatch appends a hashed batch decision log", async (t) => {
  const tmp = await t.testContext?.tmpdir?.() ?? await import("node:fs/promises").then(({ mkdtemp }) => mkdtemp(join(tmpdir(), "crossed-decisions-")));
  const decisionsPath = join(tmp, "decisions.log");
  const store = createJsonStore({ statePath: join(tmp, "state.json"), decisionsPath });
  const matcher = createMatcher({
    pairId: 1,
    onDecision: (decision) => store.appendDecision(decision),
    proveMatchFn: async ({ sell, buy }) => ({
      proof: { a: "aa", b: "bb", c: "cc" },
      match_id: "1".repeat(64),
      note_sell: sell.note,
      note_buy: buy.note,
      nf_sell: sell.nf_order,
      nf_buy: buy.nf_order,
      leaf_sell: sell.leaf,
      leaf_buy: buy.leaf,
      base_amount: sell.size,
      quote_amount: "250000000",
    }),
  });
  const directory = await createDirectory();
  matcher.state.orders.push(
    { owner: "GSELLER", leaf: dpRegistrations[0].leaf.slice(2), side: 0, size: "100000000", limit_price: "24000000", salt: "111", batch_id: "1", note: "a".repeat(64), nf_order: "b".repeat(64), pair_id: 1, placed: true, filled: false },
    { owner: "GBUYER", leaf: dpRegistrations[1].leaf.slice(2), side: 1, size: "100000000", limit_price: "26000000", salt: "222", batch_id: "1", note: "c".repeat(64), nf_order: "d".repeat(64), pair_id: 1, placed: true, filled: false },
  );
  const chain = {
    dpPairId: 1,
    async dpPostRoot() {
      return { tx: "root-tx" };
    },
    async settleDpMatch() {
      return { tx: "settle-tx" };
    },
  };

  await matcher.closeBatch(chain, directory);

  const [line] = (await readFile(decisionsPath, "utf8")).trim().split("\n");
  const record = JSON.parse(line);
  const { hash, ...signed } = record;
  assert.equal(record.type, "batch_decision");
  assert.equal(record.batch_id, "1");
  assert.deepEqual(record.considered.map((order) => order.note), ["a".repeat(64), "c".repeat(64)]);
  assert.deepEqual(record.matched.map((match) => [match.note_sell, match.note_buy]), [["a".repeat(64), "c".repeat(64)]]);
  assert.match(record.timestamp, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(hash, createHash("sha256").update(JSON.stringify(signed)).digest("hex"));
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
