import { useEffect, useRef, useState } from "react";
import "./App.css";
import { init, createIdentity, leafOf, proveDpCancelOrder, proveDpCancelOrderV2, proveDpOrder, proveDpOrderV2, randomSalt, type Identity } from "./lib/otc";
import * as chain from "./lib/chain";
import { CONFIG } from "./lib/config";
import { TokenIcon } from "./components/TokenIcon";
import { ThemeToggle } from "./components/ThemeToggle";
import { connectWallet, currentWalletAddress, disconnectWallet, restoreWallet, subscribeWalletChanges } from "./lib/wallet";
// v2 gap-closure components — each rendered only behind its CONFIG.FEATURES flag, so with
// all flags false this file renders byte-for-byte the current live demo.
import { KillSwitchBanner } from "./components/KillSwitchBanner";
import { AdvancedOrderFields, type AdvancedOrder } from "./components/AdvancedOrderFields";
import { PartialFillRow } from "./components/PartialFillRow";
import { atomicToDecimalString, formatAtomicAmount, formatAtomicRatio, formatDecimalAmount, parseAtomicAmount, TOKEN_SCALE } from "./lib/amounts";
import { ACTIVITY_DEFAULT_OPEN, activityStatusLabel, activitySummary } from "./lib/activity-panel";
import { assertCoordinatorReady } from "./lib/coordinator-health";
import {
  fillNotesFromRecord,
  fillSideForNote,
  fillSwapAmountsForOrderSide,
  noteKey,
  nonzeroNote,
  residualSideForNote,
} from "./lib/order-activity";
import { registrationForIdentity } from "./lib/registration";

// Dark-pool app surface. The default pair trades USDC base vs XLM quote,
// but the pool itself can custody many assets — the "In the pool" panel lists them generically.
// The order form is a generic swap (pay X / receive Y) mapped onto the pool's side/size/limit:
//  - Pay USDC, receive XLM  => SELL USDC (side 0): escrow the USDC you pay.
//  - Pay XLM,  receive USDC => BUY  USDC (side 1): escrow the XLM you pay.
// The "receive" amount sets your limit price (XLM per USDC). Orders are opaque on-chain.

// Namespaced by contract id AND wallet owner, so switching wallets never clobbers another wallet's
// identity/membership, and a redeploy never collides with stale state.
const NS = `crossed.${CONFIG.DP_CONTRACT_ID}`;
const idKey = (owner: string) => `${NS}.id.${owner}.v3`;
const regKey = (owner: string) => `${NS}.reg.${owner}.v3`;
const ordersKey = (owner: string) => `${NS}.orders.${owner}.v3`;
type Tok = string;
type Registration = { index: number; owner: string; leaf?: string };
type OpenOrder = {
  owner: string;
  note: string;
  pay: string;
  from: Tok;
  get: string;
  to: Tok;
  side: 0 | 1;
  size: string;
  limitPrice: string;
  salt: string;
  pairId: number;
  batchId: string;
  expiry?: string;
  maq?: string;
  tier?: number;
  tif?: AdvancedOrder["tif"];
  tx?: string;
  cancelable?: boolean;
  status?: "pending" | "fulfilled";
  matchedTx?: string;
  matchedAt?: number;
  matchedSource?: "fill" | "chain";
};
type AdvancedOpenOrder = OpenOrder & { expiry: string; maq: string; tier: number };

// Assets the dark pool can hold — driven by the token registry.
const POOL_ASSETS: { sym: Tok; c: string }[] = CONFIG.TOKENS.map((t) => ({ sym: t.sym, c: t.c }));
const tokenC = (sym: Tok): string => CONFIG.TOKENS.find((t) => t.sym === sym)?.c ?? "";
const OTHER = (t: Tok): Tok => POOL_ASSETS.find((a) => a.sym !== t)?.sym ?? t;
const isAdvancedOpenOrder = (order: OpenOrder): order is AdvancedOpenOrder => (
  order.expiry !== undefined && order.maq !== undefined && order.tier !== undefined
);

// Resolve the configured pair + order side for a generic from→to swap.
//  side 0 = sell base (pay base, receive quote); side 1 = buy base (pay quote, receive base).
function resolvePair(from: Tok, to: Tok): { id: number; side: 0 | 1; base: Tok; quote: Tok } | null {
  const p = CONFIG.PAIRS.find((x) => (x.base === from && x.quote === to) || (x.base === to && x.quote === from));
  if (!p) return null;
  return { id: p.id, side: from === p.base ? 0 : 1, base: p.base, quote: p.quote };
}
const pairById = (id: number) => CONFIG.PAIRS.find((p) => p.id === id);

// The ZK pool identity is stored PLAINTEXT, per wallet. Deliberate trade-off (confirmed via review):
// it lets a returning or switched-back wallet use the pool with NO extra signature. The identity only
// authorizes dark-pool orders for the already-registered owner — funds stay gated by the Freighter-
// signed deposit/settle — so its blast radius is limited. TODO(security): passkey/WebAuthn for prod.
const idPlain = (id: Identity) => JSON.stringify({ sk: id.sk.toString(), pkX: id.pkX.toString(), pkY: id.pkY.toString(), hSk: id.hSk.toString() });
const idFromPlain = (plain: string): Identity => { const o = JSON.parse(plain); return { sk: BigInt(o.sk), pkX: BigInt(o.pkX), pkY: BigInt(o.pkY), hSk: BigInt(o.hSk) }; };
const saveId = (id: Identity, owner: string) => localStorage.setItem(idKey(owner), idPlain(id));
const loadId = (owner: string): Identity | null => {
  const s = localStorage.getItem(idKey(owner));
  if (!s) return null;
  try { return idFromPlain(s); } catch { return null; }
};
const loadReg = (owner: string): Registration | null => {
  const s = localStorage.getItem(regKey(owner));
  if (!s) return null;
  try {
    const o = JSON.parse(s);
    return o?.owner === owner && Number.isInteger(o.index) ? o : null;
  } catch {
    return null;
  }
};
const saveReg = (reg: Registration) => localStorage.setItem(regKey(reg.owner), JSON.stringify(reg));
const loadOrders = (owner: string): OpenOrder[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(ordersKey(owner)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((order) => order?.owner === owner && typeof order.note === "string") : [];
  } catch {
    return [];
  }
};
const saveOrders = (orders: OpenOrder[], owner: string) => localStorage.setItem(ordersKey(owner), JSON.stringify(orders));
const nowt = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

const DEFAULT_EXPIRY_MINS = 60;
const expiryFromAdvanced = (order: AdvancedOrder): bigint => {
  const now = Date.now();
  if (order.tif === "DAY") {
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    return BigInt(Math.floor(endOfDay.getTime() / 1000));
  }
  if (order.tif === "IOC") {
    return BigInt(Math.floor(now / 1000) + 2 * 60);
  }
  return BigInt(Math.floor(now / 1000) + (order.expiryMins ?? DEFAULT_EXPIRY_MINS) * 60);
};
const maqFromAdvanced = (order: AdvancedOrder): bigint => {
  const parsed = parseAtomicAmount(order.minFill ?? "0");
  if (parsed === null) throw new Error("min fill must be a valid amount");
  return parsed;
};
const tierFromAdvanced = (order: AdvancedOrder): number => order.tier ?? 0;
const fmt = (a: bigint | string) => formatAtomicAmount(a);
const num = (s: string) => formatDecimalAmount(s);
const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
const atomicString = (value: unknown): string | undefined => {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value).toString();
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  return undefined;
};

