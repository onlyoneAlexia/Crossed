import assert from "node:assert/strict";
import test from "node:test";

import { createWalletStateStore } from "./wallet-state.ts";

test("wallet state store notifies when the wallet account changes", () => {
  const store = createWalletStateStore("GA");
  const seen: (string | null)[] = [];

  store.subscribe((state) => seen.push(state.address));

  assert.equal(store.setAddress("GB"), true);
  assert.equal(store.getAddress(), "GB");
  assert.deepEqual(seen, ["GB"]);
});

test("wallet state store clears subscribers on disconnect", () => {
  const store = createWalletStateStore("GA");
  const seen: (string | null)[] = [];

  store.subscribe((state) => seen.push(state.address));

  assert.equal(store.setAddress(null), true);
  assert.equal(store.getAddress(), null);
  assert.deepEqual(seen, [null]);
});

test("wallet state store ignores duplicate account updates", () => {
  const store = createWalletStateStore("GA");
  let calls = 0;

  store.subscribe(() => { calls += 1; });

  assert.equal(store.setAddress("GA"), false);
  assert.equal(calls, 0);
});

test("wallet state subscriptions can be removed", () => {
  const store = createWalletStateStore("GA");
  let calls = 0;

  const unsubscribe = store.subscribe(() => { calls += 1; });
  unsubscribe();
  store.setAddress("GB");

  assert.equal(calls, 0);
});
