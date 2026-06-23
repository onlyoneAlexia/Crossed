// Crossed v2 — Viewing-key page wrapper.
//
// Thin parent that owns the ViewingKey state and renders the controlled <ViewingKeys/>
// inside the app shell. Gated entirely behind CONFIG.FEATURES.viewingKeys at the router;
// this file only exists in the build when that flag flips on.
//
// Per CROSSED_V2_PLAN Hard Rule 5 (no faked cryptography): the secret here is honest
// random key material persisted locally; the selective-disclosure DECRYPT path stays
// disabled (decryptReady=false) until the coordinator /dp/disclose endpoint lands, at
// which point this wrapper wires a real onDecrypt + decryptReady.
import { useState } from "react";
import "./App.css";
import ViewingKeys, { type ViewingKey } from "./components/ViewingKeys";
import { ThemeToggle } from "./components/ThemeToggle";
import { CONFIG } from "./lib/config";

const VK_KEY = `crossed.${CONFIG.DP_CONTRACT_ID}.viewingKey.v1`;

function randomSecretHex(bytes = 32): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Short, non-secret fingerprint so a user can distinguish keys at a glance.
function fingerprintOf(secret: string): string {
  return `${secret.slice(0, 4)}…${secret.slice(-4)}`;
}

function loadKey(): ViewingKey | null {
  try {
    const raw = localStorage.getItem(VK_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return typeof o?.secret === "string" ? o : null;
  } catch {
    return null;
  }
}

export default function ViewingKeysPage({ onHome }: { onHome: () => void }) {
  const [viewingKey, setViewingKey] = useState<ViewingKey | null>(() => loadKey());

  const persist = (k: ViewingKey | null) => {
    setViewingKey(k);
    if (k) localStorage.setItem(VK_KEY, JSON.stringify(k));
    else localStorage.removeItem(VK_KEY);
  };

  const onGenerate = () => {
    const secret = randomSecretHex();
    persist({ secret, label: "Viewing key", fingerprint: fingerprintOf(secret) });
  };
  const onImport = (secret: string) => {
    const s = secret.trim();
    if (!s) return;
    persist({ secret: s, label: "Imported", fingerprint: fingerprintOf(s) });
  };
  const onClear = () => persist(null);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand" style={{ cursor: "pointer" }} onClick={onHome} title="Back to the pool">
          <div className="mark" /><div className="name">Crossed</div>
        </div>
        <div className="walletline">
          <span className="pill"><span className="dot" /> Viewing keys · Testnet</span>
          <ThemeToggle />
          <button className="px-btn px-btn--sm px-btn--ghost" type="button" onClick={onHome}>Back</button>
        </div>
      </div>
      <ViewingKeys
        viewingKey={viewingKey}
        onGenerate={onGenerate}
        onImport={onImport}
        onClear={onClear}
        decryptReady={false}
      />
    </div>
  );
}
