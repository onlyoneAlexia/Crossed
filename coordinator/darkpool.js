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
const ORDER_V2_WASM = path.join(rootDir, "circuits/build_v2/order_v2/order_v2_js/order_v2.wasm");
const ORDER_V2_ZKEY = path.join(rootDir, "circuits/build_v2/order_v2_final.zkey");
const ORDER_V2_VK = path.join(rootDir, "circuits/build_v2/order_v2_vk.json");
const MATCH_V2_WASM = path.join(rootDir, "circuits/build_v2/dpmatch_v2/dpmatch_v2_js/dpmatch_v2.wasm");
const MATCH_V2_ZKEY = path.join(rootDir, "circuits/build_v2/dpmatch_v2_final.zkey");
const MATCH_V2_VK = path.join(rootDir, "circuits/build_v2/dpmatch_v2_vk.json");
const MATCH_V3_WASM = path.join(rootDir, "circuits/build_v3/dpmatch_v3/dpmatch_v3_js/dpmatch_v3.wasm");
const MATCH_V3_ZKEY = path.join(rootDir, "circuits/build_v3/dpmatch_v3/dpmatch_v3_final.zkey");
const MATCH_V3_VK = path.join(rootDir, "circuits/build_v3/dpmatch_v3/dpmatch_v3_vk.json");

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

