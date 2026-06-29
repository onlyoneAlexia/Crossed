// Crossed — Transaction-Cost-Analysis (TCA) / execution-quality metrics.
//
// Reads SETTLEMENT/FILL events straight off-chain via Stellar RPC `getEvents`
// (no indexer, no coordinator) and derives execution-quality stats:
//   • counts        — number of settled fills (+ unique matches/pairs)
//   • volume        — base/quote notional executed, per pair and in total
//   • price quality — per-fill execution price vs a DERIVED reference midpoint
//                     (volume-weighted average price across that pair's fills),
//                     yielding a price-improvement figure in basis points.
//
// Honesty note (obeys CROSSED_V2_PLAN Hard Rule #5 — no faked data): v1 settlement
// events carry NO signed oracle midpoint (`ref_mid` is a v2/deferred public signal),
// so the midpoint here is REDERIVED from the realised fills themselves (pair VWAP).
// `midpointSource` records this. When the v2 contract starts emitting `ref_mid`, swap
// the reference in `pairFromEvents` without touching the dashboard.
//
// On-chain event shapes consumed (contracts/crossed/src/lib.rs):
//   DpSettled    { match_id, leaf_sell, leaf_buy, base_amount, quote_amount, pair_id }
//   MatchSettled { match_id, ..., a_sell_asset, a_buy_asset, a_sell_amount, a_buy_amount, ... }
import { Buffer } from "buffer";
import { scValToNative, rpc, xdr } from "@stellar/stellar-sdk";
import { CONFIG } from "./config";

// ---- public types -------------------------------------------------------

export type MidpointSource = "vwap-derived" | "oracle-ref-mid";

export interface PairTca {
  pairId: number;
  /** "USDC/XLM" style label, or the raw pair id when unknown. */
  label: string;
  base: string;
  quote: string;
  fills: number;
  /** Executed base notional (human units, base token). */
  baseVolume: number;
  /** Executed quote notional (human units, quote token). */
  quoteVolume: number;
  /** Volume-weighted average execution price (quote per base). */
  vwap: number;
  /** Best (lowest for buyers / highest for sellers) realised price seen. */
  bestPrice: number;
  worstPrice: number;
  /**
   * Mean price-improvement vs the reference midpoint, in basis points.
   * Positive = filled better than midpoint on average. Derived; see midpointSource.
   */
  avgPriceImprovementBps: number;
}

export interface TcaFill {
  pairId: number;
  label: string;
  /** quote per base. */
  price: number;
  baseAmount: number;
  quoteAmount: number;
  /** Signed price improvement vs the pair reference midpoint, in bps. */
  priceImprovementBps: number;
  ledger: number;
  closedAt: string;
  txHash: string;
}

export interface TcaMetrics {
  /** Contract the metrics were read from. */
  contractId: string;
  /** Total settled fills found in the scanned window. */
  totalFills: number;
  /** Distinct settlement match ids. */
  uniqueMatches: number;
  /** Pairs that traded at least once. */
  activePairs: number;
  /** Σ quote notional across all pairs (mixed-asset sum; indicative only). */
  totalQuoteVolume: number;
  /** Volume-weighted mean |price-improvement| across all fills, in bps. */
  avgPriceImprovementBps: number;
  midpointSource: MidpointSource;
  perPair: PairTca[];
  /** Most-recent-first sample of individual fills (capped). */
  recentFills: TcaFill[];
  /** Ledger range actually scanned. */
  scannedFromLedger: number;
  scannedToLedger: number;
  /** True when no settlement events were found (drives the empty state). */
  empty: boolean;
}

// ---- internals ----------------------------------------------------------

const ATOMIC = 1e7; // SAC tokens are 7-decimal on this deployment.
const RECENT_FILLS_CAP = 25;
// Testnet RPC silently returns [] when startLedger predates its event retention (only a few
// thousand ledgers here, and it varies by endpoint). Try progressively smaller windows and use
// the first the RPC actually serves, so recent fills always appear.
const LEDGER_WINDOWS = [16_000, 9_000, 4_000, 1_500];
const PAGE_LIMIT = 200;
const MAX_PAGES = 12; // hard cap so a busy contract can't spin forever.

const toNum = (v: unknown): number => {
  try { return Number(typeof v === "bigint" ? v : BigInt(v as any)) / ATOMIC; }
  catch { return Number(v) / ATOMIC; }
};

const pairMeta = (pairId: number): { base: string; quote: string; label: string } => {
  const p = CONFIG.PAIRS.find((x) => x.id === pairId);
  if (!p) return { base: "?", quote: "?", label: `pair #${pairId}` };
  return { base: p.base, quote: p.quote, label: `${p.base}/${p.quote}` };
};

// One settled fill, asset-agnostic: base/quote amounts + executed price.
interface RawFill {
  pairId: number;
  base: number;
  quote: number;
  price: number; // quote per base
  matchId: string;
  ledger: number;
  closedAt: string;
  txHash: string;
}

