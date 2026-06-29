import { randomBytes } from "node:crypto";

import { buildTreeFromLeaves, be32, orderCommitment, orderCommitmentV2, proveMatch, proveMatchV2, proveMatchV3 } from "./darkpool.js";
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

function flagEnv(value) {
  return typeof value === "string" && !/^(|0|false|off|no)$/i.test(value);
}

function randomFieldDecimal() {
  return BigInt(`0x${randomBytes(31).toString("hex")}`).toString();
}

function minDecimal(a, b) {
  const aN = BigInt(a);
  const bN = BigInt(b);
  return (aN < bN ? aN : bN).toString();
}

function maxBigInt(...values) {
  return values.reduce((max, value) => {
    const n = BigInt(value);
    return n > max ? n : max;
  }, 0n);
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
  orderV2 = flagEnv(process.env.DP_ORDER_V2),
  matchV3 = process.env.DP_MATCH_V3 === undefined ? true : flagEnv(process.env.DP_MATCH_V3),
  proveMatchFn = null,
  minBatchOrders = numberEnv(process.env.DP_MIN_BATCH_ORDERS, 2),
  maxOrders = numberEnv(process.env.DP_MAX_ORDERS, 512),
  maxFills = numberEnv(process.env.DP_MAX_FILLS, 512),
  ttlMs = numberEnv(process.env.DP_STATE_TTL_MS, 60 * 60_000),
  initialState = null,
  onChange = async () => {},
  onDecision = async () => {},
} = {}) {
  let closing = null;
  const state = {
    currentBatchId: BigInt(initialState?.currentBatchId ?? 1),
    orders: Array.isArray(initialState?.orders) ? initialState.orders.map((order) => ({ ...order })) : [],
    fills: Array.isArray(initialState?.fills) ? initialState.fills.map((fill) => ({ ...fill })) : [],
    postedRoots: new Set(Array.isArray(initialState?.postedRoots) ? initialState.postedRoots : []),
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
      ...(Object.hasOwn(order, "expiry") ? { expiry: order.expiry, maq: order.maq, tier: order.tier } : {}),
      ...(order.tif ? { tif: order.tif } : {}),
      placed: order.placed,
      filled: order.filled,
      cancelled: order.cancelled === true,
      base_amount: order.base_amount,
      quote_amount: order.quote_amount,
    };
  }

  function ownerOrder(order) {
    return {
      ...publicOrder(order),
      pair_id: order.pair_id,
      salt: order.salt,
      tx: order.tx,
    };
  }

  function publicFill(fill) {
    const { _createdAt, ...rest } = fill;
    return {
      ...rest,
      ...residualFieldsFromOpenOrder(fill, "sell"),
      ...residualFieldsFromOpenOrder(fill, "buy"),
    };
  }

  function snapshotOrder(order) {
    return { ...order };
  }

  function snapshotFill(fill) {
    return { ...fill };
  }

  function snapshot() {
    return {
      currentBatchId: batchIdString(),
      orders: state.orders
        .filter((order) => order.placed && !order.filled && !order.cancelled)
        .map(snapshotOrder),
      fills: state.fills.map(snapshotFill),
      postedRoots: Array.from(state.postedRoots),
    };
  }

  async function notifyChange() {
    await onChange(snapshot());
  }

  function decisionOrder(order) {
    return {
      owner: order.owner,
      side: order.side,
      size: order.size,
      limit_price: order.limit_price,
      pair_id: order.pair_id,
      batch_id: order.batch_id,
      ...(Object.hasOwn(order, "expiry") ? { expiry: order.expiry, maq: order.maq, tier: order.tier } : {}),
      ...(order.tif ? { tif: order.tif } : {}),
      note: order.note,
      nf_order: order.nf_order,
    };
  }

  function decisionFill(fill) {
    return {
      match_id: fill.match_id,
      sell_owner: fill.sell_owner,
      buy_owner: fill.buy_owner,
      note_sell: fill.note_sell,
      note_buy: fill.note_buy,
      base_amount: fill.base_amount,
      quote_amount: fill.quote_amount,
      ...(fill.fill_base ? { fill_base: fill.fill_base } : {}),
      ...(fill.fill_quote ? { fill_quote: fill.fill_quote } : {}),
      ...(fill.change_note_sell ? { change_note_sell: fill.change_note_sell, residual_sell: fill.residual_sell } : {}),
      ...(fill.change_note_buy ? { change_note_buy: fill.change_note_buy, residual_buy: fill.residual_buy } : {}),
      tx: fill.tx,
    };
  }

  function residualFields(side, change) {
    if (!change) return {};
    const size = decimal(change.size ?? "0", `${side} residual size`);
    if (BigInt(size) === 0n) return {};
    const suffix = side === "sell" ? "sell" : "buy";
    const fields = {
      [`change_note_${suffix}`]: hex32NoPrefix(change.note, `change.${suffix}.note`),
      [`residual_${suffix}`]: size,
    };
    if (change.change_salt !== undefined || change.salt !== undefined) {
      fields[`change_salt_${suffix}`] = decimal(change.change_salt ?? change.salt, `change_salt_${suffix}`);
    }
    return fields;
  }

  function residualFieldsFromOpenOrder(fill, side) {
    const suffix = side === "sell" ? "sell" : "buy";
    if (fill[`change_note_${suffix}`]) return {};
    const owner = side === "sell" ? fill.sell_owner : fill.buy_owner;
    const expectedSide = side === "sell" ? 0 : 1;
    const residual = state.orders.find((order) => (
      order.owner === owner
      && order.side === expectedSide
      && order.pair_id === fill.pair_id
      && order.batch_id === fill.batch_id
      && order.tx === fill.tx
      && order.placed
      && !order.filled
      && !order.cancelled
    ));
    if (!residual) return {};
    return {
      [`change_note_${suffix}`]: residual.note,
      [`residual_${suffix}`]: residual.size,
      ...(residual.salt !== undefined ? { [`change_salt_${suffix}`]: residual.salt } : {}),
    };
  }

  const matcher = {
    state,
    snapshot,
    // Let the server seed already-posted roots so the first order doesn't redundantly re-post one.
    markRootPosted(rootHex) { if (rootHex) state.postedRoots.add(rootHex); },

    batch() {
      pruneState();
      return {
        batch_id: batchIdString(),
        open_count: state.orders.filter((order) => order.batch_id === batchIdString() && order.placed && !order.filled && !order.cancelled).length,
        min_open_count: minBatchOrders,
      };
    },

    async submitOrder(chain, directory, body = {}, options = {}) {
      pruneState();
      const useOrderV2 = options.orderV2 ?? orderV2;
      const useMatchV3 = options.matchV3 ?? matchV3;
      const useV2Opening = useOrderV2 || useMatchV3;
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
      const expiry = useV2Opening ? decimal(body.expiry, "expiry") : undefined;
      const maq = useV2Opening ? decimal(body.maq, "maq") : undefined;
      const tier = useV2Opening ? decimal(body.tier, "tier") : undefined;
      const tif = useV2Opening && ["GTT", "DAY", "IOC"].includes(body.tif) ? body.tif : undefined;

      const registered = directory.get(`0x${leaf}`);
      if (!registered?.owner) throw new Error("registered leaf owner is missing");
      if (registered.owner !== owner) throw new Error("submitted owner does not match registered owner for leaf");

      await ensureRootAccepted(chain, directory, state.postedRoots);
      const fresh = await treeFromDirectory(directory);
      if (`0x${root}` !== fresh.snapshot.root_hex) {
        throw new Error("order root is stale; refresh the directory before submitting");
      }
      const expected = useV2Opening
        ? await orderCommitmentV2({
          leaf,
          side,
          size,
          limit_price,
          salt,
          pair_id: resolvedPairId,
          batch_id,
          expiry,
          maq,
          tier,
        })
        : await orderCommitment({
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
      if (useV2Opening) {
        if (deposit_token) throw new Error("v2 orders require a separate deposit before place_order_v2");
        orderProof.expiry = expected.expiry;
        orderProof.maq = expected.maq;
        orderProof.tier = expected.tier;
      }
      const placed = useV2Opening
        ? await chain.placeOrderV2(orderProof)
        : deposit_token
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
        ...(useV2Opening ? { expiry: expected.expiry, maq: expected.maq, tier: expected.tier } : {}),
        ...(tif ? { tif } : {}),
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
      await notifyChange();
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
      await notifyChange();
      return { note, cancelled: true };
    },

    async closeBatch(chain, directory, options = {}) {
      if (closing) return closing;
      closing = matcher.closeBatchUnlocked(chain, directory, options).finally(() => {
        closing = null;
      });
      return closing;
    },

    async closeBatchUnlocked(chain, directory, options = {}) {
      pruneState();
      const useMatchV3 = options.matchV3 ?? matchV3;
      const useOrderV2 = (options.orderV2 ?? orderV2) || useMatchV3;
      const selectedProveMatchFn = proveMatchFn ?? (useMatchV3 ? proveMatchV3 : useOrderV2 ? proveMatchV2 : proveMatch);
      const batch_id = batchIdString();
      await ensureRootAccepted(chain, directory, state.postedRoots);
      const { tree } = await treeFromDirectory(directory);
      const fills = [];
      const open = () => state.orders.filter((order) => order.batch_id === batch_id && order.placed && !order.filled && !order.cancelled);
      const dropUnmatchedIoc = () => {
        let dropped = 0;
        for (const order of open()) {
          if (order.tif !== "IOC") continue;
          order.cancelled = true;
          order._updatedAt = Date.now();
          dropped += 1;
        }
        return dropped;
      };
      const openCount = open().length;
      if (openCount < minBatchOrders) {
        const dropped = dropUnmatchedIoc();
        const remaining = open().length;
        if (dropped > 0) {
          if (remaining === 0) state.currentBatchId += 1n;
          pruneState();
          await notifyChange();
        }
        return { batch_id, fills, pending: remaining > 0, open_count: remaining, min_open_count: minBatchOrders };
      }
      const considered = open().map(decisionOrder);
      const skippedPairs = new Set();
      const orderKey = (sell, buy) => `${state.orders.indexOf(sell)}:${state.orders.indexOf(buy)}`;
      const assignedTierCache = new Map();
      const assignedTierOf = async (order) => {
        const key = order.leaf;
        if (assignedTierCache.has(key)) return assignedTierCache.get(key);
        let tier = "0";
        if (typeof chain?.tier_of === "function") {
          try {
            tier = decimal(await chain.tier_of(`0x${order.leaf}`), "assigned tier");
          } catch {
            tier = "0";
          }
        }
        assignedTierCache.set(key, tier);
        return tier;
      };
      const addChangeOrder = (original, change, settledTx) => {
        if (!change || BigInt(change.size ?? "0") === 0n) return;
        state.orders.push({
          owner: original.owner,
          side: original.side,
          size: change.size,
          limit_price: original.limit_price,
          salt: change.change_salt,
          leaf: original.leaf,
          pair_id: original.pair_id,
          batch_id: original.batch_id,
          note: hex32NoPrefix(change.note, "change.note"),
          nf_order: hex32NoPrefix(change.nf_order, "change.nf_order"),
          root: be32(tree.root),
          expiry: original.expiry,
          maq: original.maq,
          tier: original.tier,
          ...(original.tif ? { tif: original.tif } : {}),
          placed: true,
          filled: false,
          cancelled: false,
          base_amount: null,
          quote_amount: null,
          tx: settledTx,
          _createdAt: Date.now(),
          _updatedAt: Date.now(),
        });
      };

      let matched = true;
      while (matched) {
        matched = false;
        const orders = open();
        for (const sell of orders.filter((order) => order.side === 0)) {
          const buys = orders.filter((order) => (
            order.side === 1
            && !order.filled
            && order.pair_id === sell.pair_id
            && (useMatchV3 || order.size === sell.size)
            && BigInt(sell.limit_price) <= BigInt(order.limit_price)
          ));
          if (buys.length === 0) continue;

          for (const buy of buys) {
            const key = orderKey(sell, buy);
            if (skippedPairs.has(key)) continue;
            try {
              const matchParams = {
                sell,
                buy,
                pair_id: sell.pair_id,
                batch_id,
                tree,
              };
              let assignedTierSell = "0";
              let assignedTierBuy = "0";
              if (useMatchV3) {
                const fill_base = minDecimal(sell.size, buy.size);
                if (BigInt(fill_base) < maxBigInt(sell.maq, buy.maq)) continue;
                assignedTierSell = await assignedTierOf(sell);
                assignedTierBuy = await assignedTierOf(buy);
                if (BigInt(assignedTierSell) < BigInt(buy.tier) || BigInt(assignedTierBuy) < BigInt(sell.tier)) continue;
                const sum = BigInt(sell.limit_price) + BigInt(buy.limit_price);
                matchParams.cross_price = (sum / 2n).toString();
                matchParams.fill_base = fill_base;
                matchParams.change_salt_sell = randomFieldDecimal();
                matchParams.change_salt_buy = randomFieldDecimal();
                matchParams.assigned_tier_sell = assignedTierSell;
                matchParams.assigned_tier_buy = assignedTierBuy;
              }
              const proof = await selectedProveMatchFn({
                ...matchParams,
              });
              const settleArgs = useMatchV3
                ? {
                  proof: proof.proof,
                  match_id: proof.match_id,
                  note_sell: proof.note_sell,
                  note_buy: proof.note_buy,
                  nf_sell: proof.nf_sell,
                  nf_buy: proof.nf_buy,
                  leaf_sell: proof.leaf_sell,
                  leaf_buy: proof.leaf_buy,
                  fill_base: proof.fill_base ?? proof.base_amount,
                  fill_quote: proof.fill_quote ?? proof.quote_amount,
                  change_note_sell: proof.change_note_sell,
                  change_note_buy: proof.change_note_buy,
                  assigned_tier_sell: proof.assigned_tier_sell ?? assignedTierSell,
                  assigned_tier_buy: proof.assigned_tier_buy ?? assignedTierBuy,
                  pair_id: sell.pair_id,
                  batch_id,
                  root: be32(tree.root),
                }
                : useOrderV2
                ? {
                  proof: proof.proof,
                  match_id: proof.match_id,
                  note_sell: proof.note_sell,
                  note_buy: proof.note_buy,
                  nf_sell: proof.nf_sell,
                  nf_buy: proof.nf_buy,
                  leaf_sell: proof.leaf_sell,
                  leaf_buy: proof.leaf_buy,
                  fill_base: proof.fill_base ?? proof.base_amount,
                  fill_quote: proof.fill_quote ?? proof.quote_amount,
                  pair_id: sell.pair_id,
                  batch_id,
                  root: be32(tree.root),
                }
                : { ...proof, pair_id: sell.pair_id, batch_id, root: be32(tree.root) };
              const settled = useMatchV3
                ? await chain.settleDpMatchV3(settleArgs)
                : useOrderV2
                ? await chain.settleDpMatchV2(settleArgs)
                : await chain.settleDpMatch(settleArgs);
              sell.filled = true;
              buy.filled = true;
              sell._updatedAt = Date.now();
              buy._updatedAt = Date.now();
              sell.base_amount = proof.base_amount;
              sell.quote_amount = proof.quote_amount;
              buy.base_amount = proof.base_amount;
              buy.quote_amount = proof.quote_amount;
              if (useMatchV3) {
                addChangeOrder(sell, proof.changeSell, settled.tx);
                addChangeOrder(buy, proof.changeBuy, settled.tx);
              }
              const fill = {
                match_id: proof.match_id,
                batch_id,
                pair_id: sell.pair_id,
                sell_owner: sell.owner,
                buy_owner: buy.owner,
                note_sell: proof.note_sell,
                note_buy: proof.note_buy,
                ...(useMatchV3 ? {
                  fill_base: proof.fill_base ?? proof.base_amount,
                  fill_quote: proof.fill_quote ?? proof.quote_amount,
                  ...residualFields("sell", proof.changeSell),
                  ...residualFields("buy", proof.changeBuy),
                } : {}),
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

      dropUnmatchedIoc();
      // Only advance the batch once it's fully cleared. Leftover unmatched orders MUST stay in this
      // same batch (their proofs bind this batch_id and can't be re-batched), so a later crossing
      // order can still match them — otherwise they'd be stranded in a closed batch forever.
      if (open().length === 0) state.currentBatchId += 1n;
      pruneState();
      await notifyChange();
      await onDecision({
        batch_id,
        considered,
        matched: fills.map(decisionFill),
      });
      return { batch_id, fills };
    },

    fillsFor(owner) {
      pruneState();
      requireOwner(owner);
      return state.fills
        .filter((fill) => fill.sell_owner === owner || fill.buy_owner === owner)
        .map(publicFill);
    },

    ordersFor(owner) {
      pruneState();
      requireOwner(owner);
      return state.orders
        .filter((order) => order.owner === owner && order.placed && !order.filled && !order.cancelled)
        .map(ownerOrder);
    },

    orders() {
      pruneState();
      return state.orders.map(publicOrder);
    },
  };
  return matcher;
}
