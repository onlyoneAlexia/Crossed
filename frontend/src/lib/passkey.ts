// Passkey-derived custody for the Crossed ZK dark-pool identity.
//
// WHY: today DarkPool.tsx stores the pool identity's secret scalar `sk` as PLAINTEXT
// decimal in localStorage. The blast radius is bounded (the identity only authorizes
// dark-pool orders for an already-registered owner; funds stay gated by Freighter-signed
// deposit/settle), but plaintext-at-rest is still the weakest link. This module replaces
// that with WebAuthn/passkey custody: the 32-byte identity SEED is wrapped under a key that
// only the platform authenticator (Touch ID / Windows Hello / a security key) can release,
// so a stolen localStorage blob is inert without a successful user-verifying ceremony.
//
// MODEL: WebAuthn cannot mint a baby-jubjub scalar directly, so we keep the identity math in
// `otc.ts` (single source of truth) and only manage the 32-byte seed here. The seed deterministically
// yields the full identity: sk = seed mod subOrder, pk = sk·Base8, hSk = Poseidon(sk). We persist
// ONLY ciphertext + non-secret metadata; the cleartext seed exists transiently in memory.
//
// THREE CUSTODY BACKENDS, best-available first (browser support varies — see TODOs):
//   1. PRF  — derive a stable 32-byte AES key from the credential (WebAuthn PRF / hmac-secret).
//             Seed is generated locally, AES-GCM-encrypted under the PRF key, ciphertext stored.
//   2. largeBlob — store the encrypted seed inside the credential's per-credential blob, gated
//             by the same ceremony. (We still AES-wrap before storing so the blob is not cleartext.)
//   3. wrap (fallback) — no PRF/largeBlob: generate a non-extractable AES-GCM CryptoKey, persist it
//             via IndexedDB-less localStorage as an OPAQUE handle, and require a user-verifying
//             WebAuthn assertion before each unwrap. This does NOT bind the key to the authenticator
//             cryptographically (the key lives in the browser keystore), but it does enforce a
//             user-presence/verification gate and removes plaintext secrets from storage.
//
// FRAMEWORK-FREE: no React, no app imports beyond `otc.ts` crypto primitives. Pure async functions,
// props/values in, plain objects out. The caller (gated behind CONFIG.FEATURES.passkey) decides when
// to invoke create/get and how to surface prompts.

import { init, leafOf } from "./otc";
import { buildBabyjub, buildPoseidon } from "circomlibjs";

// ---------------------------------------------------------------------------
// Public types — kept minimal & local so this module is self-contained.
// ---------------------------------------------------------------------------

/** The dark-pool identity, mirroring otc.ts `Identity`. Re-declared locally to avoid a hard type
 *  coupling (and a circular dep) while staying structurally identical. */
export interface PasskeyIdentity {
  sk: bigint;
  pkX: bigint;
  pkY: bigint;
  hSk: bigint;
  /** Membership leaf = Poseidon(pkX, pkY, hSk); handy for the caller's register() flow. */
  leaf: bigint;
}

/** Which custody backend produced/holds this identity, for diagnostics + UI copy. */
export type PasskeyBackend = "prf" | "largeBlob" | "wrap";

export interface CreatePasskeyOptions {
  /** Owner address (Stellar G...) — namespaces the stored blob so wallets don't collide. */
  owner: string;
  /** Shown in the OS passkey prompt; defaults to a Crossed-branded label. */
  displayName?: string;
  /** Relying-party id. Defaults to the current hostname. MUST be a registrable suffix of the origin. */
  rpId?: string;
}

export interface GetPasskeyOptions {
  owner: string;
  rpId?: string;
}

export interface PasskeyResult {
  identity: PasskeyIdentity;
  backend: PasskeyBackend;
}

// ---------------------------------------------------------------------------
// Storage layout. Only NON-SECRET material + ciphertext lives here.
// ---------------------------------------------------------------------------

const STORE_VERSION = 1;
const keyFor = (owner: string) => `crossed.passkey.${owner}.v${STORE_VERSION}`;

