// Client-side crypto for Crossed OTC — MIRRORS circuits/gen_otc_inputs.js + intent/match.circom EXACTLY.
// baby-jubjub ECDH (cofactor-cleared x8), Poseidon trade_hash/rdv/C/nf/terms_hash/match_id,
// depth-4 Merkle, in-browser Groth16 proving (snarkjs), Soroban byte encoding, AEAD relay envelope.
import { buildBabyjub, buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

export const DEPTH = 4;
export const N_LEAVES = 1 << DEPTH;
const MASK_128 = (1n << 128n) - 1n;
const DOM_RDV = 1n, DOM_DIR = 2n, DOM_NF = 3n, DOM_NFKEY = 4n, DOM_MATCH = 5n, DOM_TRADE = 6n, DOM_TERMS = 7n, DOM_COMMIT = 8n;
const DOM_ORDER = 9n, DOM_NFORD = 10n, DOM_NFCANCEL = 12n;

const INTENT_WASM = "/circuits/intent.wasm";
const INTENT_ZKEY = "/circuits/intent_final.zkey";
const INTENT_VK = "/circuits/intent_vk.json";
const MATCH_WASM = "/circuits/match.wasm";
const MATCH_ZKEY = "/circuits/match_final.zkey";
const MATCH_VK = "/circuits/match_vk.json";
const ORDER_WASM = "/circuits/order.wasm";
const ORDER_ZKEY = "/circuits/order_final.zkey";
const ORDER_VK = "/circuits/order_vk.json";
const CANCEL_ORDER_WASM = "/circuits/cancel_order.wasm";
const CANCEL_ORDER_ZKEY = "/circuits/cancel_order_final.zkey";
const CANCEL_ORDER_VK = "/circuits/cancel_order_vk.json";

// Memoized proving keys (the zkeys are multi-MB) so the first proof doesn't wait on a download.
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
// Call after the user connects so the big order/cancel zkeys (+ wasm) are warm before the first order.
export function prefetchOrderArtifacts() {
  void loadZkey(ORDER_ZKEY); void loadZkey(CANCEL_ORDER_ZKEY);
  void fetch(ORDER_WASM); void fetch(CANCEL_ORDER_WASM);
}

let _bj: any, _pos: any, _F: any;
export async function init() {
  if (_pos) return;
  _bj = await buildBabyjub();
  _pos = await buildPoseidon();
  _F = _pos.F;
}
const H = (a: bigint[]): bigint => _F.toObject(_pos(a));
const Fadd = (a: bigint, b: bigint) => _F.toObject(_F.add(_F.e(a), _F.e(b)));
const Fmul = (a: bigint, b: bigint) => _F.toObject(_F.mul(_F.e(a), _F.e(b)));

export interface Identity { sk: bigint; pkX: bigint; pkY: bigint; hSk: bigint; }
export interface Party { handle: string; index: number; pkX: bigint; pkY: bigint; hSk: bigint; }
export interface Split { hi: bigint; lo: bigint; }
export interface TradeSpec {
  sellAsset: Split; buyAsset: Split; sellAmount: bigint; buyAmount: bigint;
  direction: bigint; counterparty: [bigint, bigint]; epoch: bigint; expiry: bigint;
  chainId: Split; contractId: Split; nonce: bigint;
}

export function splitBytes32(hex: string): Split {
  const v = BigInt(hex.startsWith("0x") ? hex : "0x" + hex);
  return { hi: v >> 128n, lo: v & MASK_128 };
}
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
export const randomNonce = () => randBelow(1n << 128n);

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
export const rootOf = (leaves: bigint[]) => buildLevels(leaves)[buildLevels(leaves).length - 1][0];
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
function normalizedLeaves(raw: Array<bigint | string>): bigint[] {
  if (raw.length > N_LEAVES) throw new Error(`directory is full at ${N_LEAVES} leaves`);
  const leaves = raw.map((leaf, i) => parseFieldLike(leaf, `leaves[${i}]`));
  while (leaves.length < N_LEAVES) leaves.push(0n);
  return leaves;
}

// ---- core hashes (exact mirror of gen_otc_inputs.js) ----
function ecdhPairSecret(skSelf: bigint, partnerPkX: bigint, partnerPkY: bigint): bigint {
  const partnerPt = [_bj.F.e(partnerPkX), _bj.F.e(partnerPkY)];
  const partner8 = _bj.mulPointEscalar(partnerPt, 8n);          // cofactor-clear
  const shared = _bj.mulPointEscalar(partner8, skSelf);
  return H([_bj.F.toObject(shared[0]), _bj.F.toObject(shared[1])]);
}
function rdvOf(self: Identity, pPkX: bigint, pPkY: bigint, epoch: bigint, chainId: Split, contractId: Split): bigint {
  const psec = ecdhPairSecret(self.sk, pPkX, pPkY);
  return H([DOM_RDV, psec, Fadd(self.pkX, pPkX), Fmul(self.pkX, pPkX), Fadd(self.pkY, pPkY), Fmul(self.pkY, pPkY),
    epoch, chainId.hi, chainId.lo, contractId.hi, contractId.lo]);
}
const dirOf = (axX: bigint, axY: bigint, bxX: bigint, bxY: bigint) => H([DOM_DIR, axX, axY, bxX, bxY]);
function tradeHash(s: TradeSpec): bigint {
  return H([DOM_TRADE,
    H([DOM_TRADE, s.sellAsset.hi, s.sellAsset.lo, s.buyAsset.hi, s.buyAsset.lo, s.sellAmount, s.buyAmount, s.direction, s.counterparty[0]]),
    H([DOM_TRADE, s.counterparty[1], s.epoch, s.expiry, s.chainId.hi, s.chainId.lo, s.contractId.hi, s.contractId.lo, s.nonce])]);
}
function termsHash(s: TradeSpec): bigint {
  const l0a = s.direction === 0n ? s.sellAsset : s.buyAsset;
  const l0amt = s.direction === 0n ? s.sellAmount : s.buyAmount;
  const l1a = s.direction === 0n ? s.buyAsset : s.sellAsset;
  const l1amt = s.direction === 0n ? s.buyAmount : s.sellAmount;
  return H([DOM_TERMS, l0a.hi, l0a.lo, l0amt, l1a.hi, l1a.lo, l1amt, s.epoch, s.expiry, s.chainId.hi, s.chainId.lo, s.contractId.hi, s.contractId.lo]);
}

// ---- intent witness ----
export interface IntentArtifacts { input: Record<string, any>; C: bigint; nf: bigint; rdv: bigint; salt: bigint; root: bigint; tradeHash: bigint; }
export function buildIntent(self: Identity, selfIdx: number, partner: Party, salt: bigint, spec: TradeSpec, leaves: bigint[]): IntentArtifacts {
  const levels = buildLevels(leaves); const root = levels[levels.length - 1][0];
  const sp = pathOf(levels, selfIdx); const pp = pathOf(levels, partner.index);
  const rdv = rdvOf(self, partner.pkX, partner.pkY, spec.epoch, spec.chainId, spec.contractId);
  const dir = dirOf(self.pkX, self.pkY, partner.pkX, partner.pkY);
  const th = tradeHash(spec);
  const nfKey = H([DOM_NFKEY, self.sk]);
  const C = H([DOM_COMMIT, rdv, dir, self.hSk, th, salt]);
  const nf = H([DOM_NF, nfKey, th, spec.epoch, spec.chainId.hi, spec.contractId.hi]);
  const input = {
    sk_self: self.sk.toString(), pk_partner_x: partner.pkX.toString(), pk_partner_y: partner.pkY.toString(),
    salt_self: salt.toString(), H_sk_partner: partner.hSk.toString(),
    path_self_el: sp.el.map(String), path_self_idx: sp.id.map(String),
    path_partner_el: pp.el.map(String), path_partner_idx: pp.id.map(String),
    sell_asset_hi: spec.sellAsset.hi.toString(), sell_asset_lo: spec.sellAsset.lo.toString(),
    buy_asset_hi: spec.buyAsset.hi.toString(), buy_asset_lo: spec.buyAsset.lo.toString(),
    sell_amount: spec.sellAmount.toString(), buy_amount: spec.buyAmount.toString(),
    direction: spec.direction.toString(), counterparty_pk_x: spec.counterparty[0].toString(), counterparty_pk_y: spec.counterparty[1].toString(),
    expiry: spec.expiry.toString(), nonce: spec.nonce.toString(),
    chain_id_hi: spec.chainId.hi.toString(), chain_id_lo: spec.chainId.lo.toString(),
    contract_id_hi: spec.contractId.hi.toString(), contract_id_lo: spec.contractId.lo.toString(),
    epoch: spec.epoch.toString(), root: root.toString(),
  };
  return { input, C, nf, rdv, salt, root, tradeHash: th };
}

// ---- match witness ----
export interface MatchArtifacts { input: Record<string, any>; matchId: bigint; cSelf: bigint; cPartner: bigint; termsHash: bigint; root: bigint; }
export function buildMatch(self: Identity, selfIdx: number, partner: Party, saltSelf: bigint, saltPartner: bigint, specSelf: TradeSpec, specPartner: TradeSpec, leaves: bigint[]): MatchArtifacts {
  const levels = buildLevels(leaves); const root = levels[levels.length - 1][0];
  const sp = pathOf(levels, selfIdx); const pp = pathOf(levels, partner.index);
  const rdv = rdvOf(self, partner.pkX, partner.pkY, specSelf.epoch, specSelf.chainId, specSelf.contractId);
  const dirSelf = dirOf(self.pkX, self.pkY, partner.pkX, partner.pkY);
  const dirPartner = dirOf(partner.pkX, partner.pkY, self.pkX, self.pkY);
  const cSelf = H([DOM_COMMIT, rdv, dirSelf, self.hSk, tradeHash(specSelf), saltSelf]);
  const cPartner = H([DOM_COMMIT, rdv, dirPartner, partner.hSk, tradeHash(specPartner), saltPartner]);
  const th = termsHash(specSelf);
  const [lo, hi] = saltSelf < saltPartner ? [saltSelf, saltPartner] : [saltPartner, saltSelf];
  const matchId = H([DOM_MATCH, rdv, th, lo, hi]);
  const input = {
    sk_self: self.sk.toString(), pk_partner_x: partner.pkX.toString(), pk_partner_y: partner.pkY.toString(),
    salt_self: saltSelf.toString(), salt_partner: saltPartner.toString(), H_sk_partner: partner.hSk.toString(),
    path_self_el: sp.el.map(String), path_self_idx: sp.id.map(String),
    path_partner_el: pp.el.map(String), path_partner_idx: pp.id.map(String),
    self_sell_asset_hi: specSelf.sellAsset.hi.toString(), self_sell_asset_lo: specSelf.sellAsset.lo.toString(),
    self_buy_asset_hi: specSelf.buyAsset.hi.toString(), self_buy_asset_lo: specSelf.buyAsset.lo.toString(),
    self_sell_amount: specSelf.sellAmount.toString(), self_buy_amount: specSelf.buyAmount.toString(),
    self_direction: specSelf.direction.toString(),
    self_counterparty_pk_x: specSelf.counterparty[0].toString(), self_counterparty_pk_y: specSelf.counterparty[1].toString(),
    self_expiry: specSelf.expiry.toString(), self_nonce: specSelf.nonce.toString(),
    partner_sell_asset_hi: specPartner.sellAsset.hi.toString(), partner_sell_asset_lo: specPartner.sellAsset.lo.toString(),
    partner_buy_asset_hi: specPartner.buyAsset.hi.toString(), partner_buy_asset_lo: specPartner.buyAsset.lo.toString(),
    partner_sell_amount: specPartner.sellAmount.toString(), partner_buy_amount: specPartner.buyAmount.toString(),
    partner_direction: specPartner.direction.toString(),
    partner_counterparty_pk_x: specPartner.counterparty[0].toString(), partner_counterparty_pk_y: specPartner.counterparty[1].toString(),
    partner_expiry: specPartner.expiry.toString(), partner_nonce: specPartner.nonce.toString(),
    chain_id_hi: specSelf.chainId.hi.toString(), chain_id_lo: specSelf.chainId.lo.toString(),
    contract_id_hi: specSelf.contractId.hi.toString(), contract_id_lo: specSelf.contractId.lo.toString(),
    epoch: specSelf.epoch.toString(), expiry: specSelf.expiry.toString(), root: root.toString(),
  };
  return { input, matchId, cSelf, cPartner, termsHash: th, root };
}

// ---- proving ----
export async function proveIntent(input: Record<string, unknown>) {
  return snarkjs.groth16.fullProve(input, INTENT_WASM, INTENT_ZKEY);
}
export async function proveMatch(input: Record<string, unknown>) {
  return snarkjs.groth16.fullProve(input, MATCH_WASM, MATCH_ZKEY);
}
export async function verifyIntentLocal(proof: unknown, pub: unknown) {
  return snarkjs.groth16.verify(await (await fetch(INTENT_VK)).json(), pub as any, proof as any);
}
export async function verifyOrderLocal(proof: unknown, pub: unknown) {
  return snarkjs.groth16.verify(await (await fetch(ORDER_VK)).json(), pub as any, proof as any);
}
export async function verifyCancelOrderLocal(proof: unknown, pub: unknown) {
  return snarkjs.groth16.verify(await (await fetch(CANCEL_ORDER_VK)).json(), pub as any, proof as any);
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

// ---- Soroban byte encoding (G2 imaginary-first) ----
const be32 = (v: bigint | string) => BigInt(v).toString(16).padStart(64, "0");
const g1 = (p: string[]) => be32(p[0]) + be32(p[1]);
const g2 = (p: string[][]) => be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0]);
export const frHex = (v: bigint) => be32(v);
export const toContractProof = (proof: any) => ({ a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) });

