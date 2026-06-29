import assert from "node:assert/strict";
import test from "node:test";
import { Address, nativeToScVal } from "@stellar/stellar-sdk";

import { contractInvocation, sourceAccountAuthEntry } from "./soroban-auth.ts";

test("sourceAccountAuthEntry builds an auth entry covered by the transaction signature", () => {
  const owner = "GDIDUF2GPOPNJFDLKYUNK26A4QUSE7HKKPVEHS7NQTCVQ3TEVQTCDRNN";
  const dpContract = "CAR5DF4XFMD2ENXVIZPGHNQCRHHO4EBIGAOJ22NVJB6ZGAEEX4DD74QP";
  const token = "CAZ2G2KVLXUZOPCIF5VHB5NSC7PJDLJ57VCPDFZTJG7E46I2Y5JNJ32O";
  const amount = "10000000";
  const args = [
    Address.fromString(owner).toScVal(),
    Address.fromString(token).toScVal(),
    nativeToScVal(BigInt(amount), { type: "i128" }),
  ];
  const transfer = contractInvocation(token, "transfer", [
    Address.fromString(owner).toScVal(),
    Address.fromString(dpContract).toScVal(),
    nativeToScVal(BigInt(amount), { type: "i128" }),
  ]);

  const entry = sourceAccountAuthEntry(dpContract, "deposit", args, [transfer]);

  assert.equal(entry.credentials().switch().name, "sorobanCredentialsSourceAccount");
  assert.equal(entry.rootInvocation().function().contractFn().functionName().toString(), "deposit");
  assert.equal(entry.rootInvocation().subInvocations().length, 1);
  assert.equal(entry.rootInvocation().subInvocations()[0].function().contractFn().functionName().toString(), "transfer");
});