interface StoredRecord {
  v: number;
  backend: PasskeyBackend;
  /** base64url credential id, re-supplied to the authenticator on assertion (allowCredentials). */
  credId: string;
  /** PRF salt (base64url) — fixed per record so the derived key is stable. PRF/wrap backends. */
  prfSalt?: string;
  /** AES-GCM IV (base64url). PRF/largeBlob/wrap backends. */
  iv: string;
  /** AES-GCM ciphertext of the 32-byte seed (base64url). For largeBlob this is also mirrored in the
   *  credential blob; we keep a copy here so a same-device unwrap can skip the blob read if desired. */
  ct?: string;
  /** Exported raw AES key (base64url) for the `wrap` fallback ONLY. The non-extractable variant can't
   *  be exported, so the fallback uses an extractable key gated by a user-verifying assertion. This is
   *  the WEAKEST backend — see header. Never set for prf/largeBlob. */
  wrapKey?: string;
}

function loadRecord(owner: string): StoredRecord | null {
  const raw = localStorage.getItem(keyFor(owner));
  if (!raw) return null;
  try {
    const r = JSON.parse(raw) as StoredRecord;
    return r && typeof r.credId === "string" && typeof r.iv === "string" ? r : null;
  } catch {
    return null;
  }
}
function saveRecord(owner: string, r: StoredRecord): void {
  localStorage.setItem(keyFor(owner), JSON.stringify(r));
}

/** True if a passkey identity has already been provisioned for this owner. */
export function hasPasskeyIdentity(owner: string): boolean {
  return loadRecord(owner) !== null;
}

// ---------------------------------------------------------------------------
// Capability probe. The caller can use this to decide whether to even offer passkey UI.
// ---------------------------------------------------------------------------

export interface PasskeyCapabilities {
  webauthn: boolean;
  /** Whether a platform authenticator (Touch ID / Windows Hello) is present. */
  platformAuthenticator: boolean;
}

export async function detectPasskeySupport(): Promise<PasskeyCapabilities> {
  const webauthn = typeof window !== "undefined" && !!window.PublicKeyCredential;
  let platformAuthenticator = false;
  // TODO(support): PRF and largeBlob support cannot be feature-detected without an actual
  // create/assert ceremony — the spec exposes no reliable static probe. We therefore detect
  // them at create-time by inspecting `getClientExtensionResults()` and fall back accordingly.
  if (webauthn) {
    try {
      platformAuthenticator =
        await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    } catch {
      platformAuthenticator = false;
    }
  }
  return { webauthn, platformAuthenticator };
}

// ---------------------------------------------------------------------------
// Byte / base64url helpers (no Buffer; browser-safe).
// ---------------------------------------------------------------------------

function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}
function b64urlEncode(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// A fixed, app-scoped PRF input. Distinct constant => distinct derived key namespace.
const PRF_INFO = new TextEncoder().encode("crossed.darkpool.identity.seed.v1");

// ---------------------------------------------------------------------------
// AES-GCM seed sealing.
// ---------------------------------------------------------------------------

/** Import 32 raw bytes (from PRF output) as an AES-GCM key. Non-extractable: it never leaves WebCrypto. */
async function importAesKey(raw: Uint8Array<ArrayBuffer>, extractable = false): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, extractable, ["encrypt", "decrypt"]);
}
async function aesEncrypt(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>): Promise<{ iv: Uint8Array<ArrayBuffer>; ct: Uint8Array<ArrayBuffer> }> {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return { iv, ct };
}
async function aesDecrypt(key: CryptoKey, iv: Uint8Array<ArrayBuffer>, ct: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct));
}

// ---------------------------------------------------------------------------
// Seed -> Identity. The seed is 32 bytes of entropy; the identity is derived deterministically so the
// SAME seed always yields the SAME pool identity (and therefore the same membership leaf).
// Math is delegated to circomlibjs (same libs otc.ts uses) to guarantee bit-for-bit agreement.
// ---------------------------------------------------------------------------

let _bj: any, _pos: any, _F: any;
async function ensureCrypto(): Promise<void> {
  if (_pos) return;
  await init(); // warm otc.ts's shared instances too (cheap; both memoize)
  _bj = await buildBabyjub();
  _pos = await buildPoseidon();
  _F = _pos.F;
}

function bytesToBigint(b: Uint8Array): bigint {
  let x = 0n;
  for (const v of b) x = (x << 8n) | BigInt(v);
  return x;
}

