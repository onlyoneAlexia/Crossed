export type FillSide = "sell" | "buy";

export function noteKey(note: unknown): string {
  return typeof note === "string" ? note.replace(/^0x/i, "").toLowerCase() : "";
}

export function nonzeroNote(note: unknown): string {
  const n = noteKey(note);
  return n && !/^0+$/.test(n) ? n : "";
}

function valuesOf(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [value];
}

function notesForSide(fill: any, side: FillSide): string[] {
  const isSell = side === "sell";
  const direct = isSell
    ? [fill?.note_sell, fill?.sell_note, fill?.noteSell]
    : [fill?.note_buy, fill?.buy_note, fill?.noteBuy];
  const nested = isSell
    ? [fill?.sell?.note, fill?.order_sell?.note, fill?.sell_order?.note]
    : [fill?.buy?.note, fill?.order_buy?.note, fill?.buy_order?.note];
  return [...direct, ...nested].map(nonzeroNote).filter(Boolean);
}

function residualNotesForSide(fill: any, side: FillSide): string[] {
  const isSell = side === "sell";
  const direct = isSell
    ? [fill?.change_note_sell, fill?.residual_note_sell]
    : [fill?.change_note_buy, fill?.residual_note_buy];
  const nested = isSell
    ? [fill?.changeSell?.note, fill?.change_sell?.note]
    : [fill?.changeBuy?.note, fill?.change_buy?.note];
  return [...direct, ...nested].map(nonzeroNote).filter(Boolean);
}

function atomicString(value: unknown): string | null {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value) ? value : null;
}

export function fillNotesFromRecord(fill: any): string[] {
  const seen = new Set<string>();
  const notes = [
    fill?.note_sell,
    fill?.note_buy,
    fill?.sell_note,
    fill?.buy_note,
    fill?.noteSell,
    fill?.noteBuy,
    fill?.sell?.note,
    fill?.buy?.note,
    fill?.order_sell?.note,
    fill?.order_buy?.note,
    fill?.sell_order?.note,
    fill?.buy_order?.note,
    ...valuesOf(fill?.notes).map(nonzeroNote).filter(Boolean),
  ].map(nonzeroNote).filter(Boolean);
  return notes.filter((note: string) => {
    if (seen.has(note)) return false;
    seen.add(note);
    return true;
  });
}

export function fillSideForNote(fill: any, note: unknown): FillSide | null {
  const target = nonzeroNote(note);
  if (!target) return null;
  if (notesForSide(fill, "sell").includes(target)) return "sell";
  if (notesForSide(fill, "buy").includes(target)) return "buy";
  return null;
}

export function residualSideForNote(fill: any, note: unknown): FillSide | null {
  const target = nonzeroNote(note);
  if (!target) return null;
  if (residualNotesForSide(fill, "sell").includes(target)) return "sell";
  if (residualNotesForSide(fill, "buy").includes(target)) return "buy";
  return null;
}

export function fillSwapAmountsForOrderSide(fill: any, orderSide: 0 | 1): { pay: string; get: string } | null {
  const base = atomicString(fill?.fill_base ?? fill?.base_amount);
  const quote = atomicString(fill?.fill_quote ?? fill?.quote_amount);
  if (!base || !quote) return null;
  return orderSide === 0
    ? { pay: base, get: quote }
    : { pay: quote, get: base };
}
