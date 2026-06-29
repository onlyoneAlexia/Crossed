import test from "node:test";
import assert from "node:assert/strict";
import {
  fillNotesFromRecord,
  fillSideForNote,
  fillSwapAmountsForOrderSide,
  residualSideForNote,
  noteKey,
  nonzeroNote,
} from "./order-activity.ts";

test("normalizes order and fill notes", () => {
  assert.equal(noteKey("0xABCdef"), "abcdef");
  assert.equal(nonzeroNote("0x000000"), "");
  assert.equal(nonzeroNote("0xABCdef"), "abcdef");
});

test("collects fill notes from current and legacy field shapes", () => {
  const notes = fillNotesFromRecord({
    note_sell: "0xaaa",
    note_buy: "bbb",
    sell_note: "0xccc",
    buy_note: "ddd",
    sell: { note: "eee" },
    buy: { note: "fff" },
    notes: ["0xaaa", "000", "123"],
  });

  assert.deepEqual(notes, ["aaa", "bbb", "ccc", "ddd", "eee", "fff", "123"]);
});

test("detects whether a fill matched the sell or buy side of an order", () => {
  const fill = {
    note_sell: "0xABC",
    note_buy: "0xDEF",
  };

  assert.equal(fillSideForNote(fill, "abc"), "sell");
  assert.equal(fillSideForNote(fill, "0xdef"), "buy");
  assert.equal(fillSideForNote(fill, "999"), null);
});

test("detects whether a fill created a residual change-note for an order", () => {
  const fill = {
    change_note_sell: "0x" + "0".repeat(64),
    change_note_buy: "0xBBB",
  };

  assert.equal(residualSideForNote(fill, "bbb"), "buy");
  assert.equal(residualSideForNote(fill, "0xaaa"), null);
});

test("formats filled swap amounts in the trader order direction", () => {
  const fill = {
    fill_base: "800000000",
    fill_quote: "1000000000",
  };

  assert.deepEqual(fillSwapAmountsForOrderSide(fill, 1), {
    pay: "1000000000",
    get: "800000000",
  });
  assert.deepEqual(fillSwapAmountsForOrderSide(fill, 0), {
    pay: "800000000",
    get: "1000000000",
  });
});
