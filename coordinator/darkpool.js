import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildBabyjub, buildPoseidon } from "circomlibjs";

export const DEPTH = 4;
export const LEAF_CAPACITY = 1 << DEPTH;
export const DOM_NFKEY = 4n;
export const DOM_ORDER = 9n;
export const DOM_NFORD = 10n;
export const DOM_NFSPEND = 11n;
export const DOM_NFCANCEL = 12n;
export const DOM_MATCH = 5n;
export const SCALE = 10000000n;
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(here, "..");
const snarkjs = require(path.join(rootDir, "frontend/node_modules/snarkjs"));

const ORDER_WASM = path.join(rootDir, "circuits/build/order/order_js/order.wasm");
const ORDER_ZKEY = path.join(rootDir, "circuits/build/order/order_final.zkey");
const ORDER_VK = path.join(rootDir, "circuits/build/order/order_vk.json");
const CANCEL_ORDER_WASM = path.join(rootDir, "circuits/build/cancel_order/cancel_order_js/cancel_order.wasm");
const CANCEL_ORDER_ZKEY = path.join(rootDir, "circuits/build/cancel_order/cancel_order_final.zkey");
const CANCEL_ORDER_VK = path.join(rootDir, "circuits/build/cancel_order/cancel_order_vk.json");
const MATCH_WASM = path.join(rootDir, "circuits/build/dpmatch/dpmatch_js/dpmatch.wasm");
const MATCH_ZKEY = path.join(rootDir, "circuits/build/dpmatch/dpmatch_final.zkey");
const MATCH_VK = path.join(rootDir, "circuits/build/dpmatch/dpmatch_vk.json");

let cryptoPromise;

async function crypto() {
  cryptoPromise ??= Promise.all([buildBabyjub(), buildPoseidon()]).then(([babyJub, poseidon]) => {
    const H = (arr) => poseidon.F.toObject(poseidon(arr));
    const pkOf = (sk) => {
      const p = babyJub.mulPointEscalar(babyJub.Base8, sk);
      return [babyJub.F.toObject(p[0]), babyJub.F.toObject(p[1])];
    };
    return { babyJub, poseidon, H, pkOf };
  });
  return cryptoPromise;
}

function parseField(value, label = "field") {
  if (typeof value === "bigint") {
    if (value < 0n || value >= FIELD_MODULUS) throw new Error(`${label} out of field range`);
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
    return parseField(String(value), label);
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a decimal field string`);
  }
  const parsed = BigInt(value);
  if (parsed < 0n || parsed >= FIELD_MODULUS) throw new Error(`${label} out of field range`);
  return parsed;
}

function parseInteger(value, label) {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
    return BigInt(value);
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a decimal integer`);
  }
  return BigInt(value);
}

function parseLeaf(value, label = "leaf") {
  if (typeof value === "bigint" || typeof value === "number") return parseField(value, label);
  if (typeof value !== "string") throw new Error(`${label} must be a decimal field or hex32 string`);
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return parseField(BigInt(`0x${hex}`), label);
  return parseField(value, label);
}

function assertU32(value, label) {
  const n = parseInteger(value, label);
  if (n < 0n || n > 0xffffffffn) throw new Error(`${label} must be u32`);
  return n;
}

function assertU64(value, label) {
  const n = parseInteger(value, label);
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error(`${label} must be u64`);
  return n;
}

function assertLeafIndex(value) {
  const n = Number(parseInteger(value, "leafIndex"));
  if (!Number.isSafeInteger(n) || n < 0 || n >= LEAF_CAPACITY) {
    throw new Error(`leafIndex must be between 0 and ${LEAF_CAPACITY - 1}`);
  }
  return n;
}

export function be32(value) {
  const n = parseInteger(value, "field");
  if (n < 0n || n >= (1n << 256n)) throw new Error("field must fit in 32 bytes");
  return n.toString(16).padStart(64, "0");
}

const g1 = (p) => be32(p[0]) + be32(p[1]);
const g2 = (p) => be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0]);

export function toContractProof(proof) {
  return { a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) };
}

function merkleTree(leaves, H) {
  const levels = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const lv = levels[levels.length - 1], next = [];
    for (let i = 0; i < lv.length; i += 2) next.push(H([lv[i], lv[i + 1]]));
    levels.push(next);
  }
  return levels;
}

export function pathOf(levels, idx) {
  const el = [], id = []; let i = idx;
  for (let d = 0; d < DEPTH; d++) { el.push(levels[d][i ^ 1]); id.push(BigInt(i & 1)); i >>= 1; }
  return { el, id };
}

