import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

import { createCorsMiddleware, ownerAuthorizationPayload, requireOwnerAuthorization } from "./security.js";

test("CORS preflight allows wallet owner proof headers", () => {
  const headers = {};
  let statusCode = 0;
  const middleware = createCorsMiddleware({ origins: "http://127.0.0.1:5174" });
  const req = {
    method: "OPTIONS",
    headers: { origin: "http://127.0.0.1:5174" },
  };
  const res = {
    header(name, value) {
      headers[name.toLowerCase()] = value;
    },
    sendStatus(code) {
      statusCode = code;
    },
  };

  middleware(req, res, () => {
    throw new Error("preflight should not continue");
  });

  assert.equal(statusCode, 204);
  assert.match(headers["access-control-allow-headers"], /X-Crossed-Wallet-Timestamp/);
  assert.match(headers["access-control-allow-headers"], /X-Crossed-Wallet-Signature/);
});

test("owner authorization accepts Freighter SEP-53 signed messages", () => {
  const owner = Keypair.random();
  const timestamp = "1782490000000";
  const payload = ownerAuthorizationPayload({
    action: "dp_activity",
    owner: owner.publicKey(),
    timestamp,
  });
  const messageHash = createHash("sha256")
    .update(Buffer.concat([
      Buffer.from("Stellar Signed Message:\n", "utf8"),
      Buffer.from(payload, "utf8"),
    ]))
    .digest();
  const signature = owner.sign(messageHash).toString("base64");

  assert.doesNotThrow(() => requireOwnerAuthorization({
    action: "dp_activity",
    owner: owner.publicKey(),
    timestamp,
    signature,
    now: Number(timestamp),
  }));
});
