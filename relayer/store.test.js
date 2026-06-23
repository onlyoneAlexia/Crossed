import assert from "node:assert/strict";
import test from "node:test";
import { createStore } from "./store.js";

const envelope = Object.freeze({
  v: 1,
  alg: "AES-256-GCM",
  nonce: "MTIzNDU2Nzg5MDEy",
  ciphertext: "Y2lwaGVydGV4dA",
  tag: "dGFnMTIzNDU2Nzg",
});

const base = Object.freeze({
  network: "testnet",
  contract_id: "CROSS000000000000000000000000000000000000000000000000000001",
  tx_hash: "a".repeat(64),
  record_id: 0,
  c: "11".repeat(32),
  token: "22".repeat(32),
  inbox: "33".repeat(32),
  envelope,
});

function validator(receipts) {
  return async ({ tx_hash }) => {
    const receipt = receipts.get(tx_hash);
    if (!receipt) throw new Error("receipt not found");
    return receipt;
  };
}

test("rejects submission without tx_hash", async () => {
  const store = createStore({ validateReceipt: validator(new Map()) });
  await assert.rejects(
    store.submitIntent({ ...base, tx_hash: undefined }),
    /tx_hash must be a 64-byte hex string/,
  );
});

test("rejects unknown tx_hash before matching", async () => {
  const store = createStore({ validateReceipt: validator(new Map()) });
  await assert.rejects(store.submitIntent(base), /receipt not found/);
  assert.deepEqual(store.poll(base.inbox), { matched: false });
});

test("rejects event from wrong contract", async () => {
  const receipts = new Map([
    [base.tx_hash, { contract_id: "wrong", record_id: base.record_id, c: base.c, epoch: 7 }],
  ]);
  const store = createStore({ validateReceipt: validator(receipts) });
  await assert.rejects(store.submitIntent(base), /receipt contract mismatch/);
});

test("rejects record_id and commitment mismatch", async () => {
  const receipts = new Map([
    [base.tx_hash, { contract_id: base.contract_id, record_id: 7, c: "44".repeat(32), epoch: 7 }],
  ]);
  const store = createStore({ validateReceipt: validator(receipts) });
  await assert.rejects(store.submitIntent(base), /receipt record_id mismatch/);
});

test("rejects duplicate record_id and duplicate commitment", async () => {
  const receipts = new Map([
    [base.tx_hash, { contract_id: base.contract_id, record_id: base.record_id, c: base.c, epoch: 7 }],
    ["b".repeat(64), { contract_id: base.contract_id, record_id: 1, c: "44".repeat(32), epoch: 7 }],
  ]);
  const store = createStore({ validateReceipt: validator(receipts) });
  await store.submitIntent(base);

  await assert.rejects(
    store.submitIntent({ ...base, tx_hash: "b".repeat(64), record_id: 0, c: "44".repeat(32), inbox: "55".repeat(32) }),
    /duplicate record_id/,
  );
  await assert.rejects(
    store.submitIntent({ ...base, tx_hash: "b".repeat(64), record_id: 1, inbox: "66".repeat(32) }),
    /duplicate commitment/,
  );
});

test("cross-links only two validated receipts with same token", async () => {
  const bob = {
    ...base,
    tx_hash: "b".repeat(64),
    record_id: 1,
    c: "44".repeat(32),
    inbox: "55".repeat(32),
    envelope: { ...envelope, ciphertext: "Ym9i" },
  };
  const receipts = new Map([
    [base.tx_hash, { contract_id: base.contract_id, record_id: base.record_id, c: base.c, epoch: 7 }],
    [bob.tx_hash, { contract_id: bob.contract_id, record_id: bob.record_id, c: bob.c, epoch: 7 }],
  ]);
  const store = createStore({ validateReceipt: validator(receipts) });

  assert.deepEqual(await store.submitIntent(base), { matched: false });
  assert.deepEqual(store.poll(base.inbox), { matched: false });
  assert.deepEqual(await store.submitIntent(bob), { matched: true });

  assert.deepEqual(store.poll(base.inbox), {
    matched: true,
    counterpart: { record_id: 1, c: bob.c, envelope: bob.envelope },
  });
  assert.deepEqual(store.poll(bob.inbox), {
    matched: true,
    counterpart: { record_id: 0, c: base.c, envelope: base.envelope },
  });
});

test("stores opaque AEAD envelope without decoding plaintext", async () => {
  const receipts = new Map([
    [base.tx_hash, { contract_id: base.contract_id, record_id: base.record_id, c: base.c, epoch: 7 }],
  ]);
  const store = createStore({ validateReceipt: validator(receipts) });
  await store.submitIntent(base);
  assert.deepEqual(store.poll(base.inbox), { matched: false });

  await assert.rejects(
    store.submitIntent({
      ...base,
      tx_hash: "b".repeat(64),
      record_id: 1,
      c: "44".repeat(32),
      inbox: "55".repeat(32),
      envelope: "YWxpY2U=",
    }),
    /envelope must be an AES-256-GCM object/,
  );
});