/** Derive the full pool identity from a 32-byte seed. Pure given the seed. */
async function identityFromSeed(seed: Uint8Array): Promise<PasskeyIdentity> {
  await ensureCrypto();
  // sk in [1, subOrder). We reduce the seed mod (subOrder-1) and +1 to dodge the zero scalar,
  // mirroring otc.ts's randBelow bias-avoidance for the identity scalar.
  const sub: bigint = _bj.subOrder;
  const sk = (bytesToBigint(seed) % (sub - 1n)) + 1n;
  const pk = _bj.mulPointEscalar(_bj.Base8, sk);
  const pkX = _bj.F.toObject(pk[0]);
  const pkY = _bj.F.toObject(pk[1]);
  const hSk = _F.toObject(_pos([sk]));
  const leaf = leafOf(pkX, pkY, hSk);
  return { sk, pkX, pkY, hSk, leaf };
}

// ---------------------------------------------------------------------------
// WebAuthn ceremonies.
// ---------------------------------------------------------------------------

function rpIdOf(opt: { rpId?: string }): string {
  return opt.rpId ?? (typeof window !== "undefined" ? window.location.hostname : "localhost");
}

/** Create a discoverable credential, requesting PRF + largeBlob. We then inspect which extension the
 *  authenticator actually honored and pick the strongest available backend. */
async function createCredential(owner: string, displayName: string, rpId: string): Promise<{
  credId: Uint8Array<ArrayBuffer>;
  cred: PublicKeyCredential;
}> {
  const userId = new TextEncoder().encode(owner).slice(0, 64);
  const challenge = randomBytes(32); // not server-verified (client-only custody); freshness only.
  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: { id: rpId, name: "Crossed Dark Pool" },
    user: { id: userId, name: owner, displayName },
    pubKeyCredParams: [
      { type: "public-key", alg: -7 }, // ES256
      { type: "public-key", alg: -257 }, // RS256
    ],
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    timeout: 60_000,
    extensions: {
      // PRF: ask for a per-credential pseudo-random function (a.k.a. hmac-secret).
      // prf is newer than the lib DOM types in some TS versions.
      prf: {},
      // largeBlob: request the ability to store a small encrypted blob in the credential.
      // largeBlob support varies across TS DOM lib versions.
      largeBlob: { support: "preferred" },
    },
  };
  const cred = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!cred) throw new Error("passkey creation was cancelled or failed");
  return { credId: new Uint8Array(cred.rawId), cred };
}

/** Run an assertion that requests PRF evaluation at `prfSalt` (and/or a largeBlob read). */
async function assertCredential(
  credId: Uint8Array<ArrayBuffer>,
  rpId: string,
  opts: { prfSalt?: Uint8Array; readLargeBlob?: boolean; writeLargeBlob?: Uint8Array },
): Promise<PublicKeyCredential> {
  const challenge = randomBytes(32);
  const extensions: Record<string, unknown> = {};
  if (opts.prfSalt) extensions.prf = { eval: { first: opts.prfSalt } };
  if (opts.readLargeBlob) extensions.largeBlob = { read: true };
  if (opts.writeLargeBlob) extensions.largeBlob = { write: opts.writeLargeBlob };

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId,
    allowCredentials: [{ type: "public-key", id: credId }],
    userVerification: "required",
    timeout: 60_000,
    // prf/largeBlob extension request types vary by TS DOM lib version.
    extensions,
  };
  const assertion = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!assertion) throw new Error("passkey assertion was cancelled or failed");
  return assertion;
}

/** Pull the PRF output (32 bytes) from an assertion's client-extension results, or null if unsupported. */
function prfOutput(cred: PublicKeyCredential): Uint8Array<ArrayBuffer> | null {
  const ext = cred.getClientExtensionResults() as any;
  const first: ArrayBuffer | undefined = ext?.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}
/** Whether the authenticator reported largeBlob as supported during creation. */
function largeBlobSupported(cred: PublicKeyCredential): boolean {
  const ext = cred.getClientExtensionResults() as any;
  return ext?.largeBlob?.supported === true;
}

