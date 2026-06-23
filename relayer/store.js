const NETWORK_RPC = {
  testnet: "https://soroban-testnet.stellar.org",
  futurenet: "https://rpc-futurenet.stellar.org",
  local: "http://localhost:8000/soroban/rpc",
};

function numberEnv(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function createStore({
  validateReceipt = createRpcReceiptValidator(),
  maxEntries = numberEnv(process.env.RELAYER_MAX_ENTRIES, 1024),
  ttlMs = numberEnv(process.env.RELAYER_STATE_TTL_MS, 30 * 60_000),
} = {}) {
  const byToken = new Map();
  const byInbox = new Map();
  const byRecordId = new Map();
  const byCommitment = new Map();
  const seenTx = new Map();

  function removeEntry(entry) {
    byRecordId.delete(entry.record_id);
    byCommitment.delete(entry.c);
    seenTx.delete(entry.tx_hash);
    if (byToken.get(entry.token) === entry) byToken.delete(entry.token);
  }

  function prune() {
    const cutoff = Date.now() - ttlMs;
    for (const entry of byRecordId.values()) {
      if ((entry._createdAt ?? 0) < cutoff || byRecordId.size > maxEntries) removeEntry(entry);
    }
    for (const [inbox, value] of byInbox) {
      if ((value._createdAt ?? 0) < cutoff || byInbox.size > maxEntries * 2) byInbox.delete(inbox);
    }
    for (const [tx, createdAt] of seenTx) {
      if (createdAt < cutoff || seenTx.size > maxEntries) seenTx.delete(tx);
    }
  }

  function publicInbox(value) {
    if (!value) return { matched: false };
    return value.matched
      ? { matched: true, counterpart: value.counterpart }
      : { matched: false };
  }

  async function submitIntent(input) {
    prune();
    const req = normalizeIntent(input);
    if (seenTx.has(req.tx_hash)) throw new Error("duplicate receipt");
    if (byRecordId.has(req.record_id)) throw new Error("duplicate record_id");
    if (byCommitment.has(req.c)) throw new Error("duplicate commitment");

    const receipt = await validateReceipt({
      network: req.network,
      contract_id: req.contract_id,
      tx_hash: req.tx_hash,
      record_id: req.record_id,
      c: req.c,
    });
    assertReceiptMatches(req, receipt);

    const entry = {
      network: req.network,
      contract_id: req.contract_id,
      tx_hash: req.tx_hash,
      record_id: req.record_id,
      c: req.c,
      token: req.token,
      inbox: req.inbox,
      envelope: req.envelope,
      epoch: receipt.epoch,
      _createdAt: Date.now(),
    };

    seenTx.set(req.tx_hash, Date.now());
    byRecordId.set(req.record_id, entry);
    byCommitment.set(req.c, entry);
    prune();

    const waiting = byToken.get(req.token);
    if (!waiting) {
      byToken.set(req.token, entry);
      byInbox.set(req.inbox, { matched: false, _createdAt: Date.now() });
      return { matched: false };
    }

    if (waiting.record_id === req.record_id || waiting.c === req.c || waiting.inbox === req.inbox) {
      throw new Error("duplicate rendezvous entry");
    }

    byToken.delete(req.token);
    byInbox.set(waiting.inbox, {
      matched: true,
      counterpart: {
        record_id: entry.record_id,
        c: entry.c,
        envelope: entry.envelope,
      },
      _createdAt: Date.now(),
    });
    byInbox.set(req.inbox, {
      matched: true,
      counterpart: {
        record_id: waiting.record_id,
        c: waiting.c,
        envelope: waiting.envelope,
      },
      _createdAt: Date.now(),
    });
    prune();
    return { matched: true };
  }

  function poll(inbox) {
    prune();
    if (!isHex32(inbox)) {
      throw new Error("inbox must be a 32-byte hex string");
    }
    return publicInbox(byInbox.get(inbox.toLowerCase()));
  }

  return { submitIntent, poll };
}

export function createRpcReceiptValidator({ rpcUrls = NETWORK_RPC, fetchImpl = fetch } = {}) {
  return async function validateRpcReceipt({ network, contract_id, tx_hash }) {
    const rpcUrl = process.env.STELLAR_RPC_URL || rpcUrls[network];
    if (!rpcUrl) throw new Error(`unsupported network: ${network}`);
    const tx = await rpcCall(fetchImpl, rpcUrl, "getTransaction", { hash: tx_hash, xdrFormat: "json" });
    if (!tx || tx.status === "NOT_FOUND") throw new Error("receipt not found");
    if (tx.status !== "SUCCESS") throw new Error("transaction not successful");

    const event = findIntentSubmittedEvent(tx, contract_id);
    if (!event) {
      throw new Error("IntentSubmitted event not found");
    }
    return event;
  };
}

async function rpcCall(fetchImpl, rpcUrl, method, params) {
  const response = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new Error(`rpc ${method} failed: ${response.status}`);
  }
  const json = await response.json();
  if (json.error) {
    throw new Error(json.error.message || `rpc ${method} error`);
  }
  return json.result;
}

// Gather contract events across the shapes soroban-rpc returns (xdrFormat:"json" gives
// tx.events.contractEventsJson as an array-of-arrays), plus fallbacks for tests/mocks.
function collectContractEvents(tx) {
  const out = [];
  const ce = tx.events?.contractEventsJson;
  if (Array.isArray(ce)) for (const grp of ce) if (Array.isArray(grp)) out.push(...grp);
  if (Array.isArray(tx.events)) out.push(...tx.events);
  if (Array.isArray(tx.diagnosticEvents)) out.push(...tx.diagnosticEvents);
  if (Array.isArray(tx.resultMeta?.events)) out.push(...tx.resultMeta.events);
  return out;
}

