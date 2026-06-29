export type CachedRegistration = {
  owner: string;
  index: number;
  leaf?: string;
};

function normalizeLeaf(value: string): string {
  return value.replace(/^0x/i, "").toLowerCase();
}

export function registrationForIdentity({
  owner,
  cached,
  identityLeaf,
  leaves,
}: {
  owner: string;
  cached: CachedRegistration | null;
  identityLeaf: string;
  leaves: string[];
}): CachedRegistration | null {
  if (!cached) return null;
  const identity = normalizeLeaf(identityLeaf);
  const cachedLeaf = cached.leaf ? normalizeLeaf(cached.leaf) : "";
  const indexedLeaf = leaves[cached.index] ? normalizeLeaf(leaves[cached.index]) : "";
  if (cachedLeaf === identity && indexedLeaf === identity) return cached;

  const index = leaves.findIndex((leaf) => normalizeLeaf(leaf) === identity);
  if (index < 0) return null;
  return { owner, index, leaf: leaves[index] };
}
