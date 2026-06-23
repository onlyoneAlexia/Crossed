import { buildTreeFromLeaves, be32, orderCommitment, proveMatch } from "./darkpool.js";
import { normalizeHex32 } from "./directory.js";
import { VALID_PAIR_IDS } from "./tokens.js";

function decimal(value, label) {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) return value;
  throw new Error(`${label} must be a decimal integer`);
}

function sideValue(value) {
  if (value === 0 || value === "0" || value === "sell" || value === "SELL") return 0;
  if (value === 1 || value === "1" || value === "buy" || value === "BUY") return 1;
  throw new Error("side must be 0/sell or 1/buy");
}

function requireOwner(owner) {
  if (typeof owner !== "string" || owner.length === 0) throw new Error("owner is required");
  return owner;
}

function hex32NoPrefix(value, label) {
  return normalizeHex32(value, label).slice(2);
}

function requireProof(proof) {
  if (!proof || typeof proof !== "object") throw new Error("proof is required");
  for (const key of ["a", "b", "c"]) {
    if (typeof proof[key] !== "string" || !/^[0-9a-fA-F]+$/.test(proof[key])) {
      throw new Error(`proof.${key} must be hex`);
    }
  }
  return { a: proof.a.toLowerCase(), b: proof.b.toLowerCase(), c: proof.c.toLowerCase() };
}

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function treeFromDirectory(directory) {
  const snapshot = await directory.snapshot();
  const tree = await buildTreeFromLeaves(snapshot.leaves);
  return { snapshot, tree };
}

async function ensureRootAccepted(chain, directory, postedRoots) {
  const snapshot = await directory.snapshot();
  if (!postedRoots.has(snapshot.root_hex)) {
    await chain.dpPostRoot({
      root: snapshot.root_hex,
      leaf_count: snapshot.count,
      leaves_digest: snapshot.root_hex,
    });
    postedRoots.add(snapshot.root_hex);
  }
}

