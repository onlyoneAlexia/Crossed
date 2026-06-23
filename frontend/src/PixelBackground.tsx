import { useEffect, useRef } from "react";

/**
 * PixelBackground — active 8-bit arcade backdrop for the Crossed landing page.
 *
 * Sits BEHIND all content: fixed, full-viewport, z-index below, pointer-events:none.
 * Everything is drawn as flat color blocks snapped to an integer pixel grid, with
 * image smoothing disabled, so it reads as CRISP pixel art (no blur, no soft glow).
 *
 * Layers (back -> front):
 *   1. Flat retro sky wash (hard vertical color bands, not a soft gradient).
 *   2. Slowly scrolling pixel grid (the "arcade floor").
 *   3. Three parallax fields of pixel-art sprites: coins, stars, "cross" tokens.
 *   4. Subtle CRT scanlines (every other physical row, very low alpha).
 *
 * Performance: the static layers (sky + grid + scanlines) are pre-rendered once to
 * an offscreen canvas and only re-blitted; the grid scroll is done by offsetting the
 * blit, so per-frame cost is dominated by ~70 fillRect sprite cells. Delta-time
 * integrated, DPR-capped, pauses on tab hide, fully static under prefers-reduced-motion.
 */

// ---- pixel-art sprite matrices (each char = one "art pixel" = SCALE device px) ----
// palette keys map to colors per sprite kind; "." = transparent.
const COIN = [
  "..oooo..",
  ".oyyyyo.",
  "oyhyyyho",
  "oyyhhyyo",
  "oyyhhyyo",
  "oyhyyyho",
  ".oyyyyo.",
  "..oooo..",
];

const STAR = [
  "...c...",
  "...c...",
  ".c.c.c.",
  "..ccc..",
  "cccccccc".slice(0, 7),
  "..ccc..",
  ".c.c.c.",
];

// the "crossed" token: an X made of two flat-color diagonals on a rounded chip
const CROSS = [
  ".pppppp.",
  "p.w..w.p",
  "pw.ww.wp",
  "p..ww..p",
  "p..ww..p",
  "pw.ww.wp",
  "p.w..w.p",
  ".pppppp.",
];

type Sprite = { rows: string[]; w: number; h: number };
const mk = (rows: string[]): Sprite => ({ rows, w: rows[0].length, h: rows.length });
const SPRITES = { coin: mk(COIN), star: mk(STAR), cross: mk(CROSS) };

// vibrant arcade palette (flat, saturated — no soft glow)
const PAL: Record<string, string> = {
  o: "#7a3b00", // coin outline / dark amber
  y: "#ffcf3f", // coin gold
  h: "#fff7c2", // coin highlight
  c: "#7df9ff", // star cyan
  p: "#ff4f9a", // cross chip pink (Crossed brand-ish)
  w: "#fff4fb", // cross white-pink highlight
};

type Kind = keyof typeof SPRITES;

type Particle = {
  kind: Kind;
  x: number; // device px
  y: number;
  vx: number; // device px / sec
  vy: number;
  scale: number; // device px per art-pixel
  spin: number; // 0..1 phase for coin "flip"
  spinSpeed: number;
  layer: number; // 0 back .. 2 front (depth tint)
};

const LAYER_TINT = [0.55, 0.78, 1]; // back layers slightly dimmed for parallax depth

