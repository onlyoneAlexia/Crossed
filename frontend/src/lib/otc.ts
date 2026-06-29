// Client-side dark-pool crypto: Poseidon commitments, depth-4 Merkle paths,
// in-browser Groth16 proving (snarkjs), Soroban byte encoding, and AEAD helpers.
import { buildBabyjub, buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

const DEPTH = 4;
const N_LEAVES = 1 << DEPTH;
const DOM_ORDER = 9n, DOM_NFORD = 10n, DOM_NFCANCEL = 12n;

const ORDER_WASM = "/circuits/order.wasm";
const ORDER_ZKEY = "/circuits/order_final.zkey";
const ORDER_VK = "/circuits/order_vk.json";
const ORDER_V2_WASM = "/circuits/order_v2.wasm";
const ORDER_V2_ZKEY = "/circuits/order_v2_final.zkey";
const ORDER_V2_VK = "/circuits/order_v2_vk.json";
const CANCEL_ORDER_WASM = "/circuits/cancel_order.wasm";
const CANCEL_ORDER_ZKEY = "/circuits/cancel_order_final.zkey";
const CANCEL_ORDER_VK = "/circuits/cancel_order_vk.json";
const CANCEL_ORDER_V2_WASM = "/circuits/cancel_order_v2.wasm";
const CANCEL_ORDER_V2_ZKEY = "/circuits/cancel_order_v2_final.zkey";
const CANCEL_ORDER_V2_VK = "/circuits/cancel_order_v2_vk.json";
const FIELD_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;

// Memoized proving keys (the zkeys are multi-MB), loaded only when a proof is requested.
const _zkeys = new Map<string, Promise<Uint8Array>>();
function loadZkey(url: string): Promise<Uint8Array> {
  let p = _zkeys.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.arrayBuffer()).then((b) => new Uint8Array(b));
    p.catch(() => { if (_zkeys.get(url) === p) _zkeys.delete(url); }); // don't memoize a failed fetch
    _zkeys.set(url, p);
  }
  return p;
}

let _bj: any, _pos: any, _F: any;
export async function init() {
  if (_pos) return;
  _bj = await buildBabyjub();
  _pos = await buildPoseidon();
  _F = _pos.F;
}
const H = (a: bigint[]): bigint => _F.toObject(_pos(a));

export interface Identity { sk: bigint; pkX: bigint; pkY: bigint; hSk: bigint; }

function randBelow(max: bigint): bigint {
  const b = new Uint8Array(32); crypto.getRandomValues(b);
  let x = 0n; for (const v of b) x = (x << 8n) | BigInt(v);
  return (x % (max - 1n)) + 1n; // 1..max-1
}
export async function createIdentity(): Promise<Identity> {
  await init();
  const sk = randBelow(_bj.subOrder);
  const pk = _bj.mulPointEscalar(_bj.Base8, sk);
  return { sk, pkX: _bj.F.toObject(pk[0]), pkY: _bj.F.toObject(pk[1]), hSk: H([sk]) };
}
export const leafOf = (pkX: bigint, pkY: bigint, hSk: bigint) => H([pkX, pkY, hSk]);
export const randomSalt = () => randBelow(1n << 250n);

// ---- merkle ----
function buildLevels(leaves: bigint[]): bigint[][] {
  const padded = leaves.slice(); while (padded.length < N_LEAVES) padded.push(0n);
  const levels = [padded];
  while (levels[levels.length - 1].length > 1) {
    const lv = levels[levels.length - 1], next: bigint[] = [];
    for (let i = 0; i < lv.length; i += 2) next.push(H([lv[i], lv[i + 1]]));
    levels.push(next);
  }
  return levels;
}
function pathOf(levels: bigint[][], idx: number) {
  const el: bigint[] = [], id: bigint[] = []; let i = idx;
  for (let d = 0; d < DEPTH; d++) { el.push(levels[d][i ^ 1]); id.push(BigInt(i & 1)); i >>= 1; }
  return { el, id };
}
function parseFieldLike(value: bigint | number | string, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
    return BigInt(value);
  }
  const raw = value.trim();
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) return BigInt(raw.startsWith("0x") ? raw : `0x${raw}`);
  if (/^(0|[1-9][0-9]*)$/.test(raw)) return BigInt(raw);
  throw new Error(`${label} must be a decimal field or hex32 string`);
}
function parseDecimalInteger(value: bigint | number | string, label: string): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`${label} must be a safe integer`);
    return BigInt(value);
  }
  const raw = value.trim();
  if (/^(0|[1-9][0-9]*)$/.test(raw)) return BigInt(raw);
  throw new Error(`${label} must be a decimal integer`);
}
function assertField(value: bigint | number | string, label: string): bigint {
  const n = parseFieldLike(value, label);
  if (n < 0n || n >= FIELD_MODULUS) throw new Error(`${label} out of field range`);
  return n;
}
function assertU32(value: bigint | number | string, label: string): bigint {
  const n = parseDecimalInteger(value, label);
  if (n < 0n || n > 0xffffffffn) throw new Error(`${label} must be u32`);
  return n;
}
function assertU64(value: bigint | number | string, label: string): bigint {
  const n = parseDecimalInteger(value, label);
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error(`${label} must be u64`);
  return n;
}
function normalizedLeaves(raw: Array<bigint | string>): bigint[] {
  if (raw.length > N_LEAVES) throw new Error(`directory is full at ${N_LEAVES} leaves`);
  const leaves = raw.map((leaf, i) => parseFieldLike(leaf, `leaves[${i}]`));
  while (leaves.length < N_LEAVES) leaves.push(0n);
  return leaves;
}

