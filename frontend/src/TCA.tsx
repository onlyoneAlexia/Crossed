// Crossed — Transaction-Cost-Analysis / execution-quality dashboard.
//
// Pure, standalone, controlled: props IN (onHome), callbacks OUT. No wallet, no
// coordinator — it only READS on-chain settlement events via RPC. The caller gates
// this whole page behind CONFIG.FEATURES.tca; this component renders unconditionally
// once mounted. Styling is the pixel-arcade layer (px-* + App.css tokens), so it
// drops into the existing app shell with no new CSS.
import { useCallback, useEffect, useState } from "react";
import "./App.css";
import { CONFIG } from "./lib/config";
import { loadTcaMetrics, type TcaMetrics } from "./lib/tca";
import { ThemeToggle } from "./components/ThemeToggle";

type Props = {
  onHome: () => void;
  /** Override the read target (defaults to the live dark-pool contract / RPC). */
  rpcUrl?: string;
  contractId?: string;
};

const nf = (n: number, d = 2) =>
  n.toLocaleString(undefined, { maximumFractionDigits: d });
const nfPrice = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 6 });
const short = (h?: string) => (h ? `${h.slice(0, 6)}…${h.slice(-4)}` : "");
const explorerTx = (h: string) =>
  `https://stellar.expert/explorer/testnet/tx/${h}`;

export default function TCA(props: Props) {
  const rpcUrl = props.rpcUrl ?? CONFIG.RPC_URL;
  const contractId = props.contractId ?? CONFIG.DP_CONTRACT_ID;

  const [data, setData] = useState<TcaMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setData(await loadTcaMetrics(rpcUrl, contractId));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [rpcUrl, contractId]);

  useEffect(() => { void load(); }, [load]);

  const explorer = `https://stellar.expert/explorer/testnet/contract/${contractId}`;

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" style={{ cursor: "pointer" }} onClick={props.onHome} title="Back to home">
          <div className="mark" /><div className="name">Crossed</div>
        </div>
        <div className="walletline">
          <span className="pill"><span className="dot" /> Execution quality · Testnet</span>
          <ThemeToggle />
          <button className="px-btn px-btn--sm" type="button" disabled={loading} onClick={() => void load()}>
            <span className={loading ? "px-spin" : undefined} style={{ display: "inline-block", marginRight: 6 }}>↻</span>
            {loading ? "Loading…" : "Refresh"}
          </button>
          <a className="px-btn px-btn--sm px-btn--ghost" href={explorer} target="_blank" rel="noopener noreferrer"
            style={{ textDecoration: "none" }}>Explorer ↗</a>
        </div>
      </div>

      <div className="px-card px-card--pop" style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 8px" }}>Transaction-Cost Analysis</h2>
        <p className="muted" style={{ margin: 0 }}>
          Settlement quality read straight from on-chain fill events via Stellar RPC — no indexer,
          no coordinator. Counts, executed volume and per-fill price dispersion vs the realised
          midpoint.
        </p>
      </div>

      {loading && !data && (
        <div className="px-card">
          <p className="muted" style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 10 }}>
            Reading settlement events <span className="px-dots" aria-hidden="true"><i /><i /><i /></span>
          </p>
          <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14, marginTop: 16 }}>
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="px-skel" style={{ height: 58 }} />)}
          </div>
        </div>
      )}

      {err && (
        <div className="px-card" style={{ marginBottom: 16 }}>
          <span className="px-badge px-badge--bad"><span className="px-badge__dot" />Read error</span>
          <p className="tiny mono" style={{ marginTop: 10, marginBottom: 0 }}>{err}</p>
        </div>
      )}

      {data && data.empty && <EmptyState contractId={contractId} explorer={explorer} />}

      {data && !data.empty && <Filled data={data} />}
    </div>
  );
}

// ----------------------------------------------------------------- subviews

function StatTiles({ data }: { data: TcaMetrics }) {
  const tiles: { k: string; v: string }[] = [
    { k: "Fills settled", v: nf(data.totalFills, 0) },
    { k: "Unique matches", v: nf(data.uniqueMatches, 0) },
    { k: "Active pairs", v: nf(data.activePairs, 0) },
    { k: "Quote volume", v: nf(data.totalQuoteVolume) },
    { k: "Avg dispersion", v: `${nf(data.avgPriceImprovementBps, 1)} bps` },
  ];
  return (
    <div className="px-card" style={{ marginBottom: 16 }}>
      <div className="px-card__title">Pool execution</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14 }}>
        {tiles.map((t) => (
          <div key={t.k}>
            <div className="px-stat__v">{t.v}</div>
            <div className="px-stat__k">{t.k}</div>
          </div>
        ))}
      </div>
      <hr className="px-rule" />
      <p className="tiny mono" style={{ margin: 0, opacity: 0.75 }}>
        Midpoint: {data.midpointSource === "vwap-derived" ? "derived (pair VWAP)" : "oracle ref_mid"} ·
        scanned ledgers {nf(data.scannedFromLedger, 0)}–{nf(data.scannedToLedger, 0)}
      </p>
    </div>
  );
}

