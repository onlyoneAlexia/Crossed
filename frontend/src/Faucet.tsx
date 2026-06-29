import { useEffect, useState } from "react";
import "./App.css";
import * as chain from "./lib/chain";
import { CONFIG } from "./lib/config";
import { TokenIcon } from "./components/TokenIcon";
import { ThemeToggle } from "./components/ThemeToggle";
import { connectWallet, currentWalletAddress, disconnectWallet, restoreWallet, subscribeWalletChanges } from "./lib/wallet";
import { formatDecimalAmount } from "./lib/amounts";

const nowt = () => new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const num = (s: string) => formatDecimalAmount(s);
const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
const FAUCET_AMOUNT = "1000000000"; // 100 units (7 decimals)

export default function Faucet({ onHome, onApp }: { onHome: () => void; onApp: () => void }) {
  const [addr, setAddr] = useState("");
  const [bal, setBal] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<{ t: string; m: string } | null>(null);
  const say = (m: string) => setStatus({ t: nowt(), m });

  useEffect(() => { (async () => {
    try {
      const restored = await restoreWallet();
      if (restored) await activateWallet(restored);
    } catch { /* not connected yet */ }
  })(); }, []);

  useEffect(() => subscribeWalletChanges((state) => {
    const next = state.address;
    if (!next) {
      clearWalletView(addr ? "Wallet disconnected" : undefined);
      return;
    }
    if (next === addr) {
      void refresh(next);
      return;
    }
    void activateWallet(next, true);
  }), [addr]);

  async function refresh(owner = addr) {
    if (!owner || currentWalletAddress() !== owner) return;
    try {
      const nextBal = await chain.balances();
      if (currentWalletAddress() === owner) setBal(nextBal);
    } catch { /* trustlines not set yet */ }
  }

  function clearWalletView(message?: string) {
    setAddr("");
    setBal({});
    if (message) say(message);
  }

  async function activateWallet(wallet: string, switched = false) {
    setAddr(wallet);
    setBal({});
    if (switched) say(`Switched to ${short(wallet)}`);
    try {
      await chain.ensureAccount();
      await refresh(wallet);
    } catch (e: any) {
      if (switched) say("Wallet switched, but balances did not refresh: " + (e?.message || e));
    }
  }

  async function connect() {
    setBusy("connect");
    try {
      const w = await connectWallet();
      await activateWallet(w);
      say(`Connected ${short(w)}`);
    } catch (e: any) { say("Connect failed: " + (e?.message || e)); }
    setBusy(null);
  }

  function disconnect() { disconnectWallet(); clearWalletView("Disconnected"); }

  async function request(sym: string) {
    if (!addr) { say("Connect a wallet first"); return; }
    setBusy(sym);
    try {
      await chain.ensureAccount();
      say("Requesting wallet signature for trustlines…");
      await chain.ensureTrustlines();
      say(`Minting 100 ${sym}…`);
      await chain.coordMint(addr, sym, FAUCET_AMOUNT);
      await refresh();
      say(`Sent 100 ${sym} to ${short(addr)}.`);
    } catch (e: any) { say(`${sym} faucet failed: ` + (e?.message || e)); }
    setBusy(null);
  }

  async function requestAll() {
    if (!addr) { say("Connect a wallet first"); return; }
    setBusy("all");
    try {
      await chain.ensureAccount();
      say("Requesting wallet signature for trustlines…");
      await chain.ensureTrustlines();
      for (const t of CONFIG.TOKENS) { say(`Minting 100 ${t.sym}…`); await chain.coordMint(addr, t.sym, FAUCET_AMOUNT); }
      await refresh();
      say("Topped up all test tokens.");
    } catch (e: any) { say("Faucet failed: " + (e?.message || e)); }
    setBusy(null);
  }

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" style={{ cursor: "pointer" }} onClick={onHome} title="Back to home">
          <div className="mark" /><div className="name">Crossed</div>
        </div>
        <div className="walletline">
          <span className="pill"><span className="dot" /> Faucet · Testnet</span>
          <ThemeToggle />
          <button className="btn ghost sm" type="button" onClick={onApp}>Dark pool</button>
          {addr ? (
            <>
              <span className="pill wallet-pill">{short(addr)}</span>
              <button className="btn ghost sm" type="button" onClick={disconnect}>Disconnect</button>
            </>
          ) : null}
        </div>
      </div>

      {status && (
        <div className="statusbar" role="status" aria-live="polite" key={status.t + status.m}><span className="t">{status.t}</span><span>{status.m}</span></div>
      )}

      <div className="dp-grid">
        <div className="dp-main">
          <div className="card">
            <h2>Test token faucet</h2>
            <p className="muted" style={{ marginTop: 0 }}>
              Free testnet tokens for trying Crossed. Connect your wallet, then request any token — we set the
              trustlines and mint 100 to your address. Testnet only, no real value.
            </p>
            {!addr ? (
              <button className="btn" disabled={busy === "connect"} onClick={connect}>{busy === "connect" ? "Connecting…" : "Connect wallet"}</button>
            ) : (
              <button className="btn" disabled={!!busy} onClick={requestAll}>{busy === "all" ? "Minting…" : "Get 100 of every token"}</button>
            )}
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 10 }}>
              <h2 style={{ margin: 0 }}>Tokens</h2>
              {addr && <button className="btn ghost sm" disabled={!!busy || refreshing} title="Refresh"
                onClick={async () => { setRefreshing(true); try { await refresh(); } finally { setRefreshing(false); } }}>
                <span className={refreshing ? "px-spin" : undefined} style={{ display: "inline-block" }}>↻</span></button>}
            </div>
            <div className="pool-list">
              {CONFIG.TOKENS.map((t) => (
                <div className="pool-row" key={t.sym}>
                  <span className="sym"><TokenIcon symbol={t.icon} size={18} />{t.sym}</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 14 }}>
                    {addr && <span style={{ fontSize: 18 }}>{num(bal[t.sym] ?? "0")}</span>}
                    <button className="btn ghost sm" disabled={!addr || !!busy} onClick={() => request(t.sym)}>
                      {busy === t.sym ? "Minting…" : "Request 100"}
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
