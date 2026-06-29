/**
 * PartialFillRow — one Activity-card row showing a *partial* dark-pool fill.
 *
 * v2 dpmatch settles partial fills: an order can cross for less than its full
 * size, leaving a residual (change-note) UTXO that stays open. This row makes
 * that split legible — how much base actually filled vs. how much is still
 * resting — in the same pixel-arcade row style as the rest of the desk list.
 *
 * Pure / standalone / controlled: props in, no callbacks, no app imports. The
 * caller gates rendering behind CONFIG.FEATURES.partialFills and supplies the
 * already-formatted fill record. Reuses existing classes only
 * (.desks li / .deskname / .desk-meta / .chip / .pill / .mono / .tx-link) and
 * var(--…) tokens, so it inherits theming with zero new CSS.
 */

/** A single partial fill, as handed in by the caller (amounts are display strings). */
export interface PartialFill {
  /** base asset symbol, e.g. "XLM" */
  base: string;
  /** quote asset symbol, e.g. "USDC" */
  quote: string;
  /** amount of base that actually crossed/settled */
  filledBase: string;
  /** amount of base left resting as a residual change-note (omit/empty → fully filled) */
  residualBase?: string;
  /** settlement tx hash, if on-chain */
  tx?: string;
}

// Block explorer for the settlement tx (testnet — switch to /public for mainnet).
const txUrl = (h: string) => `https://stellar.expert/explorer/testnet/tx/${h}`;

export function PartialFillRow({ fill }: { fill: PartialFill }) {
  const { base, quote, filledBase, residualBase, tx } = fill;
  const hasResidual = !!residualBase && residualBase.trim() !== "" && residualBase.trim() !== "0";

  return (
    <li className="desks-row" aria-label={`Partial fill ${base}/${quote}`}>
      <div className="deskname">
        <span className="chip aaa">{base}</span>
        <span className="mono" aria-hidden style={{ color: "var(--muted-2)" }}>
          /
        </span>
        <span className="chip bbb">{quote}</span>
        <span
          className="pill"
          title={hasResidual ? "Order crossed for less than its full size" : "Order crossed in full"}
          style={{ marginLeft: "auto" }}
        >
          {hasResidual ? "Partial fill" : "Filled"}
        </span>
      </div>

      <div className="desk-meta">
        <span className="mono" title="Base amount that settled on-chain">
          <span style={{ color: "var(--muted)" }}>filled </span>
          <strong style={{ color: "var(--good)" }}>{filledBase}</strong>{" "}
          <span style={{ color: "var(--muted-2)" }}>{base}</span>
        </span>

        {hasResidual && (
          <span className="mono" title="Base left resting as a residual change-note (still open)">
            <span style={{ color: "var(--muted)" }}>residual </span>
            <strong style={{ color: "var(--fg)" }}>{residualBase}</strong>{" "}
            <span style={{ color: "var(--muted-2)" }}>{base}</span>
          </span>
        )}

        {tx && (
          <a
            className="tiny mono tx-link"
            href={txUrl(tx)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="View settlement on Stellar Explorer"
            style={{ marginLeft: "auto" }}
          >
            {tx.slice(0, 10)}…
          </a>
        )}
      </div>
    </li>
  );
}

export default PartialFillRow;
