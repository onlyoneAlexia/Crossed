import { useEffect, useRef, useState } from "react";
import "./App.css";
import { init, createIdentity, leafOf, prefetchOrderArtifacts, proveDpCancelOrder, proveDpOrder, randomSalt, type Identity } from "./lib/otc";
import * as chain from "./lib/chain";
import { CONFIG } from "./lib/config";
import { TokenIcon } from "./components/TokenIcon";
import { ThemeToggle } from "./components/ThemeToggle";
import { connectWallet, disconnectWallet, restoreWallet } from "./lib/wallet";
// v2 gap-closure components — each rendered only behind its CONFIG.FEATURES flag, so with
// all flags false this file renders byte-for-byte the current live demo.
import { KillSwitchBanner } from "./components/KillSwitchBanner";
import { AdvancedOrderFields, type AdvancedOrder } from "./components/AdvancedOrderFields";
import { PartialFillRow } from "./components/PartialFillRow";

// Dark-pool app surface. The pool trades USDC (base / TOKEN_A) vs XLM (quote / TOKEN_B),
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
  tx?: string;
};

// Assets the dark pool can hold — driven by the token registry.
const POOL_ASSETS: { sym: Tok; c: string }[] = CONFIG.TOKENS.map((t) => ({ sym: t.sym, c: t.c }));
const tokenC = (sym: Tok): string => CONFIG.TOKENS.find((t) => t.sym === sym)?.c ?? "";
const OTHER = (t: Tok): Tok => POOL_ASSETS.find((a) => a.sym !== t)?.sym ?? t;

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
const nowt = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function toAtomic(s: string): bigint {
  const [w, f = ""] = (s || "0").trim().split(".");
  const frac = (f + "0000000").slice(0, 7);
  return BigInt(w || "0") * 10000000n + BigInt(frac || "0");
}
const fmt = (a: bigint | string) => (Number(BigInt(a)) / 1e7).toLocaleString(undefined, { maximumFractionDigits: 4 });
const num = (s: string) => Number(s || "0").toLocaleString(undefined, { maximumFractionDigits: 2 });
const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");

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
  if (!tx) return null;
  return (
    <a className="tiny mono tx-link" href={txUrl(tx)} target="_blank" rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()} title="View transaction on Stellar Explorer">
      {tx.slice(0, 10)}…
    </a>
  );
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
  const [status, setStatus] = useState<{ t: string; m: string } | null>(null);
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
  const say = (m: string) => setStatus({ t: nowt(), m });

  useEffect(() => { (async () => {
    void init(); // warm crypto in the background; proof/identity fns await it when needed
    try {
      const restored = await restoreWallet();
      if (restored) {
        setAddr(restored);
        setReg(loadReg(restored));        // show cached membership instantly (no signature)
        setOpenOrders(loadOrders(restored));
        setReady(true);                   // render now — never sign just to open the app
        // Background: verify the cached membership via its public leaf, then load balances.
        // The pool identity is unlocked lazily on the first order, so opening prompts no wallet sigs.
        (async () => {
          try { setReg(await resolveReg(restored)); } catch { /* keep cached reg */ }
          await refresh(restored);
          prefetchOrderArtifacts();
        })();
        return;
      }
    } catch {
      // No approved wallet yet. The app stays inert until the user connects.
    }
    setReady(true);
  })(); }, []);

  useEffect(() => {
    const close = () => setOpenSel(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, []);

  async function refresh(owner = addr) {
    if (!owner) return;
    let fillList: any[] = [];
    // Run the four read groups concurrently rather than in series.
    await Promise.all([
      chain.balances().then(setBal).catch(() => { /* trustlines not set yet */ }),
      Promise.all(POOL_ASSETS.map(async (x) => [x.sym, await chain.dpEscrowBalance(x.c)] as const))
        .then((e) => setEsc(Object.fromEntries(e))).catch(() => { /* not registered yet */ }),
      Promise.all(POOL_ASSETS.map(async (x) => [x.sym, await chain.dpPoolBalance(x.c)] as const))
        .then((e) => setPool(Object.fromEntries(e))).catch(() => { /* network */ }),
      chain.dpFills(owner).then((f: any) => { fillList = f.fills ?? f ?? []; setFills(fillList); }).catch(() => { /* coordinator offline */ }),
    ]);
    try {
      const filled = new Set(fillList.flatMap((f: any) => [f.note_sell, f.note_buy]).filter(Boolean));
      setOpenOrders((orders) => {
        const active = orders.filter((order) => order.owner === owner && !filled.has(order.note));
        saveOrders(active, owner);
        return active;
      });
    } catch { /* local order cleanup */ }
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

  async function connect() {
    setBusy(true);
    try {
      const wallet = await connectWallet();
      meRef.current = null;               // drop any prior wallet's cached identity
      setAddr(wallet);
      say(`Connected ${short(wallet)}`);
      setReg(await resolveReg(wallet));   // verify via public leaf — no signature on connect
      setOpenOrders(loadOrders(wallet));
      await chain.ensureAccount();
      await refresh(wallet);
      prefetchOrderArtifacts();
    } catch (e: any) {
      say("Wallet connection failed: " + (e?.message || e));
    }
    setBusy(false);
  }

  function disconnect() {
    disconnectWallet();
    meRef.current = null;
    setAddr("");
    setReg(null);
    setBal({});
    setEsc({});
    setPool({});
    setFills([]);
    setOpenOrders([]);
    say("Disconnected wallet");
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
      say(`You're in the pool (member #${index}).`);
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
  const payA = toAtomic(payAmt), getA = toAtomic(getAmt);
  const overBal = payA > toAtomic(balOf(fromTok));
  const rate = payA > 0n ? Number(getA) / Number(payA) : 0;

  function pickFrom(t: Tok) { setFromTok(t); if (t === toTok) setToTok(OTHER(t)); }
  function pickTo(t: Tok) { setToTok(t); if (t === fromTok) setFromTok(OTHER(t)); }
  function flip() { setFromTok(toTok); setToTok(fromTok); setPayAmt(getAmt); setGetAmt(payAmt); }

  async function placeOrder() {
    if (!reg) { say("Enter the pool first"); return; }
    if (fromTok === toTok) { say("Pick two different tokens"); return; }
    if (payA <= 0n || getA <= 0n) { say("Enter an amount on both sides"); return; }
    if (overBal) { say(`Not enough ${fromTok} — you have ${balOf(fromTok)}`); return; }
    const pair = resolvePair(fromTok, toTok);
    if (!pair) { say(`${fromTok}/${toTok} isn't a listed pair`); return; }
    setBusy(true);
    try {
      const id = await ensureIdentity(addr); // unlock the pool identity lazily (no sig — plaintext cache)
      // You escrow the token you pay (fromTok). base/quote amounts set size + limit (quote per base).
      const baseAmt = fromTok === pair.base ? payA : getA;
      const quoteAmt = fromTok === pair.base ? getA : payA;
      const sizeA = baseAmt;
      const limitA = baseAmt > 0n ? (quoteAmt * 10000000n) / baseAmt : 0n;
      const escHave = toAtomic(escOf(fromTok));
      const depositAtomic = escHave < payA ? payA - escHave : 0n; // top up the shortfall; 0 = pre-funded
      const salt = randomSalt();
      say("Generating your order proof locally…");
      const [batch, directory] = await Promise.all([chain.dpBatch(), chain.coordDirectory()]);
      const orderProof = await proveDpOrder({
        identity: id,
        index: reg.index,
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
      setOpenOrders((orders) => {
        const next = [...orders, {
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
          tx: res.tx,
        }];
        saveOrders(next, addr);
        return next;
      });
      say(`Order sealed (batch #${res.batch_id}). Your identity key stayed in the browser; only the commitment is visible on-chain.`);
      await refresh();
    } catch (e: any) { say("Order failed: " + (e?.message || e)); }
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
      say("Generating your cancel proof locally…");
      const directory = await chain.coordDirectory();
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
      const tx = await chain.dpCancelOrder(cancelProof);
      let coordinatorSynced = true;
      try {
        await chain.dpCancelCoordinator(order.note);
      } catch {
        coordinatorSynced = false;
      }
      setOpenOrders((orders) => {
        const next = orders.filter((candidate) => candidate.note !== order.note);
        saveOrders(next, addr);
        return next;
      });
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
    const amtA = toAtomic(withdrawAmt);
    if (amtA <= 0n) { say("Enter an amount to withdraw"); return; }
    if (amtA > toAtomic(escOf(withdrawTok))) { say(`Only ${escOf(withdrawTok)} ${withdrawTok} is withdrawable`); return; }
    setBusy(true);
    try {
      say(`Approve once to withdraw ${withdrawAmt} ${withdrawTok}…`);
      const tx = await chain.dpWithdraw(tokenC(withdrawTok), amtA.toString());
      setWithdrawAmt("");
      await refresh();
      say(`Withdrew ${withdrawAmt} ${withdrawTok}. ${short(tx)}`);
    } catch (e: any) { say("Withdraw failed: " + (e?.message || e)); }
    setBusy(false);
  }

  async function runMatch() {
    setBusy(true);
    try {
      say("Running the sealed-batch match…");
      const r = await chain.dpClose();
      const n = r.fills?.length ?? 0;
      if (r.pending) {
        say(`Batch #${r.batch_id} is waiting for more orders (${r.open_count}/${r.min_open_count}).`);
      } else {
        say(n > 0 ? `Matched ${n} pair(s) — settling at the midpoint…` : "No crossing pair in this batch yet.");
      }
      await refresh();
    } catch (e: any) { say("Match failed: " + (e?.message || e)); }
    setBusy(false);
  }

  const myFills = fills.filter((f) => f.sell_owner === addr || f.buy_owner === addr);

  const tokenSelect = (value: Tok, onPick: (t: Tok) => void, which: "from" | "to" | "withdraw") => (
    <span className="tok-wrap">
      <span className="chip" role="button" tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setOpenSel(openSel === which ? null : which); }}
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
  const activityCard = (
    <div className="card">
      <h2>Activity</h2>
      {!hasSwaps ? (
        <div className="empty">No swaps yet — {reg ? "place a sealed order" : "enter the pool"} to get started.</div>
      ) : (
        <ul className="desks">
          {openOrders.map((o, i) => (
            <li key={`o${i}`}>
              <span className="deskname">{o.pay} {o.from} → {o.get} {o.to}</span>
              <span className="desk-meta">
                <span className="tiny">sealed · pending</span>
                <TxLink tx={o.tx} />
                <span className="desk-actions">
                  <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void cancelOpenOrder(o, "edit")}>Edit</button>
                  <button className="btn ghost sm" type="button" disabled={busy} onClick={() => void cancelOpenOrder(o)}>Cancel</button>
                </span>
              </span>
            </li>
          ))}
          {myFills.map((f, i) => {
            const sold = f.sell_owner === addr;
            const p = pairById(Number(f.pair_id));
            const base = p?.base ?? "USDC", quote = p?.quote ?? "XLM";
            // v2 partial fills: when the backend reports a residual change-note, render the
            // dedicated PartialFillRow. Gated behind FEATURES.partialFills; with the flag off
            // (and on the v1 backend, which carries no residual) the standard row always renders.
            if (CONFIG.FEATURES.partialFills && (f.residual_base != null || f.fill_base != null)) {
              return (
                <PartialFillRow key={`f${i}`} fill={{
                  base, quote,
                  filledBase: fmt(f.fill_base ?? f.base_amount),
                  residualBase: f.residual_base != null ? fmt(f.residual_base) : undefined,
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
      )}
    </div>
  );

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" style={{ cursor: "pointer" }} onClick={onHome} title="Back to home">
          <div className="mark" /><div className="name">Crossed</div>
        </div>
        <div className="walletline">
          <span className="pill"><span className="dot" /> Dark pool · Testnet</span>
          <ThemeToggle />
          <button className="btn ghost sm" type="button" onClick={onFaucet}>Faucet</button>
          {CONFIG.FEATURES.tca && onTca && (
            <button className="btn ghost sm" type="button" onClick={onTca}>Execution</button>
          )}
          {CONFIG.FEATURES.viewingKeys && onViewingKeys && (
            <button className="btn ghost sm" type="button" onClick={onViewingKeys}>Viewing key</button>
          )}
          <a className="btn ghost sm" href={POOL_EXPLORER} target="_blank" rel="noopener noreferrer"
            title="View the pool's full on-chain history on Stellar Explorer"
            style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}>Explorer ↗</a>
          {addr ? (
            <>
              <span className="pill wallet-pill">{short(addr)}</span>
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
        <div className="statusbar"><span className="t">{status.t}</span><span>{status.m}</span></div>
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
                {payA > 0n && getA > 0n ? `≈ 1 ${fromTok} = ${rate.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${toTok}. ` : ""}
                Sealed — the pair, amounts and price stay hidden on-chain until a matching order crosses you, then it settles at the midpoint.
              </p>
              {ADVANCED_ON && (
                <div style={{ margin: "0 0 12px" }}>
                  <AdvancedOrderFields value={advanced} onChange={setAdvanced} />
                </div>
              )}
              <button className="btn" disabled={busy || overBal} onClick={placeOrder}>{busy ? "Working…" : "Place sealed order"}</button>
              <button className="btn ghost" style={{ width: "100%", marginTop: 8 }} disabled={busy} onClick={runMatch}>Run batch match</button>
            </div>
          </div>

          <aside className="dp-aside">
            <div className="card">
              <div className="row" style={{ marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>In the pool</h2>
                <button className="btn ghost sm" disabled={busy} onClick={() => void refresh()} title="Refresh">↻</button>
              </div>
              <div className="pool-list">
                {POOL_ASSETS.map((a) => {
                  const mine = esc[a.sym] ?? "0";
                  const hasMine = Number(mine) > 0;
                  return (
                    <div className="pool-row" key={a.sym}>
                      <span className="sym"><TokenIcon symbol={a.sym} size={16} />{a.sym}</span>
                      <span className="amt">
                        {num(pool[a.sym] ?? "0")}
                        {hasMine && <span className="mine">you: {num(mine)}</span>}
                      </span>
                    </div>
                  );
                })}
              </div>
              <p className="tiny mono" style={{ marginTop: 12, marginBottom: 0, opacity: 0.7 }}>{short(addr)} · member #{reg.index}</p>
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