const HOW_IT_WORKS =
  "Orders are sealed: your browser proves membership locally, then only an opaque commitment and one-time order opening reach the coordinator. A trusted coordinator matches sealed batches and settles the swap, but funds only move when an on-chain zero-knowledge proof confirms the two orders genuinely cross.";

function InfoButton() {
  return (
    <span className="info-wrap">
      <button type="button" className="info-btn" aria-label="How Crossed works">i</button>
      <span className="info-tip" role="tooltip">{HOW_IT_WORKS}</span>
    </span>
  );
}

// Link a tx hash out to the Stellar block explorer (testnet — switch to /public for mainnet).
const txUrl = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;
// The pool's full on-chain history (invocations + DpSettled/OrderPlaced/Registered events) on the
// ecosystem's Etherscan-equivalent. No custom indexer needed — stellar.expert already indexes it.
const POOL_EXPLORER = `https://stellar.expert/explorer/testnet/contract/${CONFIG.DP_CONTRACT_ID}`;
function TxLink({ tx }: { tx?: string }) {
  const [copied, setCopied] = useState(false);
  if (!tx) return null;
  return (
    <span className="tx-link-wrap">
      <a className="tiny mono tx-link" href={txUrl(tx)} target="_blank" rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()} title="View transaction on Stellar Explorer">
        {tx.slice(0, 10)}…
      </a>
      <button type="button" className="tx-copy" title="Copy full tx hash" aria-label="Copy transaction hash"
        onClick={(e) => {
          e.stopPropagation();
          navigator.clipboard?.writeText(tx).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1200); }).catch(() => {});
        }}>
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}

// Money figures tick from their previous value to the new one (crunchy, stepped) so the
// "0 -> 49" pool/balance refresh has a beat instead of snapping. Honors reduced-motion.
function AnimatedNum({ value }: { value: string }) {
  const target = Number(value);
  const decimals = Math.min((value.split(".")[1] || "").length, 4);
  const prev = useRef(Number.isFinite(target) ? target : 0);
  const [disp, setDisp] = useState(prev.current);
  useEffect(() => {
    if (!Number.isFinite(target)) { setDisp(target); return; }
    const from = prev.current, to = target;
    if (from === to) { setDisp(to); return; }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { prev.current = to; setDisp(to); return; }
    const start = performance.now(), dur = 450;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisp(from + (to - from) * eased);
      if (t < 1) raf = requestAnimationFrame(tick); else { prev.current = to; setDisp(to); }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return <>{formatDecimalAmount((Number.isFinite(disp) ? disp : 0).toFixed(decimals))}</>;
}

// Guard a stale cached registration: the cached index must still hold the cached (public) leaf in the
// current coordinator directory (e.g. after a contract/coordinator change). Uses only the public leaf
// so it can run on app open WITHOUT unlocking the identity (no wallet signature).
async function verifyRegistration(r: Registration): Promise<boolean> {
  if (!r.leaf) return true; // legacy cache without a stored leaf — can't verify without a sig; keep it
  try {
    const dir = await chain.coordDirectory();
    if (r.index < 0 || r.index >= dir.count) return false;
    const onChain = dir.leaves[r.index];
    if (!onChain) return false;
    const toBig = (s: string) => BigInt(/^0x/i.test(s) ? s : "0x" + s);
    return toBig(onChain) === toBig(r.leaf);
  } catch {
    return true; // transient coordinator/network error — keep the cached reg
  }
}

// v2 nav callbacks are optional so the existing call sites (and any flag-off path) stay valid.
type DarkPoolProps = {
  onHome: () => void;
  onFaucet: () => void;
  onTca?: () => void;
  onViewingKeys?: () => void;
};

const ADVANCED_ON = CONFIG.FEATURES.tif || CONFIG.FEATURES.maq || CONFIG.FEATURES.tiers;
const DEFAULT_ADVANCED: AdvancedOrder = { tif: "GTT" };

// Compact "Menu" dropdown for the secondary pages — keeps the top bar from sprawling.
function PagesMenu({ onFaucet, onTca, onViewingKeys }: { onFaucet: () => void; onTca?: () => void; onViewingKeys?: () => void }) {
  const [open, setOpen] = useState(false);
  const items: { label: string; on: () => void }[] = [{ label: "Get test tokens", on: onFaucet }];
  if (CONFIG.FEATURES.tca && onTca) items.push({ label: "Activity & prices", on: onTca });
  if (CONFIG.FEATURES.viewingKeys && onViewingKeys) items.push({ label: "Audit key", on: onViewingKeys });
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button className="btn ghost sm" type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Menu ▾</button>
      {open ? (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div className="card px-pop" style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 50, padding: 6, display: "grid", gap: 4, minWidth: 190, margin: 0 }}>
            {items.map((it) => (
              <button key={it.label} className="btn ghost sm" type="button"
                style={{ width: "100%", justifyContent: "flex-start", textAlign: "left" }}
                onClick={() => { setOpen(false); it.on(); }}>{it.label}</button>
            ))}
            <a className="btn ghost sm" href={POOL_EXPLORER} target="_blank" rel="noopener noreferrer"
              style={{ width: "100%", justifyContent: "flex-start", textAlign: "left", textDecoration: "none" }}
              onClick={() => setOpen(false)}>View on-chain ↗</a>
          </div>
        </>
      ) : null}
    </span>
  );
}