function addLeafIndex(indexByLeaf, leaf, index) {
  indexByLeaf.set(leaf.toString(), index);
  indexByLeaf.set(be32(leaf), index);
  indexByLeaf.set(`0x${be32(leaf)}`, index);
}

export async function identityFromSk(skValue) {
  const sk = parseField(skValue, "sk");
  const { H, pkOf } = await crypto();
  const pk = pkOf(sk);
  const h_sk = H([sk]);
  const nfk = H([DOM_NFKEY, sk]);
  const leaf = H([pk[0], pk[1], h_sk]);
  return { sk, pk, h_sk, nfk, leaf };
}

export async function buildDirectoryTree(registrations) {
  if (!Array.isArray(registrations)) throw new Error("registrations must be an array");
  const { H } = await crypto();
  const leaves = new Array(LEAF_CAPACITY).fill(0n);
  const indexByLeaf = new Map();

  for (const [position, registration] of registrations.entries()) {
    if (!registration || typeof registration !== "object") throw new Error(`registrations[${position}] is required`);
    const index = registration.index === undefined ? position : Number(assertU32(registration.index, `registrations[${position}].index`));
    if (index >= LEAF_CAPACITY) throw new Error(`registration index ${index} exceeds depth-${DEPTH} capacity`);
    if (leaves[index] !== 0n) throw new Error(`duplicate registration index ${index}`);

    const pkX = parseField(registration.pk_x, `registrations[${position}].pk_x`);
    const pkY = parseField(registration.pk_y, `registrations[${position}].pk_y`);
    const hSk = parseField(registration.h_sk, `registrations[${position}].h_sk`);
    const leaf = H([pkX, pkY, hSk]);
    if (registration.leaf !== undefined && parseLeaf(registration.leaf, `registrations[${position}].leaf`) !== leaf) {
      throw new Error(`registration leaf mismatch at index ${index}: expected 0x${be32(leaf)}`);
    }

    leaves[index] = leaf;
    addLeafIndex(indexByLeaf, leaf, index);
  }

  const levels = merkleTree(leaves, H);
  const root = levels[levels.length - 1][0];
  return { leaves, levels, root, indexByLeaf };
}

export async function buildTreeFromLeaves(rawLeaves) {
  if (!Array.isArray(rawLeaves)) throw new Error("leaves must be an array");
  const { H } = await crypto();
  const leaves = new Array(LEAF_CAPACITY).fill(0n);
  const indexByLeaf = new Map();
  for (const [index, value] of rawLeaves.entries()) {
    if (index >= LEAF_CAPACITY) throw new Error(`directory is full at ${LEAF_CAPACITY} leaves`);
    const leaf = parseLeaf(value, `leaves[${index}]`);
    leaves[index] = leaf;
    if (leaf !== 0n) addLeafIndex(indexByLeaf, leaf, index);
  }
  const levels = merkleTree(leaves, H);
  const root = levels[levels.length - 1][0];
  return { leaves, levels, root, indexByLeaf };
}

export async function orderCommitment({ leaf, side, size, limit_price, salt, pair_id, batch_id }) {
  const { H } = await crypto();
  const leafN = parseLeaf(leaf, "leaf");
  const sideN = parseInteger(side, "side");
  if (sideN !== 0n && sideN !== 1n) throw new Error("side must be 0 (sell) or 1 (buy)");
  const sizeN = parseInteger(size, "size");
  const limitN = parseInteger(limit_price, "limit_price");
  const saltN = parseField(salt, "salt");
  const pairN = assertU32(pair_id, "pair_id");
  const batchN = assertU64(batch_id, "batch_id");
  if (sizeN <= 0n) throw new Error("size must be positive");
  if (limitN <= 0n) throw new Error("limit_price must be positive");

  const note = H([DOM_ORDER, leafN, sideN, pairN, sizeN, limitN, saltN, batchN]);
  const nf_order = H([DOM_NFORD, saltN, note]);
  return {
    leaf: be32(leafN),
    note: be32(note),
    nf_order: be32(nf_order),
    pair_id: Number(pairN),
    batch_id: batchN.toString(),
    values: { leaf: leafN, side: sideN, size: sizeN, limit_price: limitN, salt: saltN, pair_id: pairN, batch_id: batchN, note, nf_order },
  };
}

async function proveAndVerify(input, wasm, zkey, vkPath, expectedSignals, label) {
  const { proof: rawProof, publicSignals } = await snarkjs.groth16.fullProve(input, wasm, zkey);
  const vk = require(vkPath);
  const ok = await snarkjs.groth16.verify(vk, publicSignals, rawProof);
  if (!ok) throw new Error(`${label} proof verification failed`);
  for (const [index, expected] of expectedSignals.entries()) {
    if (publicSignals[index] !== expected.toString()) {
      throw new Error(`${label} publicSignals[${index}] mismatch: expected ${expected}, got ${publicSignals[index]}`);
    }
  }
  return { rawProof, publicSignals, proof: toContractProof(rawProof) };
}

