// CROSSED v2 — Advanced order fields (time-in-force / expiry, min-fill MAQ,
// counterparty tier, post-only). Pure, controlled, standalone: props in, callback out.
// The CALLER gates this behind CONFIG.FEATURES (tif / maq / tiers / partialFills);
// this component owns no feature flags and touches no globals.
//
// Pixel-arcade styling: reuses the .px-* layer (pixel-ui.css) + var(--...) tokens
// from index.css only. No new CSS files, no external deps.

import type { CSSProperties } from "react";

export type Tif = "GTT" | "DAY" | "IOC";

export interface AdvancedOrder {
  tif: Tif;
  expiryMins?: number;
  minFill?: string;
  tier?: number;
  postOnly?: boolean;
}

const TIF_OPTIONS: { v: Tif; label: string; hint: string }[] = [
  { v: "GTT", label: "GTT", hint: "Good-til-time" },
  { v: "DAY", label: "DAY", hint: "Expires end of day" },
  { v: "IOC", label: "IOC", hint: "Immediate-or-cancel" },
];

// Counterparty tier = minimum trust class your fill is allowed to match against.
const TIER_OPTIONS: { v: number; label: string }[] = [
  { v: 0, label: "ANY" },
  { v: 1, label: "T1" },
  { v: 2, label: "T2" },
  { v: 3, label: "T3" },
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

  // IOC orders match-or-cancel within the batch, so there is no resting expiry.
  const expiryDisabled = value.tif === "IOC";
  const activeTif = TIF_OPTIONS.find((o) => o.v === value.tif);

  return (
    <div className="px-card" style={{ padding: 14, display: "grid", gap: 14 }}>
      <div
        className="px-card__title"
        style={{ margin: 0, display: "flex", alignItems: "center", gap: 8 }}
      >
        <span>Advanced</span>
        {value.postOnly ? (
          <span className="px-badge px-badge--ok" style={{ fontSize: 9, padding: "3px 6px" }}>
            <span className="px-badge__dot" />
            MAKER
          </span>
        ) : null}
      </div>

      {/* Time-in-force + expiry */}
      <div style={rowStyle}>
        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="aof-tif">
            Time in force
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
            Expiry (min)
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
            {expiryDisabled ? "n/a for IOC" : "Cancel after"}
          </div>
        </div>
      </div>

      {/* Min fill (MAQ) + counterparty tier */}
      <div style={rowStyle}>
        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="aof-maq">
            Min fill (MAQ)
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
          <div style={hintStyle}>Min accept qty</div>
        </div>

        <div style={fieldStyle}>
          <label style={labelStyle} htmlFor="aof-tier">
            Counterparty tier
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
          <div style={hintStyle}>Min trust class</div>
        </div>
      </div>

      {/* Post-only toggle */}
      <label
        htmlFor="aof-postonly"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <input
          id="aof-postonly"
          type="checkbox"
          checked={!!value.postOnly}
          onChange={(e) => patch({ postOnly: e.target.checked })}
          style={{ width: 16, height: 16, accentColor: "var(--coin)", cursor: "pointer" }}
        />
        <span style={{ ...labelStyle, margin: 0, color: "var(--fg)" }}>
          Post-only (maker)
        </span>
        <span style={{ ...hintStyle, margin: 0, minHeight: 0 }}>
          reject if it would take
        </span>
      </label>
    </div>
  );
}
