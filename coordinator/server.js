import express from "express";
import { fileURLToPath } from "node:url";

import { createDirectory } from "./directory.js";
import { createMatcher } from "./matcher.js";
import { createJsonStore } from "./store.js";
import {
  createAuthMiddleware,
  createCorsMiddleware,
  createExpiringMap,
  createRateLimitMiddleware,
  requireOwnerAuthorization,
} from "./security.js";

function flagEnv(value) {
  return typeof value === "string" && !/^(|0|false|off|no)$/i.test(value);
}

export async function registerLeaf({ directory, chain, body, persistState = async () => {} }) {
  const entry = await directory.add(body ?? {});
  if (entry.added) {
    await chain.register({
      owner: chain.address,
      pk_x: body.pk_x,
      pk_y: body.pk_y,
      h_sk: body.h_sk,
      leaf: entry.leaf,
    });

    const snapshot = await directory.snapshot();
    await chain.waitForLeafCount(snapshot.count);
    await chain.postRoot({
      root: snapshot.root_hex,
      leaf_count: snapshot.count,
      leaves_digest: snapshot.root_hex,
    });
    await persistState();
  }

  return {
    index: entry.index,
    root_hex: entry.root_hex,
    leaf: entry.leaf,
  };
}

export async function registerDpLeaf({ directory, chain, matcher, body, persistState = async () => {} }) {
  const request = body ?? {};
  if (typeof request.owner !== "string" || !request.owner) throw new Error("owner is required");
  if (typeof request.auth_entry !== "string" || !request.auth_entry) throw new Error("auth_entry is required");

  const prepared = await directory.prepare(request);
  if (prepared.added) {
    await chain.dpRegister(
      {
        owner: request.owner,
        pk_x: request.pk_x,
        pk_y: request.pk_y,
        h_sk: request.h_sk,
        leaf: prepared.leaf,
      },
      request.auth_entry,
    );
    await chain.waitForLeafCount(prepared.count, { dp: true });
    const posted = await chain.dpPostRoot({
      root: prepared.root_hex,
      leaf_count: prepared.count,
      leaves_digest: prepared.root_hex,
    });
    directory.commit(prepared);
    if (posted?.confirmed) matcher?.markRootPosted(prepared.root_hex);
    await persistState();
  } else {
    const existing = directory.get(prepared.leaf);
    if (existing?.owner && existing.owner !== request.owner) {
      throw new Error("leaf is already registered to a different owner");
    }
  }

  return {
    index: prepared.index,
    root_hex: prepared.root_hex,
    leaf: prepared.leaf,
  };
}

