// Client-side crypto for Crossed — mirrors circuits/like.circom EXACTLY.
// Identity (baby-jubjub), ECDH rendezvous, Poseidon C/nf (private-key-bound
// nullifier), depth-4 Poseidon Merkle, in-browser Groth16 proving (snarkjs),
// and Soroban byte encoding for the contract.
import { buildBabyjub, buildPoseidon } from "circomlibjs";
import * as snarkjs from "snarkjs";

export const DEPTH = 4;
export const N_LEAVES = 1 << DEPTH;
const DOM_RDV = 1n, DOM_DIR = 2n, DOM_NF = 3n, DOM_NFKEY = 4n, DOM_MATCH = 5n;

const LIKE_WASM = "/circuits/like.wasm";
const LIKE_ZKEY = "/circuits/like_final.zkey";
const LIKE_VK = "/circuits/like_vk.json";
const MATCH_WASM = "/circuits/match.wasm";
const MATCH_ZKEY = "/circuits/match_final.zkey";
const MATCH_VK = "/circuits/match_vk.json";
const SALT_MAX = 1n << 250n; // MATCH circuit range-constrains salts (LessThan(252))

let _babyJub: any, _poseidon: any, _F: any;
export async function init() {
  if (_poseidon) return;
  _babyJub = await buildBabyjub();
  _poseidon = await buildPoseidon();
  _F = _poseidon.F;
}
const H = (arr: bigint[]): bigint => _F.toObject(_poseidon(arr));
const Fadd = (a: bigint, b: bigint) => _F.toObject(_F.add(_F.e(a), _F.e(b)));
const Fmul = (a: bigint, b: bigint) => _F.toObject(_F.mul(_F.e(a), _F.e(b)));

export interface Identity { sk: bigint; pkX: bigint; pkY: bigint; hSk: bigint; }
export interface Profile { handle: string; pkX: bigint; pkY: bigint; hSk: bigint; index: number; }

function randBelow(max: bigint): bigint {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let x = 0n;
  for (const b of bytes) x = (x << 8n) | BigInt(b);
  return x % max;
}

export async function createIdentity(): Promise<Identity> {
  await init();
  const l: bigint = _babyJub.subOrder;
  const sk = randBelow(l);
  const pk = _babyJub.mulPointEscalar(_babyJub.Base8, sk);
  const pkX = _babyJub.F.toObject(pk[0]);
  const pkY = _babyJub.F.toObject(pk[1]);
  const hSk = H([sk]);
  return { sk, pkX, pkY, hSk };
}

export function leafOf(pkX: bigint, pkY: bigint, hSk: bigint): bigint {
  return H([pkX, pkY, hSk]);
}

// Build a full N_LEAVES tree from registered leaves (rest = 0), return levels.
function buildLevels(leaves: bigint[]): bigint[][] {
  const padded = leaves.slice();
  while (padded.length < N_LEAVES) padded.push(0n);
  const levels = [padded];
  while (levels[levels.length - 1].length > 1) {
    const lv = levels[levels.length - 1];
    const next: bigint[] = [];
    for (let i = 0; i < lv.length; i += 2) next.push(H([lv[i], lv[i + 1]]));
    levels.push(next);
  }
  return levels;
}
export function rootOf(leaves: bigint[]): bigint {
  return buildLevels(leaves)[buildLevels(leaves).length - 1][0];
}
function pathOf(levels: bigint[][], idx: number) {
  const el: bigint[] = [], id: bigint[] = [];
  let i = idx;
  for (let d = 0; d < DEPTH; d++) { el.push(levels[d][i ^ 1]); id.push(BigInt(i & 1)); i >>= 1; }
  return { el, id };
}

// Direction-independent rendezvous (symmetric binding, matches the circuit).
function computeRdv(self: Identity, p: Profile, S: bigint[], epoch: bigint): bigint {
  const pairSecret = H([S[0], S[1]]);
  return H([pairSecret, Fadd(self.pkX, p.pkX), Fmul(self.pkX, p.pkX), Fadd(self.pkY, p.pkY), Fmul(self.pkY, p.pkY), epoch, DOM_RDV]);
}
const dirOf = (ax: bigint, ay: bigint, bx: bigint, by: bigint) => H([ax, ay, bx, by, DOM_DIR]);

export interface LikeArtifacts {
  input: Record<string, string | string[]>;
  C: bigint; nf: bigint; rdv: bigint; salt: bigint; epoch: bigint; root: bigint;
}