function assertU127(value, label) {
  const n = parseInteger(value, label);
  if (n < 0n || n >= (1n << 127n)) throw new Error(`${label} must fit in 127 bits`);
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

function inverseMod(value, modulus) {
  let t = 0n, newT = 1n;
  let r = modulus, newR = ((value % modulus) + modulus) % modulus;
  while (newR !== 0n) {
    const quotient = r / newR;
    [t, newT] = [newT, t - quotient * newT];
    [r, newR] = [newR, r - quotient * newR];
  }
  if (r !== 1n) throw new Error("value has no field inverse");
  return t < 0n ? t + modulus : t;
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

export async function orderCommitmentV2({ leaf, side, size, limit_price, salt, pair_id, batch_id, expiry, maq, tier }) {
  const { H } = await crypto();
  const leafN = parseLeaf(leaf, "leaf");
  const sideN = parseInteger(side, "side");
  if (sideN !== 0n && sideN !== 1n) throw new Error("side must be 0 (sell) or 1 (buy)");
  const sizeN = assertU64(size, "size");
  const limitN = assertU64(limit_price, "limit_price");
  const saltN = parseField(salt, "salt");
  const pairN = assertU32(pair_id, "pair_id");
  const batchN = assertU64(batch_id, "batch_id");
  const expiryN = assertU64(expiry, "expiry");
  const maqN = assertU64(maq, "maq");
  const tierN = assertU32(tier, "tier");
  if (sizeN <= 0n) throw new Error("size must be positive");
  if (limitN <= 0n) throw new Error("limit_price must be positive");
  if (maqN > sizeN) throw new Error("maq must be less than or equal to size");

  const note = H([DOM_ORDER, leafN, sideN, pairN, sizeN, limitN, saltN, batchN, expiryN, maqN, tierN]);
  const nf_order = H([DOM_NFORD, saltN, note]);
  return {
    leaf: be32(leafN),
    note: be32(note),
    nf_order: be32(nf_order),
    pair_id: Number(pairN),
    batch_id: batchN.toString(),
    expiry: expiryN.toString(),
    maq: maqN.toString(),
    tier: Number(tierN),
    values: {
      leaf: leafN,
      side: sideN,
      size: sizeN,
      limit_price: limitN,
      salt: saltN,
      pair_id: pairN,
      batch_id: batchN,
      expiry: expiryN,
      maq: maqN,
      tier: tierN,
      note,
      nf_order,
    },
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

export async function verifyOrderV2Proof(proof, publicSignals) {
  return snarkjs.groth16.verify(require(ORDER_V2_VK), publicSignals, proof);
}

export async function verifyMatchV2Proof(proof, publicSignals) {
  return snarkjs.groth16.verify(require(MATCH_V2_VK), publicSignals, proof);
}

export async function verifyMatchV3Proof(proof, publicSignals) {
  return snarkjs.groth16.verify(require(MATCH_V3_VK), publicSignals, proof);
}

export async function buildOrderV2Witness({ sk, side, size, limit_price, salt, pair_id, batch_id, expiry, maq, tier, tree, leafIndex }) {
  if (!tree || !Array.isArray(tree.levels) || !Array.isArray(tree.leaves)) throw new Error("tree is required");
  const { H } = await crypto();
  const identity = await identityFromSk(sk);
  const index = assertLeafIndex(leafIndex);
  if (tree.leaves[index] !== identity.leaf) throw new Error("sk does not match registered leafIndex");

  const sideN = parseInteger(side, "side");
  if (sideN !== 0n && sideN !== 1n) throw new Error("side must be 0 (sell) or 1 (buy)");
  const sizeN = assertU64(size, "size");
  const limitN = assertU64(limit_price, "limit_price");
  const saltN = parseField(salt, "salt");
  const pairN = assertU32(pair_id, "pair_id");
  const batchN = assertU64(batch_id, "batch_id");
  const expiryN = assertU64(expiry, "expiry");
  const maqN = assertU64(maq, "maq");
  const tierN = assertU32(tier, "tier");
  if (sizeN <= 0n) throw new Error("size must be positive");
  if (limitN <= 0n) throw new Error("limit_price must be positive");
  if (maqN > sizeN) throw new Error("maq must be less than or equal to size");

  const p = pathOf(tree.levels, index);
  const note = H([DOM_ORDER, identity.leaf, sideN, pairN, sizeN, limitN, saltN, batchN, expiryN, maqN, tierN]);
  const nf_order = H([DOM_NFORD, saltN, note]);
  return {
    input: {
      sk: identity.sk.toString(), side: sideN.toString(), size: sizeN.toString(), limit_price: limitN.toString(),
      salt: saltN.toString(), path_el: p.el.map(String), path_idx: p.id.map(String),
      pair_id: pairN.toString(), batch_id: batchN.toString(), root: tree.root.toString(),
      expiry: expiryN.toString(), maq: maqN.toString(), tier: tierN.toString(),
    },
    note,
    nf_order,
    leaf: identity.leaf,
    root: tree.root,
    pair_id: pairN,
    batch_id: batchN,
    expiry: expiryN,
    maq: maqN,
    tier: tierN,
  };
}

export async function proveOrderV2(params) {
  const witness = await buildOrderV2Witness(params);
  const proved = await proveAndVerify(
    witness.input,
    ORDER_V2_WASM,
    ORDER_V2_ZKEY,
    ORDER_V2_VK,
    [witness.note, witness.nf_order, witness.pair_id, witness.batch_id, witness.root, witness.expiry, witness.maq, witness.tier],
    "order v2",
  );
  return {
    proof: proved.proof,
    rawProof: proved.rawProof,
    publicSignals: proved.publicSignals,
    note: be32(witness.note),
    nf_order: be32(witness.nf_order),
    leaf: be32(witness.leaf),
    root: be32(witness.root),
    pair_id: Number(witness.pair_id),
    batch_id: witness.batch_id.toString(),
    expiry: witness.expiry.toString(),
    maq: witness.maq.toString(),
    tier: Number(witness.tier),
  };
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

export async function buildMatchV2Witness({ sell, buy, pair_id, batch_id, tree }) {
  const { H } = await crypto();
  const pairN = assertU32(pair_id, "pair_id");
  const batchN = assertU64(batch_id, "batch_id");
  const rootN = tree?.root !== undefined ? parseLeaf(tree.root, "root") : parseLeaf(sell?.root ?? buy?.root, "root");
  const leafSell = parseLeaf(sell?.leaf, "sell.leaf");
  const leafBuy = parseLeaf(buy?.leaf, "buy.leaf");
  if (leafSell === leafBuy) throw new Error("sell.leaf and buy.leaf must differ");
  if (sell?.side !== undefined && parseInteger(sell.side, "sell.side") !== 0n) throw new Error("sell.side must be 0");
  if (buy?.side !== undefined && parseInteger(buy.side, "buy.side") !== 1n) throw new Error("buy.side must be 1");

  const sizeSell = assertU64(sell.size, "sell.size");
  const sizeBuy = assertU64(buy.size, "buy.size");
  const limitSell = assertU64(sell.limit_price, "sell.limit_price");
  const limitBuy = assertU64(buy.limit_price, "buy.limit_price");
  const saltSell = parseField(sell.salt, "sell.salt");
  const saltBuy = parseField(buy.salt, "buy.salt");
  const expirySell = assertU64(sell.expiry, "sell.expiry");
  const expiryBuy = assertU64(buy.expiry, "buy.expiry");
  const maqSell = assertU64(sell.maq, "sell.maq");
  const maqBuy = assertU64(buy.maq, "buy.maq");
  const tierSell = assertU32(sell.tier, "sell.tier");
  const tierBuy = assertU32(buy.tier, "buy.tier");
  if (sizeSell <= 0n || sizeBuy <= 0n) throw new Error("order size must be positive");
  if (limitSell <= 0n || limitBuy <= 0n) throw new Error("limit_price must be positive");
  if (sizeSell !== sizeBuy) throw new Error("dark-pool match requires equal order sizes");
  if (maqSell > sizeSell) throw new Error("sell.maq must be less than or equal to sell.size");
  if (maqBuy > sizeBuy) throw new Error("buy.maq must be less than or equal to buy.size");

  const sum = limitSell + limitBuy;
  const cross = sum / 2n;
  const parity = sum % 2n;
  if (limitSell > cross || cross > limitBuy) throw new Error("orders do not cross at midpoint");
  const product = sizeSell * cross;
  const quote = assertU127(product / SCALE, "fill_quote");
  const rem = product % SCALE;

  const noteSell = H([DOM_ORDER, leafSell, 0n, pairN, sizeSell, limitSell, saltSell, batchN, expirySell, maqSell, tierSell]);
  const noteBuy = H([DOM_ORDER, leafBuy, 1n, pairN, sizeBuy, limitBuy, saltBuy, batchN, expiryBuy, maqBuy, tierBuy]);
  if (sell.note !== undefined && parseLeaf(sell.note, "sell.note") !== noteSell) {
    throw new Error("sell note does not match submitted order opening");
  }
  if (buy.note !== undefined && parseLeaf(buy.note, "buy.note") !== noteBuy) {
    throw new Error("buy note does not match submitted order opening");
  }
  const nfSell = H([DOM_NFSPEND, saltSell, noteSell]);
  const nfBuy = H([DOM_NFSPEND, saltBuy, noteBuy]);
  const matchId = H([DOM_MATCH, noteSell, noteBuy, pairN, batchN, rootN]);
  const leafDiffInv = inverseMod(leafSell - leafBuy, FIELD_MODULUS);

  return {
    input: {
      leaf_sell_w: leafSell.toString(), size_sell: sizeSell.toString(), limit_sell: limitSell.toString(),
      salt_sell: saltSell.toString(), expiry_sell: expirySell.toString(), maq_sell: maqSell.toString(),
      tier_sell: tierSell.toString(),
      leaf_buy_w: leafBuy.toString(), size_buy: sizeBuy.toString(), limit_buy: limitBuy.toString(),
      salt_buy: saltBuy.toString(), expiry_buy: expiryBuy.toString(), maq_buy: maqBuy.toString(),
      tier_buy: tierBuy.toString(),
      cross_price: cross.toString(), parity: parity.toString(), quote_amount_w: quote.toString(),
      rem: rem.toString(), leaf_diff_inv: leafDiffInv.toString(),
      pair_id: pairN.toString(), batch_id: batchN.toString(), root: rootN.toString(),
    },
    match_id: matchId,
    note_sell: noteSell,
    note_buy: noteBuy,
    nf_sell: nfSell,
    nf_buy: nfBuy,
    leaf_sell: leafSell,
    leaf_buy: leafBuy,
    fill_base: sizeSell,
    fill_quote: quote,
    pair_id: pairN,
    batch_id: batchN,
    root: rootN,
  };
}

export async function proveMatchV2(params) {
  const witness = await buildMatchV2Witness(params);
  const proved = await proveAndVerify(
    witness.input,
    MATCH_V2_WASM,
    MATCH_V2_ZKEY,
    MATCH_V2_VK,
    [
      witness.match_id,
      witness.note_sell,
      witness.note_buy,
      witness.nf_sell,
      witness.nf_buy,
      witness.leaf_sell,
      witness.leaf_buy,
      witness.fill_base,
      witness.fill_quote,
      witness.pair_id,
      witness.batch_id,
      witness.root,
    ],
    "match v2",
  );
  return {
    proof: proved.proof,
    rawProof: proved.rawProof,
    publicSignals: proved.publicSignals,
    match_id: be32(witness.match_id),
    note_sell: be32(witness.note_sell),
    note_buy: be32(witness.note_buy),
    nf_sell: be32(witness.nf_sell),
    nf_buy: be32(witness.nf_buy),
    leaf_sell: be32(witness.leaf_sell),
    leaf_buy: be32(witness.leaf_buy),
    fill_base: witness.fill_base.toString(),
    fill_quote: witness.fill_quote.toString(),
    base_amount: witness.fill_base.toString(),
    quote_amount: witness.fill_quote.toString(),
  };
}

export async function buildMatchV3Witness({
  sell,
  buy,
  pair_id,
  batch_id,
  tree,
  cross_price,
  fill_base,
  change_salt_sell,
  change_salt_buy,
  assigned_tier_sell,
  assigned_tier_buy,
}) {
  const { H } = await crypto();
  const pairN = assertU32(pair_id, "pair_id");
  const batchN = assertU64(batch_id, "batch_id");
  const rootN = tree?.root !== undefined ? parseLeaf(tree.root, "root") : parseLeaf(sell?.root ?? buy?.root, "root");
  const leafSell = parseLeaf(sell?.leaf, "sell.leaf");
  const leafBuy = parseLeaf(buy?.leaf, "buy.leaf");
  if (leafSell === leafBuy) throw new Error("sell.leaf and buy.leaf must differ");
  if (sell?.side !== undefined && parseInteger(sell.side, "sell.side") !== 0n) throw new Error("sell.side must be 0");
  if (buy?.side !== undefined && parseInteger(buy.side, "buy.side") !== 1n) throw new Error("buy.side must be 1");

  const sizeSell = assertU64(sell.size, "sell.size");
  const sizeBuy = assertU64(buy.size, "buy.size");
  const limitSell = assertU64(sell.limit_price, "sell.limit_price");
  const limitBuy = assertU64(buy.limit_price, "buy.limit_price");
  const saltSell = parseField(sell.salt, "sell.salt");
  const saltBuy = parseField(buy.salt, "buy.salt");
  const expirySell = assertU64(sell.expiry, "sell.expiry");
  const expiryBuy = assertU64(buy.expiry, "buy.expiry");
  const maqSell = assertU64(sell.maq, "sell.maq");
  const maqBuy = assertU64(buy.maq, "buy.maq");
  const tierSell = assertU32(sell.tier, "sell.tier");
  const tierBuy = assertU32(buy.tier, "buy.tier");
  const fillBase = assertU64(fill_base, "fill_base");
  const cross = assertU64(cross_price, "cross_price");
  const changeSaltSell = parseField(change_salt_sell, "change_salt_sell");
  const changeSaltBuy = parseField(change_salt_buy, "change_salt_buy");
  const assignedTierSell = assertU32(assigned_tier_sell, "assigned_tier_sell");
  const assignedTierBuy = assertU32(assigned_tier_buy, "assigned_tier_buy");
  if (sizeSell <= 0n || sizeBuy <= 0n) throw new Error("order size must be positive");
  if (limitSell <= 0n || limitBuy <= 0n) throw new Error("limit_price must be positive");
  if (fillBase <= 0n) throw new Error("fill_base must be positive");
  if (fillBase > sizeSell || fillBase > sizeBuy) throw new Error("fill_base must be less than or equal to both order sizes");
  if (fillBase < maqSell || fillBase < maqBuy) throw new Error("fill_base must satisfy both order MAQs");
  if (assignedTierBuy < tierSell) throw new Error("buy assigned tier does not satisfy sell requirement");
  if (assignedTierSell < tierBuy) throw new Error("sell assigned tier does not satisfy buy requirement");

  const sum = limitSell + limitBuy;
  if (sum < 2n * cross || sum > 2n * cross + 1n) throw new Error("cross_price must be the midpoint floor");
  const parity = sum - 2n * cross;
  if (limitSell > cross || cross > limitBuy) throw new Error("orders do not cross at midpoint");
  const product = fillBase * cross;
  const quote = assertU127(product / SCALE, "fill_quote");
  const rem = product % SCALE;
  if (quote <= 0n) throw new Error("fill_quote must be positive");

  const noteSell = H([DOM_ORDER, leafSell, 0n, pairN, sizeSell, limitSell, saltSell, batchN, expirySell, maqSell, tierSell]);
  const noteBuy = H([DOM_ORDER, leafBuy, 1n, pairN, sizeBuy, limitBuy, saltBuy, batchN, expiryBuy, maqBuy, tierBuy]);
  if (sell.note !== undefined && parseLeaf(sell.note, "sell.note") !== noteSell) {
    throw new Error("sell note does not match submitted order opening");
  }
  if (buy.note !== undefined && parseLeaf(buy.note, "buy.note") !== noteBuy) {
    throw new Error("buy note does not match submitted order opening");
  }
  const nfSell = H([DOM_NFSPEND, saltSell, noteSell]);
  const nfBuy = H([DOM_NFSPEND, saltBuy, noteBuy]);
  const residualSell = sizeSell - fillBase;
  const residualBuy = sizeBuy - fillBase;
  const rawChangeNoteSell = H([DOM_ORDER, leafSell, 0n, pairN, residualSell, limitSell, changeSaltSell, batchN, expirySell, maqSell, tierSell]);
  const rawChangeNoteBuy = H([DOM_ORDER, leafBuy, 1n, pairN, residualBuy, limitBuy, changeSaltBuy, batchN, expiryBuy, maqBuy, tierBuy]);
  const changeNoteSell = residualSell === 0n ? 0n : rawChangeNoteSell;
  const changeNoteBuy = residualBuy === 0n ? 0n : rawChangeNoteBuy;
  const changeNfOrderSell = residualSell === 0n ? 0n : H([DOM_NFORD, changeSaltSell, rawChangeNoteSell]);
  const changeNfOrderBuy = residualBuy === 0n ? 0n : H([DOM_NFORD, changeSaltBuy, rawChangeNoteBuy]);
  const matchId = H([DOM_MATCH, noteSell, noteBuy, pairN, batchN, rootN]);
  const leafDiffInv = inverseMod(leafSell - leafBuy, FIELD_MODULUS);

  return {
    input: {
      leaf_sell_w: leafSell.toString(), size_sell: sizeSell.toString(), limit_sell: limitSell.toString(),
      salt_sell: saltSell.toString(), expiry_sell: expirySell.toString(), maq_sell: maqSell.toString(),
      tier_sell: tierSell.toString(),
      leaf_buy_w: leafBuy.toString(), size_buy: sizeBuy.toString(), limit_buy: limitBuy.toString(),
      salt_buy: saltBuy.toString(), expiry_buy: expiryBuy.toString(), maq_buy: maqBuy.toString(),
      tier_buy: tierBuy.toString(),
      fill_base_w: fillBase.toString(), cross_price: cross.toString(), parity: parity.toString(),
      quote_amount_w: quote.toString(), rem: rem.toString(), leaf_diff_inv: leafDiffInv.toString(),
      change_salt_sell: changeSaltSell.toString(), change_salt_buy: changeSaltBuy.toString(),
      assigned_tier_sell_w: assignedTierSell.toString(), assigned_tier_buy_w: assignedTierBuy.toString(),
      pair_id: pairN.toString(), batch_id: batchN.toString(), root: rootN.toString(),
    },
    match_id: matchId,
    note_sell: noteSell,
    note_buy: noteBuy,
    nf_sell: nfSell,
    nf_buy: nfBuy,
    leaf_sell: leafSell,
    leaf_buy: leafBuy,
    fill_base: fillBase,
    fill_quote: quote,
    change_note_sell: changeNoteSell,
    change_note_buy: changeNoteBuy,
    assigned_tier_sell: assignedTierSell,
    assigned_tier_buy: assignedTierBuy,
    pair_id: pairN,
    batch_id: batchN,
    root: rootN,
    changeSell: {
      size: residualSell,
      change_salt: changeSaltSell,
      note: changeNoteSell,
      nf_order: changeNfOrderSell,
    },
    changeBuy: {
      size: residualBuy,
      change_salt: changeSaltBuy,
      note: changeNoteBuy,
      nf_order: changeNfOrderBuy,
    },
  };
}

export async function proveMatchV3(params) {
  const witness = await buildMatchV3Witness(params);
  const proved = await proveAndVerify(
    witness.input,
    MATCH_V3_WASM,
    MATCH_V3_ZKEY,
    MATCH_V3_VK,
    [
      witness.match_id,
      witness.note_sell,
      witness.note_buy,
      witness.nf_sell,
      witness.nf_buy,
      witness.leaf_sell,
      witness.leaf_buy,
      witness.fill_base,
      witness.fill_quote,
      witness.change_note_sell,
      witness.change_note_buy,
      witness.assigned_tier_sell,
      witness.assigned_tier_buy,
      witness.pair_id,
      witness.batch_id,
      witness.root,
    ],
    "match v3",
  );
  return {
    proof: proved.proof,
    rawProof: proved.rawProof,
    publicSignals: proved.publicSignals,
    match_id: be32(witness.match_id),
    note_sell: be32(witness.note_sell),
    note_buy: be32(witness.note_buy),
    nf_sell: be32(witness.nf_sell),
    nf_buy: be32(witness.nf_buy),
    leaf_sell: be32(witness.leaf_sell),
    leaf_buy: be32(witness.leaf_buy),
    fill_base: witness.fill_base.toString(),
    fill_quote: witness.fill_quote.toString(),
    change_note_sell: be32(witness.change_note_sell),
    change_note_buy: be32(witness.change_note_buy),
    assigned_tier_sell: Number(witness.assigned_tier_sell),
    assigned_tier_buy: Number(witness.assigned_tier_buy),
    base_amount: witness.fill_base.toString(),
    quote_amount: witness.fill_quote.toString(),
    changeSell: {
      size: witness.changeSell.size.toString(),
      change_salt: witness.changeSell.change_salt.toString(),
      note: be32(witness.changeSell.note),
      nf_order: be32(witness.changeSell.nf_order),
    },
    changeBuy: {
      size: witness.changeBuy.size.toString(),
      change_salt: witness.changeBuy.change_salt.toString(),
      note: be32(witness.changeBuy.note),
      nf_order: be32(witness.changeBuy.nf_order),
    },
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
