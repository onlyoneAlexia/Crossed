import { useEffect } from "react";
import "./Landing.css";
import ArcadeTimeline from "./ArcadeTimeline";
import Footer from "./Footer";
import { ThemeToggle } from "./components/ThemeToggle";
// inline the SVG (so its CSS animation runs; <img> doesn't animate inline <style>)
import heroSvg from "./crossed-hero.svg?raw";

const CONTRACT = "CDFQ2O2CLVYGFONHDWSCJSBC4RNVPG5TDHH4ETLVLJ4W54UU4LAXMH5H";

const Check = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

const TRUST_CHIPS = ["Both sides swap at once", "Nothing leaks", "You hold your tokens", "Check it on Stellar"];

const STEPS = [
  { h: "Make a private offer", t: "Pick what you'll give, what you want back, and who you want to trade with. Your offer is locked on your own device before it's ever sent." },
  { h: "It stays secret", t: "Your offer goes out, but no one can read it — not the network, not other people, not even the person you chose. If no one ever matches it, it just stays hidden. Nobody learns a thing." },
  { h: "It finds its match", t: "If the other person makes the exact opposite offer — they give what you want and want what you give — the two offers recognize each other. Only now does the deal become visible, and only to the two of you." },
  { h: "You swap", t: "Both sides trade at the very same moment, in one step. Either the whole swap goes through, or nothing happens at all. No one can take your tokens and leave you with nothing." },
];

const WHY = [
  { h: "You don't tip your hand", t: "You never announce what you're trying to do. You make one private offer to one person and wait." },
  { h: "Nothing leaks if it falls through", t: "If your offer never finds a match, no one ever learns it existed in the first place." },
  { h: "No one can jump ahead of you", t: "The deal only becomes visible after both sides have already agreed. There's no gap for someone to sneak in front of you." },
  { h: "You never get left hanging", t: "Both sides swap together in a single step. You can't hand over your tokens and be left waiting for theirs." },
];

const HOW = [
  { h: "Locked on your device", t: "Your offer is scrambled on your own computer before it leaves. Only an exact matching offer can ever line up with it." },
  { h: "Checked, never revealed", t: "Stellar checks that two offers truly match without ever seeing what's inside them. (This is the “zero-knowledge” part: proof without exposure.)" },
  { h: "Swapped in one step", t: "Once it's confirmed and both people approve, the tokens swap in a single transaction. The network only records the finished swap — never the details of anything that didn't happen." },
];

const TRUST = [
  { h: "It can never take your tokens", t: "Nothing moves without your own approval. Not a single token can be sent unless you sign for it yourself." },
  { h: "It can't see an offer that hasn't matched", t: "The helper service only steps in once two offers have already lined up. An offer that hasn't matched never reaches it." },
  { h: "Your privacy is real, not a pinky-promise", t: "Offers are scrambled with cryptography, not just “trust us.” The network proves two offers match without seeing them." },
  { h: "You can check everything yourself", t: "Every finished swap is written to Stellar. You can look it up and confirm it with your own eyes." },
];

const sd = (i: number) => ({ transitionDelay: `${i * 70}ms` }) as React.CSSProperties;