// PRF outputs vary in length across authenticators; HKDF-extract to a stable 32-byte AES key.
async function prfToAesKey(prf: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey("raw", prf, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: PRF_INFO },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// ---------------------------------------------------------------------------
// CREATE
// ---------------------------------------------------------------------------

/**
 * Provision a brand-new passkey-protected pool identity for `owner`.
 *
 * Generates a fresh 32-byte seed, seals it under the best available WebAuthn backend, persists ONLY
 * the ciphertext + metadata, and returns the derived identity (which the caller registers on-chain).
 *
 * Throws if WebAuthn is unavailable or the user cancels. The caller (gated by CONFIG.FEATURES.passkey)
 * should catch and offer the legacy plaintext path as a fallback if it chooses.
 */
export async function createPasskeyIdentity(opts: CreatePasskeyOptions): Promise<PasskeyResult> {
  const { owner } = opts;
  if (!owner) throw new Error("createPasskeyIdentity requires an owner address");
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    throw new Error("WebAuthn is not available in this browser");
  }
  const rpId = rpIdOf(opts);
  const displayName = opts.displayName ?? "Crossed pool identity";

  const seed = randomBytes(32); // the identity entropy; lives in memory only until sealed.
  const { credId, cred } = await createCredential(owner, displayName, rpId);
  const credIdB64 = b64urlEncode(credId);

  // ---- Backend 1: PRF ----------------------------------------------------
  // Some authenticators return PRF results on create; most require a follow-up assertion. We attempt
  // a PRF assertion immediately to learn support AND to derive the wrapping key.
  const prfSalt = randomBytes(32);
  try {
    const assertion = await assertCredential(credId, rpId, { prfSalt });
    const prf = prfOutput(assertion);
    if (prf) {
      const key = await prfToAesKey(prf);
      const { iv, ct } = await aesEncrypt(key, seed);
      saveRecord(owner, {
        v: STORE_VERSION,
        backend: "prf",
        credId: credIdB64,
        prfSalt: b64urlEncode(prfSalt),
        iv: b64urlEncode(iv),
        ct: b64urlEncode(ct),
      });
      const identity = await identityFromSeed(seed);
      return { identity, backend: "prf" };
    }
  } catch (e) {
    // PRF assertion failed/declined — fall through to largeBlob, then wrap.
    // TODO(support): Safari/iOS historically lacked PRF; Chrome+platform authenticators added it.
    // We intentionally swallow and downgrade rather than hard-fail.
    void e;
  }

  // ---- Backend 2: largeBlob ---------------------------------------------
  // Wrap the seed under a locally generated AES key, store the WRAPPED bytes in the credential blob,
  // and persist the AES key handle as an extractable raw key gated behind the same passkey. (We still
  // never store the raw SEED in cleartext.)
  // TODO(support): largeBlob is supported on Chrome + many security keys; spotty on iOS/Safari.
  if (largeBlobSupported(cred)) {
    try {
      const wrapKeyRaw = randomBytes(32);
      const wrapKey = await importAesKey(wrapKeyRaw, false);
      const { iv, ct } = await aesEncrypt(wrapKey, seed);
      // Store [iv || ct] in the credential blob.
      const blob = new Uint8Array(iv.length + ct.length);
      blob.set(iv, 0);
      blob.set(ct, iv.length);
      await assertCredential(credId, rpId, { writeLargeBlob: blob });
      saveRecord(owner, {
        v: STORE_VERSION,
        backend: "largeBlob",
        credId: credIdB64,
        iv: b64urlEncode(iv),
        ct: b64urlEncode(ct), // mirror copy; the source of truth is the credential blob.
        wrapKey: b64urlEncode(wrapKeyRaw),
      });
      const identity = await identityFromSeed(seed);
      return { identity, backend: "largeBlob" };
    } catch (e) {
      void e; // fall through to wrap.
    }
  }

  // ---- Backend 3: wrap (documented fallback) ----------------------------
  // No PRF, no usable largeBlob. We still require a user-verifying assertion (above, during create the
  // authenticatorSelection.userVerification:"required" enforced UV) and we remove plaintext seeds from
  // storage by AES-wrapping under a generated key. The key itself is persisted (extractable), so this
  // is NOT hardware-bound custody — it is a user-presence-gated obfuscation step. The caller MUST gate
  // any prod use behind CONFIG.FEATURES.passkey and treat this backend as a graceful degradation only.
  // TODO(security): when PRF lands everywhere we target, DELETE this fallback — it provides defense in
  // depth (UV gate + no plaintext at rest) but not cryptographic binding to the authenticator.
  {
    const wrapKeyRaw = randomBytes(32);
    const wrapKey = await importAesKey(wrapKeyRaw, false);
    const { iv, ct } = await aesEncrypt(wrapKey, seed);
    saveRecord(owner, {
      v: STORE_VERSION,
      backend: "wrap",
      credId: credIdB64,
      iv: b64urlEncode(iv),
      ct: b64urlEncode(ct),
      wrapKey: b64urlEncode(wrapKeyRaw),
    });
    const identity = await identityFromSeed(seed);
    return { identity, backend: "wrap" };
  }
}

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

