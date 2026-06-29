import test from "node:test";
import assert from "node:assert/strict";

import { createOwnerAuthorizationCache, ownerAuthorizationPayload, resolveOwnerAuthorization } from "./coordinator-auth.ts";

test("ownerAuthorizationPayload matches the coordinator canonical message", () => {
  assert.equal(
    ownerAuthorizationPayload({
      action: "dp_fills",
      owner: "GALICE",
      timestamp: "1782490000000",
    }),
    [
      "domain=crossed.coordinator",
      "version=1",
      "action=dp_fills",
      "owner=GALICE",
      "timestamp=1782490000000",
    ].join("\n"),
  );
});

test("ownerAuthorizationPayload normalizes optional notes without a 0x prefix", () => {
  assert.match(
    ownerAuthorizationPayload({
      action: "dp_cancel",
      owner: "GALICE",
      note: "0xABCDEF",
      timestamp: "1782490000000",
    }),
    /note=abcdef\n/,
  );
});

test("owner authorization cache exposes cached auth without prompting", async () => {
  const cache = createOwnerAuthorizationCache();
  let signCount = 0;

  assert.equal(cache.peek({ action: "dp_fills", owner: "GALICE", now: 1000 }), null);

  const auth = await cache.get({
    action: "dp_fills",
    owner: "GALICE",
    now: 1000,
    signMessage: async () => {
      signCount += 1;
      return "signed";
    },
  });

  assert.equal(auth.signature, "signed");
  assert.equal(signCount, 1);
  assert.equal(cache.peek({ action: "dp_fills", owner: "GALICE", now: 2000 })?.signature, "signed");
  assert.equal(signCount, 1);
});

test("owner authorization cache coalesces concurrent signing requests", async () => {
  const cache = createOwnerAuthorizationCache();
  let signCount = 0;
  let resolveSignature!: (value: string) => void;
  const signature = new Promise<string>((resolve) => { resolveSignature = resolve; });

  const first = cache.get({
    action: "dp_fills",
    owner: "GALICE",
    now: 1000,
    signMessage: async () => {
      signCount += 1;
      return signature;
    },
  });
  const second = cache.get({
    action: "dp_fills",
    owner: "GALICE",
    now: 1001,
    signMessage: async () => {
      signCount += 1;
      return "second-signature";
    },
  });

  assert.equal(signCount, 1);
  resolveSignature("first-signature");
  assert.equal((await first).signature, "first-signature");
  assert.equal((await second).signature, "first-signature");
  assert.equal(signCount, 1);
});

test("resolveOwnerAuthorization does not prompt unless explicitly requested", async () => {
  const cache = createOwnerAuthorizationCache();
  let signCount = 0;

  const passive = await resolveOwnerAuthorization({
    cache,
    action: "dp_fills",
    owner: "GALICE",
    now: 1000,
    signMessage: async () => {
      signCount += 1;
      return "signed";
    },
  });

  assert.equal(passive, null);
  assert.equal(signCount, 0);

  const prompted = await resolveOwnerAuthorization({
    cache,
    action: "dp_fills",
    owner: "GALICE",
    prompt: true,
    now: 1000,
    signMessage: async () => {
      signCount += 1;
      return "signed";
    },
  });

  assert.equal(prompted?.signature, "signed");
  assert.equal(signCount, 1);
});
