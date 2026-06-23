/**
 * ViewingKeys — selective-disclosure key management (Crossed v2, Class C/D).
 *
 * Pure, standalone, controlled: props in, callbacks out. NO crypto, NO chain, NO
 * coordinator calls are performed here — the parent owns key derivation + I/O and
 * wires this behind `CONFIG.FEATURES.viewingKeys` (default false). Per the v2 plan
 * Hard Rules: no faked cryptography. The "decrypt fill payload" panel is an explicit
 * design stub that surfaces a clear "pending coordinator support" state until the
 * `/dp/disclose` endpoint lands.
 *
 * Style: pixel-arcade `.px-*` layer (pixel-ui.css) + var(--…) tokens (index.css).
 */
import { useState } from "react";

/** A viewing key as the parent models it. `secret` is the raw key material the
 *  parent derived/imported; everything here is display + controlled edit only. */
export interface ViewingKey {
  /** opaque secret (hex / bech32 / base64 — parent decides the encoding). */
  secret: string;
  /** optional public label so a user can tell multiple keys apart. */
  label?: string;
  /** optional short fingerprint the parent computed (e.g. first bytes of a hash). */
  fingerprint?: string;
}

/** Result of a disclosure attempt, surfaced by the parent once supported. */
export interface DisclosureResult {
  ok: boolean;
  /** human-readable line(s) the parent decoded, or an error reason. */
  message: string;
  /** decoded fields to render as a key/value table when ok. */
  fields?: { k: string; v: string }[];
}

export interface ViewingKeysProps {
  /** Current key, or null when none generated/imported yet. */
  viewingKey: ViewingKey | null;
  /** Generate a fresh viewing key (parent derives the real material). */
  onGenerate: () => void;
  /** Import an existing key from a pasted secret string. */
  onImport: (secret: string) => void;
  /** Forget/clear the current key. */
  onClear: () => void;
  /**
   * Attempt to decrypt a coordinator fill payload with the current key.
   * Returns null/undefined while support is pending; the panel then shows the
   * "pending coordinator support" state. Provide a handler to enable the panel.
   */
  onDecrypt?: (payload: string) => DisclosureResult | Promise<DisclosureResult>;
  /**
   * Whether the coordinator disclosure endpoint is live. Defaults to false so the
   * decrypt panel renders its pending state until the backend lane ships `/dp/disclose`.
   */
  decryptReady?: boolean;
  /** Disable all controls (e.g. while a parent op is in flight). */
  busy?: boolean;
  className?: string;
}

const labelCap: React.CSSProperties = {
  fontFamily: "var(--font-label)",
  textTransform: "uppercase",
  letterSpacing: ".08em",
  fontSize: 11,
  color: "var(--muted)",
};

const mono: React.CSSProperties = {
  fontFamily: "var(--font-body)",
  fontSize: 16,
  color: "var(--fg)",
  wordBreak: "break-all",
  lineHeight: 1.4,
};

