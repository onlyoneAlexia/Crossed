import "./arcade-timeline.css";

type NodeDef = { n: string; label: string; cap: string; kind: "offer" | "hidden" | "match" | "swap" };

const NODES: NodeDef[] = [
  { n: "01", label: "You offer", cap: "locked on your device", kind: "offer" },
  { n: "02", label: "Stays hidden", cap: "nobody can see it", kind: "hidden" },
  { n: "03", label: "It matches", cap: "only you two see it", kind: "match" },
  { n: "04", label: "You swap", cap: "both sides at once", kind: "swap" },
];

function Glyph({ kind }: { kind: NodeDef["kind"] }) {
  const common = { viewBox: "0 0 24 24", width: 40, height: 40, shapeRendering: "crispEdges" as const };

  // 01 — a sealed private order ticket: card + redacted lines + a gold coin, sealed shut
  if (kind === "offer")
    return (
      <svg {...common} className="at-glyph-svg">
        <rect x="4" y="5" width="16" height="15" fill="#FDF6E3" />
        <rect x="4" y="5" width="16" height="4" fill="#FF2E88" />
        <rect x="6" y="11" width="10" height="1" fill="#C9BFA6" />
        <rect x="6" y="13" width="7" height="1" fill="#C9BFA6" />
        <rect x="6" y="15" width="9" height="1" fill="#C9BFA6" />
        <g className="at-coin-drop">
          <rect x="12" y="13" width="6" height="5" fill="#FFD23F" />
          <rect x="13" y="12" width="4" height="1" fill="#FFE98A" />
          <rect x="13" y="14" width="2" height="2" fill="#FF9E2C" />
        </g>
      </svg>
    );

  // 02 — padlock (same language as the hero): closed, then it clicks shut
  if (kind === "hidden")
    return (
      <svg {...common} className="at-glyph-svg">
        <g className="at-shackle">
          <rect x="8" y="5" width="2" height="6" fill="#EDE3C6" />
          <rect x="14" y="5" width="2" height="6" fill="#EDE3C6" />
          <rect x="9" y="3" width="6" height="2" fill="#EDE3C6" />
          <rect x="8" y="4" width="2" height="1" fill="#EDE3C6" />
          <rect x="14" y="4" width="2" height="1" fill="#EDE3C6" />
        </g>
        <rect x="5" y="11" width="14" height="10" fill="#FFD23F" />
        <rect x="5" y="11" width="14" height="2" fill="#FFE98A" />
        <rect x="17" y="13" width="2" height="8" fill="#FF9E2C" />
        <rect x="11" y="14" width="2" height="3" fill="#15110C" />
        <rect x="11" y="16" width="2" height="3" fill="#15110C" />
      </svg>
    );

  // 03 — the brand mark itself is revealed: two orders Crossed (real logo on a coin badge)
  if (kind === "match")
    return (
      <svg {...common} className="at-glyph-svg">
        <g className="at-badge">
          <rect x="4" y="4" width="16" height="16" fill="#2BFF88" />
          <rect x="5" y="5" width="14" height="14" fill="#FDF6E3" />
          <image href="/crossed-logo.svg" x="5" y="5" width="14" height="14" />
        </g>
      </svg>
    );

  // 04 — the two real pixel token coins trade places
  return (
    <svg {...common} className="at-glyph-svg">
      <image className="at-swapL" href="/tokens/usdc-px.svg" x="2" y="7" width="10" height="10" />
      <image className="at-swapR" href="/tokens/xlm-px.svg" x="12" y="7" width="10" height="10" />
    </svg>
  );
}

export default function ArcadeTimeline() {
  return (
    <div className="at-wrap" role="list" aria-label="How a Crossed swap progresses">
      <div className="at-bg" aria-hidden="true"><div className="at-stars" /><div className="at-scan" /></div>
      <div className="at-track" aria-hidden="true"><div className="at-fill" /></div>
      <div className="at-sprite" aria-hidden="true">
        <svg viewBox="0 0 12 12" width="22" height="22" shapeRendering="crispEdges">
          <rect x="3" y="1" width="6" height="10" fill="#0A0A12" />
          <rect x="1" y="3" width="10" height="6" fill="#0A0A12" />
          <rect x="3" y="2" width="6" height="8" fill="#FFD23F" />
          <rect x="2" y="4" width="8" height="4" fill="#FFD23F" />
          <rect x="3" y="2" width="2" height="2" fill="#FFE98A" />
          <rect x="5" y="5" width="2" height="2" fill="#FF9E2C" />
        </svg>
      </div>
      <div className="at-nodes">
        {NODES.map((nd, i) => (
          <div className={`at-node at-${nd.kind}`} key={nd.label}
            style={{ ["--i" as string]: i } as React.CSSProperties} role="listitem"
            aria-label={`Step ${i + 1}: ${nd.label} — ${nd.cap}`}>
            <span className="at-num">{nd.n}</span>
            <div className="at-cell">
              <span className="at-spark s-t" /><span className="at-spark s-r" />
              <span className="at-spark s-b" /><span className="at-spark s-l" />
              <Glyph kind={nd.kind} />
            </div>
            <span className="at-label">{nd.label}</span>
            <span className="at-cap">{nd.cap}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
