import assert from "node:assert/strict";
import test from "node:test";

import { coordinatorCancelPayload } from "./coordinator-cancel.ts";

test("coordinatorCancelPayload uses on-chain confirmation instead of a wallet message", () => {
  assert.deepEqual(
    coordinatorCancelPayload({
      owner: "GALICE",
      note: "a".repeat(64),
      onchainCancelled: true,
    }),
    {
      owner: "GALICE",
      note: "a".repeat(64),
      onchain_cancelled: true,
    },
  );
});

test("coordinatorCancelPayload includes wallet auth when no on-chain confirmation is supplied", () => {
  assert.deepEqual(
    coordinatorCancelPayload({
      owner: "GALICE",
      note: "b".repeat(64),
      auth: { timestamp: "123", signature: "signed" },
    }),
    {
      owner: "GALICE",
      note: "b".repeat(64),
      timestamp: "123",
      signature: "signed",
    },
  );
});
