import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile, appendFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_DIR = dirname(fileURLToPath(import.meta.url));
const DEFAULT_STATE_PATH = join(DEFAULT_DIR, ".state.json");
const DEFAULT_DECISIONS_PATH = join(DEFAULT_DIR, ".decisions.log");

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function openOrders(orders = []) {
  return orders.filter((order) => order?.placed && !order.filled && !order.cancelled).map(cloneJson);
}

function matcherSnapshot(matcher) {
  if (matcher && typeof matcher.snapshot === "function") return matcher.snapshot();
  const state = matcher?.state ?? {};
  return {
    currentBatchId: String(state.currentBatchId ?? "1"),
    orders: openOrders(state.orders),
    fills: Array.isArray(state.fills) ? state.fills.map(cloneJson) : [],
    postedRoots: Array.from(state.postedRoots ?? []),
  };
}

export function hashRecord(record) {
  return createHash("sha256").update(JSON.stringify(record)).digest("hex");
}

function invalidState(message) {
  return new Error(`invalid persisted state: ${message}`);
}

function requirePlainObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalidState(`${label} must be an object`);
  return value;
}

function optionalArray(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalidState(`${label} must be an array`);
  return value;
}

function requireString(value, label, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw invalidState(`${label} must be a string`);
  }
  return value;
}

function requireDecimalString(value, label) {
  const string = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : requireString(value, label);
  if (!/^(0|[1-9][0-9]*)$/.test(string)) throw invalidState(`${label} must be a decimal string`);
  return string;
}

function requireHex32(value, label, { prefix = "optional" } = {}) {
  const string = requireString(value, label);
  const pattern = prefix === "required" ? /^0x[0-9a-fA-F]{64}$/ : /^(0x)?[0-9a-fA-F]{64}$/;
  if (!pattern.test(string)) throw invalidState(`${label} must be 32 bytes of hex`);
  return string;
}

function validateRegistration(entry, index) {
  const record = requirePlainObject(entry, `registrations[${index}]`);
  requireString(record.pk_x, `registrations[${index}].pk_x`);
  requireString(record.pk_y, `registrations[${index}].pk_y`);
  requireString(record.h_sk, `registrations[${index}].h_sk`);
  requireHex32(record.leaf, `registrations[${index}].leaf`, { prefix: "required" });
  if (record.owner !== undefined) requireString(record.owner, `registrations[${index}].owner`);
  return cloneJson(record);
}

function validateOrder(order, index) {
  const record = requirePlainObject(order, `orders[${index}]`);
  requireString(record.owner, `orders[${index}].owner`);
  requireDecimalString(record.size, `orders[${index}].size`);
  requireDecimalString(record.limit_price, `orders[${index}].limit_price`);
  requireHex32(record.note, `orders[${index}].note`);
  requireHex32(record.nf_order, `orders[${index}].nf_order`);
  requireHex32(record.leaf, `orders[${index}].leaf`);
  if (record.root !== undefined) requireHex32(record.root, `orders[${index}].root`);
  if (record.batch_id !== undefined) requireDecimalString(record.batch_id, `orders[${index}].batch_id`);
  if (record.pair_id !== undefined && (!Number.isSafeInteger(record.pair_id) || record.pair_id < 1)) {
    throw invalidState(`orders[${index}].pair_id must be a positive integer`);
  }
  return cloneJson(record);
}

function validateFill(fill, index) {
  const record = requirePlainObject(fill, `fills[${index}]`);
  requireString(record.sell_owner, `fills[${index}].sell_owner`);
  requireString(record.buy_owner, `fills[${index}].buy_owner`);
  if (record.match_id !== undefined) requireString(record.match_id, `fills[${index}].match_id`, { allowEmpty: true });
  if (record.note_sell !== undefined) requireString(record.note_sell, `fills[${index}].note_sell`);
  if (record.note_buy !== undefined) requireString(record.note_buy, `fills[${index}].note_buy`);
  return cloneJson(record);
}

