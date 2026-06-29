import { useEffect, useRef } from "react";

/**
 * OrderRainBackground — the app's always-on, CALM full-viewport pixel backdrop.
 *
 * This REPLACES the louder Pac-Man / CrossingBackground field with the restrained,
 * ambient option: a gentle "order rain" of 8-bit pixel sprites drifting slowly
 * downward behind all page content. There is NO loud "MATCHED" banner — instead an
 * OCCASIONAL, quiet "match" pop (two falling lock-chips drift together near
 * mid-screen and cross with a small, understated pixel-X flash).
 *
 * The rain is made of flat-pixel sprites, every visual a flat color block snapped to
 * an integer pixel grid with image smoothing disabled so it reads as CRISP pixel art:
 *   - coins (--coin gold) that do a classic 8-bit horizontal "flip" squash,
 *   - cyan stars (--bbb),
 *   - pink "cross / X" chips (--aaa),
 *   - small "sealed order" lock-chips (--card body, --border outline, --coin padlock,
 *     a --good green / --aaa pink side accent).
 * They fall over a slowly scrolling pixel grid floor with subtle CRT scanlines.
 *
 * Theme-aware: all colors are read at runtime from the "Warm Ink" CSS custom
 * properties on <html>. A MutationObserver on data-theme re-reads the palette and
 * rebuilds the cached static layers when the user flips dark <-> light. In light
 * mode the field is dimmed (via `dim`) so it reads as a subtle texture on cream,
 * mirroring how CrossingBackground drops to a quiet overlay.
 *
 * CALM + VISIBLE balance: slow downward drift, three parallax depth layers (back =
 * small + dim, front = bigger + brighter), modest sprite density, and a small, quiet,
 * infrequent match-pop. Opacity is applied CONSISTENTLY across all layers via a single
 * tunable master OPACITY plus per-layer relative weights, all multiplied by that same
 * master so the whole field scales together (no layer silently vanishing).
 *
 * Performance: scanlines are pre-rendered once per resize and re-blitted; the grid
 * scroll is cheap fillRects; sprite counts are capped. Delta-time integrated,
 * DPR-capped, pauses on tab hide, fully static under prefers-reduced-motion.
 */

// ---- master opacity: one tunable knob for the WHOLE field ----
// Aim, on dark theme, for sprites that read clearly but sit quietly behind text.
const OPACITY = 0.72;
// per-layer RELATIVE weights (all multiplied by the same OPACITY master so the field
// scales together — back is dimmer, front is brighter, but nothing ever vanishes).
const W_BACK = 0.7; // depth 0 — far, small, dim
const W_MID = 0.9; // depth 1 — middle
const W_FRONT = 1.1; // depth 2 — near, big, bright

type Depth = 0 | 1 | 2;

// every falling sprite shares this base; `type` picks which drawer runs
type Drop = {
  type: "coin" | "star" | "cross" | "lock";
  x: number; // device px
  y: number;
  v: number; // device px / sec (downward)
  d: Depth;
  scale: number; // device px per art-pixel
  phase: number; // generic animation phase (flip / twinkle / wobble)
  spin: number; // coin flip speed
  side: "buy" | "sell"; // lock accent side
  // lock pairing state for the quiet match-pop:
  paired: boolean;
  partner: Drop | null;
  crossedDone: boolean;
};

type Pop = { x: number; y: number; t: number; life: number; block: number };

