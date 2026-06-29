import { buildPoseidon } from "circomlibjs";

export const DEPTH = 4;
export const LEAF_CAPACITY = 1 << DEPTH;
export const FIELD_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

let poseidonPromise;

async function getPoseidon() {
  poseidonPromise ??= buildPoseidon();
  return poseidonPromise;
}

function parseField(value, label = "field") {
  if (typeof value === "bigint") {
    if (value < 0n || value >= FIELD_MODULUS) throw new Error(`${label} out of field range`);
    return value;
  }
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a decimal field string`);
  }
  const parsed = BigInt(value);
  if (parsed >= FIELD_MODULUS) throw new Error(`${label} out of field range`);
  return parsed;
}

function parseLeafValue(value, label = "leaf") {
  if (typeof value === "bigint") return parseField(value, label);
  if (typeof value !== "string") throw new Error(`${label} must be a field or hex32 string`);
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(value)) return BigInt(normalizeHex32(value, label));
  return parseField(value, label);
}

export function normalizeHex32(value, label = "hex32") {
  if (typeof value !== "string") throw new Error(`${label} must be a hex32 string`);
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error(`${label} must be 32 bytes of hex`);
  return `0x${hex.toLowerCase()}`;
}

export function fieldToHex(value) {
  const field = parseLeafValue(value, "field");
  return `0x${field.toString(16).padStart(64, "0")}`;
}

export async function poseidonHash(values) {
  const poseidon = await getPoseidon();
  const fields = values.map((value, index) => parseField(value, `field[${index}]`));
  return poseidon.F.toObject(poseidon(fields));
}

export async function computeLeaf(pkX, pkY, hSk) {
  return poseidonHash([
    parseField(pkX, "pk_x"),
    parseField(pkY, "pk_y"),
    parseField(hSk, "h_sk"),
  ]);
}

export async function computeRoot(leaves) {
  if (!Array.isArray(leaves)) throw new Error("leaves must be an array");
  if (leaves.length > LEAF_CAPACITY) throw new Error(`directory is full at ${LEAF_CAPACITY} leaves`);

  let level = leaves.map((leaf, index) => parseLeafValue(leaf, `leaves[${index}]`));
  while (level.length < LEAF_CAPACITY) level.push(0n);

  for (let depth = 0; depth < DEPTH; depth += 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      next.push(await poseidonHash([level[i], level[i + 1]]));
    }
    level = next;
  }
  return level[0];
}

export async function createDirectory() {
  await getPoseidon();
  return new Directory();
}

class Directory {
  #entries = [];
  #indexByLeaf = new Map();

  async prepare({ pk_x, pk_y, h_sk, leaf, owner }) {
    const expected = await computeLeaf(pk_x, pk_y, h_sk);
    const normalizedLeaf = normalizeHex32(leaf, "leaf");
    const expectedHex = fieldToHex(expected);
    if (normalizedLeaf !== expectedHex) {
      throw new Error(`leaf mismatch: expected ${expectedHex}`);
    }

    const existing = this.#indexByLeaf.get(normalizedLeaf);
    if (existing !== undefined) {
      return {
        index: existing,
        added: false,
        leaf: normalizedLeaf,
        root_hex: await this.rootHex(),
        count: this.count(),
      };
    }
    if (this.#entries.length >= LEAF_CAPACITY) {
      throw new Error(`directory is full at ${LEAF_CAPACITY} leaves`);
    }

    const index = this.#entries.length;
    const record = {
      pk_x: parseField(pk_x, "pk_x").toString(),
      pk_y: parseField(pk_y, "pk_y").toString(),
      h_sk: parseField(h_sk, "h_sk").toString(),
      leaf: normalizedLeaf,
      ...(typeof owner === "string" && owner.length > 0 ? { owner } : {}),
    };
    const root_hex = fieldToHex(await computeRoot([...this.leaves(), normalizedLeaf]));

    return {
      index,
      added: true,
      leaf: normalizedLeaf,
      root_hex,
      count: index + 1,
      record,
    };
  }

  async add(entry) {
    const prepared = await this.prepare(entry);
    this.commit(prepared);
    return {
      index: prepared.index,
      added: prepared.added,
      leaf: prepared.leaf,
      root_hex: prepared.root_hex,
    };
  }

  commit(prepared) {
    if (!prepared || typeof prepared !== "object") throw new Error("prepared entry is required");
    if (!prepared.added) return;
    if (prepared.index !== this.#entries.length) throw new Error("prepared entry is stale");
    if (this.#indexByLeaf.has(prepared.leaf)) throw new Error("leaf already exists");
    this.#entries.push(prepared.record);
    this.#indexByLeaf.set(prepared.leaf, prepared.index);
  }

  count() {
    return this.#entries.length;
  }

  has(leaf) {
    return this.#indexByLeaf.has(normalizeHex32(leaf, "leaf"));
  }

  get(leaf) {
    const normalizedLeaf = normalizeHex32(leaf, "leaf");
    const index = this.#indexByLeaf.get(normalizedLeaf);
    if (index === undefined) return null;
    return { index, ...this.#entries[index] };
  }

  leaves() {
    return this.#entries.map((entry) => entry.leaf);
  }

  entries() {
    return this.#entries.map((entry, index) => ({ index, ...entry }));
  }

  async rootHex() {
    return fieldToHex(await computeRoot(this.leaves()));
  }

  async snapshot() {
    return {
      count: this.count(),
      root_hex: await this.rootHex(),
      leaves: this.leaves(),
    };
  }
}
