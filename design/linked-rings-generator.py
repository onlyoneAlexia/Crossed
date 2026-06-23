import os, colorsys
DOUT="/home/mimi/Stellar hack/design/logos"; os.makedirs(DOUT,exist_ok=True)
N=24
GOLD=(255,210,63); CYAN=(44,232,245); CREAM=(253,246,227); INK=(5,6,15); PINK=(255,46,136)
def lt(c,d=0.12,s=0.0):
    h,l,sa=colorsys.rgb_to_hls(*[v/255 for v in c]); r,g,b=colorsys.hls_to_rgb(h,max(0,min(1,l+d)),max(0,min(1,sa+s)))
    return (round(r*255),round(g*255),round(b*255))
GOLD_L=lt(GOLD,.13); GOLD_D=lt(GOLD,-.16); CYAN_L=lt(CYAN,.13); CYAN_D=lt(CYAN,-.18)

def newg(): return [[None]*N for _ in range(N)]
def st(g,x,y,c):
    if 0<=x<N and 0<=y<N: g[y][x]=c
def ring(cx,cy,r,t,c):
    g=newg()
    for y in range(N):
        for x in range(N):
            d=((x-cx)**2+(y-cy)**2)**.5
            if r-t<d<=r: g[y][x]=c
    return g
def ring_shaded(cx,cy,r,t,base,light,dark):
    g=newg()
    for y in range(N):
        for x in range(N):
            dx,dy=x-cx,y-cy; d=(dx*dx+dy*dy)**.5
            if r-t<d<=r:
                n=(-dx*0.6-dy*0.8)/r
                g[y][x]= light if n>0.30 else dark if n<-0.34 else base
    return g
def outline(g,c=INK):
    g2=[row[:] for row in g]
    for y in range(N):
        for x in range(N):
            if g[y][x] is None and any(0<=x+dx<N and 0<=y+dy<N and g[y+dy][x+dx] is not None
                                       for dx,dy in((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1))):
                g2[y][x]=c
    return g2
def weave(L,R, lo_x, lo_y, lo_w=99):
    """left ring over right everywhere, then right re-asserted in the 'lower/second' crossing zone."""
    Lk=outline(L); Rk=outline(R)
    g=newg()
    for y in range(N):
        for x in range(N):
            if Rk[y][x] is not None: g[y][x]=Rk[y][x]
            if Lk[y][x] is not None: g[y][x]=Lk[y][x]
    for y in range(N):
        for x in range(N):
            if Rk[y][x] is not None and y>=lo_y and abs(x-lo_x)<=lo_w: g[y][x]=Rk[y][x]
    return g
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

out=[]
# A — Clean horizontal link (flat, ink weave)
A=weave(ring(9,12,6,2,GOLD), ring(15,12,6,2,CYAN), 12, 13)
out.append(("06A","Clean Link",A))
# B — Bold link (thicker + bigger, best at small sizes)
B=weave(ring(8,12,7,3,GOLD), ring(15,12,7,3,CYAN), 12, 13)
out.append(("06B","Bold Link",B))
# C — Crossed link (diagonal arrangement -> leans into the X)
C=weave(ring(9,9,6,2,GOLD), ring(15,15,6,2,CYAN), 12, 13)
out.append(("06C","Crossed Link",C))
# D — Coin-shaded link (matches token-coin family)
D=weave(ring_shaded(9,12,6,2,GOLD,GOLD_L,GOLD_D), ring_shaded(15,12,6,2,CYAN,CYAN_L,CYAN_D), 12, 13)
out.append(("06D","Shaded Link",D))
# E — Clean link + match spark (the moment they bind)
E=[row[:] for row in A]
for (x,y) in [(11,11),(12,11),(11,12),(12,12)]: E[y][x]=CREAM
out.append(("06E","Link + Spark",E))

for idn,n,g in out: open(f"{DOUT}/crossed-{idn}.svg","w").write(svg(g,n))
print("wrote",len(out),"link treatments")

def cells():
    s=""
    for idn,n,g in out:
        sv=svg(g,n)
        s+=(f'<figure><div class="t big">{sv}</div><div class="t sm">{sv}</div>'
            f'<div class="t grid">{sv}</div><figcaption>{idn} · {n}</figcaption></figure>')
    return s
html=('<!doctype html><meta charset=utf8><title>Linked Rings — treatments</title><style>'
 'body{margin:0;background:#0B0E2A;font-family:ui-monospace,monospace;color:#9D9BE0;padding:20px}'
 'h1{color:#FDF6E3;font-size:15px}.row{display:flex;gap:26px;flex-wrap:wrap}'
 'figure{margin:0;text-align:center}figcaption{color:#cfd2dc;font-size:11px;margin-top:8px}'
 '.t{display:inline-flex;align-items:center;justify-content:center;image-rendering:pixelated;vertical-align:middle}'
 '.big{width:110px;height:110px;background:#141A47;border:2px solid #3A2E7A;box-shadow:4px 4px 0 #05060F}'
 '.sm{width:40px;height:40px;margin-left:8px;background:#141A47;border:2px solid #3A2E7A}'
 '.grid{width:64px;height:64px;margin-left:8px;background-color:#0B0E2A;background-image:linear-gradient(#141A47 2px,transparent 2px),linear-gradient(90deg,#141A47 2px,transparent 2px);background-size:20px 20px,20px 20px;border:2px solid #3A2E7A}'
 '.t svg{width:100%;height:100%;image-rendering:pixelated}</style>'
 '<h1>CROSSED · Linked Rings — pick a treatment (big 110px · small 40px · on-grid 64px)</h1>'
 f'<div class=row>{cells()}</div>')
open("/home/mimi/Stellar hack/design/linked-rings.html","w").write(html)
print("wrote design/linked-rings.html")