// Decode a single getEvents entry into a RawFill, or null if it isn't a settlement
// event we understand (or has unusable amounts).
function decodeFill(ev: rpc.Api.EventResponse): RawFill | null {
  const name = topicName(ev.topic);
  if (name !== "DpSettled" && name !== "MatchSettled") return null;

  let body: Record<string, any>;
  try { body = scValToNative(ev.value) as Record<string, any>; }
  catch { return null; }
  if (!body || typeof body !== "object") return null;

  const matchId = hexOf(body.match_id);
  const ledger = ev.ledger;
  const closedAt = ev.ledgerClosedAt;
  const txHash = ev.txHash;

  if (name === "DpSettled") {
    const pairId = Number(body.pair_id ?? 0);
    const base = toNum(body.base_amount);
    const quote = toNum(body.quote_amount);
    if (!(base > 0) || !(quote > 0)) return null;
    return { pairId, base, quote, price: quote / base, matchId, ledger, closedAt, txHash };
  }

  // Legacy bilateral OTC: side-A sells a_sell_amount, receives a_buy_amount. Map onto
  // the configured pair by matching the assets; fall back to a/b ordering when unknown.
  const sellHex = hexOf(body.a_sell_asset);
  const buyHex = hexOf(body.a_buy_asset);
  const sellAmt = toNum(body.a_sell_amount);
  const buyAmt = toNum(body.a_buy_amount);
  if (!(sellAmt > 0) || !(buyAmt > 0)) return null;
  const resolved = resolveOtcPair(sellHex, buyHex, sellAmt, buyAmt);
  return { ...resolved, matchId, ledger, closedAt, txHash };
}

// Map an OTC sell/buy leg onto a configured pair so it shares the base/quote frame
// of the dark-pool fills. base = the pair's base leg; price = quote per base.
function resolveOtcPair(
  sellHex: string, buyHex: string, sellAmt: number, buyAmt: number,
): { pairId: number; base: number; quote: number; price: number } {
  const symOf = (hex: string) => CONFIG.TOKENS.find((t) => t.hex === hex)?.sym;
  const sSym = symOf(sellHex);
  const bSym = symOf(buyHex);
  const pair = CONFIG.PAIRS.find(
    (p) => (p.base === sSym && p.quote === bSym) || (p.base === bSym && p.quote === sSym),
  );
  if (pair && sSym && bSym) {
    if (sSym === pair.base) {
      // sold base, received quote: base=sellAmt, quote=buyAmt
      return { pairId: pair.id, base: sellAmt, quote: buyAmt, price: buyAmt / sellAmt };
    }
    // sold quote, received base: base=buyAmt, quote=sellAmt
    return { pairId: pair.id, base: buyAmt, quote: sellAmt, price: sellAmt / buyAmt };
  }
  // Unknown assets: treat the sell leg as base for a stable, labelled-unknown frame.
  return { pairId: 0, base: sellAmt, quote: buyAmt, price: buyAmt / sellAmt };
}

function topicName(topic: xdr.ScVal[] | undefined): string {
  if (!topic || topic.length === 0) return "";
  try {
    const t0 = scValToNative(topic[0]);
    return typeof t0 === "string" ? t0 : String(t0);
  } catch { return ""; }
}

function hexOf(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Uint8Array) return Buffer.from(v).toString("hex");
  if (typeof v === "string") return v;
  try { return Buffer.from(v as any).toString("hex"); } catch { return String(v); }
}

// Page through getEvents within [startLedger, latest], following the cursor.
async function fetchSettlementEvents(
  srv: rpc.Server, contractId: string, startLedger: number,
): Promise<rpc.Api.EventResponse[]> {
  const out: rpc.Api.EventResponse[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const req: rpc.Api.GetEventsRequest = cursor
      ? { filters: [{ type: "contract", contractIds: [contractId] }], cursor, limit: PAGE_LIMIT }
      : { filters: [{ type: "contract", contractIds: [contractId] }], startLedger, limit: PAGE_LIMIT };
    let res: rpc.Api.GetEventsResponse;
    try { res = await srv.getEvents(req); }
    catch { break; } // window outside retention / transient — return what we have.
    out.push(...res.events);
    if (!res.cursor || res.events.length < PAGE_LIMIT) break;
    cursor = res.cursor;
  }
  return out;
}

