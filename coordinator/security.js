const DEFAULT_CORS_ORIGINS = "http://127.0.0.1:5173,http://localhost:5173";

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
    res.header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-API-Key,X-Crossed-Secret");
    if (req.method === "OPTIONS") {
      return origin && !allowed.has(origin) ? res.sendStatus(403) : res.sendStatus(204);
    }
    next();
  };
}

export function createAuthMiddleware({
  secret = process.env.COORDINATOR_API_TOKEN ?? process.env.API_SHARED_SECRET,
  service = "coordinator",
} = {}) {
  if (!secret) {
    console.warn(`[security] ${service} API auth is disabled; set COORDINATOR_API_TOKEN or API_SHARED_SECRET`);
  }
  return (req, res, next) => {
    if (!secret) return next();
    const auth = String(req.headers.authorization ?? "");
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const supplied = bearer || req.headers["x-api-key"] || req.headers["x-crossed-secret"];
    if (supplied === secret) return next();
    return res.status(401).json({ error: "unauthorized" });
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