export default function Landing({ onLaunch }: { onLaunch: () => void }) {
  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>(".reveal"));
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce || !("IntersectionObserver" in window)) { els.forEach((e) => e.classList.add("in")); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);

  return (
    <div className="landing">
      <header className="lp-top">
        <div className="brand"><div className="mark" /><div className="name">Crossed</div></div>
        <div className="lp-top-right">
          <span className="pill"><span className="dot" /> Testnet</span>
          <ThemeToggle />
          <button className="btn sm" onClick={onLaunch}>Launch app</button>
        </div>
      </header>

      <section className="lp-hero">
        <span className="eyebrow">Private token swaps on Stellar</span>
        <h1>Swap tokens privately.<br /><span className="g">Nobody sees the deal until it happens.</span></h1>
        <p className="lp-sub">
          Make a private offer — what you give, what you want, and who with. It stays invisible until they make the
          exact mirror, then both sides swap in the same instant. No match, no trace.
        </p>
        <div className="lp-cta">
          <button className="btn" onClick={onLaunch}>Launch app</button>
          <button className="btn ghost" onClick={() => scrollTo("how")}>See how it works</button>
        </div>
        <div className="lp-chips">
          {TRUST_CHIPS.map((c) => <span className="trust-chip" key={c}><Check /> {c}</span>)}
        </div>
        <div className="hero-art card" role="img" aria-label="Two sealed orders cross into a private token swap" dangerouslySetInnerHTML={{ __html: heroSvg }} />
        <ArcadeTimeline />
      </section>

      <section className="lp-section reveal" id="how">
        <div className="lp-head">
          <span className="eyebrow">How it works</span>
          <h2>Four simple steps</h2>
          <p className="lp-body">That's the whole thing. Read it once and you understand Crossed.</p>
        </div>
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li className="reveal" style={sd(i)} key={s.h}><span className="step-n mono">{String(i + 1).padStart(2, "0")}</span>
              <div><div className="step-h">{s.h}</div><div className="step-t">{s.t}</div></div></li>
          ))}
        </ol>
      </section>

      <section className="lp-section reveal">
        <div className="lp-head">
          <span className="eyebrow">Why it's private</span>
          <h2>Why hide your offer?</h2>
          <p className="lp-body">
            Normally, to find someone to trade with, you have to tell people what you want. The moment they know, they
            can use it against you — like nudging the price before you buy. Crossed lets you find a match without telling
            anyone anything.
          </p>
        </div>
        <div className="grid2">
          {WHY.map((f, i) => (
            <div className="feat reveal" style={sd(i)} key={f.h}><div className="feat-h">{f.h}</div><div className="feat-t">{f.t}</div></div>
          ))}
        </div>
      </section>

      <section className="lp-section reveal">
        <div className="lp-head">
          <span className="eyebrow">Under the hood</span>
          <h2>How it actually works</h2>
          <p className="lp-body">If you're curious about the how, here it is in plain terms. The math stays out of your way.</p>
        </div>
        <ol className="steps">
          {HOW.map((s, i) => (
            <li className="reveal" style={sd(i)} key={s.h}><span className="step-n mono">{String(i + 1).padStart(2, "0")}</span>
              <div><div className="step-h">{s.h}</div><div className="step-t">{s.t}</div></div></li>
          ))}
        </ol>
      </section>

      <section className="lp-section">
        <div className="card trust-card reveal">
          <span className="eyebrow">Straight talk</span>
          <h2 style={{ marginTop: 6 }}>What to know before you trust it</h2>
          <p className="lp-body" style={{ marginBottom: 18 }}>
            We'd rather tell you exactly how this works than oversell it. Crossed uses a small helper service to introduce
            the two sides and complete the swap. Here's precisely what it can and can't do.
          </p>
          <div className="grid2">
            {TRUST.map((f) => (
              <div className="feat" key={f.h}><div className="feat-h">{f.h}</div><div className="feat-t">{f.t}</div></div>
            ))}
          </div>
          <p className="tiny mono contract-line">Contract {CONTRACT} · Stellar testnet</p>
        </div>
      </section>

      <section className="lp-section lp-final reveal">
        <h2>Make your first private trade</h2>
        <p className="lp-body" style={{ margin: "0 auto 22px", textAlign: "center" }}>
          Set up in under a minute, pick someone to trade with, and send a hidden offer. If it matches, you'll watch both
          sides swap at once. If it doesn't, no one ever knows.
        </p>
        <div className="lp-cta center">
          <button className="btn" onClick={onLaunch}>Launch app</button>
          <button className="btn ghost" onClick={() => scrollTo("how")}>See how it works</button>
        </div>
      </section>

      <Footer onLaunch={onLaunch} />
    </div>
  );
}