export default function OrderRainBackground() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // opaque context: we always fill the full viewport with --bg, so no alpha needed
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    const mqReduce = window.matchMedia("(prefers-reduced-motion: reduce)");

    // cap DPR: pixel art doesn't benefit from >1.5x, and it keeps fill cost low
    const DPR = Math.min(window.devicePixelRatio || 1, 1.5);

    let W = 0; // device px
    let H = 0;
    let CELL = 0; // device px per grid cell
    let light = false; // current theme is the cream/light scheme
    let dim = 1; // global texture multiplier (lower in light mode)

    let drops: Drop[] = [];
    let pops: Pop[] = []; // quiet cross flashes

    let scanLayer: HTMLCanvasElement | null = null;
    let gridScroll = 0; // accumulated floor scroll (device px)
    let pairCheck = 0; // accumulator for the gentle pairing attempt
    let nowSec = 0; // running clock (sec) for flip / twinkle phases

    let raf = 0;
    let last = 0;
    let running = true;

    const rand = (a: number, b: number) => a + Math.random() * (b - a);
    const rint = (a: number, b: number) => Math.floor(a + Math.random() * (b - a + 1));

    // ---- live theme palette (read from CSS custom properties on <html>) ----
    const css = (name: string, fallback: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

    // turn a #rrggbb / rgb() color into an rgba() string at the given alpha
    const rgba = (color: string, a: number): string => {
      if (color.startsWith("#")) {
        const n = parseInt(color.slice(1), 16);
        return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
      }
      if (color.startsWith("rgb")) {
        const nums = color.replace(/rgba?\(|\)/g, "").split(",").slice(0, 3).join(",");
        return `rgba(${nums},${a})`;
      }
      return color;
    };

    // the whole "coin family" + surfaces, re-read on every theme change
    let PAL = {
      bg: "#15110C",
      grid: "#211A10",
      fg: "#FBF3E0",
      coin: "#FFD23F",
      pink: "#FF2E88",
      cyan: "#2CE8F5",
      green: "#2BFF88",
      card: "#1E180F",
      surface: "#2A2114",
      border: "#3A2E1A",
      ink: "#070502",
    };

    const readPalette = () => {
      light = document.documentElement.getAttribute("data-theme") === "light";
      // in light mode dim the overlay so it sits as a subtle texture on cream
      dim = light ? 0.45 : 1;
      PAL = {
        bg: css("--bg", "#15110C"),
        grid: css("--bg-2", "#211A10"),
        fg: css("--fg", "#FBF3E0"),
        coin: css("--coin", "#FFD23F"),
        pink: css("--aaa", "#FF2E88"),
        cyan: css("--bbb", "#2CE8F5"),
        green: css("--good", "#2BFF88"),
        card: css("--card", "#1E180F"),
        surface: css("--surface-2", "#2A2114"),
        border: css("--border", "#3A2E1A"),
        ink: css("--ink", "#070502"),
      };
    };

    // ---- pre-render CRT scanlines once per resize (cheap re-blit each frame) ----
    const buildScanLayer = () => {
      const c = document.createElement("canvas");
      c.width = W;
      c.height = H;
      const g = c.getContext("2d");
      if (!g) return;
      g.imageSmoothingEnabled = false;
      // darken every other PHYSICAL row, very subtle (lighter still on cream)
      g.fillStyle = `rgba(0,0,0,${light ? 0.05 : 0.1})`;
      for (let y = 0; y < H; y += 2) g.fillRect(0, y, W, 1);
      scanLayer = c;
    };

    // ---- drawing helper: a flat block snapped to the integer pixel grid ----
    const px = (x: number, y: number, w: number, h: number, color: string) => {
      ctx.fillStyle = color;
      ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    };

    // ---- depth helpers: 0=back(small/dim/slow) 1=mid 2=front(big/bright/fast) ----
    // per-layer weight, then multiplied by the OPACITY master + theme dim everywhere
    const depthWeight = (d: Depth) => (d === 0 ? W_BACK : d === 1 ? W_MID : W_FRONT);
    const depthAlpha = (d: Depth) => OPACITY * depthWeight(d) * dim;
    const depthScale = (d: Depth) =>
      Math.max(1, Math.round((d === 0 ? 1.5 : d === 1 ? 2.2 : 3) * (DPR / 1.5)));
    const depthSpeed = (d: Depth) => (d === 0 ? 14 : d === 1 ? 22 : 32) * DPR;

    // ---- factory: a single falling sprite (spread = scatter across the screen) ----
    const makeDrop = (type: Drop["type"], spread: boolean): Drop => {
      // locks live mid/front so they read as "sealed orders"; rest use all depths
      const d: Depth = type === "lock" ? (rint(1, 2) as Depth) : (rint(0, 2) as Depth);
      const scale = depthScale(d) * (type === "lock" ? 0.9 : 1);
      return {
        type,
        x: rand(0, W),
        y: spread ? rand(-H, H) : -rand(20 * DPR, 80 * DPR),
        v: depthSpeed(d) * rand(0.8, 1.15) * (type === "lock" ? 0.85 : 1),
        d,
        scale: Math.max(1, Math.round(scale)),
        phase: rand(0, Math.PI * 2),
        spin: rand(1.6, 2.8),
        side: Math.random() < 0.5 ? "buy" : "sell",
        paired: false,
        partner: null,
        crossedDone: false,
      };
    };

    const initEntities = () => {
      drops = [];
      pops = [];
      const area = W * H;
      // modest, capped densities so the field stays calm but never empty
      const nCoins = Math.min(20, Math.max(8, Math.round(area / (130000 * DPR))));
      const nStars = Math.min(28, Math.max(12, Math.round(area / (95000 * DPR))));
      const nCross = Math.min(15, Math.max(6, Math.round(area / (200000 * DPR))));
      const nLocks = Math.min(12, Math.max(5, Math.round(area / (260000 * DPR))));
      for (let i = 0; i < nCoins; i++) drops.push(makeDrop("coin", true));
      for (let i = 0; i < nStars; i++) drops.push(makeDrop("star", true));
      for (let i = 0; i < nCross; i++) drops.push(makeDrop("cross", true));
      for (let i = 0; i < nLocks; i++) drops.push(makeDrop("lock", true));
      pairCheck = 0;
    };

    // ---- pixel sprite drawing (flat fillRect, integer snapped) ----

    // classic spinning coin: face width squashes via cos for the 8-bit "flip"
    const drawCoin = (o: Drop) => {
      const s = o.scale;
      const cx = Math.round(o.x);
      const cy = Math.round(o.y);
      const squash = Math.cos(nowSec * o.spin + o.phase); // -1..1
      const fw = Math.max(s, Math.round(Math.abs(squash) * s * 4)); // half face width-ish
      const edge = squash < 0; // back side -> dimmer gold
      const hgt = s * 8;
      ctx.save();
      ctx.globalAlpha = depthAlpha(o.d);
      // outline column
      px(cx - fw - s, cy - hgt / 2 - s, (fw + s) * 2, hgt + s * 2, PAL.border);
      // gold face (dimmer on the back side of the flip)
      px(cx - fw, cy - hgt / 2, fw * 2, hgt, edge ? rgba(PAL.coin, 0.7) : PAL.coin);
      // highlight notch + little cross emboss when fairly face-on
      if (Math.abs(squash) > 0.45 && !edge) {
        px(
          cx - Math.round(fw * 0.4),
          cy - Math.round(hgt * 0.32),
          Math.max(s, Math.round(fw * 0.35)),
          Math.round(hgt * 0.5),
          PAL.fg,
        );
        px(cx - s, cy - s * 2, s * 2, s * 4, rgba(PAL.coin, 0.85));
        px(cx - s * 2, cy - s, s * 4, s * 2, rgba(PAL.coin, 0.85));
      }
      ctx.restore();
    };

    // cyan plus-shaped 8-bit twinkle star
    const drawStar = (o: Drop) => {
      const s = Math.max(1, Math.round(o.scale * 0.8));
      const cx = Math.round(o.x);
      const cy = Math.round(o.y);
      const tw = 0.55 + 0.45 * Math.abs(Math.sin(o.phase + nowSec * 3));
      ctx.save();
      ctx.globalAlpha = depthAlpha(o.d) * tw;
      px(cx - s, cy - s, s * 2, s * 2, PAL.cyan); // core
      px(cx - s, cy - s * 3, s * 2, s * 2, PAL.cyan); // up
      px(cx - s, cy + s, s * 2, s * 2, PAL.cyan); // down
      px(cx - s * 3, cy - s, s * 2, s * 2, PAL.cyan); // left
      px(cx + s, cy - s, s * 2, s * 2, PAL.cyan); // right
      px(cx - Math.floor(s / 2), cy - Math.floor(s / 2), Math.max(1, s), Math.max(1, s), PAL.fg);
      ctx.restore();
    };

    // pink "cross / X" chip on a dark backplate
    const drawCross = (o: Drop) => {
      const s = o.scale;
      const cx = Math.round(o.x);
      const cy = Math.round(o.y + Math.sin(o.phase + nowSec * 1.5) * 1.5);
      ctx.save();
      ctx.globalAlpha = depthAlpha(o.d);
      // chip backplate (dark surface)
      px(cx - s * 3, cy - s * 3, s * 6, s * 6, rgba(PAL.surface, 0.9));
      // pink X arms
      ctx.fillStyle = PAL.pink;
      for (let k = -2; k <= 2; k++) {
        ctx.fillRect(Math.round(cx + k * s), Math.round(cy + k * s), Math.round(s), Math.round(s));
        ctx.fillRect(Math.round(cx + k * s), Math.round(cy - k * s), Math.round(s), Math.round(s));
      }
      px(cx - Math.floor(s / 2), cy - Math.floor(s / 2), Math.max(1, s), Math.max(1, s), PAL.fg);
      ctx.restore();
    };

    // small "sealed order" lock-chip: --card body, --border outline, --coin padlock,
    // --good / --aaa side accent
    const drawLock = (o: Drop) => {
      const s = o.scale;
      const cx = Math.round(o.x + Math.sin(o.phase + nowSec * 0.9) * 1.0);
      const cy = Math.round(o.y);
      const bw = s * 6;
      const bh = s * 5;
      const accent = o.side === "buy" ? PAL.green : PAL.pink;
      ctx.save();
      ctx.globalAlpha = depthAlpha(o.d);
      // shackle
      px(cx - s * 2, cy - s * 5, s, s * 3, PAL.coin);
      px(cx + s, cy - s * 5, s, s * 3, PAL.coin);
      px(cx - s * 2, cy - s * 5, s * 3, s, PAL.coin);
      // body: outline (--border) then fill (--card)
      px(cx - bw / 2 - 1, cy - bh / 2 - 1, bw + 2, bh + 2, PAL.border);
      px(cx - bw / 2, cy - bh / 2, bw, bh, PAL.card);
      // top highlight strip
      px(cx - bw / 2, cy - bh / 2, bw, s, PAL.surface);
      // keyhole tinted by side (BUY green / SELL pink)
      px(cx - s, cy - s, s * 2, s * 2, accent);
      px(cx - Math.floor(s / 2), cy, Math.max(1, s), s * 2, accent);
      ctx.restore();
    };

    // ---- quiet cross pop: a small, understated cyan/pink/white pixel-X flash ----
    const spawnPop = (x: number, y: number) => {
      pops.push({ x, y, t: 0, life: 0.85, block: rint(3, 4) * DPR });
    };
    const drawPop = (p: Pop) => {
      const prog = p.t / p.life; // 0..1
      const a = 1 - prog; // fade out
      if (a <= 0) return;
      const grow = 1 + prog * 1.6;
      const s = Math.max(1, Math.round(p.block * grow));
      const cx = Math.round(p.x);
      const cy = Math.round(p.y);
      ctx.save();
      // understated: pop also rides the master OPACITY so it never shouts
      ctx.globalAlpha = a * 0.9 * OPACITY * (dim < 1 ? dim : 1);
      // alternating cyan / pink arms
      for (let k = -3; k <= 3; k++) {
        ctx.fillStyle = k % 2 === 0 ? PAL.cyan : PAL.pink;
        ctx.fillRect(Math.round(cx + k * s), Math.round(cy + k * s), Math.round(s), Math.round(s));
        ctx.fillRect(Math.round(cx + k * s), Math.round(cy - k * s), Math.round(s), Math.round(s));
      }
      // soft center spark in --fg
      px(cx - s, cy - s, s * 2, s * 2, PAL.fg);
      ctx.restore();
    };

    // ---- gentle pairing: occasionally two falling locks (opposite sides, near
    // mid-screen, roughly aligned) drift together and cross with a quiet pop ----
    const tryPairLocks = () => {
      const midTop = H * 0.4;
      const midBot = H * 0.62;
      const locks = drops.filter((o) => o.type === "lock");
      for (let i = 0; i < locks.length; i++) {
        const a = locks[i];
        if (a.paired || a.crossedDone) continue;
        if (a.y < midTop || a.y > midBot) continue;
        for (let j = i + 1; j < locks.length; j++) {
          const b = locks[j];
          if (b.paired || b.crossedDone) continue;
          if (b.y < midTop || b.y > midBot) continue;
          if (a.side === b.side) continue; // need opposite BUY/SELL
          if (Math.abs(a.y - b.y) > H * 0.1) continue;
          const dx = Math.abs(a.x - b.x);
          if (dx > W * 0.22 || dx < 8 * DPR) continue;
          // pair them: they'll ease toward a shared midpoint x
          a.paired = b.paired = true;
          a.partner = b;
          b.partner = a;
          return; // at most one new pair per check — keep it calm
        }
      }
    };

    // ---- update ----
    const update = (dt: number) => {
      nowSec += dt;
      gridScroll += dt * 10 * DPR; // slow floor scroll

      for (let i = 0; i < drops.length; i++) {
        const o = drops[i];

        if (o.type === "lock" && o.paired && o.partner && !o.crossedDone) {
          // converge horizontally toward the pair midpoint, fall slowly meanwhile
          const mid = (o.x + o.partner.x) / 2;
          o.x += (mid - o.x) * Math.min(1, dt * 3.0);
          o.y += o.v * 0.6 * dt;
          if (
            Math.abs(o.x - o.partner.x) < 6 * DPR &&
            !o.crossedDone &&
            !o.partner.crossedDone
          ) {
            spawnPop((o.x + o.partner.x) / 2, (o.y + o.partner.y) / 2);
            o.crossedDone = o.partner.crossedDone = true;
          }
        } else {
          o.y += o.v * dt;
        }

        // recycle when it falls off the bottom (or after a completed cross)
        if (o.y > H + 50 * DPR || o.crossedDone) {
          drops[i] = makeDrop(o.type, false);
        }
      }

      // periodic gentle pairing attempt -> infrequent, quiet match-pop (~3-6s)
      pairCheck += dt;
      if (pairCheck > 1.4) {
        pairCheck = 0;
        if (Math.random() < 0.6) tryPairLocks();
      }

      // pops fade and expire
      for (let i = pops.length - 1; i >= 0; i--) {
        pops[i].t += dt;
        if (pops[i].t >= pops[i].life) pops.splice(i, 1);
      }
    };

    // ---- scrolling pixel grid floor (drawn live; cheap fillRects) ----
    const drawGrid = () => {
      const off = gridScroll % CELL;
      // grid lines: warm brown border tone (or --bg-2 on cream), kept soft
      const lineCol = rgba(light ? PAL.grid : PAL.border, 0.45);
      for (let x = -off; x <= W; x += CELL) px(x, 0, 1, H, lineCol);
      for (let y = -off; y <= H; y += CELL) px(0, y, W, 1, lineCol);
      // node dots at intersections (pink, very low alpha, rides dim)
      ctx.fillStyle = rgba(PAL.pink, 0.09 * dim);
      for (let gx = -off; gx <= W; gx += CELL)
        for (let gy = -off; gy <= H; gy += CELL)
          ctx.fillRect(Math.round(gx) - 1, Math.round(gy) - 1, 2, 2);
    };

    // dispatch one sprite to its drawer
    const drawDrop = (o: Drop) => {
      if (o.type === "coin") drawCoin(o);
      else if (o.type === "star") drawStar(o);
      else if (o.type === "cross") drawCross(o);
      else drawLock(o);
    };

    // ---- render ----
    const render = () => {
      // base fill = --bg so there is NO seam with the page
      ctx.fillStyle = PAL.bg;
      ctx.fillRect(0, 0, W, H);

      drawGrid();

      // draw back -> front by depth so the parallax reads correctly
      for (const o of drops) if (o.d === 0) drawDrop(o);
      for (const o of drops) if (o.d === 1) drawDrop(o);
      for (const o of drops) if (o.d === 2) drawDrop(o);

      // quiet match-pops on top (still understated)
      for (const p of pops) drawPop(p);

      // scanlines on top
      if (scanLayer) ctx.drawImage(scanLayer, 0, 0);
    };

    // ---- loop ----
    const step = (now: number) => {
      if (!running) return;
      if (!last) last = now;
      let dt = (now - last) / 1000;
      last = now;
      if (dt > 0.05) dt = 0.05; // clamp big gaps (tab refocus) so nothing teleports
      update(dt);
      render();
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

    // single crisp static snapshot (first frame + reduced-motion frame): a calm
    // composition of scattered drops with one frozen mid-screen cross pop.
    const drawStaticFrame = () => {
      gridScroll = 0;
      nowSec = 0;
      initEntities();
      pops = [];
      // freeze a single quiet pop near mid-screen for the "match" hint
      pops.push({ x: W * 0.5, y: H * 0.5, t: 0.3, life: 0.85, block: 4 * DPR });
      render();
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
      // grid cell sized so it stays crisp across screens (~40 css px)
      CELL = Math.max(24, Math.round(40 * DPR));
      buildScanLayer();
      initEntities();
      // one immediate paint so the first frame is correct even before rAF
      if (mqReduce.matches) drawStaticFrame();
      else render();
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

    // on theme flip: re-read the palette, rebuild cached layers, repaint
    const themeObserver = new MutationObserver(() => {
      readPalette();
      buildScanLayer();
      if (mqReduce.matches || document.hidden) drawStaticFrame();
    });

    readPalette();
    resize();
    applyMotionPref();

    window.addEventListener("resize", resize);
    document.addEventListener("visibilitychange", onVisibility);
    themeObserver.observe(document.documentElement, { attributeFilter: ["data-theme"] });
    // Safari < 14 uses addListener; modern is addEventListener
    if (mqReduce.addEventListener) mqReduce.addEventListener("change", applyMotionPref);
    else mqReduce.addListener?.(applyMotionPref);

    return () => {
      stopLoop();
      themeObserver.disconnect();
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