export function createApp({
  directory,
  chain,
  matcher = createMatcher({ pairId: chain?.dpPairId, orderV2: flagEnv(process.env.DP_ORDER_V2) }),
  persistState = async () => {},
}) {
  if (!directory) throw new Error("directory is required");
  if (!chain) throw new Error("chain is required");
  if (!matcher) throw new Error("matcher is required");

  const app = express();
  const auth = createAuthMiddleware();
  const requiredAuth = createAuthMiddleware({ required: true });
  const dpOrderV2 = flagEnv(process.env.DP_ORDER_V2);

  app.use(createCorsMiddleware());
  app.use(createRateLimitMiddleware());
  app.use(express.json({ limit: "512kb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      address: chain.address,
      contract: chain.contractId,
      dp_contract: chain.dpContractId,
      dp_pair_id: chain.dpPairId,
      dp_order_v2: dpOrderV2,
      tokenA: chain.tokenA,
      tokenB: chain.tokenB,
    });
  });

  app.get("/auth/check", auth, (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/register", auth, async (req, res) => {
    try {
      res.json(await registerLeaf({ directory, chain, body: req.body, persistState }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/directory", async (_req, res) => {
    try {
      res.json(await directory.snapshot());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/fund", requiredAuth, async (req, res) => {
    try {
      const { account } = req.body ?? {};
      const result = await chain.fund({ account });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/mint", requiredAuth, async (req, res) => {
    try {
      const { account, token, amount } = req.body ?? {};
      const result = await chain.mint({ account, token, amount });
      res.json({ tx: result.tx });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  // Accumulate settle pieces per match_id: the proof bundle (from the side-A prover) + each
  // owner's signed auth entry. Submit once the proof + both distinct owners' entries are present.
  // The coordinator can never forge a signature, so it cannot move funds unilaterally.
  const settlements = createExpiringMap({
    max: Number(process.env.SETTLEMENT_MAX_ENTRIES ?? process.env.STATE_MAX_ENTRIES) || 1024,
    ttlMs: Number(process.env.SETTLEMENT_TTL_MS ?? process.env.STATE_TTL_MS) || 30 * 60_000,
  });
  const normMatch = (m) => String(m || "").replace(/^0x/i, "").toLowerCase();
  const settleState = (s) => ({ submitted: s.submitted, tx: s.tx, have: s.entries.size, hasProof: !!s.args });

  async function handleSettle(s) {
    if (s.submitted || s.submitting) return;
    if (!s.args || s.entries.size < 2) return;
    s.submitting = true;
    try {
      const auth = Array.from(s.entries.values()).slice(0, 2);
      const result = await chain.settle({ args: s.args, auth });
      s.submitted = true;
      s.tx = result.tx;
    } finally {
      s.submitting = false;
    }
  }

  app.post("/settle", requiredAuth, async (req, res) => {
    try {
      const { match_id, owner, auth_entry, args } = req.body ?? {};
      const key = normMatch(match_id);
      if (!/^[0-9a-f]{64}$/.test(key)) throw new Error("match_id must be 32 bytes of hex");
      if (typeof owner !== "string" || !owner) throw new Error("owner is required");
      if (typeof auth_entry !== "string" || !auth_entry) throw new Error("auth_entry is required");

      let s = settlements.get(key);
      if (!s) { s = { args: null, entries: new Map(), submitting: false, submitted: false, tx: null }; }
      if (args && !s.args) s.args = args; // proof bundle from the side-A prover
      s.entries.set(owner, auth_entry);
      settlements.set(key, s);

      await handleSettle(s);
      settlements.set(key, s);
      res.json(settleState(s));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/settle/:match_id", (req, res) => {
    const s = settlements.get(normMatch(req.params.match_id));
    res.json(s ? settleState(s) : { submitted: false, have: 0, hasProof: false });
  });

  // Dark-pool registration: owner = the TRADER (not the coordinator), so settle_dp_match can
  // resolve each trader's escrow via owner_by_leaf. The trader signs an auth entry for
  // register(owner, ...); the coordinator (source) co-authorizes and posts the new root.
  app.post("/dp/register", auth, async (req, res) => {
    try {
      res.json(await registerDpLeaf({ directory, chain, matcher, body: req.body, persistState }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/dp/order", auth, async (req, res) => {
    try {
      res.json(await matcher.submitOrder(chain, directory, req.body, { orderV2: dpOrderV2 }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/dp/cancel", requiredAuth, async (req, res) => {
    try {
      if (req.body?.onchain_cancelled === true) {
        if (typeof chain.isOrderOpen !== "function") throw new Error("on-chain order status is unavailable");
        if (await chain.isOrderOpen(req.body?.note)) {
          return res.status(409).json({ error: "order is still open on-chain" });
        }
      } else {
        requireOwnerAuthorization({
          action: "dp_cancel",
          owner: req.body?.owner,
          note: req.body?.note,
          timestamp: req.body?.timestamp,
          signature: req.body?.signature ?? req.body?.wallet_signature,
        });
      }
      res.json(await matcher.cancelOrder(chain, directory, req.body));
    } catch (error) {
      res.status(error.statusCode ?? 400).json({ error: error.message });
    }
  });

  app.post("/dp/close", requiredAuth, async (_req, res) => {
    try {
      res.json(await matcher.closeBatch(chain, directory, { orderV2: dpOrderV2 }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/dp/batch", (_req, res) => {
    res.json(matcher.batch());
  });

  app.get("/dp/fills/:owner", requiredAuth, (req, res) => {
    try {
      // Bearer auth is coordinator-level only; each fills lookup also proves control of :owner.
      requireOwnerAuthorization({
        action: "dp_fills",
        owner: req.params.owner,
        timestamp: req.query.timestamp ?? req.headers["x-crossed-wallet-timestamp"],
        signature: req.query.signature ?? req.headers["x-crossed-wallet-signature"],
      });
      res.json({ fills: matcher.fillsFor(req.params.owner) });
    } catch (error) {
      res.status(error.statusCode ?? 400).json({ error: error.message });
    }
  });

  app.get("/dp/activity/:owner", requiredAuth, (req, res) => {
    try {
      requireOwnerAuthorization({
        action: "dp_activity",
        owner: req.params.owner,
        timestamp: req.query.timestamp ?? req.headers["x-crossed-wallet-timestamp"],
        signature: req.query.signature ?? req.headers["x-crossed-wallet-signature"],
      });
      res.json({
        orders: typeof matcher.ordersFor === "function" ? matcher.ordersFor(req.params.owner) : [],
        fills: matcher.fillsFor(req.params.owner),
      });
    } catch (error) {
      res.status(error.statusCode ?? 400).json({ error: error.message });
    }
  });

  return app;
}

export async function main() {
  const [{ createChainFromEnv }, directory] = await Promise.all([
    import("./chain.js"),
    createDirectory(),
  ]);
  const chain = createChainFromEnv();
  const store = createJsonStore({ contractId: chain.dpContractId });
  const persisted = await store.load();
  for (const reg of persisted.registrations) await directory.add(reg);
  if (persisted.registrations.length > 0) {
    console.log(`Loaded ${persisted.registrations.length} registration(s) from ${store.statePath}`);
  }

  // Rebuild the in-memory directory from on-chain registrations so leaf_count + root
  // stay consistent with the persistent contract state across coordinator restarts.
  let startupRoot = null;
  try {
    const regs = await chain.getRegistrations();
    for (const reg of regs) await directory.add(reg);
    console.log(`Synced ${regs.length} registration(s) from chain (leaf_count=${directory.count()})`);
    // Ensure the on-chain accepted root matches the rebuilt directory so submit_intent accepts it.
    if (directory.count() > 0) {
      const snap = await directory.snapshot();
      const posted = await chain.postRoot({ root: snap.root_hex, leaf_count: snap.count, leaves_digest: snap.root_hex });
      console.log(`Posted directory root ${snap.root_hex} (leaf_count=${snap.count})`);
      if (posted?.confirmed) startupRoot = snap.root_hex;
    }
  } catch (error) {
    console.error("Directory sync from chain failed:", error.message);
  }

  let matcher;
  const persistState = async () => store.save({ directory, matcher });
  matcher = createMatcher({
    pairId: chain.dpPairId,
    orderV2: flagEnv(process.env.DP_ORDER_V2),
    initialState: persisted,
    onChange: persistState,
    onDecision: (decision) => store.appendDecision(decision),
  });
  matcher.markRootPosted(startupRoot); // skip a redundant first-order root re-post
  await persistState();
  const app = createApp({ directory, chain, matcher, persistState });
  const port = Number(process.env.PORT ?? 8790);
  const host = process.env.HOST ?? "127.0.0.1";
  const batchMs = Number(process.env.DP_BATCH_MS ?? 0);
  if (Number.isFinite(batchMs) && batchMs > 0) {
    setInterval(() => {
      matcher.closeBatch(chain, directory, { orderV2: flagEnv(process.env.DP_ORDER_V2) }).catch((error) => {
        console.error("Dark-pool auto-close failed:", error.message);
      });
    }, batchMs).unref();
  }

  app.listen(port, host, () => {
    console.log(`Crossed OTC coordinator listening on http://${host}:${port}`);
    console.log(`Coordinator address: ${chain.address}`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