export default function DarkPool({ onHome, onFaucet, onTca, onViewingKeys }: DarkPoolProps) {
  const [ready, setReady] = useState(false);
  const [addr, setAddr] = useState("");
  const [reg, setReg] = useState<Registration | null>(null);
  const [bal, setBal] = useState<Record<string, string>>({});
  const [esc, setEsc] = useState<Record<string, string>>({});
  const [pool, setPool] = useState<Record<string, string>>({});
  const [fromTok, setFromTok] = useState<Tok>("USDC");
  const [toTok, setToTok] = useState<Tok>("XLM");
  const [payAmt, setPayAmt] = useState("10");
  const [getAmt, setGetAmt] = useState("25");
  const [openSel, setOpenSel] = useState<null | "from" | "to" | "withdraw">(null);
  const [busy, setBusy] = useState(false);
  const [fills, setFills] = useState<any[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenOrder[]>([]);
  const [status, setStatus] = useState<{ t: string; m: string; tone?: "ok" | "bad" } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activityOpen, setActivityOpen] = useState(ACTIVITY_DEFAULT_OPEN);
  // v2 (flag-gated) state. paused drives the kill-switch banner; advanced holds the extra
  // order fields; withdrawAmt/withdrawTok drive the always-available withdraw control;
  // passkeyOn is the passkey-custody opt-in. None of these affect the flags-off render path.
  const [paused] = useState(false);
  const [pauseReason] = useState<string | undefined>(undefined);
  const [advanced, setAdvanced] = useState<AdvancedOrder>(DEFAULT_ADVANCED);
  const [withdrawTok, setWithdrawTok] = useState<Tok>("USDC");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [passkeyOn, setPasskeyOn] = useState(false);
  const meRef = useRef<Identity | null>(null);
  const openOrdersRef = useRef<OpenOrder[]>([]);
  const matchNoticeRef = useRef<Set<string>>(new Set());
  const autoMatchRef = useRef(false);
  const activityModalRef = useRef<HTMLElement | null>(null);
  const say = (m: string, tone?: "ok" | "bad") => setStatus({ t: nowt(), m, tone });
  const copy = (text: string, id: string) => {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200);
    }).catch(() => {});
  };

  useEffect(() => { openOrdersRef.current = openOrders; }, [openOrders]);

  useEffect(() => { (async () => {
    void init(); // warm crypto in the background; proof/identity fns await it when needed
    try {
      const restored = await restoreWallet();
      if (restored) {
        void activateWallet(restored);
        return;
      }
    } catch {
      // No approved wallet yet. The app stays inert until the user connects.
    }
    setReady(true);
  })(); }, []);

  useEffect(() => subscribeWalletChanges((state) => {
    const next = state.address;
    if (!next) {
      clearWalletView(addr ? "Wallet disconnected" : undefined);
      setReady(true);
      return;
    }
    if (next === addr) {
      void refresh(next);
      return;
    }
    void activateWallet(next, true);
  }), [addr]);

  useEffect(() => {
    const close = () => setOpenSel(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  useEffect(() => {
    if (!activityOpen) return;
    const focusables = () => Array.from(
      activityModalRef.current?.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setActivityOpen(false); return; }
      if (event.key === "Tab") {
        const f = focusables();
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const prevFocus = document.activeElement as HTMLElement | null;
    // move focus into the dialog (Close button) so Tab is trapped inside, not behind the backdrop
    const focusTimer = window.setTimeout(() => {
      activityModalRef.current?.querySelector<HTMLButtonElement>(".activity-modal-close")?.focus();
    }, 0);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      window.clearTimeout(focusTimer);
      prevFocus?.focus?.();   // restore focus to the trigger on close
    };
  }, [activityOpen]);

  async function fetchFills(owner = addr, options: { prompt?: boolean } = {}): Promise<any[] | null> {
    if (!owner) return [];
    const response: any = await chain.dpActivity(owner, options);
    if (response === null) return null;
    if (Array.isArray(response.orders)) {
      const merged = mergeCoordinatorOrders(openOrdersRef.current, response.orders, owner);
      saveOpenOrderState(merged, owner);
    }
    const next = response?.fills ?? [];
    const list = Array.isArray(next) ? next : [];
    setFills(list);
    return list;
  }

  function fillNotes(fill: any): string[] {
    return fillNotesFromRecord(fill);
  }

  function sideForOrder(fill: any, order: OpenOrder): "sell" | "buy" | null {
    return fillSideForNote(fill, order.note);
  }

  function saveOpenOrderState(next: OpenOrder[], owner: string) {
    openOrdersRef.current = next;
    saveOrders(next, owner);
    setOpenOrders(next);
  }

  function orderLabel(order: OpenOrder): string {
    return `${order.pay} ${order.from} -> ${order.get} ${order.to}`;
  }

  function notifyMatchedOrder(order: OpenOrder, kind: "full" | "partial") {
    const key = `${noteKey(order.note)}:${kind}`;
    if (!noteKey(order.note) || matchNoticeRef.current.has(key)) return;
    matchNoticeRef.current.add(key);
    say(kind === "partial"
      ? `Your sealed order partially matched: ${orderLabel(order)}.`
      : `Your sealed order matched: ${orderLabel(order)}.`);
  }

  function fulfilledOrder(order: OpenOrder, fill?: any, source: "fill" | "chain" = "fill"): OpenOrder {
    const tx = fill?.tx ?? order.matchedTx ?? order.tx;
    return {
      ...order,
      status: "fulfilled",
      cancelable: false,
      tx: tx ?? order.tx,
      matchedTx: tx,
      matchedAt: order.matchedAt ?? Date.now(),
      matchedSource: source,
    };
  }

  function residualOrderFromFill(order: OpenOrder, fill: any, side: "sell" | "buy"): OpenOrder | null {
    const change = side === "sell" ? (fill?.changeSell ?? fill?.change_sell) : (fill?.changeBuy ?? fill?.change_buy);
    const changeNote = nonzeroNote(side === "sell"
      ? (fill?.change_note_sell ?? fill?.residual_note_sell ?? change?.note)
      : (fill?.change_note_buy ?? fill?.residual_note_buy ?? change?.note));
    if (!changeNote) return null;

    const fillBase = BigInt(atomicString(fill?.fill_base ?? fill?.base_amount) ?? "0");
    const residualBase = BigInt(
      atomicString(side === "sell"
        ? (fill?.residual_sell ?? fill?.residual_base_sell ?? change?.size)
        : (fill?.residual_buy ?? fill?.residual_base_buy ?? change?.size))
      ?? atomicString(fill?.residual_base)
      ?? (BigInt(order.size) > fillBase ? (BigInt(order.size) - fillBase).toString() : "0"),
    );
    if (residualBase <= 0n) return null;

    const residualQuote = (residualBase * BigInt(order.limitPrice)) / TOKEN_SCALE;
    const fromIsBase = order.side === 0;
    const changeSalt = atomicString(side === "sell"
      ? (fill?.change_salt_sell ?? change?.change_salt ?? change?.salt)
      : (fill?.change_salt_buy ?? change?.change_salt ?? change?.salt));

    return {
      ...order,
      note: changeNote,
      size: residualBase.toString(),
      salt: changeSalt ?? order.salt,
      pay: fmt(fromIsBase ? residualBase : residualQuote),
      get: fmt(fromIsBase ? residualQuote : residualBase),
      tx: fill?.tx ?? order.tx,
      status: "pending",
      matchedTx: undefined,
      matchedAt: undefined,
      matchedSource: undefined,
      cancelable: changeSalt ? order.cancelable : false,
    };
  }

  function dedupeOrders(orders: OpenOrder[]): OpenOrder[] {
    const seen = new Set<string>();
    return orders.filter((order) => {
      const key = `${order.owner}:${noteKey(order.note)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function orderFromCoordinator(record: any, owner: string): OpenOrder | null {
    if (record?.owner !== owner) return null;
    const pair = pairById(Number(record?.pair_id));
    const side = Number(record?.side);
    const size = atomicString(record?.size);
    const limitPrice = atomicString(record?.limit_price);
    const note = nonzeroNote(record?.note);
    const salt = atomicString(record?.salt);
    const batchId = atomicString(record?.batch_id);
    if (!pair || (side !== 0 && side !== 1) || !size || !limitPrice || !note || !batchId) return null;

    const baseAmount = BigInt(size);
    const quoteAmount = (baseAmount * BigInt(limitPrice)) / TOKEN_SCALE;
    const fromIsBase = side === 0;
    const expiry = atomicString(record?.expiry);
    const maq = atomicString(record?.maq);
    const tier = Number(record?.tier);
    return {
      owner,
      note,
      pay: fmt(fromIsBase ? baseAmount : quoteAmount),
      from: fromIsBase ? pair.base : pair.quote,
      get: fmt(fromIsBase ? quoteAmount : baseAmount),
      to: fromIsBase ? pair.quote : pair.base,
      side,
      size,
      limitPrice,
      salt: salt ?? "0",
      pairId: pair.id,
      batchId,
      ...(expiry && maq && Number.isSafeInteger(tier) ? { expiry, maq, tier } : {}),
      ...(record?.tif ? { tif: record.tif } : {}),
      ...(record?.tx ? { tx: record.tx } : {}),
      cancelable: Boolean(salt),
      status: "pending",
    };
  }

  function mergeCoordinatorOrders(local: OpenOrder[], records: any[], owner: string): OpenOrder[] {
    const remote = records
      .map((record) => orderFromCoordinator(record, owner))
      .filter((order): order is OpenOrder => Boolean(order));
    const localNotes = new Set(local.map((order) => noteKey(order.note)));
    return dedupeOrders([
      ...local,
      ...remote.filter((order) => !localNotes.has(noteKey(order.note))),
    ]);
  }

  function reconcileOpenOrders(orders: OpenOrder[], fillList: any[], owner: string): OpenOrder[] {
    const next = orders.flatMap((order) => {
      if (order.owner !== owner) return [order];
      for (const fill of fillList) {
        const side = sideForOrder(fill, order);
        if (!side) continue;
        const residual = residualOrderFromFill(order, fill, side);
        if (residual) {
          notifyMatchedOrder(order, "partial");
          return [residual];
        }
        if (order.status === "fulfilled") return [order];
        notifyMatchedOrder(order, "full");
        return [fulfilledOrder(order, fill, "fill")];
      }
      if (order.status === "fulfilled") return [order];
      return [order];
    });

    return dedupeOrders(next);
  }

  async function reconcileClosedOrdersOnChain(owner: string) {
    const pending = openOrdersRef.current.filter((order) => order.owner === owner && order.status !== "fulfilled");
    if (pending.length === 0) return;

    const checks = await Promise.all(pending.map(async (order) => {
      try {
        return { order, open: await chain.dpIsOrderOpen(order.note) };
      } catch {
        return { order, open: true };
      }
    }));
    if (currentWalletAddress() !== owner) return;

    const closedNotes = new Set(checks.filter((check) => !check.open).map((check) => noteKey(check.order.note)));
    if (closedNotes.size === 0) return;

    const next = dedupeOrders(openOrdersRef.current.map((order) => (
      order.owner === owner && closedNotes.has(noteKey(order.note)) ? fulfilledOrder(order, undefined, "chain") : order
    )));
    saveOpenOrderState(next, owner);
    for (const { order, open } of checks) {
      if (!open) notifyMatchedOrder(order, "full");
    }
  }

  async function refresh(owner = addr, options: { promptForFills?: boolean } = {}): Promise<any[] | null> {
    if (!owner || currentWalletAddress() !== owner) return null;
    // Run the four read groups concurrently rather than in series.
    const [nextBal, nextEsc, nextPool, fetchedFills] = await Promise.all([
      chain.balances().catch(() => null),
      Promise.all(POOL_ASSETS.map(async (x) => [x.sym, await chain.dpEscrowBalance(x.c)] as const))
        .then((e) => Object.fromEntries(e)).catch(() => null),
      Promise.all(POOL_ASSETS.map(async (x) => [x.sym, await chain.dpPoolBalance(x.c)] as const))
        .then((e) => Object.fromEntries(e)).catch(() => null),
      fetchFills(owner, { prompt: options.promptForFills ?? false }).catch((error) => {
        if (options.promptForFills) {
          say(`Activity sync failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return null;
      }),
    ]);
    if (currentWalletAddress() !== owner) return null;
    if (nextBal) setBal(nextBal);
    if (nextEsc) setEsc(nextEsc);
    if (nextPool) setPool(nextPool);
    if (fetchedFills) {
      const active = reconcileOpenOrders(openOrdersRef.current, fetchedFills, owner);
      saveOpenOrderState(active, owner);
      void reconcileClosedOrdersOnChain(owner);
    }
    return fetchedFills;
  }

  useEffect(() => {
    if (!addr) return;
    const interval = window.setInterval(() => { void refresh(addr); }, 15000);
    return () => window.clearInterval(interval);
  }, [addr]);

  function clearWalletView(message?: string) {
    meRef.current = null;
    setAddr("");
    setReg(null);
    setBal({});
    setEsc({});
    setPool({});
    setFills([]);
    openOrdersRef.current = [];
    setOpenOrders([]);
    if (message) say(message);
  }

  async function activateWallet(wallet: string, switched = false) {
    meRef.current = null;
    setAddr(wallet);
    setReg(loadReg(wallet));        // show cached membership instantly (no signature)
    const cachedOrders = loadOrders(wallet);
    openOrdersRef.current = cachedOrders;
    setOpenOrders(cachedOrders);
    setBal({});
    setEsc({});
    setPool({});
    setFills([]);
    setReady(true);                 // render now — never sign just to open the app
    if (switched) say(`Now trading as ${short(wallet)}`, "ok");
    try {
      setReg(await resolveReg(wallet));   // verify via public leaf — no signature on switch
      await chain.ensureAccount();
      await refresh(wallet);
    } catch (e: any) {
      if (switched) say("Wallet switched, but balances did not refresh: " + (e?.message || e));
    }
  }

  async function resolveReg(owner: string): Promise<Registration | null> {
    const r = loadReg(owner);
    if (r && !(await verifyRegistration(r))) {
      localStorage.removeItem(regKey(owner));
      say("Your saved membership is from a previous pool — re-enter the pool to continue.");
      return null;
    }
    return r;
  }

  // Unlock the encrypted pool identity lazily (one signature) the first time it's needed — never on
  // app open. Returns the cached identity if already unlocked, or creates one for a brand-new member.
  async function ensureIdentity(owner: string): Promise<Identity> {
    if (meRef.current) return meRef.current;
    let id = loadId(owner);                 // plaintext, per-wallet — no signature to load
    if (!id) { await init(); id = await createIdentity(); saveId(id, owner); say("Created your private pool identity"); }
    meRef.current = id;
    return id;
  }

  function syncRegistrationForIdentity(owner: string, id: Identity, directory: { leaves: string[] }): Registration {
    const resolved = registrationForIdentity({
      owner,
      cached: reg,
      identityLeaf: leafOf(id.pkX, id.pkY, id.hSk).toString(16).padStart(64, "0"),
      leaves: directory.leaves,
    });
    if (!resolved) {
      throw new Error("saved pool identity does not match this membership; re-enter the pool before placing an order");
    }
    if (!reg || resolved.index !== reg.index || resolved.leaf !== reg.leaf) {
      setReg(resolved);
      saveReg(resolved);
      say(`Using your matching pool membership #${resolved.index}.`);
    }
    return resolved;
  }

  async function connect() {
    setBusy(true);
    try {
      const wallet = await connectWallet();
      await activateWallet(wallet);
      say(`Connected ${short(wallet)}`);
    } catch (e: any) {
      say("Wallet connection failed: " + (e?.message || e));
    }
    setBusy(false);
  }

  function disconnect() {
    disconnectWallet();
    clearWalletView("Disconnected wallet");
  }

  async function join() {
    if (!addr) { say("Connect a Stellar wallet first"); return; }
    setBusy(true);
    try {
      await chain.ensureAccount();
      const id = await ensureIdentity(addr); // load-or-create, no signature
      say("Requesting wallet signatures for trustlines…"); await chain.ensureTrustlines();
      say("Entering the dark pool (publishing your membership)…");
      const { index, leaf } = await chain.coordDpRegister(id.pkX, id.pkY, id.hSk, leafOf(id.pkX, id.pkY, id.hSk));
      say("Funding test balances…");
      // Mint the default trade pair up front so you can trade immediately; background-mint the rest.
      await chain.coordMint(addr, "USDC", "2000000000");
      await chain.coordMint(addr, "XLM", "5000000000");
      const r = { index, owner: addr, leaf }; setReg(r); saveReg(r);
      await refresh(addr);
      say(`You're in the pool (member #${index}).`, "ok");
      void (async () => {
        for (const t of CONFIG.TOKENS) {
          if (t.sym === "USDC" || t.sym === "XLM") continue;
          try { await chain.coordMint(addr, t.sym, "2000000000"); } catch { /* faucet can top up later */ }
        }
        try { await refresh(addr); } catch { /* ignore */ }
      })();
    } catch (e: any) { say("Setup failed: " + (e?.message || e)); }
    setBusy(false);
  }

  // Generic swap -> dark-pool order. The pair's base/quote + side come from resolvePair.
  const balOf = (t: Tok) => bal[t] ?? "0";
  const escOf = (t: Tok) => esc[t] ?? "0";
  const atomicOrZero = (s: string) => parseAtomicAmount(s) ?? 0n;
  const payParsed = parseAtomicAmount(payAmt), getParsed = parseAtomicAmount(getAmt);
  const payA = payParsed ?? 0n, getA = getParsed ?? 0n;
  const overBal = payParsed !== null && payA > atomicOrZero(balOf(fromTok));
  const rate = payParsed !== null && getParsed !== null ? formatAtomicRatio(getA, payA) : "0";

  function pickFrom(t: Tok) { setFromTok(t); if (t === toTok) setToTok(OTHER(t)); }
  function pickTo(t: Tok) { setToTok(t); if (t === fromTok) setFromTok(OTHER(t)); }
  function flip() { setFromTok(toTok); setToTok(fromTok); setPayAmt(getAmt); setGetAmt(payAmt); }

  async function placeOrder() {
    if (!reg) { say("Enter the pool first"); return; }
    if (fromTok === toTok) { say("Pick two different tokens"); return; }
    if (payParsed === null || getParsed === null) { say("Enter a valid amount on both sides"); return; }
    if (payA <= 0n || getA <= 0n) { say("Enter an amount on both sides"); return; }
    if (overBal) { say(`Not enough ${fromTok} — you have ${balOf(fromTok)}`); return; }
    const pair = resolvePair(fromTok, toTok);
    if (!pair) { say(`${fromTok}/${toTok} isn't a listed pair`); return; }
    setBusy(true);
    let depositedBeforeOrder: { token: Tok; amountAtomic: bigint } | null = null;
    try {
      const id = await ensureIdentity(addr); // unlock the pool identity lazily (no sig — plaintext cache)
      // You escrow the token you pay (fromTok). base/quote amounts set size + limit (quote per base).
      const baseAmt = fromTok === pair.base ? payA : getA;
      const quoteAmt = fromTok === pair.base ? getA : payA;
      const sizeA = baseAmt;
      const limitA = baseAmt > 0n ? (quoteAmt * TOKEN_SCALE) / baseAmt : 0n;
      const escHave = atomicOrZero(escOf(fromTok));
      const depositAtomic = escHave < payA ? payA - escHave : 0n; // top up the shortfall; 0 = pre-funded
      const salt = randomSalt();
      const rememberOrder = (
        res: { note: string; batch_id: string; tx?: string },
        v2?: { expiry: string; maq: string; tier: number; tif: AdvancedOrder["tif"] },
      ) => {
        const next = [...openOrdersRef.current, {
          owner: addr,
          note: res.note,
          pay: payAmt,
          from: fromTok,
          get: getAmt,
          to: toTok,
          side: pair.side,
          size: sizeA.toString(),
          limitPrice: limitA.toString(),
          salt: salt.toString(),
          pairId: pair.id,
          batchId: res.batch_id,
          ...v2,
          tx: res.tx,
          status: "pending" as const,
        }];
        saveOpenOrderState(next, addr);
      };

      let placed: { note: string; batch_id: string; tx?: string };
      if (ADVANCED_ON) {
        const expiry = expiryFromAdvanced(advanced);
        const maq = maqFromAdvanced(advanced);
        const tier = tierFromAdvanced(advanced);
        if (maq > sizeA) throw new Error("min fill cannot be larger than the order size");
        say("Generating your v2 order proof locally…");
        const [batch, directory] = await Promise.all([chain.dpBatch(), chain.coordDirectory()]);
        const activeReg = syncRegistrationForIdentity(addr, id, directory);
        const orderProof = await proveDpOrderV2({
          identity: id,
          index: activeReg.index,
          side: pair.side,
          size: sizeA,
          limitPrice: limitA,
          salt,
          pairId: pair.id,
          batchId: BigInt(batch.batch_id),
          leaves: directory.leaves,
          expiry,
          maq,
          tier,
        });
        if (depositAtomic > 0n) {
          say("Checking that the coordinator is ready before moving funds…");
          await assertCoordinatorReady({
            coordinatorUrl: CONFIG.COORDINATOR_URL,
            coordinatorApiToken: CONFIG.COORDINATOR_API_TOKEN,
            expectedDpContractId: CONFIG.DP_CONTRACT_ID,
            requireDpOrderV2: true,
          });
          say(`Approve once to deposit ${fmt(depositAtomic.toString())} ${fromTok} before placing your v2 order…`);
          await chain.dpDeposit(tokenC(fromTok), depositAtomic.toString());
          depositedBeforeOrder = { token: fromTok, amountAtomic: depositAtomic };
        }
        say("Posting your v2 sealed order…");
        const res = await chain.dpSubmitOrderV2({
          ...orderProof, side: pair.side, size: sizeA, limitPrice: limitA, salt, pairId: pair.id,
          expiry: orderProof.expiry, maq: orderProof.maq, tier: orderProof.tier, tif: advanced.tif,
        });
        placed = res;
        rememberOrder(res, { expiry: orderProof.expiry, maq: orderProof.maq, tier: orderProof.tier, tif: advanced.tif });
        depositedBeforeOrder = null;
      } else {
        say("Generating your order proof locally…");
        const [batch, directory] = await Promise.all([chain.dpBatch(), chain.coordDirectory()]);
        const activeReg = syncRegistrationForIdentity(addr, id, directory);
        const orderProof = await proveDpOrder({
          identity: id,
          index: activeReg.index,
          side: pair.side,
          size: sizeA,
          limitPrice: limitA,
          salt,
          pairId: pair.id,
          batchId: BigInt(batch.batch_id),
          leaves: directory.leaves,
        });
        // One signed step: deposit (if needed) + sealed order, atomic in a single coordinator tx.
        say(depositAtomic > 0n
          ? `Approve once to deposit ${fmt(depositAtomic.toString())} ${fromTok} and seal your order…`
          : "Posting your sealed order (pre-funded — no signature)…");
        const res = await chain.dpDepositAndPlaceOrder({
          ...orderProof, side: pair.side, size: sizeA, limitPrice: limitA, salt, pairId: pair.id,
          depositTokenC: tokenC(fromTok), depositAmountDec: depositAtomic.toString(),
        });
        placed = res;
        rememberOrder(res);
      }
      say(`Order sealed — it's live in the pool. Your identity key stayed in the browser; only the commitment is visible on-chain.`, "ok");
      await refresh();
      void maybeAutoMatch();
    } catch (e: any) {
      if (depositedBeforeOrder) {
        setWithdrawTok(depositedBeforeOrder.token);
        setWithdrawAmt(atomicToDecimalString(depositedBeforeOrder.amountAtomic));
        try { await refresh(addr); } catch { /* keep the original placement error visible */ }
        say(`Deposit succeeded, but the order was not placed: ${e?.message || e}. Use Withdraw to pull back ${fmt(depositedBeforeOrder.amountAtomic.toString())} ${depositedBeforeOrder.token}.`);
      } else {
        say("Order failed: " + (e?.message || e), "bad");
      }
    }
    setBusy(false);
  }

  async function cancelOpenOrder(order: OpenOrder, mode: "cancel" | "edit" = "cancel") {
    if (!reg) { say("Enter the pool first"); return; }
    setBusy(true);
    try {
      const id = await ensureIdentity(addr);
      if (mode === "edit") {
        setPayAmt(order.pay);
        setFromTok(order.from);
        setGetAmt(order.get);
        setToTok(order.to);
      }
      const advancedCancel = isAdvancedOpenOrder(order);
      say(advancedCancel ? "Generating your v2 cancel proof locally…" : "Generating your cancel proof locally…");
      const directory = await chain.coordDirectory();
      let tx: string;
      if (advancedCancel) {
        const cancelProof = await proveDpCancelOrderV2({
          identity: id,
          index: reg.index,
          side: order.side,
          size: BigInt(order.size),
          limitPrice: BigInt(order.limitPrice),
          salt: BigInt(order.salt),
          pairId: order.pairId,
          batchId: BigInt(order.batchId),
          leaves: directory.leaves,
          expiry: BigInt(order.expiry),
          maq: BigInt(order.maq),
          tier: order.tier,
        });
        if (cancelProof.note !== order.note) throw new Error("local cancel proof does not match the pending order");
        say("Cancelling the v2 sealed order on-chain…");
        tx = await chain.dpCancelOrderV2(cancelProof);
      } else {
        const cancelProof = await proveDpCancelOrder({
          identity: id,
          index: reg.index,
          side: order.side,
          size: BigInt(order.size),
          limitPrice: BigInt(order.limitPrice),
          salt: BigInt(order.salt),
          pairId: order.pairId,
          batchId: BigInt(order.batchId),
          leaves: directory.leaves,
        });
        if (cancelProof.note !== order.note) throw new Error("local cancel proof does not match the pending order");
        say("Cancelling the sealed order on-chain…");
        tx = await chain.dpCancelOrder(cancelProof);
      }
      let coordinatorSynced = true;
      try {
        await chain.dpCancelCoordinator(order.note, { onchainCancelled: true });
      } catch {
        coordinatorSynced = false;
      }
      saveOpenOrderState(openOrdersRef.current.filter((candidate) => candidate.note !== order.note), addr);
      await refresh();
      say(mode === "edit"
        ? `Order cancelled${coordinatorSynced ? "" : " on-chain"}; adjust the form and place the replacement. ${short(tx)}`
        : `Order cancelled${coordinatorSynced ? "" : " on-chain"}. ${short(tx)}`);
    } catch (e: any) {
      say("Cancel failed: " + (e?.message || e));
    }
    setBusy(false);
  }

  // Always-available withdraw of un-reserved escrow. Per CROSSED_V2_PLAN the venue pause
  // gates place/settle but NEVER withdraw, so this stays enabled even while paused.
  async function withdraw() {
    if (!addr) { say("Connect a Stellar wallet first"); return; }
    const parsedWithdraw = parseAtomicAmount(withdrawAmt);
    if (parsedWithdraw === null) { say("Enter a valid amount to withdraw"); return; }
    const amtA = parsedWithdraw;
    if (amtA <= 0n) { say("Enter an amount to withdraw"); return; }
    if (amtA > atomicOrZero(escOf(withdrawTok))) { say(`Only ${num(escOf(withdrawTok))} ${withdrawTok} is withdrawable`); return; }
    setBusy(true);
    try {
      say(`Approve once to withdraw ${withdrawAmt} ${withdrawTok}…`);
      const tx = await chain.dpWithdraw(tokenC(withdrawTok), amtA.toString());
      setWithdrawAmt("");
      await refresh();
      say(`Withdrew ${withdrawAmt} ${withdrawTok}. ${short(tx)}`, "ok");
    } catch (e: any) { say("Withdraw failed: " + (e?.message || e), "bad"); }
    setBusy(false);
  }

  async function closeBatchAndRefresh(manual: boolean) {
    if (autoMatchRef.current) {
      if (manual) say("A batch match is already running…");
      return;
    }
    autoMatchRef.current = true;
    try {
      if (manual) say("Running the sealed-batch match…");
      const r = await chain.dpClose();
      const n = r.fills?.length ?? 0;
      const expectedNotes = new Set<string>((r.fills ?? []).flatMap(fillNotes));
      if (manual && r.pending) {
        say(`Batch #${r.batch_id} is waiting for more orders (${r.open_count}/${r.min_open_count}).`);
      } else if (manual) {
        say(n > 0 ? `Matched ${n} pair(s) — settling at the midpoint…` : "No crossing pair in this batch yet.", n > 0 ? "ok" : undefined);
      } else if (n > 0) {
        say(`A sealed batch matched ${n} pair(s).`, "ok");
      }
      if (n > 0) {
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const latest = await refresh(addr, { promptForFills: manual && attempt === 0 });
          if (latest === null && manual) break;
          const seen = new Set((latest ?? []).flatMap(fillNotes));
          if (expectedNotes.size > 0 && [...expectedNotes].every((note) => seen.has(note))) break;
          if (attempt < 5) await sleep(10000);
        }
      } else {
        await refresh();
      }
    } catch (e: any) {
      if (manual) say("Match failed: " + (e?.message || e));
    } finally {
      autoMatchRef.current = false;
    }
  }

  async function maybeAutoMatch() {
    if (!addr || !reg || currentWalletAddress() !== addr || autoMatchRef.current) return;
    const batch = await chain.dpBatch().catch(() => null);
    if (!batch) return;
    const openCount = Number(batch.open_count ?? 0);
    const minOpenCount = Number(batch.min_open_count ?? 2);
    if (!Number.isFinite(openCount) || !Number.isFinite(minOpenCount) || openCount < minOpenCount) return;
    await closeBatchAndRefresh(false);
  }

  async function runMatch() {
    setBusy(true);
    await closeBatchAndRefresh(true);
    setBusy(false);
  }

  useEffect(() => {
    if (!addr || !reg) return;
    void maybeAutoMatch();
    const interval = window.setInterval(() => { void maybeAutoMatch(); }, 5000);
    return () => window.clearInterval(interval);
  }, [addr, reg]);

  const myFills = fills.filter((f) => f.sell_owner === addr || f.buy_owner === addr);
  const fillBelongsToOrder = (fill: any, order: OpenOrder) => (
    residualSideForNote(fill, order.note) !== null || fillSideForNote(fill, order.note) !== null
  );
  const fillForOrder = (order: OpenOrder) => myFills.find((fill) => fillBelongsToOrder(fill, order));
  const fulfilledWithoutFillCount = openOrders.filter((order) => (
    order.status === "fulfilled" && !fillForOrder(order)
  )).length;
  const ungroupedFills = myFills.filter((fill) => !openOrders.some((order) => fillBelongsToOrder(fill, order)));

  const tokenSelect = (value: Tok, onPick: (t: Tok) => void, which: "from" | "to" | "withdraw") => (
    <span className="tok-wrap">
      <span className="chip" role="button" tabIndex={0}
        aria-haspopup="listbox" aria-expanded={openSel === which}
        onClick={(e) => { e.stopPropagation(); setOpenSel(openSel === which ? null : which); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpenSel(openSel === which ? null : which); }
          else if (e.key === "Escape") setOpenSel(null);
        }}
        style={{ display: "inline-flex", alignItems: "center", gap: 6, paddingRight: 10, cursor: "pointer", userSelect: "none" }}>
        <TokenIcon symbol={value} size={16} />{value}
        <span aria-hidden="true" style={{ opacity: 0.6, fontSize: 11 }}>▾</span>
      </span>
      {openSel === which && (
        <div className="tok-menu" onClick={(e) => e.stopPropagation()}>
          {POOL_ASSETS.map((a) => (
            <button type="button" key={a.sym} className={`tok-opt ${a.sym === value ? "sel" : ""}`}
              onClick={() => { onPick(a.sym); setOpenSel(null); }}>
              <TokenIcon symbol={a.sym} size={16} />{a.sym}
            </button>
          ))}
        </div>
      )}
    </span>
  );

  const hasSwaps = openOrders.length > 0 || myFills.length > 0;
  const pendingOrderCount = openOrders.filter((order) => order.status !== "fulfilled").length;
  const activityLabel = activitySummary(pendingOrderCount, myFills.length + fulfilledWithoutFillCount);
  const activityList = !hasSwaps ? (
    <div className="empty">No swaps yet — {reg ? "place a sealed order" : "enter the pool"} to get started.</div>
  ) : (
    <ul className="desks">
      {openOrders.map((o, i) => {
        const fulfilled = o.status === "fulfilled";
        const groupedFill = fillForOrder(o);
        const residualSide = groupedFill ? residualSideForNote(groupedFill, o.note) : null;
        const filledAmounts = groupedFill && residualSide ? fillSwapAmountsForOrderSide(groupedFill, o.side) : null;
        return (
          <li key={`o${i}`} className={[fulfilled ? "fulfilled-order" : "", filledAmounts ? "partial-order" : ""].filter(Boolean).join(" ") || undefined}>
            <span className="deskname">{o.pay} {o.from} → {o.get} {o.to}</span>
            <span className="desk-meta">
              <span className="tiny">sealed</span>
              <span className={`order-status ${fulfilled ? "fulfilled" : "pending"}`}>
                {fulfilled ? "fulfilled" : "pending"}
              </span>
              <TxLink tx={o.matchedTx ?? o.tx} />
              <span className="desk-actions">
                {fulfilled ? (
                  <span className="tiny muted">matched on-chain</span>
                ) : o.cancelable === false ? (
                  <span className="tiny muted">residual change-note</span>
                ) : (
                  <>
                    <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void cancelOpenOrder(o, "edit")}>Edit</button>
                    <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void cancelOpenOrder(o)}>Cancel</button>
                  </>
                )}
              </span>
            </span>
            {filledAmounts ? (
              <span className="order-fill-detail">
                <span className="order-fill-label">filled</span>
                <span>{fmt(filledAmounts.pay)} {o.from} → {fmt(filledAmounts.get)} {o.to}</span>
                {groupedFill?.tx ? <TxLink tx={groupedFill.tx} /> : null}
              </span>
            ) : null}
          </li>
        );
      })}
      {ungroupedFills.map((f, i) => {
        const sold = f.sell_owner === addr;
        const p = pairById(Number(f.pair_id));
        const base = p?.base ?? "USDC", quote = p?.quote ?? "XLM";
        // v2 partial fills: when the backend reports a residual change-note, render the
        // dedicated PartialFillRow. Gated behind FEATURES.partialFills; with the flag off
        // (and on the v1 backend, which carries no residual) the standard row always renders.
        const residualBase = sold
          ? (f.residual_sell ?? f.residual_base_sell ?? f.residual_base)
          : (f.residual_buy ?? f.residual_base_buy ?? f.residual_base);
        if (CONFIG.FEATURES.partialFills && (residualBase != null || f.fill_base != null)) {
          return (
            <PartialFillRow key={`f${i}`} fill={{
              base, quote,
              filledBase: fmt(f.fill_base ?? f.base_amount),
              residualBase: residualBase != null ? fmt(residualBase) : undefined,
              tx: f.tx,
            }} />
          );
        }
        return (
          <li key={`f${i}`} style={{ borderColor: "var(--good)" }}>
            <span className="deskname">{sold ? `Sold ${fmt(f.base_amount)} ${base} → +${fmt(f.quote_amount)} ${quote}` : `Bought ${fmt(f.base_amount)} ${base} for ${fmt(f.quote_amount)} ${quote}`}</span>
            {f.tx ? <span className="desk-meta"><TxLink tx={f.tx} /></span> : null}
          </li>
        );
      })}
    </ul>
  );
  const activityCard = (
    <>
      <div className="card activity-status-card" aria-live="polite">
        <div>
          <h2>Activity</h2>
          <div className="tiny muted" id="activity-status-summary">{activityLabel}</div>
        </div>
        <button
          className="btn ghost sm activity-status-trigger"
          type="button"
          aria-haspopup="dialog"
          aria-expanded={activityOpen}
          aria-controls="activity-modal"
          aria-describedby="activity-status-summary"
          aria-label={activityStatusLabel(activityLabel)}
          onClick={() => {
            setActivityOpen(true);
            void refresh(addr, { promptForFills: true });
          }}
        >
          View
        </button>
      </div>
      {activityOpen ? (
        <div className="activity-modal-backdrop" role="presentation" onClick={() => setActivityOpen(false)}>
          <section
            ref={activityModalRef}
            className="activity-modal"
            id="activity-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="activity-modal-title"
            aria-describedby="activity-modal-summary"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="activity-modal-head">
              <div>
                <h2 id="activity-modal-title">Activity</h2>
                <div className="tiny muted" id="activity-modal-summary">{activityLabel}</div>
              </div>
              <button className="btn ghost sm activity-modal-close" type="button" onClick={() => setActivityOpen(false)}>
                Close
              </button>
            </div>
            <div className="activity-modal-body">{activityList}</div>
          </section>
        </div>
      ) : null}
    </>
  );

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" style={{ cursor: "pointer" }} onClick={onHome} title="Back to home">
          <div className="mark" /><div className="name">Crossed</div>
        </div>
        <div className="walletline">
          <span className="pill"><span className="dot" /> Testnet</span>
          <ThemeToggle />
          <PagesMenu onFaucet={onFaucet} onTca={onTca} onViewingKeys={onViewingKeys} />
          {addr ? (
            <>
              <button type="button" className="pill wallet-pill" title="Copy address" style={{ cursor: "pointer", font: "inherit" }}
                onClick={() => copy(addr, "walletpill")}>{copied === "walletpill" ? "copied!" : short(addr)}</button>
              <button className="btn ghost sm" type="button" onClick={disconnect}>Disconnect</button>
            </>
          ) : null}
        </div>
      </div>

      {CONFIG.FEATURES.killSwitch && (
        <div style={{ marginBottom: 12 }}>
          <KillSwitchBanner paused={paused} reason={pauseReason} />
        </div>
      )}

      {status && (
        <div className={`statusbar${status.tone === "ok" ? " statusbar--ok" : status.tone === "bad" ? " statusbar--bad" : ""}`}
             role="status" aria-live="polite" key={status.t + status.m}>
          <span className="t">{status.t}</span><span>{status.m}</span>
          {status.tone === "ok" && <span className="px-burst" aria-hidden="true"><i /><i /><i /></span>}
        </div>
      )}

      {!ready && <div className="card"><p className="muted">Warming up…</p></div>}

      {ready && !addr && (
        <div className="dp-grid">
          <div className="dp-main">
            <div className="card">
              <h2>Connect wallet</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                Balances and swap actions stay hidden until you connect a Stellar wallet. Crossed never creates a browser wallet or shows balances without your wallet approval.
              </p>
              <button className="btn" disabled={busy} onClick={connect}>{busy ? "Connecting…" : "Connect wallet"}</button>
            </div>
          </div>
          <aside className="dp-aside">{activityCard}</aside>
        </div>
      )}

      {ready && addr && !reg && (
        <div className="dp-grid">
          <div className="dp-main">
            <div className="card">
              <h2>Enter the dark pool</h2>
              <p className="muted" style={{ marginTop: 0 }}>
                One step: your wallet signs the setup, we publish your anonymous membership, and fund test balances.
                After that you can post sealed orders that no one can read until they match.
              </p>
              <button className="btn" disabled={busy} onClick={join}>{busy ? "Setting up…" : "Enter the pool"}</button>
            </div>
          </div>
          <aside className="dp-aside">{activityCard}</aside>
        </div>
      )}

      {ready && reg && (
        <div className="dp-grid">
          <div className="dp-main">
            <div className="card">
              <div className="row" style={{ marginBottom: 14 }}>
                <h2 style={{ margin: 0 }}>Swap — sealed order</h2>
                <InfoButton />
              </div>
              <div className="leg" style={{ marginBottom: 4 }}>
                <label>You pay</label>
                <div className="legrow">
                  <input value={payAmt} onChange={(e) => setPayAmt(e.target.value)} inputMode="decimal" />
                  {tokenSelect(fromTok, pickFrom, "from")}
                </div>
                <div className="tiny muted" style={{ marginTop: 6 }}>
                  Balance {num(balOf(fromTok))} {fromTok} ·{" "}
                  <button onClick={() => setPayAmt(balOf(fromTok))}
                    style={{ background: "none", border: 0, color: "var(--bbb)", cursor: "pointer", font: "inherit", padding: 0, textDecoration: "underline" }}>Max</button>
                  {overBal && <span style={{ color: "var(--bad, #FF3B3B)" }}> · not enough {fromTok}</span>}
                </div>
              </div>
              <div className="swap-mid"><div className="icon" onClick={flip} title="Flip" style={{ cursor: "pointer" }}>⇅</div></div>
              <div className="leg" style={{ marginBottom: 12 }}>
                <label>You receive</label>
                <div className="legrow">
                  <input value={getAmt} onChange={(e) => setGetAmt(e.target.value)} inputMode="decimal" />
                  {tokenSelect(toTok, pickTo, "to")}
                </div>
              </div>
              <p className="tiny muted" style={{ marginTop: 0 }}>
                {payA > 0n && getA > 0n ? `≈ 1 ${fromTok} = ${rate} ${toTok}. ` : ""}
                Sealed — the pair, amounts and price stay hidden on-chain until a matching order crosses you, then it settles at the midpoint.
              </p>
              {ADVANCED_ON && (
                <div style={{ margin: "0 0 12px" }}>
                  <AdvancedOrderFields value={advanced} onChange={setAdvanced} />
                </div>
              )}
              <button className="btn" disabled={busy || overBal} onClick={placeOrder}>{overBal ? `Not enough ${fromTok}` : busy ? "Working…" : "Place sealed order"}</button>
              <button className="btn ghost" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={runMatch}>Find a match</button>
            </div>
          </div>

          <aside className="dp-aside">
            <div className="card">
              <div className="row" style={{ marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>In the pool</h2>
                <button className="btn ghost sm" disabled={busy || refreshing} title="Refresh"
                  onClick={async () => { setRefreshing(true); try { await refresh(addr, { promptForFills: true }); } finally { setRefreshing(false); } }}>
                  <span className={refreshing ? "px-spin" : undefined} style={{ display: "inline-block" }}>↻</span></button>
              </div>
              <div className="pool-list">
                {POOL_ASSETS.map((a) => {
                  const mine = esc[a.sym] ?? "0";
                  const hasMine = atomicOrZero(mine) > 0n;
                  return (
                    <div className="pool-row" key={a.sym}>
                      <span className="sym"><TokenIcon symbol={a.sym} size={16} />{a.sym}</span>
                      <span className="amt">
                        <AnimatedNum value={pool[a.sym] ?? "0"} />
                        {hasMine && <span className="mine">you: <AnimatedNum value={mine} /></span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="tiny mono" style={{ marginTop: 12, marginBottom: 0, opacity: 0.7 }}>
                <button type="button" className="copy-text" title="Copy your full address" onClick={() => copy(addr, "pooladdr")}>
                  {copied === "pooladdr" ? "copied!" : short(addr)}
                </button> · member #{reg.index}
              </p>
            </div>

            {CONFIG.FEATURES.killSwitch && (
              <div className="card">
                <div className="row" style={{ marginBottom: 8 }}>
                  <h2 style={{ margin: 0 }}>Withdraw</h2>
                  <span className="tiny muted">always available</span>
                </div>
                <p className="tiny muted" style={{ marginTop: 0 }}>
                  Pull un-reserved escrow back to your wallet. Withdraw is never blocked by a venue pause.
                </p>
                <div className="leg">
                  <div className="legrow">
                    <input value={withdrawAmt} onChange={(e) => setWithdrawAmt(e.target.value)} inputMode="decimal" placeholder="0" />
                    {tokenSelect(withdrawTok, setWithdrawTok, "withdraw")}
                  </div>
                  <div className="tiny muted" style={{ marginTop: 6 }}>
                    Escrowed {num(escOf(withdrawTok))} {withdrawTok} ·{" "}
                    <button onClick={() => setWithdrawAmt(escOf(withdrawTok))}
                      style={{ background: "none", border: 0, color: "var(--bbb)", cursor: "pointer", font: "inherit", padding: 0, textDecoration: "underline" }}>Max</button>
                  </div>
                </div>
                <button className="btn ghost" style={{ width: "100%", marginTop: 10 }} disabled={busy} onClick={() => void withdraw()}>
                  {busy ? "Working…" : "Withdraw"}
                </button>
              </div>
            )}

            {CONFIG.FEATURES.passkey && (
              <div className="card">
                <div className="row" style={{ marginBottom: 8 }}>
                  <h2 style={{ margin: 0 }}>Passkey custody</h2>
                  <span className={`pill ${passkeyOn ? "" : ""}`}>{passkeyOn ? "On" : "Off"}</span>
                </div>
                <p className="tiny muted" style={{ marginTop: 0 }}>
                  Seal your pool identity behind a device passkey (WebAuthn) instead of plaintext browser storage.
                </p>
                <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", userSelect: "none" }}>
                  <input type="checkbox" checked={passkeyOn} disabled={busy}
                    onChange={(e) => { setPasskeyOn(e.target.checked); say(e.target.checked ? "Passkey custody enabled — your identity will be sealed on next unlock." : "Passkey custody disabled."); }}
                    style={{ width: 16, height: 16, cursor: "pointer" }} />
                  <span className="tiny">Use a passkey to protect my pool identity</span>
                </label>
              </div>
            )}

            {activityCard}
          </aside>
        </div>
      )}

    </div>
  );
}