// ---- proving ----
async function verifyOrderLocal(proof: unknown, pub: unknown) {
  return snarkjs.groth16.verify(await (await fetch(ORDER_VK)).json(), pub as any, proof as any);
}
async function verifyOrderV2Local(proof: unknown, pub: unknown) {
  return snarkjs.groth16.verify(await (await fetch(ORDER_V2_VK)).json(), pub as any, proof as any);
}
async function verifyCancelOrderLocal(proof: unknown, pub: unknown) {
  return snarkjs.groth16.verify(await (await fetch(CANCEL_ORDER_VK)).json(), pub as any, proof as any);
}
async function verifyCancelOrderV2Local(proof: unknown, pub: unknown) {
  return snarkjs.groth16.verify(await (await fetch(CANCEL_ORDER_V2_VK)).json(), pub as any, proof as any);
}

export interface DpOrderProofArgs {
  identity: Identity;
  index: number;
  side: 0 | 1;
  size: bigint;
  limitPrice: bigint;
  salt: bigint;
  pairId: number;
  batchId: bigint | number | string;
  leaves: Array<bigint | string>;
}
export async function proveDpOrder(args: DpOrderProofArgs) {
  await init();
  if (!Number.isInteger(args.index) || args.index < 0 || args.index >= N_LEAVES) {
    throw new Error(`member index must be between 0 and ${N_LEAVES - 1}`);
  }
  const leaves = normalizedLeaves(args.leaves);
  const leaf = leafOf(args.identity.pkX, args.identity.pkY, args.identity.hSk);
  if (leaves[args.index] !== leaf) throw new Error("local pool identity does not match the registered directory leaf");
  const side = BigInt(args.side);
  const pairId = BigInt(args.pairId);
  const batchId = parseFieldLike(args.batchId, "batchId");
  const levels = buildLevels(leaves);
  const root = levels[levels.length - 1][0];
  const p = pathOf(levels, args.index);
  const note = H([DOM_ORDER, leaf, side, pairId, args.size, args.limitPrice, args.salt, batchId]);
  const nfOrder = H([DOM_NFORD, args.salt, note]);
  const input = {
    sk: args.identity.sk.toString(),
    side: side.toString(),
    size: args.size.toString(),
    limit_price: args.limitPrice.toString(),
    salt: args.salt.toString(),
    path_el: p.el.map(String),
    path_idx: p.id.map(String),
    pair_id: pairId.toString(),
    batch_id: batchId.toString(),
    root: root.toString(),
  };
  const { proof: rawProof, publicSignals } = await snarkjs.groth16.fullProve(input, ORDER_WASM, await loadZkey(ORDER_ZKEY));
  const ok = await verifyOrderLocal(rawProof, publicSignals);
  if (!ok) throw new Error("local order proof verification failed");
  const expected = [note, nfOrder, pairId, batchId, root].map(String);
  expected.forEach((value, index) => {
    if ((publicSignals as string[])[index] !== value) throw new Error(`order publicSignals[${index}] mismatch`);
  });
  return {
    proof: toContractProof(rawProof),
    rawProof,
    publicSignals,
    note: frHex(note),
    nf_order: frHex(nfOrder),
    root: frHex(root),
    leaf: frHex(leaf),
    pair_id: Number(pairId),
    batch_id: batchId.toString(),
  };
}