// Assemble the snarkjs witness input for self liking partner.
export function buildLikeInput(
  self: Identity, selfIndex: number, partner: Profile, leaves: bigint[], epoch: bigint,
): LikeArtifacts {
  const levels = buildLevels(leaves);
  const root = levels[levels.length - 1][0];
  const ps = pathOf(levels, selfIndex);
  const pp = pathOf(levels, partner.index);
  const salt = randBelow(SALT_MAX);

  // expected outputs (for envelope + sanity)
  const S = _babyJub.mulPointEscalar([_babyJub.F.e(partner.pkX), _babyJub.F.e(partner.pkY)], self.sk);
  const Sx = _babyJub.F.toObject(S[0]), Sy = _babyJub.F.toObject(S[1]);
  const rdv = computeRdv(self, partner, [Sx, Sy], epoch);
  const dir = dirOf(self.pkX, self.pkY, partner.pkX, partner.pkY);
  const nfk = H([self.sk, DOM_NFKEY]);
  const C = H([rdv, dir, self.hSk, salt]);
  const nf = H([rdv, dir, nfk, epoch, DOM_NF]);

  const input = {
    sk_self: self.sk.toString(),
    pk_partner_x: partner.pkX.toString(),
    pk_partner_y: partner.pkY.toString(),
    salt_self: salt.toString(),
    H_sk_partner: partner.hSk.toString(),
    path_self_el: ps.el.map(String),
    path_self_idx: ps.id.map(String),
    path_partner_el: pp.el.map(String),
    path_partner_idx: pp.id.map(String),
    epoch: epoch.toString(),
    root: root.toString(),
  };
  return { input, C, nf, rdv, salt, epoch, root };
}

export async function proveLike(input: Record<string, unknown>) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, LIKE_WASM, LIKE_ZKEY);
  return { proof, publicSignals };
}

export interface MatchArtifacts {
  input: Record<string, string | string[]>;
  matchId: bigint; cSelf: bigint; cPartner: bigint; root: bigint;
}
// Build the MATCH witness: prove two opposite-direction records open to the same rdv.
export function buildMatchInput(
  self: Identity, selfIndex: number, partner: Profile,
  saltSelf: bigint, saltPartner: bigint, leaves: bigint[], epoch: bigint,
): MatchArtifacts {
  const levels = buildLevels(leaves);
  const root = levels[levels.length - 1][0];
  const ps = pathOf(levels, selfIndex);
  const pp = pathOf(levels, partner.index);
  const S = _babyJub.mulPointEscalar([_babyJub.F.e(partner.pkX), _babyJub.F.e(partner.pkY)], self.sk);
  const rdv = computeRdv(self, partner, [_babyJub.F.toObject(S[0]), _babyJub.F.toObject(S[1])], epoch);
  const dirSelf = dirOf(self.pkX, self.pkY, partner.pkX, partner.pkY);
  const dirPartner = dirOf(partner.pkX, partner.pkY, self.pkX, self.pkY);
  const cSelf = H([rdv, dirSelf, self.hSk, saltSelf]);
  const cPartner = H([rdv, dirPartner, partner.hSk, saltPartner]);
  const mId = matchId(rdv, saltSelf, saltPartner);
  const input = {
    sk_self: self.sk.toString(),
    pk_partner_x: partner.pkX.toString(),
    pk_partner_y: partner.pkY.toString(),
    salt_self: saltSelf.toString(),
    salt_partner: saltPartner.toString(),
    H_sk_partner: partner.hSk.toString(),
    path_self_el: ps.el.map(String), path_self_idx: ps.id.map(String),
    path_partner_el: pp.el.map(String), path_partner_idx: pp.id.map(String),
    epoch: epoch.toString(), root: root.toString(),
  };
  return { input, matchId: mId, cSelf, cPartner, root };
}
export async function proveMatch(input: Record<string, unknown>) {
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, MATCH_WASM, MATCH_ZKEY);
  return { proof, publicSignals };
}
export async function verifyMatchLocally(proof: unknown, publicSignals: unknown): Promise<boolean> {
  const vk = await (await fetch(MATCH_VK)).json();
  return snarkjs.groth16.verify(vk, publicSignals as any, proof as any);
}

export async function verifyLikeLocally(proof: unknown, publicSignals: unknown): Promise<boolean> {
  const vk = await (await fetch(LIKE_VK)).json();
  return snarkjs.groth16.verify(vk, publicSignals as any, proof as any);
}

// ---- Soroban byte encoding (G2 = imaginary-first; matches scripts/to_invoke.js) ----
const be32 = (dec: string | bigint) => BigInt(dec).toString(16).padStart(64, "0");
const g1 = (p: string[]) => be32(p[0]) + be32(p[1]);
const g2 = (p: string[][]) => be32(p[0][1]) + be32(p[0][0]) + be32(p[1][1]) + be32(p[1][0]);
export const frHex = (v: bigint | string) => be32(v);

export function toContractProof(proof: any) {
  return { a: g1(proof.pi_a), b: g2(proof.pi_b), c: g1(proof.pi_c) };
}

export function matchId(rdv: bigint, saltSelf: bigint, saltPartner: bigint): bigint {
  const [lo, hi] = saltSelf < saltPartner ? [saltSelf, saltPartner] : [saltPartner, saltSelf];
  return H([rdv, lo, hi, DOM_MATCH]);
}

// rendezvous token for the relayer (opaque; relayer never sees identities).
// Derived from rdv so both parties agree; safe because the relayer exposes no
// lookup API (probing still costs a real on-chain like).
export function rendezvousToken(rdv: bigint): string {
  return H([rdv, 99n]).toString(16).padStart(64, "0");
}