function findIntentSubmittedEvent(tx, contractId) {
  for (const event of collectContractEvents(tx)) {
    const ec = event.contract_id ?? event.contractId ?? event.contract;
    const normalizedContract = normalizeContractId(ec);
    if (normalizedContract && normalizedContract !== normalizeContractId(contractId)) continue;
    if (!eventHasTopic(event, "IntentSubmitted")) continue;
    const parsed = parseIntentEvent(event);
    if (parsed) return { contract_id: contractId, ...parsed };
  }
  return null;
}

function topicsOf(event) {
  return event.body?.v0?.topics ?? event.topics ?? event.topic ?? [];
}
function symbolOf(topic) {
  if (typeof topic === "string") return topic;
  if (topic?.symbol) return topic.symbol;
  if (topic?.sym) return topic.sym;
  if (topic?._arm === "symbol") return topic?._value;
  return undefined;
}
function eventHasTopic(event, name) {
  const topics = topicsOf(event);
  return Array.isArray(topics) && topics.some((t) => symbolOf(t) === name);
}

// Convert a JSON-encoded ScVal ({bytes}/{u64}/{u32}/{symbol}/{bool}/...) to a JS value.
function scvToJs(v) {
  if (v == null || typeof v !== "object") return v;
  if (v.bytes !== undefined) return v.bytes;
  if (v.u64 !== undefined) return Number(v.u64);
  if (v.u32 !== undefined) return Number(v.u32);
  if (v.i128 !== undefined) return v.i128;
  if (v.symbol !== undefined) return v.symbol;
  if (v.bool !== undefined) return v.bool;
  if (v.address !== undefined) return v.address;
  return v;
}

function parseIntentEvent(event) {
  const data = event.body?.v0?.data ?? event.value ?? event.data ?? {};
  let fields = {};
  if (Array.isArray(data.map)) {
    for (const kv of data.map) fields[symbolOf(kv.key)] = scvToJs(kv.val);
  } else {
    fields = data.native ?? data;
  }
  const id = fields.id ?? fields.record_id ?? fields.intent_id;
  const c = fields.c ?? fields.commitment;
  const epoch = fields.epoch;
  if (!Number.isSafeInteger(Number(id)) || !isHex32(c)) return null;
  return {
    record_id: Number(id),
    c: String(c).toLowerCase(),
    epoch: epoch === undefined ? undefined : Number(epoch),
    cancelled: Boolean(fields.cancelled),
    settled: Boolean(fields.settled),
  };
}

function normalizeIntent(input = {}) {
  const network = String(input.network ?? "");
  if (!["testnet", "futurenet", "local"].includes(network)) {
    throw new Error("network must be testnet, futurenet, or local");
  }
  const contract_id = normalizeContractId(input.contract_id);
  if (!contract_id) throw new Error("contract_id is required");
  if (!isHex64(input.tx_hash)) throw new Error("tx_hash must be a 64-byte hex string");
  if (!Number.isSafeInteger(input.record_id) || input.record_id < 0) {
    throw new Error("record_id must be a non-negative integer");
  }
  if (!isHex32(input.c)) throw new Error("c must be a 32-byte hex string");
  if (!isHex32(input.token)) throw new Error("token must be a 32-byte hex string");
  if (!isHex32(input.inbox)) throw new Error("inbox must be a 32-byte hex string");
  if (!isAeadEnvelope(input.envelope)) {
    throw new Error("envelope must be an AES-256-GCM object");
  }
  return {
    network,
    contract_id,
    tx_hash: input.tx_hash.toLowerCase(),
    record_id: input.record_id,
    c: input.c.toLowerCase(),
    token: input.token.toLowerCase(),
    inbox: input.inbox.toLowerCase(),
    envelope: input.envelope,
  };
}

function assertReceiptMatches(req, receipt = {}) {
  if (receipt.finalized === false) throw new Error("receipt not finalized");
  if (receipt.success === false) throw new Error("receipt transaction failed");
  if (normalizeContractId(receipt.contract_id) !== req.contract_id) {
    throw new Error("receipt contract mismatch");
  }
  if (Number(receipt.record_id) !== req.record_id) {
    throw new Error("receipt record_id mismatch");
  }
  if (!isHex32(receipt.c) || receipt.c.toLowerCase() !== req.c) {
    throw new Error("receipt commitment mismatch");
  }
  if (receipt.cancelled) throw new Error("intent is cancelled");
  if (receipt.settled) throw new Error("intent is settled");
}

function normalizeContractId(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  if (isHex32(value)) return value.toLowerCase();
  if (/^C[A-Z2-7]{55}$/.test(value)) return value;
  return value.toLowerCase();
}

function isAeadEnvelope(value) {
  return (
    value &&
    typeof value === "object" &&
    value.v === 1 &&
    value.alg === "AES-256-GCM" &&
    isBase64Url(value.nonce) &&
    isBase64Url(value.ciphertext) &&
    isBase64Url(value.tag)
  );
}

function isHex32(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

function isHex64(value) {
  return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value);
}

function isBase64Url(value) {
  return typeof value === "string" && value.length > 0 && /^[A-Za-z0-9_-]+={0,2}$/.test(value);
}