export interface DpOrderV2ProofArgs extends DpOrderProofArgs {
  expiry: bigint | number | string;
  maq: bigint | number | string;
  tier: bigint | number | string;
}
export async function proveDpOrderV2(args: DpOrderV2ProofArgs) {
  await init();
  if (!Number.isInteger(args.index) || args.index < 0 || args.index >= N_LEAVES) {
    throw new Error(`member index must be between 0 and ${N_LEAVES - 1}`);
  }
  const leaves = normalizedLeaves(args.leaves);
  const leaf = leafOf(args.identity.pkX, args.identity.pkY, args.identity.hSk);
  if (leaves[args.index] !== leaf) throw new Error("local pool identity does not match the registered directory leaf");
  const side = BigInt(args.side);
  if (side !== 0n && side !== 1n) throw new Error("side must be 0 (sell) or 1 (buy)");
  const size = assertU64(args.size, "size");
  const limitPrice = assertU64(args.limitPrice, "limit_price");
  const salt = assertField(args.salt, "salt");
  const pairId = assertU32(args.pairId, "pair_id");
  const batchId = assertU64(args.batchId, "batch_id");
  const expiry = assertU64(args.expiry, "expiry");
  const maq = assertU64(args.maq, "maq");
  const tier = assertU32(args.tier, "tier");
  if (size <= 0n) throw new Error("size must be positive");
  if (limitPrice <= 0n) throw new Error("limit_price must be positive");
  if (maq > size) throw new Error("maq must be less than or equal to size");

  const levels = buildLevels(leaves);
  const root = levels[levels.length - 1][0];
  const p = pathOf(levels, args.index);
  const note = H([DOM_ORDER, leaf, side, pairId, size, limitPrice, salt, batchId, expiry, maq, tier]);
  const nfOrder = H([DOM_NFORD, salt, note]);
  const input = {
    sk: args.identity.sk.toString(),
    side: side.toString(),
    size: size.toString(),
    limit_price: limitPrice.toString(),
    salt: salt.toString(),
    path_el: p.el.map(String),
    path_idx: p.id.map(String),
    pair_id: pairId.toString(),
    batch_id: batchId.toString(),
    root: root.toString(),
    expiry: expiry.toString(),
    maq: maq.toString(),
    tier: tier.toString(),
  };
  const { proof: rawProof, publicSignals } = await snarkjs.groth16.fullProve(input, ORDER_V2_WASM, await loadZkey(ORDER_V2_ZKEY));
  const ok = await verifyOrderV2Local(rawProof, publicSignals);
  if (!ok) throw new Error("local order v2 proof verification failed");
  const expected = [note, nfOrder, pairId, batchId, root, expiry, maq, tier].map(String);
  expected.forEach((value, index) => {
    if ((publicSignals as string[])[index] !== value) throw new Error(`order v2 publicSignals[${index}] mismatch`);
  });
  return {
    proof: toContractProof(rawProof),
    rawProof,
    publicSignals,
    note: frHex(note),
    nf_order: frHex(nfOrder),
    root: frHex(root),
    leaf: frHex(leaf),
    pair_id: Number(pairId),
    batch_id: batchId.toString(),
    expiry: expiry.toString(),
    maq: maq.toString(),
    tier: Number(tier),
  };
}

export interface DpCancelProofArgs {
  identity: Identity;
  index: number;
  side: 0 | 1;
  size: bigint;
  limitPrice: bigint;
  salt: bigint;
  pairId: number;
  batchId: bigint | number | string;
  leaves: Array<bigint | string>;
}
export async function proveDpCancelOrder(args: DpCancelProofArgs) {
  await init();
  if (!Number.isInteger(args.index) || args.index < 0 || args.index >= N_LEAVES) {
    throw new Error(`member index must be between 0 and ${N_LEAVES - 1}`);
  }
  const leaves = normalizedLeaves(args.leaves);
  const leaf = leafOf(args.identity.pkX, args.identity.pkY, args.identity.hSk);
  if (leaves[args.index] !== leaf) throw new Error("local pool identity does not match the registered directory leaf");
  const side = BigInt(args.side);
  const pairId = BigInt(args.pairId);
  const batchId = parseFieldLike(args.batchId, "batchId");
  const levels = buildLevels(leaves);
  const root = levels[levels.length - 1][0];
  const p = pathOf(levels, args.index);
  const note = H([DOM_ORDER, leaf, side, pairId, args.size, args.limitPrice, args.salt, batchId]);
  const nfCancel = H([DOM_NFCANCEL, args.salt, note]);
  const input = {
    sk: args.identity.sk.toString(),
    side: side.toString(),
    size: args.size.toString(),
    limit_price: args.limitPrice.toString(),
    salt: args.salt.toString(),
    path_el: p.el.map(String),
    path_idx: p.id.map(String),
    pair_id: pairId.toString(),
    batch_id: batchId.toString(),
    root: root.toString(),
  };
  const { proof: rawProof, publicSignals } = await snarkjs.groth16.fullProve(input, CANCEL_ORDER_WASM, await loadZkey(CANCEL_ORDER_ZKEY));
  const ok = await verifyCancelOrderLocal(rawProof, publicSignals);
  if (!ok) throw new Error("local cancel proof verification failed");
  const expected = [note, nfCancel, leaf, pairId, batchId, root].map(String);
  expected.forEach((value, index) => {
    if ((publicSignals as string[])[index] !== value) throw new Error(`cancel publicSignals[${index}] mismatch`);
  });
  return {
    proof: toContractProof(rawProof),
    rawProof,
    publicSignals,
    note: frHex(note),
    nf_cancel: frHex(nfCancel),
    leaf: frHex(leaf),
    root: frHex(root),
    pair_id: Number(pairId),
    batch_id: batchId.toString(),
  };
}

