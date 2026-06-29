const OWNER_AUTH_DOMAIN = "crossed.coordinator";
const OWNER_AUTH_VERSION = "1";
const OWNER_AUTH_REUSE_MS = 4 * 60_000;

export type OwnerAuthorization = {
  timestamp: string;
  signature: string;
  payload: string;
};

type SignMessage = (message: string) => Promise<string>;
type OwnerAuthorizationCache = ReturnType<typeof createOwnerAuthorizationCache>;

function normalizeNote(note: string): string {
  return note.replace(/^0x/i, "").toLowerCase();
}

export function ownerAuthorizationPayload({
  action,
  owner,
  note,
  timestamp,
}: {
  action: string;
  owner: string;
  note?: string;
  timestamp: string;
}): string {
  const lines = [
    `domain=${OWNER_AUTH_DOMAIN}`,
    `version=${OWNER_AUTH_VERSION}`,
    `action=${action}`,
    `owner=${owner}`,
  ];
  if (note !== undefined && note !== null) lines.push(`note=${normalizeNote(note)}`);
  lines.push(`timestamp=${timestamp}`);
  return lines.join("\n");
}

export function createOwnerAuthorizationCache() {
  const cache = new Map<string, OwnerAuthorization & { expiresAt: number }>();
  const pending = new Map<string, Promise<OwnerAuthorization>>();

  const keyFor = ({ owner, action, note }: { owner: string; action: string; note?: string }) => (
    `${owner}:${action}:${note ? normalizeNote(note) : ""}`
  );

  function readFresh(key: string, now: number): OwnerAuthorization | null {
    const cached = cache.get(key);
    if (!cached || cached.expiresAt <= now) return null;
    const { expiresAt: _expiresAt, ...auth } = cached;
    return auth;
  }

  return {
    peek({
      action,
      owner,
      note,
      now = Date.now(),
    }: {
      action: string;
      owner: string;
      note?: string;
      now?: number;
    }): OwnerAuthorization | null {
      return readFresh(keyFor({ owner, action, note }), now);
    },

    async get({
      action,
      owner,
      note,
      signMessage,
      now = Date.now(),
    }: {
      action: string;
      owner: string;
      note?: string;
      signMessage: SignMessage;
      now?: number;
    }): Promise<OwnerAuthorization> {
      const key = keyFor({ owner, action, note });
      const cached = readFresh(key, now);
      if (cached) return cached;
      const inFlight = pending.get(key);
      if (inFlight) return inFlight;

      const timestamp = String(now);
      const payload = ownerAuthorizationPayload({ action, owner, note, timestamp });
      const request = signMessage(payload).then((signature) => {
        const auth = { timestamp, signature, payload };
        cache.set(key, { ...auth, expiresAt: now + OWNER_AUTH_REUSE_MS });
        return auth;
      }).finally(() => {
        pending.delete(key);
      });
      pending.set(key, request);
      return request;
    },
  };
}

export async function resolveOwnerAuthorization({
  cache,
  action,
  owner,
  note,
  prompt = false,
  signMessage,
  now = Date.now(),
}: {
  cache: OwnerAuthorizationCache;
  action: string;
  owner: string;
  note?: string;
  prompt?: boolean;
  signMessage: SignMessage;
  now?: number;
}): Promise<OwnerAuthorization | null> {
  return prompt
    ? cache.get({ action, owner, note, signMessage, now })
    : cache.peek({ action, owner, note, now });
}
