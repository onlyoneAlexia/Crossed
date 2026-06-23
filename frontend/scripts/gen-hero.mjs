// Generate a frame-by-frame pixel-art hero as an SVG "filmstrip" played with steps()
// (the correct way to animate pixel art: discrete grid-snapped frames, no sub-pixel tweening).
// Story beats: sealed orders -> coins converge -> cross at center X -> swap sides -> matched.
import { writeFileSync } from "fs";

const FW = 256, FH = 96;          // one frame
const N = 28;                      // frames
const DUR = 2.8;                   // seconds (=> ~10fps)
const SNAP = 2;                    // grid snap (px)

const COL = {
  bg: "#15110C", band: "#211A10", rail: "#9B7BFF", ink: "#070502", cream: "#FDF6E3",
  gold: "#FFD23F", goldHi: "#FFE98A", magenta: "#FF2E88", cyan: "#2CE8F5", green: "#2BFF88", dim: "#2A1F63",
  creamSh: "#E0D2A0", hairA: "#6B4A2A", hairB: "#241733", pants: "#222B57", skinSh: "#D9C089",
};
const snap = (v) => Math.round(v / SNAP) * SNAP;
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const r = (x, y, w, h, f) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${f}"/>`;

// --- static actors (same every frame) ---
function trader(x, body, hair, dir) {
  // detailed pixel trader; x = left edge (~28 wide), faces toward center via `dir` (+1 right / -1 left)
  const s = dir > 0 ? 1 : -1;            // eye/feature shift toward facing direction
  const ink = COL.ink;
  return [
    // cap
    r(x + 7, 32, 14, 5, COL.rail), r(x + 9, 31, 8, 1, COL.violet || COL.rail),
    r(x + 5, 37, 18, 2, COL.dim),         // brim
    // hair under cap
    r(x + 8, 39, 12, 2, hair), r(x + 6, 39, 2, 7, hair), r(x + 20, 39, 2, 7, hair),
    // face
    r(x + 8, 40, 12, 13, COL.cream),
    r(x + (s > 0 ? 18 : 8), 41, 2, 11, COL.skinSh), // shaded cheek on the away side
    r(x + 6, 45, 2, 3, COL.cream), r(x + 20, 45, 2, 3, COL.cream), // ears
    // brows + eyes (look toward center)
    r(x + 9 + s, 43, 2, 1, hair), r(x + 14 + s, 43, 2, 1, hair),
    r(x + 9 + s, 45, 2, 2, ink), r(x + 14 + s, 45, 2, 2, ink),
    r(x + 9 + s, 45, 1, 1, COL.cream), r(x + 14 + s, 45, 1, 1, COL.cream), // glints
    // nose + smile
    r(x + 13, 47, 1, 3, COL.skinSh),
    r(x + 10, 50, 8, 1, COL.skinSh), r(x + 9, 49, 1, 1, COL.skinSh), r(x + 18, 49, 1, 1, COL.skinSh),
    // neck
    r(x + 11, 53, 6, 3, COL.skinSh),
    // suit body + shaded edge
    r(x + 3, 56, 22, 20, body), r(x + 23, 57, 2, 18, COL.dim), r(x + 3, 57, 2, 18, COL.dim),
    // collar + shirt V + tie + buttons
    r(x + 6, 56, 16, 3, COL.rail),
    r(x + 11, 57, 6, 9, COL.cream),
    r(x + 12, 57, 4, 2, COL.gold), r(x + 13, 59, 2, 9, COL.gold),  // tie
    r(x + 13, 61, 1, 1, ink), r(x + 13, 64, 1, 1, ink),            // buttons
    // arms + hands
    r(x + 1, 57, 3, 15, body), r(x + 24, 57, 3, 15, body),
    r(x + 1, 72, 3, 3, COL.cream), r(x + 24, 72, 3, 3, COL.cream),
    // belt + buckle
    r(x + 3, 76, 22, 2, ink), r(x + 12, 76, 4, 2, COL.gold),
    // pants + shoes
    r(x + 5, 78, 8, 8, COL.pants), r(x + 15, 78, 8, 8, COL.pants),
    r(x + 4, 86, 9, 3, ink), r(x + 15, 86, 9, 3, ink),
  ].join("");
}
function lock(cx, cy, open) {
  // padlock; shackle lifts + tilts when open
  const body = r(cx - 8, cy, 16, 14, COL.gold) + r(cx - 2, cy + 4, 4, 5, COL.ink);
  const shackle = open
    ? r(cx - 9, cy - 8, 4, 8, COL.cream) + r(cx - 9, cy - 10, 8, 3, COL.cream)   // open: lifted to the side
    : r(cx - 6, cy - 8, 3, 8, COL.cream) + r(cx + 3, cy - 8, 3, 8, COL.cream) + r(cx - 6, cy - 10, 12, 3, COL.cream);
  return shackle + body;
}
function coin(cx, cy, href) {
  // bare token icon — the logos are already circular with their own fill, no backing square
  const sz = 30;
  return `<image href="${href}" xlink:href="${href}" x="${cx - sz / 2}" y="${cy - sz / 2}" width="${sz}" height="${sz}" preserveAspectRatio="xMidYMid meet"/>`;
}
function bigX(cx, cy, size, color) {
  // diagonal pixel X drawn at discrete sizes (no CSS scale)
  if (size <= 0) return "";
  const out = [];
  for (let i = -size; i <= size; i += 2) {
    out.push(r(cx + i - 1, cy + i - 1, 3, 3, color));
    out.push(r(cx - i - 1, cy + i - 1, 3, 3, color));
  }
  out.push(r(cx - 2, cy - 2, 4, 4, COL.goldHi));
  return out.join("");
}
function check(cx, cy) {
  return [
    r(cx - 6, cy, 3, 3, COL.green), r(cx - 3, cy + 3, 3, 3, COL.green),
    r(cx, cy + 6, 3, 3, COL.green), r(cx + 3, cy + 3, 3, 3, COL.green),
    r(cx + 6, cy, 3, 3, COL.green), r(cx + 9, cy - 3, 3, 3, COL.green),
  ].join("");
}
function logoBadge(cx, cy, glow) {
  // the original Crossed brand mark, revealed on a coin-style badge at the match
  const ring = [
    glow ? r(cx - 16, cy - 16, 32, 32, COL.green) : "",   // green halo on the pop frame
    r(cx - 13, cy - 13, 26, 26, COL.gold),
    r(cx - 11, cy - 15, 22, 2, COL.goldHi),
    r(cx - 11, cy - 11, 22, 22, COL.cream),               // face plate
  ].join("");
  const img = `<image href="/crossed-logo.svg" xlink:href="/crossed-logo.svg" x="${cx - 10}" y="${cy - 10}" width="20" height="20" preserveAspectRatio="xMidYMid meet"/>`;
  return ring + img;
}

