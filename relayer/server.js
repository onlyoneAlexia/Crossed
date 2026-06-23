import express from "express";
import { createRpcReceiptValidator, createStore } from "./store.js";
import { createAuthMiddleware, createCorsMiddleware, createRateLimitMiddleware } from "./security.js";

const app = express();
const store = createStore({ validateReceipt: createRpcReceiptValidator() });
const port = Number(process.env.PORT ?? 8787);
const auth = createAuthMiddleware();

app.use(createCorsMiddleware());
app.use(createRateLimitMiddleware());

app.use(express.json({ limit: "256kb" }));

// --- receipt-gated rendezvous matching (no equality-test/lookup API) ---
app.post("/intent", auth, async (req, res) => {
  try {
    const result = await store.submitIntent(req.body);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/poll/:inbox", (req, res) => {
  try { res.json(store.poll(req.params.inbox)); }
  catch (error) { res.status(400).json({ error: error.message }); }
});

// --- profile directory (handle <-> public key). pk is public; only who-likes-whom is private. ---
const profiles = new Map(); // index -> profile
const profileMax = Number(process.env.PROFILE_MAX_ENTRIES) || 1024;
const profileTtlMs = Number(process.env.PROFILE_TTL_MS) || 30 * 60_000;
function pruneProfiles() {
  const cutoff = Date.now() - profileTtlMs;
  for (const [index, profile] of profiles) {
    if ((profile._createdAt ?? 0) < cutoff || profiles.size > profileMax) profiles.delete(index);
  }
}
function publicProfile(profile) {
  const { _createdAt, ...rest } = profile;
  return rest;
}
app.post("/profile", auth, (req, res) => {
  pruneProfiles();
  const p = req.body || {};
  if (p.index === undefined || !p.pk_x || !p.pk_y || !p.h_sk) return res.status(400).json({ error: "bad profile" });
  profiles.set(Number(p.index), {
    handle: String(p.handle ?? `user-${p.index}`),
    index: Number(p.index),
    pk_x: p.pk_x,
    pk_y: p.pk_y,
    h_sk: p.h_sk,
    _createdAt: Date.now(),
  });
  pruneProfiles();
  res.sendStatus(200);
});
app.get("/profiles", (_req, res) => {
  pruneProfiles();
  res.json([...profiles.values()].map(publicProfile).sort((a, b) => a.index - b.index));
});

app.listen(port, "127.0.0.1", () => {
  console.log(`Crossed relayer listening on http://127.0.0.1:${port}`);
});