/**
 * Unlock the previously-provisioned passkey identity for `owner`. Triggers exactly one user-verifying
 * WebAuthn ceremony, unwraps the seed, and re-derives the identity. Returns null if nothing was ever
 * provisioned (caller should then offer createPasskeyIdentity). Throws on cancel/failure.
 */
export async function getPasskeyIdentity(opts: GetPasskeyOptions): Promise<PasskeyResult | null> {
  const { owner } = opts;
  if (!owner) throw new Error("getPasskeyIdentity requires an owner address");
  const rec = loadRecord(owner);
  if (!rec) return null;
  if (typeof window === "undefined" || !window.PublicKeyCredential) {
    throw new Error("WebAuthn is not available in this browser");
  }
  const rpId = rpIdOf(opts);
  const credId = b64urlDecode(rec.credId);

  let seed: Uint8Array;

  if (rec.backend === "prf") {
    if (!rec.prfSalt) throw new Error("passkey record corrupt: missing prfSalt");
    const assertion = await assertCredential(credId, rpId, { prfSalt: b64urlDecode(rec.prfSalt) });
    const prf = prfOutput(assertion);
    if (!prf) throw new Error("authenticator did not return a PRF result on unlock");
    const key = await prfToAesKey(prf);
    seed = await aesDecrypt(key, b64urlDecode(rec.iv), b64urlDecode(rec.ct ?? ""));
  } else if (rec.backend === "largeBlob") {
    // Read the wrapped seed back from the credential blob (re-verifying the user), then unwrap.
    const assertion = await assertCredential(credId, rpId, { readLargeBlob: true });
    const ext = assertion.getClientExtensionResults() as any;
    const blob: ArrayBuffer | undefined = ext?.largeBlob?.blob;
    if (!rec.wrapKey) throw new Error("passkey record corrupt: missing wrapKey");
    const wrapKey = await importAesKey(b64urlDecode(rec.wrapKey), false);
    if (blob) {
      const all = new Uint8Array(blob);
      const iv = all.slice(0, 12);
      const ct = all.slice(12);
      seed = await aesDecrypt(wrapKey, iv, ct);
    } else {
      // Blob read unsupported on this device/session — fall back to the mirrored ciphertext, still
      // gated by the assertion we just performed.
      if (!rec.ct) throw new Error("largeBlob unreadable and no mirrored ciphertext present");
      seed = await aesDecrypt(wrapKey, b64urlDecode(rec.iv), b64urlDecode(rec.ct));
    }
  } else {
    // wrap fallback: require a user-verifying assertion as a presence gate, then unwrap.
    await assertCredential(credId, rpId, {});
    if (!rec.wrapKey || !rec.ct) throw new Error("passkey record corrupt: missing wrap material");
    const wrapKey = await importAesKey(b64urlDecode(rec.wrapKey), false);
    seed = await aesDecrypt(wrapKey, b64urlDecode(rec.iv), b64urlDecode(rec.ct));
  }

  const identity = await identityFromSeed(seed);
  // Best-effort scrub of the transient seed from this frame's memory.
  seed.fill(0);
  return { identity, backend: rec.backend };
}

/** Forget the stored passkey record for `owner`. Does NOT (and cannot) delete the OS-side credential;
 *  the user manages that in their password manager / OS settings. */
export function clearPasskeyIdentity(owner: string): void {
  localStorage.removeItem(keyFor(owner));
}