// rendezvous token + inbox for the relayer (both parties derive same rdv -> same token)
export const rendezvousToken = (rdv: bigint) => be32(H([rdv, 99n]));
export const inboxOf = (rdv: bigint, selfPkX: bigint) => (rendezvousToken(rdv).slice(0, 32) + frHex(selfPkX).slice(0, 32));

// ---- AEAD envelope (HKDF-SHA256 -> AES-256-GCM), matches relayer spec ----
const enc = new TextEncoder();
const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => { s = s.replace(/-/g, "+").replace(/_/g, "/"); return new Uint8Array([...atob(s)].map(c => c.charCodeAt(0))); };
const hexBytes = (hex: string) => { const h = hex.replace(/^0x/, "").padStart(64, "0"); const o = new Uint8Array(32); for (let i = 0; i < 32; i++) o[i] = parseInt(h.substr(i * 2, 2), 16); return o; };
function u64be(v: bigint) { const o = new Uint8Array(8); let x = v; for (let i = 7; i >= 0; i--) { o[i] = Number(x & 0xffn); x >>= 8n; } return o; }
function cat(...arrs: Uint8Array[]) { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let p = 0; for (const a of arrs) { o.set(a, p); p += a.length; } return o; }

async function relayKey(rdv: bigint, chainIdHex: string, contractIdHex: string, epoch: bigint): Promise<CryptoKey> {
  const ikm = hexBytes(frHex(rdv));
  const salt = cat(hexBytes(chainIdHex), hexBytes(contractIdHex), u64be(epoch));
  const base = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info: enc.encode("CrossedOTC envelope v1") },
    base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}
