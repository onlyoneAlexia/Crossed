/* CROSSED — KillSwitchBanner
   Prominent pause/halt notice shown when the venue is paused (kill switch on).
   Gated by the caller behind CONFIG.FEATURES.killSwitch — this component is pure,
   standalone and controlled (props in, no callbacks needed). Returns null when not paused.

   Style: pixel-arcade tokens only (var(--…) from index.css). Uses the reserved
   warn/danger family so the halted state reads loud, but keeps the reassuring
   "Withdraw stays available" line so users never feel funds are trapped.
*/

type KillSwitchBannerProps = {
  paused: boolean;
  reason?: string;
};

export function KillSwitchBanner({ paused, reason }: KillSwitchBannerProps) {
  if (!paused) return null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        width: "100%",
        background: "var(--bad-bg)",
        border: "2px solid var(--bad)",
        borderRadius: "var(--radius)",
        boxShadow: "var(--shadow)",
        color: "var(--fg)",
        padding: "14px 16px",
        imageRendering: "pixelated",
      }}
    >
      {/* halt glyph — octagon "stop" square, pixel hard edges */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          display: "inline-grid",
          placeItems: "center",
          width: 28,
          height: 28,
          marginTop: 2,
          background: "var(--bad)",
          color: "#160305",
          border: "2px solid #8A1F22",
          borderRadius: "var(--radius-sm)",
          fontFamily: "var(--font-label)",
          fontSize: 14,
          lineHeight: 1,
        }}
      >
        {"■"}
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--font-label)",
            textTransform: "uppercase",
            letterSpacing: ".08em",
            fontSize: 12,
            color: "var(--bad)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 8,
              height: 8,
              background: "currentColor",
              boxShadow: "inset 0 0 0 2px var(--ink)",
              imageRendering: "pixelated",
            }}
          />
          Venue paused
        </div>

        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-body)",
            fontSize: 19,
            lineHeight: 1.35,
            color: "var(--fg)",
          }}
        >
          Placing and settling orders is halted{reason ? ` — ${reason}` : "."}
        </p>

        <p
          style={{
            margin: "6px 0 0",
            fontFamily: "var(--font-body)",
            fontSize: 18,
            lineHeight: 1.35,
            color: "var(--good)",
          }}
        >
          {"✓"} Withdraw stays available. Your funds are never locked by a pause.
        </p>
      </div>
    </div>
  );
}