const STARS = [[40, 12, COL.goldHi], [96, 8, COL.cyan], [150, 14, COL.goldHi], [210, 10, COL.rail], [70, 22, COL.rail], [184, 24, COL.goldHi]];

function frameStatic() {
  let s = r(0, 0, FW, FH, COL.bg) + r(0, 82, FW, FH - 82, COL.band) + r(0, 80, FW, 2, COL.rail);
  for (const [x, y, c] of STARS) s += r(x, y, 2, 2, c);
  // ground prize bars
  s += r(20, 86, 40, 4, COL.green) + r(196, 86, 40, 4, COL.green) + r(112, 86, 32, 4, COL.gold);
  s += trader(12, COL.cyan, COL.hairA, +1) + trader(220, COL.magenta, COL.hairB, -1);
  return s;
}

// timeline (per-frame state)
const SEAL_END = 5;      // 0..5 sealed hold
const TRAVEL_END = 21;   // 6..21 travel/cross/swap
const matchFrame = 13;   // X peak + locks open + cross

function frame(i) {
  let s = frameStatic();
  // phase progress for travel
  const traveling = i > SEAL_END && i <= TRAVEL_END;
  const t = traveling ? (i - SEAL_END) / (TRAVEL_END - SEAL_END) : (i <= SEAL_END ? 0 : 1);
  const e = easeInOut(t);
  // coin x: XLM left->right, USDC right->left (cross at center)
  const xlmX = snap(lerp(60, 196, e));
  const usdcX = snap(lerp(196, 60, e));
  // opposite vertical arcs so the two coins visibly pass each other at the cross
  const arc = Math.sin(Math.PI * t);
  const xlmY = snap(44 - 12 * arc);   // XLM hops up and over
  const usdcY = snap(44 + 8 * arc);   // USDC dips down and under
  const opened = i >= matchFrame;
  const matched = i > TRAVEL_END;

  // padlock centered above each trader's head: sealed -> open at the match
  s += lock(26, 10, opened) + lock(230, 10, opened);

  // center X: a violet "crossing" spark that grows as the coins meet
  if (!matched) {
    let xsize = 0;
    if (i >= matchFrame - 4 && i <= matchFrame + 2) xsize = 6 + Math.min(7, Math.abs(4 - Math.abs(i - matchFrame)) * 3);
    if (xsize > 0) s += bigX(128, 42, xsize, COL.rail);
  }

  // bare token coins (pixelated logo renditions to match the 8-bit art)
  s += coin(xlmX, xlmY, "/tokens/xlm-px.svg");
  s += coin(usdcX, usdcY, "/tokens/usdc-px.svg");

  // match: reveal the original Crossed brand mark at the crossing point + a success check
  if (matched) {
    s += logoBadge(128, 42, i <= TRAVEL_END + 2);   // green halo on the first couple of pop frames
    s += check(128, 12);
  }

  return s;
}