export async function verifyOrderProof(proof, publicSignals) {
  return snarkjs.groth16.verify(require(ORDER_VK), publicSignals, proof);
}

export async function verifyCancelOrderProof(proof, publicSignals) {
  return snarkjs.groth16.verify(require(CANCEL_ORDER_VK), publicSignals, proof);
}

export async function verifyMatchProof(proof, publicSignals) {
  return snarkjs.groth16.verify(require(MATCH_VK), publicSignals, proof);
}

export async function proveOrder({ sk, side, size, limit_price, salt, pair_id, batch_id, tree, leafIndex }) {
  if (!tree || !Array.isArray(tree.levels) || !Array.isArray(tree.leaves)) throw new Error("tree is required");
  const { H } = await crypto();
  const identity = await identityFromSk(sk);
  const index = assertLeafIndex(leafIndex);
  if (tree.leaves[index] !== identity.leaf) throw new Error("sk does not match registered leafIndex");

  const sideN = parseInteger(side, "side");
  if (sideN !== 0n && sideN !== 1n) throw new Error("side must be 0 (sell) or 1 (buy)");
  const sizeN = parseInteger(size, "size");
  const limitN = parseInteger(limit_price, "limit_price");
  const saltN = parseField(salt, "salt");
  const pairN = assertU32(pair_id, "pair_id");
  const batchN = assertU64(batch_id, "batch_id");
  if (sizeN <= 0n) throw new Error("size must be positive");
  if (limitN <= 0n) throw new Error("limit_price must be positive");

  const p = pathOf(tree.levels, index);
  const note = H([DOM_ORDER, identity.leaf, sideN, pairN, sizeN, limitN, saltN, batchN]);
  const nf_order = H([DOM_NFORD, saltN, note]);
  const orderInput = {
    sk: identity.sk.toString(), side: sideN.toString(), size: sizeN.toString(), limit_price: limitN.toString(),
    salt: saltN.toString(), path_el: p.el.map(String), path_idx: p.id.map(String),
    pair_id: pairN.toString(), batch_id: batchN.toString(), root: tree.root.toString(),
  };

  const proved = await proveAndVerify(
    orderInput,
    ORDER_WASM,
    ORDER_ZKEY,
    ORDER_VK,
    [note, nf_order, pairN, batchN, tree.root],
    "order",
  );
  return {
    proof: proved.proof,
    rawProof: proved.rawProof,
    publicSignals: proved.publicSignals,
    note: be32(note),
    nf_order: be32(nf_order),
    leaf: be32(identity.leaf),
    root: be32(tree.root),
    pair_id: Number(pairN),
    batch_id: batchN.toString(),
  };
}

export async function proveCancelOrder({ sk, side, size, limit_price, salt, pair_id, batch_id, tree, leafIndex }) {
  if (!tree || !Array.isArray(tree.levels) || !Array.isArray(tree.leaves)) throw new Error("tree is required");
  const { H } = await crypto();
  const identity = await identityFromSk(sk);
  const index = assertLeafIndex(leafIndex);
  if (tree.leaves[index] !== identity.leaf) throw new Error("sk does not match registered leafIndex");

  const sideN = parseInteger(side, "side");
  if (sideN !== 0n && sideN !== 1n) throw new Error("side must be 0 (sell) or 1 (buy)");
  const sizeN = parseInteger(size, "size");
  const limitN = parseInteger(limit_price, "limit_price");
  const saltN = parseField(salt, "salt");
  const pairN = assertU32(pair_id, "pair_id");
  const batchN = assertU64(batch_id, "batch_id");
  if (sizeN <= 0n) throw new Error("size must be positive");
  if (limitN <= 0n) throw new Error("limit_price must be positive");

  const p = pathOf(tree.levels, index);
  const note = H([DOM_ORDER, identity.leaf, sideN, pairN, sizeN, limitN, saltN, batchN]);
  const nf_cancel = H([DOM_NFCANCEL, saltN, note]);
  const cancelInput = {
    sk: identity.sk.toString(), side: sideN.toString(), size: sizeN.toString(), limit_price: limitN.toString(),
    salt: saltN.toString(), path_el: p.el.map(String), path_idx: p.id.map(String),
    pair_id: pairN.toString(), batch_id: batchN.toString(), root: tree.root.toString(),
  };

  const proved = await proveAndVerify(
    cancelInput,
    CANCEL_ORDER_WASM,
    CANCEL_ORDER_ZKEY,
    CANCEL_ORDER_VK,
    [note, nf_cancel, identity.leaf, pairN, batchN, tree.root],
    "cancel order",
  );
  return {
    proof: proved.proof,
    rawProof: proved.rawProof,
    publicSignals: proved.publicSignals,
    note: be32(note),
    nf_cancel: be32(nf_cancel),
    leaf: be32(identity.leaf),
    root: be32(tree.root),
    pair_id: Number(pairN),
    batch_id: batchN.toString(),
  };
}