export default function PixelBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    // cap DPR: pixel art doesn't benefit from >1.5x, and it keeps fill cost low
    const DPR = Math.min(window.devicePixelRatio || 1, 1.5);

    let W = 0;
    let H = 0;
    let GRID = 0; // device px per grid cell
    let particles: Particle[] = [];
    let staticLayer: HTMLCanvasElement | null = null;
    let gridScroll = 0; // accumulated scroll offset (device px)
    let raf = 0;
    let last = 0;
    let running = true;

    // deterministic-ish rng so re-mounts look stable enough; not security-relevant
    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const pick = <T,>(arr: T[]): T => arr[(Math.random() * arr.length) | 0];

    // tint a hex color toward black by factor t (1 = unchanged)
    const tint = (hex: string, t: number): string => {
      if (t >= 1) return hex;
      const n = parseInt(hex.slice(1), 16);
      const r = Math.round(((n >> 16) & 255) * t);
      const g = Math.round(((n >> 8) & 255) * t);
      const b = Math.round((n & 255) * t);
      return `rgb(${r},${g},${b})`;
    };

    // pre-render the non-animated backdrop once per resize:
    // hard sky bands + pixel grid + scanlines. Grid is drawn one cell TALLER so we
    // can scroll it vertically by blitting at a negative offset without seams.
    const buildStaticLayer = () => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H + GRID; // extra cell for seamless vertical scroll
      const g = c.getContext("2d");
      if (!g) return;
      g.imageSmoothingEnabled = false;

      // 1) hard retro sky bands (top -> bottom), flat blocks not a soft gradient
      const bands = ["#1a1033", "#241447", "#2d1a55", "#371f63", "#3c2168"];
      const bandH = Math.ceil((H + GRID) / bands.length);
      for (let i = 0; i < bands.length; i++) {
        g.fillStyle = bands[i];
        g.fillRect(0, i * bandH, W, bandH);
      }

      // 2) pixel grid lines (thin, dim) — the arcade floor
      g.fillStyle = "rgba(124,249,255,0.06)";
      for (let x = 0; x <= W; x += GRID) g.fillRect(x, 0, 1, H + GRID);
      for (let y = 0; y <= H + GRID; y += GRID) g.fillRect(0, y, W, 1);
      // grid node dots at intersections for a denser "8-bit map" feel
      g.fillStyle = "rgba(255,79,154,0.10)";
      for (let x = 0; x <= W; x += GRID)
        for (let y = 0; y <= H + GRID; y += GRID) g.fillRect(x - 1, y - 1, 2, 2);

      // 3) CRT scanlines — darken every other PHYSICAL row, very subtle
      g.fillStyle = "rgba(0,0,0,0.10)";
      for (let y = 0; y < H + GRID; y += 2) g.fillRect(0, y, W, 1);

      staticLayer = c;
    };

    const spawn = (count: number) => {
      const list: Particle[] = [];
      const kinds: Kind[] = ["coin", "star", "cross", "coin", "star"];
      for (let i = 0; i < count; i++) {
        const layer = (Math.random() * 3) | 0;
        const base = 2 + layer; // back = small, front = big (parallax depth)
        const kind = pick(kinds);
        list.push({
          kind,
          x: rand(0, W),
          y: rand(0, H),
          vx: rand(-6, 6) * (layer + 1),
          vy: rand(8, 22) * (layer + 1), // gentle downward drift
          scale: Math.max(1, Math.round(base * (DPR / 1.5))),
          spin: Math.random(),
          spinSpeed: kind === "coin" ? rand(0.25, 0.7) : 0,
          layer,
        });
      }
      // draw back-to-front
      list.sort((a, b) => a.layer - b.layer);
      return list;
    };

    const resize = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      W = Math.max(1, Math.floor(w * DPR));
      H = Math.max(1, Math.floor(h * DPR));
      canvas.width = W;
      canvas.height = H;
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.imageSmoothingEnabled = false;
      // grid cell sized so it stays crisp across screens (~28 css px)
      GRID = Math.max(16, Math.round(28 * DPR));
      buildStaticLayer();
      // density scales with area but is capped for perf
      const target = Math.min(80, Math.round((w * h) / 22000));
      particles = spawn(target);
      // one immediate static paint so first frame is correct even before rAF
      drawStaticFrame();
    };

    // draw a single sprite snapped to the integer pixel grid (crisp, no blur)
    const drawSprite = (p: Particle) => {
      const s = SPRITES[p.kind];
      const t = LAYER_TINT[p.layer];
      const px = Math.round(p.x);
      const py = Math.round(p.y);
      const sc = p.scale;

      // coin "flip": squash horizontally via cosine of spin phase -> classic 8-bit spin
      let colW = sc;
      let xShift = 0;
      let edge = false;
      if (p.kind === "coin") {
        const f = Math.cos(p.spin * Math.PI * 2); // -1..1
        const aw = Math.max(0.12, Math.abs(f));
        colW = Math.max(1, Math.round(sc * aw));
        xShift = Math.round(((sc - colW) * s.w) / 2);
        edge = Math.abs(f) < 0.18; // show a thin edge bar at the flip extremes
      }

      if (edge) {
        // thin spinning edge: a vertical bar of coin-outline color
        ctx.fillStyle = tint(PAL.o, t);
        ctx.fillRect(px + Math.round((sc * s.w) / 2) - 1, py, 2, sc * s.h);
        return;
      }

      for (let row = 0; row < s.h; row++) {
        const line = s.rows[row];
        for (let col = 0; col < s.w; col++) {
          const ch = line[col];
          if (!ch || ch === ".") continue;
          const color = PAL[ch];
          if (!color) continue;
          ctx.fillStyle = tint(color, t);
          ctx.fillRect(px + xShift + col * colW, py + row * sc, colW, sc);
        }
      }
    };

    // blit static backdrop with the grid scrolled, then paint all sprites
    const paint = () => {
      ctx.clearRect(0, 0, W, H);
      if (staticLayer) {
        const off = gridScroll % GRID; // 0..GRID
        ctx.drawImage(staticLayer, 0, off - GRID); // scroll the floor downward
      }
      for (const p of particles) drawSprite(p);
    };

    // first/static frame (also the reduced-motion frame): one fixed snapshot
    const drawStaticFrame = () => {
      gridScroll = 0;
      // freeze coins at a pleasing 3/4 angle for the static look
      for (const p of particles) if (p.kind === "coin") p.spin = 0.12;
      paint();
    };

    const step = (now: number) => {
      if (!running) return;
      if (!last) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05; // clamp big gaps (tab refocus) so nothing teleports

      gridScroll += 10 * DPR * dt; // slow floor scroll

      const pad = 24 * DPR;
      for (const p of particles) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.spinSpeed) p.spin = (p.spin + p.spinSpeed * dt) % 1;
        // wrap around edges so the field is endless
        const spanW = SPRITES[p.kind].w * p.scale;
        const spanH = SPRITES[p.kind].h * p.scale;
        if (p.y - spanH > H) {
          p.y = -spanH - rand(0, pad);
          p.x = rand(0, W);
        }
        if (p.x + spanW < -pad) p.x = W + pad;
        else if (p.x - spanW > W + pad) p.x = -spanW;
      }

      paint();
      raf = requestAnimationFrame(step);
    };

    const startLoop = () => {
      cancelAnimationFrame(raf);
      last = 0;
      running = true;
      raf = requestAnimationFrame(step);
    };
    const stopLoop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };

    const applyMotionPref = () => {
      if (mqReduce.matches) {
        stopLoop();
        drawStaticFrame(); // single crisp static snapshot, no animation
      } else {
        startLoop();
      }
    };

    const onVisibility = () => {
      if (mqReduce.matches) return;
      if (document.hidden) stopLoop();
      else startLoop();
    };

    resize();
    applyMotionPref();

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    // Safari < 14 uses addListener; modern is addEventListener
    if (mqReduce.addEventListener) mqReduce.addEventListener("change", applyMotionPref);
    else mqReduce.addListener?.(applyMotionPref);

    return () => {
      stopLoop();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      if (mqReduce.removeEventListener) mqReduce.removeEventListener("change", applyMotionPref);
      else mqReduce.removeListener?.(applyMotionPref);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        zIndex: -1,
        pointerEvents: "none",
        display: "block",
        imageRendering: "pixelated",
      }}
    />
  );
}