export function createMatcher({
  pairId = 1,
  validPairs = VALID_PAIR_IDS,
  proveMatchFn = proveMatch,
  minBatchOrders = numberEnv(process.env.DP_MIN_BATCH_ORDERS, 2),
  maxOrders = numberEnv(process.env.DP_MAX_ORDERS, 512),
  maxFills = numberEnv(process.env.DP_MAX_FILLS, 512),
  ttlMs = numberEnv(process.env.DP_STATE_TTL_MS, 60 * 60_000),
} = {}) {
  let closing = null;
  const state = {
    currentBatchId: 1n,
    orders: [],
    fills: [],
    postedRoots: new Set(),
  };

  function batchIdString() {
    return state.currentBatchId.toString();
  }

  function pruneState() {
    const cutoff = Date.now() - ttlMs;
    state.orders = state.orders
      .filter((order) => !(order.filled || order.cancelled) || (order._updatedAt ?? order._createdAt ?? 0) >= cutoff)
      .slice(-maxOrders);
    state.fills = state.fills
      .filter((fill) => (fill._createdAt ?? 0) >= cutoff)
      .slice(-maxFills);
  }

  function publicOrder(order) {
    return {
      owner: order.owner,
      side: order.side,
      size: order.size,
      limit_price: order.limit_price,
      note: order.note,
      nf_order: order.nf_order,
      batch_id: order.batch_id,
      placed: order.placed,
      filled: order.filled,
      cancelled: order.cancelled === true,
      base_amount: order.base_amount,
      quote_amount: order.quote_amount,
    };
  }

  function publicFill(fill) {
    const { _createdAt, ...rest } = fill;
    return rest;
  }

  const matcher = {
    state,
    // Let the server seed already-posted roots so the first order doesn't redundantly re-post one.
    markRootPosted(rootHex) { if (rootHex) state.postedRoots.add(rootHex); },

    batch() {
      pruneState();
      return {
        batch_id: batchIdString(),
        open_count: state.orders.filter((order) => order.batch_id === batchIdString() && order.placed && !order.filled && !order.cancelled).length,
      };
    },

    async submitOrder(chain, directory, body = {}) {
      pruneState();
      if (Object.hasOwn(body, "sk")) {
        throw new Error("identity secret must not be submitted to the coordinator");
      }
      const owner = requireOwner(body.owner);
      const side = sideValue(body.side);
      const size = decimal(body.size, "size");
      const limit_price = decimal(body.limit_price, "limit_price");
      const salt = decimal(body.salt, "salt");
      const resolvedPairId = Number(body.pair_id ?? chain.dpPairId ?? pairId);
      if (!Number.isSafeInteger(resolvedPairId) || resolvedPairId < 1) {
        throw new Error("pair_id must be a positive integer");
      }
      if (validPairs && !validPairs.has(resolvedPairId)) {
        throw new Error(`pair_id ${resolvedPairId} is not a configured pair`);
      }
      const leaf = hex32NoPrefix(body.leaf, "leaf");
      const proof = requireProof(body.proof);
      const note = hex32NoPrefix(body.note, "note");
      const nf_order = hex32NoPrefix(body.nf_order, "nf_order");
      const root = hex32NoPrefix(body.root, "root");
      const deposit_token = (typeof body.deposit_token === "string" && body.deposit_token) ? body.deposit_token : null;
      const deposit_amount = deposit_token ? decimal(body.deposit_amount ?? "0", "deposit_amount") : "0";
      const authEntry = (typeof body.auth_entry === "string" && body.auth_entry) ? body.auth_entry : null;
      const batch_id = batchIdString();

      const registered = directory.get(`0x${leaf}`);
      if (!registered?.owner) throw new Error("registered leaf owner is missing");
      if (registered.owner !== owner) throw new Error("submitted owner does not match registered owner for leaf");

      await ensureRootAccepted(chain, directory, state.postedRoots);
      const fresh = await treeFromDirectory(directory);
      if (`0x${root}` !== fresh.snapshot.root_hex) {
        throw new Error("order root is stale; refresh the directory before submitting");
      }
      const expected = await orderCommitment({
        leaf,
        side,
        size,
        limit_price,
        salt,
        pair_id: resolvedPairId,
        batch_id,
      });
      if (expected.note !== note) throw new Error("order note does not match submitted opening");
      if (expected.nf_order !== nf_order) throw new Error("order nullifier does not match submitted opening");

      // Combined deposit+place (FE path) when a deposit token is supplied; else plain place_order
      // (pre-funded escrow / separate-deposit e2e path). deposit_amount "0" skips the on-chain deposit.
      const orderProof = { proof, note, nf_order, pair_id: resolvedPairId, batch_id, root };
      const placed = deposit_token
        ? await chain.dpDepositAndPlaceOrder({ owner, deposit_token, deposit_amount, ...orderProof }, authEntry)
        : await chain.placeOrder(orderProof);
      const order = {
        owner,
        side,
        size,
        limit_price,
        salt,
        leaf,
        pair_id: resolvedPairId,
        batch_id,
        note,
        nf_order,
        root,
        placed: true,
        filled: false,
        cancelled: false,
        base_amount: null,
        quote_amount: null,
        tx: placed.tx,
        _createdAt: Date.now(),
        _updatedAt: Date.now(),
      };
      state.orders.push(order);
      pruneState();
      return { note: order.note, nf_order: order.nf_order, batch_id, tx: placed.tx };
    },

    async cancelOrder(_chain, _directory, body = {}) {
      pruneState();
      const owner = requireOwner(body.owner);
      const note = hex32NoPrefix(body.note, "note");
      const order = state.orders.find((candidate) => (
        candidate.owner === owner
        && candidate.note === note
        && candidate.placed
        && !candidate.filled
        && !candidate.cancelled
      ));
      if (!order) throw new Error("open order not found for owner");
      order.cancelled = true;
      order._updatedAt = Date.now();
      pruneState();
      return { note, cancelled: true };
    },

    async closeBatch(chain, directory) {
      if (closing) return closing;
      closing = matcher.closeBatchUnlocked(chain, directory).finally(() => {
        closing = null;
      });
      return closing;
    },

    async closeBatchUnlocked(chain, directory) {
      pruneState();
      const batch_id = batchIdString();
      await ensureRootAccepted(chain, directory, state.postedRoots);
      const { tree } = await treeFromDirectory(directory);
      const fills = [];
      const open = () => state.orders.filter((order) => order.batch_id === batch_id && order.placed && !order.filled && !order.cancelled);
      const openCount = open().length;
      if (openCount < minBatchOrders) {
        return { batch_id, fills, pending: true, open_count: openCount, min_open_count: minBatchOrders };
      }
      const skippedPairs = new Set();
      const orderKey = (sell, buy) => `${state.orders.indexOf(sell)}:${state.orders.indexOf(buy)}`;

      let matched = true;
      while (matched) {
        matched = false;
        const orders = open();
        for (const sell of orders.filter((order) => order.side === 0)) {
          const buys = orders.filter((order) => (
            order.side === 1
            && !order.filled
            && order.pair_id === sell.pair_id
            && order.size === sell.size
            && BigInt(sell.limit_price) <= BigInt(order.limit_price)
          ));
          if (buys.length === 0) continue;

          for (const buy of buys) {
            const key = orderKey(sell, buy);
            if (skippedPairs.has(key)) continue;
            try {
              const proof = await proveMatchFn({
                sell,
                buy,
                pair_id: sell.pair_id,
                batch_id,
                tree,
              });
              const settleArgs = { ...proof, pair_id: sell.pair_id, batch_id, root: be32(tree.root) };
              const settled = await chain.settleDpMatch(settleArgs);
              sell.filled = true;
              buy.filled = true;
              sell._updatedAt = Date.now();
              buy._updatedAt = Date.now();
              sell.base_amount = proof.base_amount;
              sell.quote_amount = proof.quote_amount;
              buy.base_amount = proof.base_amount;
              buy.quote_amount = proof.quote_amount;
              const fill = {
                match_id: proof.match_id,
                batch_id,
                pair_id: sell.pair_id,
                sell_owner: sell.owner,
                buy_owner: buy.owner,
                note_sell: proof.note_sell,
                note_buy: proof.note_buy,
                base_amount: proof.base_amount,
                quote_amount: proof.quote_amount,
                tx: settled.tx,
                _createdAt: Date.now(),
              };
              state.fills.push(fill);
              fills.push(publicFill(fill));
              matched = true;
              break;
            } catch (error) {
              skippedPairs.add(key);
            }
          }
          if (matched) break;
        }
      }

      // Only advance the batch once it's fully cleared. Leftover unmatched orders MUST stay in this
      // same batch (their proofs bind this batch_id and can't be re-batched), so a later crossing
      // order can still match them — otherwise they'd be stranded in a closed batch forever.
      if (open().length === 0) state.currentBatchId += 1n;
      pruneState();
      return { batch_id, fills };
    },

    fillsFor(owner) {
      pruneState();
      requireOwner(owner);
      return state.fills
        .filter((fill) => fill.sell_owner === owner || fill.buy_owner === owner)
        .map(publicFill);
    },

    orders() {
      pruneState();
      return state.orders.map(publicOrder);
    },
  };
  return matcher;
}