let frames = "";
for (let i = 0; i < N; i++) frames += `    <g transform="translate(${i * FW} 0)">${frame(i)}</g>\n`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${FW} ${FH}" width="100%" role="img" aria-label="Two sealed orders cross at the center X and swap XLM and USDC, then match" shape-rendering="crispEdges" preserveAspectRatio="xMidYMid meet">
  <style>
    rect{shape-rendering:crispEdges}
    .strip{animation:play ${DUR}s steps(${N}) infinite;will-change:transform}
    @keyframes play{from{transform:translateX(0)}to{transform:translateX(-${N * FW}px)}}
    @media (prefers-reduced-motion:reduce){.strip{animation:none;transform:translateX(-${(N - 1) * FW}px)}}
  </style>
  <g class="strip">
${frames}  </g>
</svg>`;

const out = process.argv[2] || "/tmp/hero_film.svg";
writeFileSync(out, svg);
console.log(`wrote ${out} — ${N} frames, ${svg.length} bytes`);

// contact sheet: all frames in a static grid for verification
if (process.argv.includes("--sheet")) {
  const COLS = 4, ROWS = Math.ceil(N / COLS), GAP = 6;
  const SW = COLS * (FW + GAP) + GAP, SH = ROWS * (FH + GAP) + GAP;
  let cells = "";
  for (let i = 0; i < N; i++) {
    const cx = GAP + (i % COLS) * (FW + GAP), cy = GAP + Math.floor(i / COLS) * (FH + GAP);
    cells += `<g transform="translate(${cx} ${cy})">${frame(i)}<text x="4" y="10" font-family="monospace" font-size="9" fill="#fff">${i}</text></g>`;
  }
  const sheet = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${SW} ${SH}" width="${SW}" height="${SH}"><rect width="${SW}" height="${SH}" fill="#222"/>${cells}</svg>`;
  writeFileSync("/tmp/hero_sheet.svg", sheet);
  writeFileSync("public/sheet.html", `<!doctype html><meta charset="utf8"><body style="margin:0;background:#222">${sheet}</body>`);
  console.log(`wrote /tmp/hero_sheet.svg + public/sheet.html — ${SW}x${SH}`);
}
