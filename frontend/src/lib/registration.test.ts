import test from "node:test";
import assert from "node:assert/strict";

import { registrationForIdentity } from "./registration.ts";

test("registrationForIdentity keeps a cached registration that matches the identity leaf", () => {
  const registration = registrationForIdentity({
    owner: "GALICE",
    cached: { owner: "GALICE", index: 1, leaf: "0x" + "ab".repeat(32) },
    identityLeaf: "ab".repeat(32),
    leaves: ["0x" + "00".repeat(32), "0x" + "ab".repeat(32)],
  });

  assert.deepEqual(registration, { owner: "GALICE", index: 1, leaf: "0x" + "ab".repeat(32) });
});

test("registrationForIdentity repairs a stale cached index when the identity leaf exists elsewhere", () => {
  const registration = registrationForIdentity({
    owner: "GALICE",
    cached: { owner: "GALICE", index: 5, leaf: "0x" + "cd".repeat(32) },
    identityLeaf: "0x" + "ab".repeat(32),
    leaves: ["0x" + "00".repeat(32), "0x" + "ab".repeat(32), "0x" + "cd".repeat(32)],
  });

  assert.deepEqual(registration, { owner: "GALICE", index: 1, leaf: "0x" + "ab".repeat(32) });
});

test("registrationForIdentity returns null when the saved identity is not registered", () => {
  const registration = registrationForIdentity({
    owner: "GALICE",
    cached: { owner: "GALICE", index: 1, leaf: "0x" + "cd".repeat(32) },
    identityLeaf: "0x" + "ab".repeat(32),
    leaves: ["0x" + "00".repeat(32), "0x" + "cd".repeat(32)],
  });

  assert.equal(registration, null);
});