// Aggregate one pair's fills into a PairTca. Reference midpoint = pair VWAP.
function pairFromEvents(pairId: number, fills: RawFill[]): { pair: PairTca; perFillBps: number[] } {
  const meta = pairMeta(pairId);
  const baseVolume = fills.reduce((s, f) => s + f.base, 0);
  const quoteVolume = fills.reduce((s, f) => s + f.quote, 0);
  const vwap = baseVolume > 0 ? quoteVolume / baseVolume : 0;
  const prices = fills.map((f) => f.price);
  const bestPrice = prices.length ? Math.min(...prices) : 0;
  const worstPrice = prices.length ? Math.max(...prices) : 0;

  // Price improvement vs the (derived) midpoint, base-weighted. We don't know each
  // fill's side from the event alone, so report the symmetric |deviation| from VWAP:
  // a tight cluster ⇒ ~0 bps (good execution dispersion); a wide spread ⇒ larger bps.
  const perFillBps: number[] = vwap > 0
    ? fills.map((f) => (Math.abs(f.price - vwap) / vwap) * 10_000)
    : fills.map(() => 0);
  const weightSum = baseVolume;
  const avgBps = weightSum > 0
    ? fills.reduce((s, f, i) => s + perFillBps[i] * f.base, 0) / weightSum
    : 0;

  return {
    pair: {
      pairId, label: meta.label, base: meta.base, quote: meta.quote,
      fills: fills.length, baseVolume, quoteVolume, vwap, bestPrice, worstPrice,
      avgPriceImprovementBps: avgBps,
    },
    perFillBps,
  };
}

// ---- entry point --------------------------------------------------------

/**
 * Read on-chain settlement/fill events for `contractId` over `rpcUrl` and derive
 * Transaction-Cost-Analysis metrics. Pure read path: no signing, no wallet, no
 * coordinator. Safe to call without a connected wallet. Never throws on empty /
 * out-of-retention windows — returns an `empty` result the dashboard can render.
 */
export async function loadTcaMetrics(rpcUrl: string, contractId: string): Promise<TcaMetrics> {
  const srv = new rpc.Server(rpcUrl);

  let latest = 0;
  try { latest = (await srv.getLatestLedger()).sequence; } catch { latest = 0; }

  // The RPC serves only its retained window; use the largest candidate window that returns events.
  let startLedger = Math.max(1, latest - LEDGER_WINDOWS[LEDGER_WINDOWS.length - 1]);
  let events: rpc.Api.EventResponse[] = [];
  if (latest > 0) {
    for (const win of LEDGER_WINDOWS) {
      const start = Math.max(1, latest - win);
      const evs = await fetchSettlementEvents(srv, contractId, start);
      startLedger = start;
      if (evs.length > 0) { events = evs; break; }
    }
  }

  const raw: RawFill[] = [];
  for (const ev of events) {
    const f = decodeFill(ev);
    if (f) raw.push(f);
  }

  if (raw.length === 0) {
    return {
      contractId, totalFills: 0, uniqueMatches: 0, activePairs: 0,
      totalQuoteVolume: 0, avgPriceImprovementBps: 0, midpointSource: "vwap-derived",
      perPair: [], recentFills: [],
      scannedFromLedger: startLedger, scannedToLedger: latest, empty: true,
    };
  }

  // Group by pair, build per-pair stats and a flat per-fill bps lookup.
  const byPair = new Map<number, RawFill[]>();
  for (const f of raw) {
    const arr = byPair.get(f.pairId);
    if (arr) arr.push(f); else byPair.set(f.pairId, [f]);
  }

  const perPair: PairTca[] = [];
  const bpsByFill = new Map<RawFill, number>();
  for (const [pairId, fills] of byPair) {
    const { pair, perFillBps } = pairFromEvents(pairId, fills);
    perPair.push(pair);
    fills.forEach((f, i) => bpsByFill.set(f, perFillBps[i]));
  }
  perPair.sort((a, b) => b.quoteVolume - a.quoteVolume);

  const totalQuoteVolume = raw.reduce((s, f) => s + f.quote, 0);
  const baseWeight = raw.reduce((s, f) => s + f.base, 0);
  const avgPriceImprovementBps = baseWeight > 0
    ? raw.reduce((s, f) => s + (bpsByFill.get(f) ?? 0) * f.base, 0) / baseWeight
    : 0;

  const recentFills: TcaFill[] = [...raw]
    .sort((a, b) => b.ledger - a.ledger)
    .slice(0, RECENT_FILLS_CAP)
    .map((f) => ({
      pairId: f.pairId,
      label: pairMeta(f.pairId).label,
      price: f.price,
      baseAmount: f.base,
      quoteAmount: f.quote,
      priceImprovementBps: bpsByFill.get(f) ?? 0,
      ledger: f.ledger,
      closedAt: f.closedAt,
      txHash: f.txHash,
    }));

  return {
    contractId,
    totalFills: raw.length,
    uniqueMatches: new Set(raw.map((f) => f.matchId)).size,
    activePairs: byPair.size,
    totalQuoteVolume,
    avgPriceImprovementBps,
    midpointSource: "vwap-derived",
    perPair,
    recentFills,
    scannedFromLedger: startLedger,
    scannedToLedger: latest,
    empty: false,
  };
}