export async function proveMatch({ sell, buy, pair_id, batch_id, tree }) {
  const { H } = await crypto();
  const pairN = assertU32(pair_id, "pair_id");
  const batchN = assertU64(batch_id, "batch_id");
  const rootN = tree?.root !== undefined ? parseLeaf(tree.root, "root") : parseLeaf(sell?.root ?? buy?.root, "root");
  const leafSell = parseLeaf(sell?.leaf, "sell.leaf");
  const leafBuy = parseLeaf(buy?.leaf, "buy.leaf");
  if (sell?.side !== undefined && parseInteger(sell.side, "sell.side") !== 0n) throw new Error("sell.side must be 0");
  if (buy?.side !== undefined && parseInteger(buy.side, "buy.side") !== 1n) throw new Error("buy.side must be 1");

  const sizeSell = parseInteger(sell.size, "sell.size");
  const sizeBuy = parseInteger(buy.size, "buy.size");
  const limitSell = parseInteger(sell.limit_price, "sell.limit_price");
  const limitBuy = parseInteger(buy.limit_price, "buy.limit_price");
  const saltSell = parseField(sell.salt, "sell.salt");
  const saltBuy = parseField(buy.salt, "buy.salt");
  if (sizeSell <= 0n || sizeBuy <= 0n) throw new Error("order size must be positive");
  if (sizeSell !== sizeBuy) throw new Error("dark-pool match requires equal order sizes");

  const sum = limitSell + limitBuy;
  const cross = sum / 2n;
  const parity = sum % 2n;
  if (limitSell > cross || cross > limitBuy) throw new Error("orders do not cross at midpoint");
  const product = sizeSell * cross;
  const quote = product / SCALE;
  const rem = product % SCALE;

  const noteSell = H([DOM_ORDER, leafSell, 0n, pairN, sizeSell, limitSell, saltSell, batchN]);
  const noteBuy = H([DOM_ORDER, leafBuy, 1n, pairN, sizeBuy, limitBuy, saltBuy, batchN]);
  if (sell.note !== undefined && parseLeaf(sell.note, "sell.note") !== noteSell) {
    throw new Error("sell note does not match submitted order opening");
  }
  if (buy.note !== undefined && parseLeaf(buy.note, "buy.note") !== noteBuy) {
    throw new Error("buy note does not match submitted order opening");
  }
  const nfSell = H([DOM_NFSPEND, saltSell, noteSell]);
  const nfBuy = H([DOM_NFSPEND, saltBuy, noteBuy]);
  const matchId = H([DOM_MATCH, noteSell, noteBuy, pairN, batchN, rootN]);

  const matchInput = {
    leaf_sell_w: leafSell.toString(), size_sell: sizeSell.toString(), limit_sell: limitSell.toString(),
    salt_sell: saltSell.toString(),
    leaf_buy_w: leafBuy.toString(), size_buy: sizeBuy.toString(), limit_buy: limitBuy.toString(),
    salt_buy: saltBuy.toString(),
    cross_price: cross.toString(), parity: parity.toString(), quote_amount_w: quote.toString(), rem: rem.toString(),
    pair_id: pairN.toString(), batch_id: batchN.toString(), root: rootN.toString(),
  };

  const proved = await proveAndVerify(
    matchInput,
    MATCH_WASM,
    MATCH_ZKEY,
    MATCH_VK,
    [matchId, noteSell, noteBuy, nfSell, nfBuy, leafSell, leafBuy, sizeSell, quote, pairN, batchN, rootN],
    "match",
  );
  return {
    proof: proved.proof,
    rawProof: proved.rawProof,
    publicSignals: proved.publicSignals,
    match_id: be32(matchId),
    note_sell: be32(noteSell),
    note_buy: be32(noteBuy),
    nf_sell: be32(nfSell),
    nf_buy: be32(nfBuy),
    leaf_sell: be32(leafSell),
    leaf_buy: be32(leafBuy),
    base_amount: sizeSell.toString(),
    quote_amount: quote.toString(),
  };
}
