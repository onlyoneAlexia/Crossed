import { useState } from "react";
import "./Footer.css";
import { CONFIG } from "./lib/config";

const EXPLORER = `https://stellar.expert/explorer/testnet/contract/${CONFIG.CONTRACT_ID}`;
const GITHUB = "https://github.com/"; // set to your repo
const CONTACT_EMAIL = "hello@crossed.exchange"; // placeholder — set your contact

const GithubIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-2c-3.2.7-3.9-1.4-3.9-1.4-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
  </svg>
);

const LEGAL: Record<string, { title: string; body: string[] }> = {
  terms: {
    title: "Terms of Use",
    body: [
      "Crossed is an experimental, unaudited application running on the Stellar test network. It is provided “as is”, with no warranties of any kind. Use it at your own risk.",
      "No real funds. All assets are valueless testnet tokens. Nothing here is an offer, solicitation, or financial advice.",
      "Your keys, your funds. Trading keys are generated in your browser. You are solely responsible for them. We cannot recover lost keys or reverse transactions.",
      "The matching coordinator helps two orders find each other and settle, but can never move your funds without a valid zero-knowledge proof of a price-compatible match that you authorized. It is a semi-trusted operator; fully operator-blind matching is on the roadmap.",
      "By using Crossed you accept these terms and the limitations described here and in the project documentation.",
    ],
  },
  privacy: {
    title: "Privacy",
    body: [
      "Crossed is designed to reveal as little as possible. Your order is sealed in your browser; the public chain stores only commitments, and other traders never see your price or size.",
      "The matching coordinator sees order terms at batch close in order to match them; it never sees an order that does not match. Executed trades are recorded on-chain (this is unavoidable for settlement).",
      "We run no analytics, ads, or third-party trackers. We do not collect personal data. Network requests go to public Stellar infrastructure and the project’s own coordinator/relayer.",
      "On-chain data is public and permanent by nature; treat anything you settle as visible.",
    ],
  },
  contact: {
    title: "Contact",
    body: [
      `Email: ${CONTACT_EMAIL}`,
      "Source & issues: see the GitHub link in the footer.",
      `On-chain: the live contract is verifiable on Stellar Expert (testnet).`,
      "Built for the Stellar Hacks: Real-World ZK hackathon.",
    ],
  },
};

export default function Footer({ onLaunch }: { onLaunch?: () => void }) {
  const [legal, setLegal] = useState<string | null>(null);
  const go = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <footer className="ft">
      <div className="ft-inner">
        <div className="ft-top">
          <div className="ft-brand">
            <div className="ft-logo-row">
              <span className="ft-mark" aria-hidden="true" />
              <span className="ft-word">Crossed</span>
            </div>
            <p className="ft-tag">Private, peer-to-peer token swaps on Stellar — settled on-chain the instant two offers match.</p>
            <div className="ft-social">
              <a href={GITHUB} target="_blank" rel="noreferrer" aria-label="GitHub"><GithubIcon /></a>
              <a href={`mailto:${CONTACT_EMAIL}`} aria-label="Email">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>
              </a>
            </div>
          </div>

          <nav className="ft-links">
            <div className="ft-col">
              <h4>Product</h4>
              <button onClick={() => go("how")}>How it works</button>
              <button onClick={() => onLaunch?.()}>Launch app</button>
              <button onClick={() => go("how")}>Why it’s private</button>
            </div>
            <div className="ft-col">
              <h4>Developers</h4>
              <a href={EXPLORER} target="_blank" rel="noreferrer">Smart contract</a>
              <a href="https://developers.stellar.org/docs/build/smart-contracts" target="_blank" rel="noreferrer">Soroban docs</a>
              <a href={GITHUB} target="_blank" rel="noreferrer">Source code</a>
            </div>
            <div className="ft-col">
              <h4>Legal</h4>
              <button onClick={() => setLegal("terms")}>Terms of Use</button>
              <button onClick={() => setLegal("privacy")}>Privacy</button>
              <button onClick={() => setLegal("contact")}>Contact</button>
            </div>
          </nav>
        </div>

        <div className="ft-partners">
          <span className="ft-partners-label">Powered by</span>
          <a href="https://stellar.org" target="_blank" rel="noreferrer" title="Stellar">
            <img className="ft-logo ft-stellar" src="/logos/stellar.svg" alt="Stellar" />
          </a>
          <span className="ft-partners-sep" />
          <span className="ft-partners-label">Built with</span>
          <img className="ft-logo" src="/logos/rust.svg" alt="Rust" title="Rust (Soroban)" />
          <img className="ft-logo" src="/logos/react.svg" alt="React" title="React" />
          <img className="ft-logo" src="/logos/typescript.svg" alt="TypeScript" title="TypeScript" />
          <img className="ft-logo" src="/logos/vite.svg" alt="Vite" title="Vite" />
          <span className="ft-partners-zk">Circom · Groth16 · BN254</span>
        </div>

        <div className="ft-bar">
          <span className="ft-copy">© 2026 Crossed. All rights reserved. · Stellar testnet — no real funds.</span>
          <div className="ft-bar-links">
            <button onClick={() => setLegal("terms")}>Terms</button>
            <span>·</span>
            <button onClick={() => setLegal("privacy")}>Privacy</button>
            <span>·</span>
            <button onClick={() => setLegal("contact")}>Contact</button>
          </div>
        </div>
      </div>

      {legal && (
        <div className="ft-modal" role="dialog" aria-modal="true" onClick={() => setLegal(null)}>
          <div className="ft-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="ft-modal-head">
              <h3>{LEGAL[legal].title}</h3>
              <button className="ft-x" onClick={() => setLegal(null)} aria-label="Close">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
              </button>
            </div>
            <div className="ft-modal-body">
              {LEGAL[legal].body.map((p, i) => <p key={i}>{p}</p>)}
            </div>
          </div>
        </div>
      )}
    </footer>
  );
}
