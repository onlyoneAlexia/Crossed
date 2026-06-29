// CROSSED v2 — Advanced order fields (time-in-force / expiry, min-fill MAQ,
// counterparty tier, post-only). Pure, controlled, standalone: props in, callback out.
// The CALLER gates this behind CONFIG.FEATURES (tif / maq / tiers / partialFills);
// this component owns no feature flags and touches no globals.
//
// Pixel-arcade styling: reuses the .px-* layer (pixel-ui.css) + var(--...) tokens
// from index.css only. No new CSS files, no external deps.

import { useState, type CSSProperties } from "react";

export type Tif = "GTT" | "DAY" | "IOC";

export interface AdvancedOrder {
  tif: Tif;
  expiryMins?: number;
  minFill?: string;
  tier?: number;
}

const TIF_OPTIONS: { v: Tif; label: string; hint: string }[] = [
  { v: "GTT", label: "Until it expires", hint: "Stays open until the time you set" },
  { v: "DAY", label: "Until end of day", hint: "Cancels itself tonight" },
  { v: "IOC", label: "Fill now or cancel", hint: "No waiting — match instantly or drop" },
];

// "Who can match you" = the lowest trust level you'll accept on the other side.
const TIER_OPTIONS: { v: number; label: string }[] = [
  { v: 0, label: "Anyone" },
  { v: 1, label: "Verified only" },
  { v: 2, label: "Trusted only" },
  { v: 3, label: "Top-tier only" },
];

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-label)",
  fontSize: 10,
  letterSpacing: ".08em",
  textTransform: "uppercase",
  color: "var(--muted)",
  display: "block",
  marginBottom: 6,
};

const rowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 12,
};

const fieldStyle: CSSProperties = { minWidth: 0 };

const selectStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 18,
  color: "var(--fg)",
  background: "var(--bg-2)",
  border: "2px solid var(--border)",
  borderRadius: "var(--radius-sm)",
  padding: "8px 10px",
  width: "100%",
  outline: "none",
  cursor: "pointer",
};

const inputCompact: CSSProperties = { fontSize: 18, padding: "8px 10px" };

const hintStyle: CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 14,
  color: "var(--muted-2)",
  marginTop: 4,
  lineHeight: 1.2,
  minHeight: 16,
};

export function AdvancedOrderFields({
  value,
  onChange,
}: {
  value: AdvancedOrder;
  onChange: (v: AdvancedOrder) => void;
}) {
  const patch = (p: Partial<AdvancedOrder>) => onChange({ ...value, ...p });

  // Folded by default, like Uniswap's slippage/advanced panel — opens on click.
  const [open, setOpen] = useState(false);

  // IOC orders match-or-cancel within the batch, so there is no resting expiry.
  const expiryDisabled = value.tif === "IOC";
  const activeTif = TIF_OPTIONS.find((o) => o.v === value.tif);

  // One-line summary of any non-default settings, shown on the collapsed header.
  const summaryParts: string[] = [];
  if (value.tif && value.tif !== "GTT") summaryParts.push(value.tif);
  if (!expiryDisabled && value.expiryMins) summaryParts.push(`${value.expiryMins}m`);
  if (value.minFill) summaryParts.push(`min ${value.minFill}`);
  if (value.tier) summaryParts.push(`T${value.tier}`);
  const summary = summaryParts.length ? summaryParts.join(" · ") : "default";

  return (
    <div className="px-card" style={{ padding: 0, display: "grid", gap: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="px-card__title"
        style={{
          margin: 0, display: "flex", alignItems: "center", gap: 8, width: "100%",
          padding: 14, background: "none", border: 0, color: "inherit", font: "inherit",
          textAlign: "left", cursor: "pointer",
        }}
      >
        <span
          aria-hidden="true"
          style={{ fontSize: 11, opacity: 0.7, transition: "transform .15s ease", transform: open ? "rotate(90deg)" : "none" }}
        >
          ▸
        </span>
        <span>Advanced</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-body)", fontSize: 14, color: "var(--muted-2)" }}>
          {open ? "" : summary}
        </span>
      </button>

      <div className="aof-body" style={{ gridTemplateRows: open ? "1fr" : "0fr" }} aria-hidden={!open}>
      <div style={{ overflow: "hidden", minHeight: 0 }}>
      <div style={{ display: "grid", gap: 14, padding: "0 14px 14px" }}>
      {/* Time-in-force + expiry */}
      <div style={rowStyle}>
        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="aof-tif">
            How long it stays open
          </label>
          <select
            id="aof-tif"
            style={selectStyle}
            value={value.tif}
            onChange={(e) => {
              const tif = e.target.value as Tif;
              // Dropping the resting expiry when switching to IOC keeps state honest.
              patch(tif === "IOC" ? { tif, expiryMins: undefined } : { tif });
            }}
          >
            {TIF_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
          <div style={hintStyle}>{activeTif?.hint}</div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="aof-expiry">
            Expires after (min)
          </label>
          <input
            id="aof-expiry"
            className="px-input"
            style={{ ...inputCompact, opacity: expiryDisabled ? 0.45 : 1 }}
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            placeholder="60"
            disabled={expiryDisabled}
            value={value.expiryMins ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              patch({ expiryMins: raw === "" ? undefined : Math.max(1, Number(raw) | 0) });
            }}
          />
          <div style={hintStyle}>
            {expiryDisabled ? "not used for fill-now" : "then it auto-cancels"}
          </div>
        </div>
      </div>

      {/* Min fill (MAQ) + counterparty tier */}
      <div style={rowStyle}>
        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="aof-maq">
            Smallest amount to trade
          </label>
          <input
            id="aof-maq"
            className="px-input"
            style={inputCompact}
            inputMode="decimal"
            placeholder="0"
            value={value.minFill ?? ""}
            onChange={(e) => {
              const raw = e.target.value;
              // Allow only digits + one dot; keep as string (matches money-figure handling).
              if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                patch({ minFill: raw === "" ? undefined : raw });
              }
            }}
          />
          <div style={hintStyle}>Won't fill for less</div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="aof-tier">
            Who can match you
          </label>
          <select
            id="aof-tier"
            style={selectStyle}
            value={value.tier ?? 0}
            onChange={(e) => {
              const t = Number(e.target.value) | 0;
              patch({ tier: t === 0 ? undefined : t });
            }}
          >
            {TIER_OPTIONS.map((o) => (
              <option key={o.v} value={o.v}>
                {o.label}
              </option>
            ))}
          </select>
          <div style={hintStyle}>Limit who can fill it</div>
        </div>
      </div>
      </div>
      </div>
      </div>
    </div>
  );
}