function PerPairTable({ data }: { data: TcaMetrics }) {
  return (
    <div className="px-card" style={{ marginBottom: 16 }}>
      <div className="px-card__title">By pair</div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "var(--font-body)" }}>
          <thead>
            <tr style={{ textAlign: "right", color: "var(--muted)", fontFamily: "var(--font-label)", fontSize: 11, textTransform: "uppercase" }}>
              <th style={{ textAlign: "left", padding: "6px 8px" }}>Pair</th>
              <th style={{ padding: "6px 8px" }}>Fills</th>
              <th style={{ padding: "6px 8px" }}>Base vol</th>
              <th style={{ padding: "6px 8px" }}>Quote vol</th>
              <th style={{ padding: "6px 8px" }}>VWAP</th>
              <th style={{ padding: "6px 8px" }}>Disp. (bps)</th>
            </tr>
          </thead>
          <tbody>
            {data.perPair.map((p) => (
              <tr key={p.pairId} style={{ borderTop: "2px dashed var(--border)", textAlign: "right" }}>
                <td style={{ textAlign: "left", padding: "8px", color: "var(--fg)" }}>
                  {p.label} <span className="px-stat__k">#{p.pairId}</span>
                </td>
                <td style={{ padding: "8px" }}>{nf(p.fills, 0)}</td>
                <td style={{ padding: "8px" }}>{nf(p.baseVolume)} {p.base}</td>
                <td style={{ padding: "8px" }}>{nf(p.quoteVolume)} {p.quote}</td>
                <td style={{ padding: "8px", color: "var(--coin)" }}>{nfPrice(p.vwap)}</td>
                <td style={{ padding: "8px" }}>{nf(p.avgPriceImprovementBps, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecentFills({ data }: { data: TcaMetrics }) {
  return (
    <div className="px-card">
      <div className="px-card__title">Recent fills</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {data.recentFills.map((f, i) => (
          <div key={`${f.txHash}-${i}`} className="px-chip" style={{ justifyContent: "space-between", width: "100%" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="px-chip__sym">{f.label}</span>
              <span className="px-chip__amt" style={{ fontSize: 18 }}>{nfPrice(f.price)}</span>
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span className="tiny mono">{nf(f.baseAmount)} / {nf(f.quoteAmount)}</span>
              {f.txHash
                ? <a className="tiny mono" style={{ color: "var(--bbb)" }} href={explorerTx(f.txHash)}
                    target="_blank" rel="noopener noreferrer">{short(f.txHash)} ↗</a>
                : <span className="tiny mono" style={{ opacity: 0.6 }}>—</span>}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Filled({ data }: { data: TcaMetrics }) {
  return (
    <>
      <StatTiles data={data} />
      <PerPairTable data={data} />
      <RecentFills data={data} />
    </>
  );
}

function EmptyState({ contractId, explorer }: { contractId: string; explorer: string }) {
  return (
    <div className="px-card px-card--pop" style={{ textAlign: "center", padding: "64px 24px" }}>
      <div className="px-stat__v" style={{ fontSize: 22 }}>No fills yet</div>
      <p className="muted" style={{ maxWidth: 460, margin: "12px auto 18px" }}>
        No settlement events were found for this contract in the recent ledger window. Once orders
        cross and settle on-chain, execution-quality metrics appear here automatically.
      </p>
      <p className="tiny mono" style={{ margin: "0 0 14px", opacity: 0.7 }}>{short(contractId)}</p>
      <a className="px-btn px-btn--ghost px-btn--sm" href={explorer} target="_blank" rel="noopener noreferrer"
        style={{ textDecoration: "none" }}>View contract on Explorer ↗</a>
      {/* skeleton preview of the metrics grid that fills will populate */}
      <div aria-hidden="true" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 14, marginTop: 32, opacity: 0.6 }}>
        {["Fills settled", "Unique matches", "Active pairs", "Quote volume", "Avg dispersion", "VWAP"].map((k) => (
          <div key={k} className="px-skel" style={{ height: 70, display: "grid", placeItems: "center" }}>
            <span className="px-stat__k">{k}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
