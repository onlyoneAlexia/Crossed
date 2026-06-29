import assert from "node:assert/strict";
import test from "node:test";

import {
  atomicToDecimalString,
  formatAtomicAmount,
  formatAtomicRatio,
  parseAtomicAmount,
} from "./amounts.ts";

test("parseAtomicAmount truncates human token input to 7 atomic decimals", () => {
  assert.equal(parseAtomicAmount("10"), 100000000n);
  assert.equal(parseAtomicAmount("2.5"), 25000000n);
  assert.equal(parseAtomicAmount("1.123456789"), 11234567n);
  assert.equal(parseAtomicAmount(""), 0n);
});

test("parseAtomicAmount rejects malformed values without throwing", () => {
  assert.equal(parseAtomicAmount("1.2.3"), null);
  assert.equal(parseAtomicAmount("-1"), null);
  assert.equal(parseAtomicAmount("abc"), null);
});

test("atomicToDecimalString preserves all 7 decimals without Number conversion", () => {
  assert.equal(atomicToDecimalString(100000000n), "10");
  assert.equal(atomicToDecimalString(25000000n), "2.5");
  assert.equal(atomicToDecimalString(1n), "0.0000001");
});

test("formatAtomicAmount shows at most 4 decimals and truncates instead of rounding", () => {
  assert.equal(formatAtomicAmount(100000000n), "10");
  assert.equal(formatAtomicAmount(12345678n), "1.2345");
  assert.equal(formatAtomicAmount(19999999n), "1.9999");
  assert.equal(formatAtomicAmount(1n), "<0.0001");
});

test("formatAtomicRatio shows quote-per-base at 4 decimals", () => {
  assert.equal(formatAtomicRatio(250000000n, 100000000n), "2.5");
  assert.equal(formatAtomicRatio(10000000n, 30000000n), "0.3333");
  assert.equal(formatAtomicRatio(0n, 10000000n), "0");
});
