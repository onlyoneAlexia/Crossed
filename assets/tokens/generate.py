#!/usr/bin/env python3
"""
Arcade-coin pixel-art token logos as PURE SVG.

Style: chunky retro coin — dark pixel OUTLINE, spherical SHADING (light top-left,
dark bottom-right), white SPECULAR highlight, and the real brand SYMBOL (extracted
from the official icon) debossed into the face. Output is pure SVG (<rect> pixels,
run-length encoded). 32px grid = sweet spot; 24 = chunkier.

Deps: Pillow + `rsvg-convert` (for .svg sources). Network to fetch source icons.
Add a token: drop a URL in TOKENS. Re-run:  python3 generate.py
"""
import colorsys, os, subprocess, tempfile, urllib.request
from collections import Counter
from PIL import Image

OUT = os.path.dirname(os.path.abspath(__file__))
GRIDS = (32, 24)
CCI = "https://raw.githubusercontent.com/spothq/cryptocurrency-icons/master/svg/color"
TW = ("https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/"
      "ethereum/assets/0x1aBaEA1f7C830bD89Acc67eC4af516284b1bC33c/logo.png")  # EURC
TOKENS = {"usdc": f"{CCI}/usdc.svg", "usdt": f"{CCI}/usdt.svg",
          "xlm": f"{CCI}/xlm.svg", "dai": f"{CCI}/dai.svg", "eurc": TW}


def _adj(rgb, dl, ds=0.0):
    h, l, s = colorsys.rgb_to_hls(*[v / 255 for v in rgb])
    r, g, b = colorsys.hls_to_rgb(h, max(0, min(1, l + dl)), max(0, min(1, s + ds)))
    return (round(r * 255), round(g * 255), round(b * 255))


def _lum(c):
    return colorsys.rgb_to_hls(*[v / 255 for v in c])[1]


def _white(c, thr=198):
    return c is not None and min(c) >= thr


def _fetch(url):
    raw = os.path.join(tempfile.gettempdir(), "tok_" + os.path.basename(url))
    urllib.request.urlretrieve(url, raw)
    if url.endswith(".svg"):
        png = raw[:-4] + ".png"
        subprocess.run(["rsvg-convert", "-w", "128", "-h", "128", raw, "-o", png], check=True)
        return png
    return raw


def _real(png, n):
    im = Image.open(png).convert("RGBA").resize((n, n), Image.LANCZOS)
    a = im.split()[3]; rgb = im.convert("RGB")
    return [[rgb.getpixel((x, y)) if a.getpixel((x, y)) >= 110 else None
             for x in range(n)] for y in range(n)]


def coin(png, n):
    rg = _real(png, n)
    cnt = Counter(c for row in rg for c in row if c and not _white(c, 205))
    base = cnt.most_common(1)[0][0] if cnt else (0xF7, 0xB7, 0x2A)
    dark_body = _lum(base) < 0.22
    light, dark = _adj(base, +0.13, +0.02), _adj(base, -0.15)
    spec = _adj(base, +0.27, -0.05)
    outline = _adj(base, +0.26) if dark_body else _adj(base, -0.36)
    c = (n - 1) / 2.0; R = n / 2.0; lx, ly = -0.55, -0.78
    inside = lambda x, y: (x - c) ** 2 + (y - c) ** 2 <= R * R
    symR = R * 0.80
    sym = [[_white(rg[y][x]) and (x - c) ** 2 + (y - c) ** 2 <= symR * symR
            for x in range(n)] for y in range(n)]
    g = [[None] * n for _ in range(n)]
    for y in range(n):
        for x in range(n):
            if not inside(x, y):
                continue
            if not (inside(x - 1, y) and inside(x + 1, y) and inside(x, y - 1) and inside(x, y + 1)):
                g[y][x] = outline; continue
            if sym[y][x]:
                g[y][x] = (255, 255, 255); continue
            dx, dy = x - c, y - c; nl = (dx * lx + dy * ly) / R
            g[y][x] = spec if nl > 0.80 else light if nl > 0.28 else dark if nl < -0.34 else base
    for y in range(n - 1):           # debossed 1px shadow under symbol
        for x in range(n - 1):
            if sym[y][x] and g[y + 1][x + 1] not in (None, outline) and not sym[y + 1][x + 1]:
                g[y + 1][x + 1] = dark
    return g


def to_svg(g, n, label):
    by = {}
    for y in range(n):
        x = 0
        while x < n:
            col = g[y][x]
            if col is None:
                x += 1; continue
            x2 = x
            while x2 < n and g[y][x2] == col:
                x2 += 1
            by.setdefault(col, []).append((x, y, x2 - x)); x = x2
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {n} {n}" width="{n}" '
           f'height="{n}" shape-rendering="crispEdges" role="img" aria-label="{label}">']
    for col, rs in sorted(by.items()):
        out.append(f'<g fill="#{col[0]:02X}{col[1]:02X}{col[2]:02X}">')
        out += [f'<rect x="{x}" y="{y}" width="{w}" height="1"/>' for x, y, w in rs]
        out.append("</g>")
    out.append("</svg>")
    return "\n".join(out)


def main():
    for sym, url in TOKENS.items():
        try:
            png = _fetch(url)
        except Exception as e:  # noqa
            print("SKIP", sym, e); continue
        for n in GRIDS:
            open(os.path.join(OUT, f"{sym}-coin{n}.svg"), "w").write(to_svg(coin(png, n), n, sym.upper()))
        print("coin", sym)


if __name__ == "__main__":
    main()