export default function ViewingKeys({
  viewingKey,
  onGenerate,
  onImport,
  onClear,
  onDecrypt,
  decryptReady = false,
  busy = false,
  className = "",
}: ViewingKeysProps) {
  const [importText, setImportText] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState<DisclosureResult | null>(null);
  const [decrypting, setDecrypting] = useState(false);

  const hasKey = viewingKey != null;
  const canDecrypt = decryptReady && typeof onDecrypt === "function";

  const masked = (s: string) =>
    s.length <= 10 ? "•".repeat(s.length) : `${s.slice(0, 6)}…${s.slice(-4)}`;

  const copyKey = async () => {
    if (!viewingKey) return;
    try {
      await navigator.clipboard.writeText(viewingKey.secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard blocked — non-fatal, the key is still visible to copy by hand */
    }
  };

  const doImport = () => {
    const s = importText.trim();
    if (!s || busy) return;
    onImport(s);
    setImportText("");
  };

  const doDecrypt = async () => {
    if (!canDecrypt || !onDecrypt || !payload.trim() || decrypting) return;
    setDecrypting(true);
    setResult(null);
    try {
      const r = await onDecrypt(payload.trim());
      setResult(r);
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : "Disclosure failed." });
    } finally {
      setDecrypting(false);
    }
  };

  return (
    <section
      className={`px-card px-card--pop ${className}`}
      style={{ display: "grid", gap: 18, maxWidth: 560 }}
      aria-label="Viewing key management"
    >
      <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h3 className="px-card__title" style={{ margin: 0 }}>Viewing key</h3>
        <span className={`px-badge ${hasKey ? "px-badge--ok" : "px-badge--pending"}`}>
          <span className="px-badge__dot" />
          {hasKey ? "Active" : "None"}
        </span>
      </header>

      <p style={{ ...labelCap, color: "var(--muted-2)", textTransform: "none", letterSpacing: 0, fontFamily: "var(--font-body)", fontSize: 16, margin: 0 }}>
        A viewing key grants selective, read-only disclosure of your sealed fills — share it
        with an auditor or counterparty without revealing your spending key.
      </p>

      {/* ---- key display / empty state ---- */}
      {hasKey ? (
        <div
          style={{
            background: "var(--bg-2)",
            border: "2px solid var(--border)",
            borderRadius: "var(--radius)",
            padding: 14,
            display: "grid",
            gap: 10,
          }}
        >
          {viewingKey.label ? (
            <div style={labelCap}>{viewingKey.label}</div>
          ) : null}
          <div style={mono} aria-label="viewing key secret">
            {revealed ? viewingKey.secret : masked(viewingKey.secret)}
          </div>
          {viewingKey.fingerprint ? (
            <div style={{ ...labelCap, color: "var(--muted-2)" }}>
              fp&nbsp;{viewingKey.fingerprint}
            </div>
          ) : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              className="px-btn px-btn--sm px-btn--ghost"
              aria-pressed={revealed}
              onClick={() => setRevealed((v) => !v)}
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
            <button type="button" className="px-btn px-btn--sm" onClick={() => void copyKey()}>
              {copied ? "Copied" : "Copy"}
            </button>
            <button
              type="button"
              className="px-btn px-btn--sm px-btn--danger"
              disabled={busy}
              onClick={onClear}
            >
              Forget
            </button>
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          <button
            type="button"
            className="px-btn px-btn--primary px-btn--block"
            disabled={busy}
            onClick={onGenerate}
          >
            Generate viewing key
          </button>

          <hr className="px-rule" style={{ margin: "4px 0" }} />

          <label style={labelCap} htmlFor="vk-import">Import existing</label>
          <input
            id="vk-import"
            className="px-input"
            placeholder="Paste viewing key secret…"
            value={importText}
            disabled={busy}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setImportText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") doImport(); }}
          />
          <button
            type="button"
            className="px-btn px-btn--block"
            disabled={busy || importText.trim().length === 0}
            onClick={doImport}
          >
            Import
          </button>
        </div>
      )}

      <hr className="px-rule" style={{ margin: 0 }} />

      {/* ---- selective disclosure: decrypt fill payload (stub) ---- */}
      <div style={{ display: "grid", gap: 12 }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <h3 className="px-card__title" style={{ margin: 0 }}>Decrypt fill payload</h3>
          {!canDecrypt ? (
            <span className="px-badge px-badge--pending">
              <span className="px-badge__dot" />
              Pending coordinator
            </span>
          ) : (
            <span className="px-badge px-badge--ok">
              <span className="px-badge__dot" />
              Ready
            </span>
          )}
        </header>

        {!canDecrypt ? (
          <div
            role="note"
            style={{
              background: "var(--surface-2)",
              border: "2px dashed var(--border)",
              borderRadius: "var(--radius)",
              padding: 14,
              ...labelCap,
              color: "var(--muted)",
              textTransform: "none",
              letterSpacing: 0,
              fontFamily: "var(--font-body)",
              fontSize: 16,
              lineHeight: 1.4,
            }}
          >
            Selective disclosure decrypts an encrypted fill payload locally with your viewing
            key — proving an amount or counterparty without exposing the rest. This requires the
            coordinator <code style={{ fontFamily: "var(--font-body)" }}>/dp/disclose</code> endpoint,
            which is <strong>not live yet</strong>. The panel unlocks automatically once support ships.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            <textarea
              className="px-input"
              style={{ minHeight: 90, resize: "vertical" }}
              placeholder="Paste encrypted fill payload…"
              value={payload}
              disabled={busy || !hasKey || decrypting}
              spellCheck={false}
              onChange={(e) => setPayload(e.target.value)}
            />
            {!hasKey ? (
              <div style={{ ...labelCap, color: "var(--warn)", textTransform: "none", letterSpacing: 0 }}>
                Generate or import a viewing key first.
              </div>
            ) : null}
            <button
              type="button"
              className="px-btn px-btn--accent px-btn--block"
              disabled={busy || !hasKey || decrypting || payload.trim().length === 0}
              onClick={() => void doDecrypt()}
            >
              {decrypting ? "Decrypting…" : "Decrypt"}
            </button>

            {result ? (
              <div
                style={{
                  background: result.ok ? "var(--good-bg)" : "var(--bad-bg)",
                  border: `2px solid ${result.ok ? "var(--good)" : "var(--bad)"}`,
                  borderRadius: "var(--radius)",
                  padding: 12,
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ ...labelCap, color: result.ok ? "var(--good)" : "var(--bad)" }}>
                  {result.ok ? "Disclosed" : "Failed"}
                </div>
                <div style={{ ...mono, fontSize: 16 }}>{result.message}</div>
                {result.ok && result.fields?.length ? (
                  <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "4px 12px" }}>
                    {result.fields.map((f) => (
                      <div key={f.k} style={{ display: "contents" }}>
                        <dt style={labelCap}>{f.k}</dt>
                        <dd style={{ ...mono, margin: 0 }}>{f.v}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