export interface DpCancelV2ProofArgs extends DpCancelProofArgs {
  expiry: bigint | number | string;
  maq: bigint | number | string;
  tier: bigint | number | string;
}
export async function proveDpCancelOrderV2(args: DpCancelV2ProofArgs) {
  await init();
  if (!Number.isInteger(args.index) || args.index < 0 || args.index >= N_LEAVES) {
    throw new Error(`member index must be between 0 and ${N_LEAVES - 1}`);
  }
  const leaves = normalizedLeaves(args.leaves);
  const leaf = leafOf(args.identity.pkX, args.identity.pkY, args.identity.hSk);
  if (leaves[args.index] !== leaf) throw new Error("local pool identity does not match the registered directory leaf");
  const side = BigInt(args.side);
  if (side !== 0n && side !== 1n) throw new Error("side must be 0 (sell) or 1 (buy)");
  const size = assertU64(args.size, "size");
  const limitPrice = assertU64(args.limitPrice, "limit_price");
  const salt = assertField(args.salt, "salt");
  const pairId = assertU32(args.pairId, "pair_id");
  const batchId = assertU64(args.batchId, "batch_id");
  const expiry = assertU64(args.expiry, "expiry");
  const maq = assertU64(args.maq, "maq");
  const tier = assertU32(args.tier, "tier");
  if (size <= 0n) throw new Error("size must be positive");
  if (limitPrice <= 0n) throw new Error("limit_price must be positive");
  if (maq > size) throw new Error("maq must be less than or equal to size");

  const levels = buildLevels(leaves);
  const root = levels[levels.length - 1][0];
  const p = pathOf(levels, args.index);
  const note = H([DOM_ORDER, leaf, side, pairId, size, limitPrice, salt, batchId, expiry, maq, tier]);
  const nfCancel = H([DOM_NFCANCEL, args.identity.sk, salt]);
  const input = {
    sk: args.identity.sk.toString(),
    side: side.toString(),
    size: size.toString(),
    limit_price: limitPrice.toString(),
    salt: salt.toString(),
    path_el: p.el.map(String),
    path_idx: p.id.map(String),
    pair_id: pairId.toString(),
    batch_id: batchId.toString(),
    root: root.toString(),
    expiry: expiry.toString(),
    maq: maq.toString(),
    tier: tier.toString(),
  };
  const { proof: rawProof, publicSignals } = await snarkjs.groth16.fullProve(input, CANCEL_ORDER_V2_WASM, await loadZkey(CANCEL_ORDER_V2_ZKEY));
  const ok = await verifyCancelOrderV2Local(rawProof, publicSignals);
  if (!ok) throw new Error("local cancel v2 proof verification failed");
  const expected = [note, nfCancel, leaf, pairId, batchId, root, expiry, maq, tier].map(String);
  expected.forEach((value, index) => {
    if ((publicSignals as string[])[index] !== value) throw new Error(`cancel v2 publicSignals[${index}] mismatch`);
  });
  return {
    proof: toContractProof(rawProof),
    rawProof,
    publicSignals,
    note: frHex(note),
    nf_cancel: frHex(nfCancel),
    leaf: frHex(leaf),
    root: frHex(root),
    pair_id: Number(pairId),
    batch_id: batchId.toString(),
    expiry: expiry.toString(),
    maq: maq.toString(),
    tier: Number(tier),
  };
}

// ---- Soroban byte encoding (G2 imaginary-first) ----
const be32 = (v: bigint | string) => BigInt(v).toString(16).padStart(64, "0");
const g1 = (p: string[]) => be32(p[0]) + be32(p[1]);
const g2 = (p: string[][]) => be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0]);
export const frHex = (v: bigint) => be32(v);
const toContractProof = (proof: any) => ({ a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) });
