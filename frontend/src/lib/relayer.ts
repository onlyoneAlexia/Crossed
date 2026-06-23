// Relayer client — receipt-gated rendezvous (/intent) + poll + public profile directory.
import { CONFIG } from "./config";
import type { Party } from "./otc";

export interface Envelope { v: number; alg: string; nonce: string; ciphertext: string; tag: string; }

const relayerHeaders = (): HeadersInit => ({
  "content-type": "application/json",
  ...(CONFIG.RELAYER_API_TOKEN ? { authorization: `Bearer ${CONFIG.RELAYER_API_TOKEN}` } : {}),
});

// post AFTER submit_intent landed on-chain; relayer verifies the receipt before matching.
export async function postIntent(p: {
  tx_hash: string; record_id: number; c: string; token: string; inbox: string; envelope: Envelope;
}): Promise<{ matched: boolean }> {
  const r = await fetch(`${CONFIG.RELAYER_URL}/intent`, {
    method: "POST", headers: relayerHeaders(),
    body: JSON.stringify({ network: "testnet", contract_id: CONFIG.CONTRACT_ID, ...p }),
  });
  if (!r.ok) throw new Error("relayer /intent: " + (await r.text()));
  return r.json();
}

export async function pollInbox(inbox: string): Promise<{ matched: boolean; counterpart?: { record_id: number; c: string; envelope: Envelope } }> {
  const r = await fetch(`${CONFIG.RELAYER_URL}/poll/${inbox}`);
  if (!r.ok) return { matched: false };
  return r.json();
}

// public profile directory (handle <-> baby-jubjub pk). pk is public; trade intent stays private.
export async function publishProfile(p: Party) {
  await fetch(`${CONFIG.RELAYER_URL}/profile`, {
    method: "POST", headers: relayerHeaders(),
    body: JSON.stringify({ handle: p.handle, index: p.index, pk_x: p.pkX.toString(), pk_y: p.pkY.toString(), h_sk: p.hSk.toString() }),
  });
}
export async function getProfiles(): Promise<Party[]> {
  try {
    const rows = await (await fetch(`${CONFIG.RELAYER_URL}/profiles`)).json();
    return rows.map((x: any) => ({ handle: x.handle, index: Number(x.index), pkX: BigInt(x.pk_x), pkY: BigInt(x.pk_y), hSk: BigInt(x.h_sk) }));
  } catch { return []; }
}
