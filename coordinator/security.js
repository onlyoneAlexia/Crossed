import { createHash } from "node:crypto";
import { Keypair } from "@stellar/stellar-sdk";

const DEFAULT_CORS_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173";
const OWNER_AUTH_DOMAIN = "crossed.coordinator";
const OWNER_AUTH_VERSION = "1";
const OWNER_AUTH_MAX_AGE_MS = 5 * 60_000;
const OWNER_AUTH_FUTURE_SKEW_MS = 60_000;

function list(value) {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function createCorsMiddleware({
  origins = process.env.CORS_ORIGINS ?? process.env.FRONTEND_ORIGIN ?? DEFAULT_CORS_ORIGINS,
} = {}) {
  const allowed = new Set(list(origins));
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && allowed.has(origin)) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
    }
    res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Content-Type,Authorization,X-API-Key,X-Crossed-Secret,X-Crossed-Wallet-Timestamp,X-Crossed-Wallet-Signature",
    );
    if (req.method === "OPTIONS") {
      return origin && !allowed.has(origin) ? res.sendStatus(403) : res.sendStatus(204);
    }
    next();
  };
}

export function createAuthMiddleware({
  secret = process.env.COORDINATOR_API_TOKEN ?? process.env.API_SHARED_SECRET,
  service = "coordinator",
  required = false,
} = {}) {
  if (!secret) {
    const mode = required ? "required but not configured" : "disabled";
    console.warn(`[security] ${service} API auth is ${mode}; set COORDINATOR_API_TOKEN or API_SHARED_SECRET`);
  }
  return (req, res, next) => {
    if (!secret) {
      if (required) return res.status(401).json({ error: "unauthorized" });
      return next();
    }
    const auth = String(req.headers.authorization ?? "");
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const supplied = bearer || req.headers["x-api-key"] || req.headers["x-crossed-secret"];
    if (supplied === secret) return next();
    return res.status(401).json({ error: "unauthorized" });
  };
}

function normalizeHex32NoPrefix(value, label) {
  if (typeof value !== "string") throw new Error(`${label} must be 32 bytes of hex`);
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${label} must be 32 bytes of hex`);
  return hex.toLowerCase();
}

function unauthorized(message = "unauthorized") {
  const error = new Error(message);
  error.statusCode = 401;
  return error;
}

function parseTimestamp(value, now, maxAgeMs) {
  if (typeof value !== "string" && typeof value !== "number") {
    throw unauthorized("wallet authorization timestamp is required");
  }
  if (!/^[0-9]+$/.test(String(value))) throw unauthorized("wallet authorization timestamp is invalid");
  let timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) {
    throw unauthorized("wallet authorization timestamp is invalid");
  }
  if (timestamp < 1_000_000_000_000) timestamp *= 1000;
  if (now - timestamp > maxAgeMs || timestamp - now > OWNER_AUTH_FUTURE_SKEW_MS) {
    throw unauthorized("wallet authorization timestamp is expired");
  }
  return String(timestamp);
}

function decodeSignature(value) {
  if (typeof value !== "string" || !value) throw unauthorized("wallet signature is required");
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (/^[0-9a-fA-F]{128}$/.test(hex)) return Buffer.from(hex, "hex");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 64) throw unauthorized("wallet signature is invalid");
  return decoded;
}

function sep53MessageHash(payload) {
  return createHash("sha256")
    .update(Buffer.concat([
      Buffer.from("Stellar Signed Message:\n", "utf8"),
      Buffer.from(payload, "utf8"),
    ]))
    .digest();
}

export function ownerAuthorizationPayload({ action, owner, note, timestamp }) {
  const lines = [
    `domain=${OWNER_AUTH_DOMAIN}`,
    `version=${OWNER_AUTH_VERSION}`,
    `action=${action}`,
    `owner=${owner}`,
  ];
  if (note !== undefined && note !== null) lines.push(`note=${normalizeHex32NoPrefix(note, "note")}`);
  lines.push(`timestamp=${timestamp}`);
  return lines.join("\n");
}

export function requireOwnerAuthorization({
  action,
  owner,
  note,
  timestamp,
  signature,
  now = Date.now(),
  maxAgeMs = OWNER_AUTH_MAX_AGE_MS,
} = {}) {
  if (typeof action !== "string" || !action) throw unauthorized("wallet authorization action is required");
  if (typeof owner !== "string" || !owner) throw unauthorized("owner is required");
  const normalizedNote = note === undefined || note === null ? undefined : normalizeHex32NoPrefix(note, "note");
  const normalizedTimestamp = parseTimestamp(timestamp, now, maxAgeMs);
  const sig = decodeSignature(signature);
  let keypair;
  try {
    keypair = Keypair.fromPublicKey(owner);
  } catch {
    throw unauthorized("owner public key is invalid");
  }
  const payload = ownerAuthorizationPayload({
    action,
    owner,
    note: normalizedNote,
    timestamp: normalizedTimestamp,
  });
  const rawPayload = Buffer.from(payload, "utf8");
  const valid = keypair.verify(rawPayload, sig) || keypair.verify(sep53MessageHash(payload), sig);
  if (!valid) {
    throw unauthorized("wallet signature is invalid");
  }
  return {
    action,
    owner,
    ...(normalizedNote ? { note: normalizedNote } : {}),
    timestamp: normalizedTimestamp,
    payload,
  };
}

export function createRateLimitMiddleware({
  windowMs = numberEnv(process.env.RATE_LIMIT_WINDOW_MS, 60_000),
  max = numberEnv(process.env.RATE_LIMIT_MAX, 120),
  maxIps = numberEnv(process.env.RATE_LIMIT_MAX_IPS, 2048),
} = {}) {
  const buckets = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const ip = req.ip || req.socket?.remoteAddress || "unknown";
    let bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(ip, bucket);
    }
    bucket.count += 1;
    for (const [key, value] of buckets) {
      if (value.resetAt <= now || buckets.size > maxIps) buckets.delete(key);
    }
    if (bucket.count > max) return res.status(429).json({ error: "rate limited" });
    next();
  };
}

export function createExpiringMap({
  max = numberEnv(process.env.STATE_MAX_ENTRIES, 1024),
  ttlMs = numberEnv(process.env.STATE_TTL_MS, 30 * 60_000),
} = {}) {
  const inner = new Map();
  const prune = () => {
    const now = Date.now();
    for (const [key, entry] of inner) {
      if (entry.expiresAt <= now || inner.size > max) inner.delete(key);
    }
  };
  return {
    get(key) {
      prune();
      return inner.get(key)?.value;
    },
    set(key, value) {
      prune();
      inner.set(key, { value, expiresAt: Date.now() + ttlMs });
      prune();
      return this;
    },
    delete(key) {
      return inner.delete(key);
    },
    size() {
      prune();
      return inner.size;
    },
  };
}