function validateState(parsed) {
  const state = requirePlainObject(parsed, "state");
  const currentBatchId = requireDecimalString(state.currentBatchId ?? "1", "currentBatchId");
  const postedRoots = optionalArray(state.postedRoots, "postedRoots").map((root, index) => {
    requireHex32(root, `postedRoots[${index}]`, { prefix: "required" });
    return root;
  });
  return {
    registrations: optionalArray(state.registrations, "registrations").map(validateRegistration),
    currentBatchId,
    orders: optionalArray(state.orders, "orders").map(validateOrder),
    fills: optionalArray(state.fills, "fills").map(validateFill),
    postedRoots,
  };
}

export function createJsonStore({
  // Namespace persisted state by contract id so switching contracts (e.g. a v2 redeploy) never
  // reloads another contract's registrations and traps post_root on a leaf-count mismatch.
  contractId,
  statePath = process.env.COORDINATOR_STATE_PATH ?? (contractId ? join(DEFAULT_DIR, `.state.${contractId}.json`) : DEFAULT_STATE_PATH),
  decisionsPath = process.env.COORDINATOR_DECISIONS_PATH ?? (contractId ? join(DEFAULT_DIR, `.decisions.${contractId}.log`) : DEFAULT_DECISIONS_PATH),
  decisionLogMaxBytes = Number(process.env.COORDINATOR_DECISION_LOG_MAX_BYTES ?? 1024 * 1024),
} = {}) {
  let writeQueue = Promise.resolve();

  function enqueueWrite(operation) {
    const next = writeQueue.then(operation, operation);
    writeQueue = next.catch(() => {});
    return next;
  }

  async function ensureParent(filePath) {
    await mkdir(dirname(filePath), { recursive: true });
  }

  async function load() {
    let raw;
    try {
      raw = await readFile(statePath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { registrations: [], currentBatchId: "1", orders: [], fills: [], postedRoots: [] };
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw invalidState(error.message);
    }
    return validateState(parsed);
  }

  async function save({ directory, matcher }) {
    return enqueueWrite(async () => {
      const snapshot = matcherSnapshot(matcher);
      const registrations = typeof directory?.entries === "function" ? directory.entries() : [];
      const payload = {
        version: 1,
        saved_at: new Date().toISOString(),
        registrations: registrations.map(cloneJson),
        currentBatchId: String(snapshot.currentBatchId ?? "1"),
        orders: openOrders(snapshot.orders),
        fills: Array.isArray(snapshot.fills) ? snapshot.fills.map(cloneJson) : [],
        postedRoots: Array.isArray(snapshot.postedRoots) ? [...snapshot.postedRoots] : [],
      };
      await ensureParent(statePath);
      const tmp = `${statePath}.${process.pid}.${Date.now()}.${randomBytes(8).toString("hex")}.tmp`;
      await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
      await rename(tmp, statePath);
      return payload;
    });
  }

  async function rotateDecisionLogIfNeeded(nextLineBytes) {
    if (!Number.isFinite(decisionLogMaxBytes) || decisionLogMaxBytes <= 0) return;
    let size = 0;
    try {
      size = (await stat(decisionsPath)).size;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      return;
    }
    if (size + nextLineBytes <= decisionLogMaxBytes) return;
    const rotated = `${decisionsPath}.${new Date().toISOString().replace(/[:.]/g, "-")}.${randomBytes(4).toString("hex")}.old`;
    await rename(decisionsPath, rotated);
  }

  async function appendDecision(decision) {
    return enqueueWrite(async () => {
      const record = {
        version: 1,
        type: "batch_decision",
        timestamp: new Date().toISOString(),
        ...cloneJson(decision),
      };
      const signed = { ...record, hash: hashRecord(record) };
      const line = `${JSON.stringify(signed)}\n`;
      await ensureParent(decisionsPath);
      await rotateDecisionLogIfNeeded(Buffer.byteLength(line));
      await appendFile(decisionsPath, line, "utf8");
      return signed;
    });
  }

  return { statePath, decisionsPath, load, save, appendDecision };
}
