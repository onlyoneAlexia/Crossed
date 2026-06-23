import os
DOUT="/home/mimi/Stellar hack/design/logos"; os.makedirs(DOUT,exist_ok=True)
N=24
GOLD=(255,210,63); CYAN=(44,232,245); PINK=(255,46,136); GREEN=(43,255,136)
VIOLET=(122,92,255); CREAM=(253,246,227); INK=(5,6,15); DGOLD=(190,150,20); DCYAN=(20,150,165)

def newg(): return [[None]*N for _ in range(N)]
def st(g,x,y,c):
    if 0<=x<N and 0<=y<N: g[y][x]=c
def stamp(g,x,y,c,t=1):
    for dy in range(t):
        for dx in range(t): st(g,x+dx,y+dy,c)
def line(g,x0,y0,x1,y1,c,t=1):
    dx=abs(x1-x0); dy=abs(y1-y0); sx=1 if x0<x1 else -1; sy=1 if y0<y1 else -1
    err=dx-dy; x,y=x0,y0; off=-(t//2)
    while True:
        stamp(g,x+off,y+off,c,t)
        if x==x1 and y==y1: break
        e2=2*err
        if e2>-dy: err-=dy; x+=sx
        if e2<dx: err+=dx; y+=sy
def box(g,x0,y0,x1,y1,c):
    for y in range(y0,y1+1):
        for x in range(x0,x1+1): st(g,x,y,c)
def disc(g,cx,cy,r,c):
    for y in range(N):
        for x in range(N):
            if (x-cx)**2+(y-cy)**2<=r*r: st(g,x,y,c)
def ring(g,cx,cy,r,c,t=2):
    for y in range(N):
        for x in range(N):
            d=((x-cx)**2+(y-cy)**2)**.5
            if r-t<d<=r: st(g,x,y,c)
def outline(g,c=INK):
    g2=[row[:] for row in g]
    for y in range(N):
        for x in range(N):
            if g[y][x] is None and any(0<=x+dx<N and 0<=y+dy<N and g[y+dy][x+dx] is not None
                                       for dx,dy in((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1))):
                g2[y][x]=c
    return g2

def svg(g,label):
    by={}
    for y in range(N):
        x=0
        while x<N:
            c=g[y][x]
            if c is None: x+=1; continue
            x2=x
            while x2<N and g[y][x2]==c: x2+=1
            by.setdefault(c,[]).append((x,y,x2-x)); x=x2
    p=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {N} {N}" width="{N}" height="{N}" shape-rendering="crispEdges" role="img" aria-label="{label}">']
    for c,rs in by.items():
        p.append(f'<g fill="#{c[0]:02X}{c[1]:02X}{c[2]:02X}">'); p+=[f'<rect x="{x}" y="{y}" width="{w}" height="1"/>' for x,y,w in rs]; p.append('</g>')
    p.append('</svg>'); return "\n".join(p)

icons=[]
def add(idn,name,g,ol=True):
    if ol: g=outline(g)
    icons.append((idn,name,g))

# 1 — BOLD X (two crossing bars + bright cross)
g=newg(); line(g,4,4,19,19,GOLD,3); line(g,19,4,4,19,CYAN,3); box(g,10,10,13,13,CREAM); add("01","Bold X",g)

# 2 — CROSSED ARROWS (swap)
g=newg()
line(g,5,18,18,5,GOLD,2)                       # up-right shaft
for d in range(4): st(g,18-d,5,GOLD); st(g,18,5+d,GOLD)   # head TR
line(g,5,6,18,19,CYAN,2)                        # down-right shaft
for d in range(4): st(g,18-d,19,CYAN); st(g,18,19-d,CYAN) # head BR
add("02","Crossed Arrows",g)

# 3 — X-COIN (coin face with X) — matches token coins
g=newg(); disc(g,11.5,11.5,10.5,GOLD)
for y in range(N):
    for x in range(N):
        if g[y][x]==GOLD and (x-11.5)*0.6+(y-11.5)*0.8< -5: g[y][x]=(255,228,138)  # hi rim
line(g,6,6,17,17,CYAN,2); line(g,17,6,6,17,CYAN,2)
add("03","X-Coin",g)

# 4 — CROSSHAIR (precise private match)
g=newg(); ring(g,11.5,11.5,10.5,GOLD,2)
box(g,11,2,12,8,CYAN); box(g,11,15,12,21,CYAN); box(g,2,11,8,12,CYAN); box(g,15,11,21,12,CYAN)
box(g,10,10,13,13,CREAM); add("04","Crosshair",g)

# 5 — SHIELD-X (privacy / ZK)
g=newg()
rows={3:(5,18),4:(5,18),5:(5,18),6:(5,18),7:(5,18),8:(5,18),9:(6,17),10:(6,17),11:(6,17),12:(7,16),
      13:(7,16),14:(8,15),15:(8,15),16:(9,14),17:(10,13),18:(10,13),19:(11,12)}
for y,(a,b) in rows.items(): box(g,a,y,b,y,VIOLET)
line(g,8,7,15,14,CYAN,2); line(g,15,7,8,14,CYAN,2)
add("05","Shield-X",g)

# 6 — INTERLOCKED RINGS (mutual bind / match)
g=newg(); ring(g,8,12,5,GOLD,2); ring(g,15,12,5,CYAN,2)
# interlink illusion: redraw gold arc over cyan at left crossing
for y in range(N):
    for x in range(N):
        d=((x-8)**2+(y-12)**2)**.5
        if 3<d<=5 and x<11 and 8<y<16: g[y][x]=GOLD
add("06","Linked Rings",g)

# 7 — HOURGLASS (sealed batch)
g=newg(); box(g,5,3,18,4,CREAM); box(g,5,19,18,20,CREAM)
for i,y in enumerate(range(5,12)): box(g,6+i,y,17-i,y,CYAN)
for i,y in enumerate(range(12,19)): box(g,12-i,y,11+i,y,GOLD)
box(g,11,11,12,12,PINK)  # grain at neck
add("07","Hourglass",g)

# 8 — TWO PEOPLE CROSSING (mascot)
g=newg()
box(g,5,4,8,7,CYAN); line(g,7,8,15,17,CYAN,2)        # left head + body to BR
box(g,15,4,18,7,GOLD); line(g,16,8,8,17,GOLD,2)      # right head + body to BL
box(g,18,16,20,18,GOLD); box(g,3,16,5,18,CYAN)       # feet
box(g,10,10,13,13,GREEN)                              # clasp center
add("08","Two Cross",g)

# 9 — DIAMOND-X (sealed gem of value)
g=newg()
for i in range(0,11): box(g,11-i,11-i if False else 11-i,12+i,12+i,None)  # noop placeholder
# draw diamond outline
pts=[]
for i in range(11):
    st(g,11-i,11-(10-i),VIOLET); st(g,12+i,11-(10-i),VIOLET)
    st(g,11-i,12+(10-i),VIOLET); st(g,12+i,12+(10-i),VIOLET)
line(g,7,7,16,16,GOLD,2); line(g,16,7,7,16,CYAN,2)
add("09","Diamond-X",g)

# 10 — CROSSING COINS + SPARK (the swap moment)
g=newg(); disc(g,6.5,6.5,4.5,GOLD); disc(g,17.5,17.5,4.5,CYAN)
for t in range(3): st(g,10+t*2,10+t*2,CREAM)  # trail
for t in range(3): st(g,13-t*2,13-t*2,CREAM)
box(g,11,8,12,15,CREAM); box(g,8,11,15,12,CREAM)  # center spark +
add("10","Crossing Coins",g)

for idn,name,g in icons:
    open(f"{DOUT}/crossed-{idn}.svg","w").write(svg(g,name))
print("wrote",len(icons),"logos")

# contact sheet
def inl(g,name): return svg(g,name)
tiles="".join(
 f'<figure><div class="t big">{inl(g,n)}</div><div class="t sm">{inl(g,n)}</div>'
 f'<figcaption>{idn} · {n}</figcaption></figure>'
 for idn,n,g in icons)
arc="".join(f'<span class="ac">{inl(g,n)}</span>' for idn,n,g in icons)
html=('<!doctype html><meta charset=utf8><title>Crossed logo concepts</title><style>'
 'body{margin:0;background:#0B0E2A;font-family:ui-monospace,monospace;color:#9D9BE0;padding:20px}'
 'h1{color:#FDF6E3;font-size:16px}h2{color:#FFD23F;font-size:12px;letter-spacing:.08em;margin:22px 0 8px}'
 '.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:16px}'
 'figure{margin:0;text-align:center}figcaption{color:#cfd2dc;font-size:11px;margin-top:8px}'
 '.t{display:inline-flex;align-items:center;justify-content:center;background:#141A47;border:2px solid #3A2E7A;box-shadow:4px 4px 0 #05060F;image-rendering:pixelated}'
 '.big{width:96px;height:96px}.sm{width:40px;height:40px;margin-left:8px}'
 '.t svg{width:100%;height:100%;image-rendering:pixelated}'
 '.arc{background:#0B0E2A;background-image:linear-gradient(#141A47 2px,transparent 2px),linear-gradient(90deg,#141A47 2px,transparent 2px);background-size:40px 40px,40px 40px;padding:18px;border:2px solid #3A2E7A;display:flex;gap:22px;flex-wrap:wrap}'
 '.ac{width:64px;height:64px;display:inline-flex}.ac svg{width:100%;height:100%;image-rendering:pixelated}</style>'
 '<h1>CROSSED — 10 logo concepts (pixel/arcade theme). Big @96px + small @40px each.</h1>'
 f'<div class=grid>{tiles}</div>'
 '<h2>AS THEY\'D SIT IN THE STORY CENTER (on the arcade grid, ~64px)</h2>'
 f'<div class=arc>{arc}</div>')
open("/home/mimi/Stellar hack/design/logo-concepts.html","w").write(html)
print("wrote design/logo-concepts.html")