function aad(chainIdHex: string, contractIdHex: string, recordId: number, cHex: string, token: string, inbox: string, epoch: bigint) {
  return cat(hexBytes(chainIdHex), hexBytes(contractIdHex), u64be(BigInt(recordId)), hexBytes(cHex), hexBytes(token), hexBytes(inbox), u64be(epoch));
}
export async function sealEnvelope(plain: any, rdv: bigint, chainIdHex: string, contractIdHex: string, epoch: bigint, recordId: number, cHex: string, token: string, inbox: string) {
  const key = await relayKey(rdv, chainIdHex, contractIdHex, epoch);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ad = aad(chainIdHex, contractIdHex, recordId, cHex, token, inbox, epoch);
  const ctTag = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, additionalData: ad }, key, enc.encode(JSON.stringify(plain))));
  const tag = ctTag.slice(ctTag.length - 16); const ct = ctTag.slice(0, ctTag.length - 16);
  return { v: 1, alg: "AES-256-GCM", nonce: b64u(nonce), ciphertext: b64u(ct), tag: b64u(tag) };
}
export async function openEnvelope(env: any, rdv: bigint, chainIdHex: string, contractIdHex: string, epoch: bigint, recordId: number, cHex: string, token: string, inbox: string) {
  const key = await relayKey(rdv, chainIdHex, contractIdHex, epoch);
  const nonce = unb64u(env.nonce); const ct = unb64u(env.ciphertext); const tag = unb64u(env.tag);
  const ad = aad(chainIdHex, contractIdHex, recordId, cHex, token, inbox, epoch);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, additionalData: ad }, key, cat(ct, tag));
  return JSON.parse(new TextDecoder().decode(pt));
}
