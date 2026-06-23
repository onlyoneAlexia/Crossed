import express from "express";
import { fileURLToPath } from "node:url";

import { createDirectory } from "./directory.js";
import { createMatcher } from "./matcher.js";
import {
  createAuthMiddleware,
  createCorsMiddleware,
  createExpiringMap,
  createRateLimitMiddleware,
} from "./security.js";

export async function registerLeaf({ directory, chain, body }) {
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
  }

  return {
    index: entry.index,
    root_hex: entry.root_hex,
    leaf: entry.leaf,
  };
}

export async function registerDpLeaf({ directory, chain, matcher, body }) {
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

export function createApp({ directory, chain, matcher = createMatcher({ pairId: chain?.dpPairId }) }) {
  if (!directory) throw new Error("directory is required");
  if (!chain) throw new Error("chain is required");
  if (!matcher) throw new Error("matcher is required");

  const app = express();
  const auth = createAuthMiddleware();

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
      tokenA: chain.tokenA,
      tokenB: chain.tokenB,
    });
  });

  app.post("/register", auth, async (req, res) => {
    try {
      res.json(await registerLeaf({ directory, chain, body: req.body }));
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

  app.post("/fund", auth, async (req, res) => {
    try {
      const { account } = req.body ?? {};
      const result = await chain.fund({ account });
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/mint", auth, async (req, res) => {
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

  app.post("/settle", auth, async (req, res) => {
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
      res.json(await registerDpLeaf({ directory, chain, matcher, body: req.body }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/dp/order", auth, async (req, res) => {
    try {
      res.json(await matcher.submitOrder(chain, directory, req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/dp/cancel", auth, async (req, res) => {
    try {
      res.json(await matcher.cancelOrder(chain, directory, req.body));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/dp/close", auth, async (_req, res) => {
    try {
      res.json(await matcher.closeBatch(chain, directory));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/dp/batch", (_req, res) => {
    res.json(matcher.batch());
  });

  app.get("/dp/fills/:owner", auth, (req, res) => {
    try {
      res.json({ fills: matcher.fillsFor(req.params.owner) });
    } catch (error) {
      res.status(400).json({ error: error.message });
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

  const matcher = createMatcher({ pairId: chain.dpPairId });
  matcher.markRootPosted(startupRoot); // skip a redundant first-order root re-post
  const app = createApp({ directory, chain, matcher });
  const port = Number(process.env.PORT ?? 8790);
  const host = process.env.HOST ?? "127.0.0.1";
  const batchMs = Number(process.env.DP_BATCH_MS ?? 0);
  if (Number.isFinite(batchMs) && batchMs > 0) {
    setInterval(() => {
      matcher.closeBatch(chain, directory).catch((error) => {
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
