// Crossed OTC — browser chain client. RPC-ONLY (no Horizon, no friendbot):
//   - account funding via the coordinator (createAccount over RPC)
//   - trustlines submitted via soroban-rpc sendTransaction
//   - balances read from the SAC `balance()` contract fn via simulation
//   - contract calls via generated bindings; coordinator + relayer over HTTP
import { Buffer } from "buffer";
import {
  Keypair, TransactionBuilder, Operation, Asset, BASE_FEE,
  Address, xdr, scValToNative, rpc, authorizeEntry, nativeToScVal,
} from "@stellar/stellar-sdk";
import { Client } from "../bindings/src/index";
import { CONFIG } from "./config";
import { frHex, toContractProof } from "./otc";
import { requireWalletAddress, signTransactionXdr, walletSigningCallback } from "./wallet";

const buf = (hex: string) => Buffer.from(hex, "hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const server = () => new rpc.Server(CONFIG.RPC_URL);
const ISSUER = "GDQPLQXZJWFGSVWM4JYCBXFOEAATO5TNH2MR674MABIBI5WU3LWTLOUK"; // coordinator/issuer
const coordHeaders = (json = true): HeadersInit => ({
  ...(json ? { "content-type": "application/json" } : {}),
  ...(CONFIG.COORDINATOR_API_TOKEN ? { authorization: `Bearer ${CONFIG.COORDINATOR_API_TOKEN}` } : {}),
});

async function accountExists(srv: rpc.Server, pub: string): Promise<boolean> {
  try { await srv.getAccount(pub); return true; } catch { return false; }
}

// Submit a classic (non-Soroban) transaction over soroban-rpc and wait for it.
async function submitClassic(srv: rpc.Server, tx: any): Promise<string> {
  const sent = await srv.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error("submit rejected: " + JSON.stringify(sent.errorResult ?? sent));
  }
  const hash = sent.hash;
  // Poll fast early (testnet ledgers close ~5s) so confirmation is detected promptly, then back off.
  for (let i = 0; i < 45; i++) {
    const g = await srv.getTransaction(hash);
    if (g.status === "SUCCESS") return hash;
    if (g.status === "FAILED") throw new Error("transaction failed on-chain: " + hash);
    await sleep(i < 15 ? 400 : 1000);
  }
  throw new Error("transaction not confirmed in time: " + hash);
}

async function signAndSubmit(srv: rpc.Server, tx: { toXDR: () => string }): Promise<string> {
  const signedXdr = await signTransactionXdr(tx.toXDR());
  const signedTx = TransactionBuilder.fromXDR(signedXdr, CONFIG.NETWORK_PASSPHRASE);
  return submitClassic(srv, signedTx);
}

// Ensure the in-browser account exists & is funded. Funds via the coordinator
// (reliable over RPC); falls back to friendbot if the coordinator is unavailable.
export async function ensureAccount(): Promise<string> {
  const pub = requireWalletAddress();
  const srv = server();
  if (await accountExists(srv, pub)) return pub;
  try {
    await coordFund(pub);
  } catch {
    try { await fetch(`https://friendbot.stellar.org/?addr=${pub}`); } catch { /* offline */ }
  }
  for (let i = 0; i < 20; i++) {
    if (await accountExists(srv, pub)) return pub;
    await sleep(1000);
  }
  return pub;
}

function client(): Client {
  const publicKey = requireWalletAddress();
  return new Client({
    contractId: CONFIG.CONTRACT_ID,
    networkPassphrase: CONFIG.NETWORK_PASSPHRASE,
    rpcUrl: CONFIG.RPC_URL,
    publicKey,
    signTransaction: async (txXdr: string) => ({
      signedTxXdr: await signTransactionXdr(txXdr),
      signerAddress: publicKey,
    }),
  });
}

function trustlineKey(pub: string, asset: Asset): xdr.LedgerKey {
  return xdr.LedgerKey.trustline(new xdr.LedgerKeyTrustLine({
    accountId: Keypair.fromPublicKey(pub).xdrAccountId(),
    asset: asset.toTrustLineXDRObject(),
  }));
}

// Add trustlines for every registry token so the account can hold/receive each SAC asset. RPC-only.
export async function ensureTrustlines(): Promise<void> {
  const pub = requireWalletAddress();
  const srv = server();
  const assets = CONFIG.TOKENS.map((t) => new Asset(t.sym, ISSUER));
  const want = assets.map((a) => ({ asset: a, key: trustlineKey(pub, a) }));
  let present = new Set<string>();
  try {
    const res = await srv.getLedgerEntries(...want.map((w) => w.key));
    present = new Set(res.entries.map((e: any) => e.key.toXDR("base64")));
  } catch { /* treat as none present */ }
  const missing = want.filter((w) => !present.has(w.key.toXDR("base64"))).map((w) => w.asset);
  if (missing.length === 0) return;

  const acct = await srv.getAccount(pub);
  let tb = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: CONFIG.NETWORK_PASSPHRASE });
  for (const a of missing) tb = tb.addOperation(Operation.changeTrust({ asset: a }));
  const tx = tb.setTimeout(1200).build();
  await signAndSubmit(srv, tx);
}

async function sacBalance(contractId: string, account: string): Promise<bigint> {
  const srv = server();
  let source;
  try { source = await srv.getAccount(account); } catch { return 0n; }
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: CONFIG.NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({
      contract: contractId, function: "balance", args: [Address.fromString(account).toScVal()],
    }))
    .setTimeout(30).build();
  const sim = await srv.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return 0n;
  try { return BigInt(scValToNative(sim.result.retval)); } catch { return 0n; }
}

const fmt7 = (v: bigint) => (Number(v) / 1e7).toString();
// Wallet balances for every registry token, keyed by symbol.
export async function balances(): Promise<Record<string, string>> {
  const pub = requireWalletAddress();
  const entries = await Promise.all(
    CONFIG.TOKENS.map(async (t) => [t.sym, fmt7(await sacBalance(t.c, pub))] as const),
  );
  return Object.fromEntries(entries);
}

// --- coordinator (fund / register / post_root / mint / settle) ---
export async function coordFund(account: string): Promise<void> {
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/fund`, {
    method: "POST", headers: coordHeaders(),
    body: JSON.stringify({ account }),
  });
  if (!r.ok) throw new Error("fund: " + (await r.text()));
}
export async function coordRegister(pkX: bigint, pkY: bigint, hSk: bigint, leaf: bigint): Promise<{ index: number; root_hex: string }> {
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/register`, {
    method: "POST", headers: coordHeaders(),
    body: JSON.stringify({ pk_x: pkX.toString(), pk_y: pkY.toString(), h_sk: hSk.toString(), leaf: frHex(leaf) }),
  });
  if (!r.ok) throw new Error("register: " + (await r.text()));
  return r.json();
}
export async function coordMint(account: string, token: string, amount: string): Promise<void> {
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/mint`, {
    method: "POST", headers: coordHeaders(),
    body: JSON.stringify({ account, token, amount }),
  });
  if (!r.ok) throw new Error("mint: " + (await r.text()));
}
export async function coordDirectory(): Promise<{ count: number; root_hex: string; leaves: string[] }> {
  return (await fetch(`${CONFIG.COORDINATOR_URL}/directory`)).json();
}

// --- submit_intent (owner single-auth from the browser) ---
export async function submitIntent(proof: any, c: bigint, nf: bigint, root: bigint): Promise<{ recordId: number; txHash: string }> {
  const owner = requireWalletAddress();
  const p = toContractProof(proof);
  const tx = await client().submit_intent({
    owner,
    proof: { a: buf(p.a), b: buf(p.b), c: buf(p.c) },
    c: buf(frHex(c)), nf: buf(frHex(nf)), epoch: BigInt(CONFIG.EPOCH), root: buf(frHex(root)),
  });
  const res = await tx.signAndSend();
  const txHash = (res as any).sendTransactionResponse?.hash ?? (res as any).getTransactionResponse?.txHash ?? "";
  return { recordId: Number(res.result), txHash };
}

// --- settle: CANONICAL args (party "a" = AAA/direction-0 side), proof from the side-A prover only.
// Each owner signs a SorobanAuthorizationEntry authorizing (contract, "settle_match", auth_args[10]),
// which the contract checks via require_auth_for_args — independent of the proof. The coordinator
// accumulates both owners' entries + the proof bundle per match_id and submits (it can never forge).
export interface SettleArgsInput {
  proof?: any; // present only for the side-A prover
  matchId: bigint; cA: bigint; cB: bigint; termsHash: bigint;
  sellAssetHex: string; buyAssetHex: string; sellAmount: bigint; buyAmount: bigint; root: bigint;
}
// Build the canonical settle_match arg object (hex/strings) — identical on BOTH sides.
export function settleArgObject(a: SettleArgsInput) {
  const p = a.proof ? toContractProof(a.proof) : null;
  return {
    proof: p ? { a: p.a, b: p.b, c: p.c } : null,
    match_id: frHex(a.matchId), c_a: frHex(a.cA), c_b: frHex(a.cB), terms_hash: frHex(a.termsHash),
    a_sell_asset: a.sellAssetHex, a_buy_asset: a.buyAssetHex,
    a_sell_amount: a.sellAmount.toString(), a_buy_amount: a.buyAmount.toString(),
    epoch: Number(CONFIG.EPOCH), expiry: Number(CONFIG.EXPIRY), root: frHex(a.root),
  };
}

const b32 = (hex: string) => xdr.ScVal.scvBytes(Buffer.from(hex.replace(/^0x/, ""), "hex"));
function proofScVal(proof: { a: string; b: string; c: string }): xdr.ScVal {
  return nativeToScVal(
    {
      a: Buffer.from(proof.a.replace(/^0x/, ""), "hex"),
      b: Buffer.from(proof.b.replace(/^0x/, ""), "hex"),
      c: Buffer.from(proof.c.replace(/^0x/, ""), "hex"),
    },
    {
      type: {
        a: ["symbol", "bytes"],
        b: ["symbol", "bytes"],
        c: ["symbol", "bytes"],
      },
    },
  );
}
function nativeI128(dec: string): xdr.ScVal {
  const v = BigInt(dec);
  return xdr.ScVal.scvI128(new xdr.Int128Parts({
    hi: new xdr.Int64(BigInt.asIntN(64, v >> 64n)), lo: new xdr.Uint64(BigInt.asUintN(64, v)),
  }));
}
// The 10 auth_args the contract authorizes (settlement_auth_args order), no proof, no root.
function settleAuthArgsScVals(a: any): xdr.ScVal[] {
  return [
    b32(a.match_id), b32(a.c_a), b32(a.c_b), b32(a.terms_hash),
    b32(a.a_sell_asset), b32(a.a_buy_asset),
    nativeI128(a.a_sell_amount), nativeI128(a.a_buy_amount),
    xdr.ScVal.scvU64(new xdr.Uint64(BigInt(a.epoch))),
    xdr.ScVal.scvU64(new xdr.Uint64(BigInt(a.expiry))),
  ];
}
function randomI64(): bigint {
  const b = crypto.getRandomValues(new Uint8Array(8));
  let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x);
  return v & ((1n << 62n) - 1n); // positive, fits i64
}
function contractFn(cid: string, fn: string, args: xdr.ScVal[]) {
  return xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
    new xdr.InvokeContractArgs({ contractAddress: Address.fromString(cid).toScAddress(), functionName: fn, args }),
  );
}
function transferSub(tokenC: string, from: string, to: string, amountDec: string) {
  return new xdr.SorobanAuthorizedInvocation({
    function: contractFn(tokenC, "transfer", [Address.fromString(from).toScVal(), Address.fromString(to).toScVal(), nativeI128(amountDec)]),
    subInvocations: [],
  });
}
// Resolve an intent's owner (Stellar address) from its commitment via the contract view.
async function intentOwnerByC(cHex: string): Promise<string> {
  const srv = server();
  const src = await srv.getAccount(requireWalletAddress());
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: CONFIG.NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({ contract: CONFIG.CONTRACT_ID, function: "get_intent_by_c", args: [b32(cHex)] }))
    .setTimeout(30).build();
  const sim = await srv.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error("get_intent_by_c failed");
  return (scValToNative(sim.result.retval) as any).owner as string;
}

// Hand-build + sign THIS owner's auth entry: it authorizes settle_match(auth_args) AND the nested
// SAC transfer that settle_match performs FROM this owner (require_auth on the sub-invocation).
async function buildSignedSettleAuth(owner: string, argsObj: any, iAmA: boolean): Promise<string> {
  const srv = server();
  const latest = await srv.getLatestLedger();
  const validUntil = latest.sequence + 120;
  const [ownerA, ownerB] = await Promise.all([intentOwnerByC(argsObj.c_a), intentOwnerByC(argsObj.c_b)]);
  // settle_match transfers a_sell_asset from ownerA->ownerB and a_buy_asset from ownerB->ownerA.
  const sub = iAmA
    ? transferSub(CONFIG.TOKEN_A, ownerA, ownerB, argsObj.a_sell_amount)
    : transferSub(CONFIG.TOKEN_B, ownerB, ownerA, argsObj.a_buy_amount);
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: contractFn(CONFIG.CONTRACT_ID, "settle_match", settleAuthArgsScVals(argsObj)),
    subInvocations: [sub],
  });
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: Address.fromString(owner).toScAddress(),
      nonce: new xdr.Int64(randomI64()),
      signatureExpirationLedger: validUntil,
      signature: xdr.ScVal.scvVoid(),
    }),
  );
  const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: invocation });
  const signed = await authorizeEntry(entry, walletSigningCallback, validUntil, CONFIG.NETWORK_PASSPHRASE);
  return signed.toXDR("base64");
}

// Post this owner's signed auth entry (+ the proof bundle, if this is the prover) to the coordinator.
export async function coordSettle(matchId: bigint, authEntryB64: string, argsWithProof?: any): Promise<{ submitted: boolean; tx?: string; have?: number }> {
  const body: any = { match_id: frHex(matchId), owner: requireWalletAddress(), auth_entry: authEntryB64 };
  if (argsWithProof) body.args = argsWithProof;
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/settle`, {
    method: "POST", headers: coordHeaders(), body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error("settle: " + (await r.text()));
  return r.json();
}
export async function coordSettleStatus(matchId: bigint): Promise<{ submitted: boolean; tx?: string; have?: number }> {
  try {
    const r = await fetch(`${CONFIG.COORDINATOR_URL}/settle/${frHex(matchId)}`);
    if (!r.ok) return { submitted: false };
    return r.json();
  } catch { return { submitted: false }; }
}

// Sign this owner's settle authorization, hand it (and the proof if prover) to the coordinator,
// then poll until both parties have confirmed and the coordinator has settled on-chain.
export async function settleMatch(matchId: bigint, argsObj: any, isProver: boolean): Promise<{ submitted: boolean; tx?: string }> {
  const owner = requireWalletAddress();
  const authEntry = await buildSignedSettleAuth(owner, argsObj, isProver);
  const res = await coordSettle(matchId, authEntry, isProver ? argsObj : undefined);
  if (res.submitted) return res;
  for (let i = 0; i < 20; i++) {
    await sleep(2000);
    const st = await coordSettleStatus(matchId);
    if (st.submitted) return st;
  }
  return res;
}

// --- views ---
export async function leafCount(): Promise<number> { return Number((await client().leaf_count()).result); }
export async function isMatched(matchId: bigint): Promise<boolean> {
  return (await client().is_matched({ match_id: buf(frHex(matchId)) })).result as boolean;
}

// ===================== DARK POOL =====================
// Escrow deposit is TRADER-signed (deposit() does from.require_auth + SAC transfer in). from == the
// browser account, so source-account credentials cover the auth — prepareTransaction assembles it.
export async function dpDeposit(tokenC: string, amountDec: string): Promise<string> {
  const pub = requireWalletAddress();
  const srv = server();
  const src = await srv.getAccount(pub);
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: CONFIG.NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({
      contract: CONFIG.DP_CONTRACT_ID, function: "deposit",
      args: [Address.fromString(pub).toScVal(), Address.fromString(tokenC).toScVal(), nativeI128(amountDec)],
    }))
    .setTimeout(1200).build();
  const prepared = await srv.prepareTransaction(tx);
  return signAndSubmit(srv, prepared);
}

export async function dpEscrowBalance(tokenC: string): Promise<string> {
  const pub = requireWalletAddress();
  const srv = server();
  let src; try { src = await srv.getAccount(pub); } catch { return "0"; }
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: CONFIG.NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({
      contract: CONFIG.DP_CONTRACT_ID, function: "escrow_balance",
      args: [Address.fromString(pub).toScVal(), Address.fromString(tokenC).toScVal()],
    }))
    .setTimeout(30).build();
  const sim = await srv.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return "0";
  try { return fmt7(BigInt(scValToNative(sim.result.retval))); } catch { return "0"; }
}

// Total assets the pool holds for a token (the DP contract's SAC balance). Generic over any token id.
export async function dpPoolBalance(tokenC: string): Promise<string> {
  const srv = server();
  let src; try { src = await srv.getAccount(requireWalletAddress()); } catch { return "0"; }
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: CONFIG.NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({
      contract: tokenC, function: "balance",
      args: [Address.fromString(CONFIG.DP_CONTRACT_ID).toScVal()],
    }))
    .setTimeout(30).build();
  const sim = await srv.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return "0";
  try { return fmt7(BigInt(scValToNative(sim.result.retval))); } catch { return "0"; }
}

// The browser builds the order proof locally. The coordinator receives only the proof/public
// signals and the one-time order opening needed for matching, never the long-lived pool identity.
export interface DpOrderInput {
  proof: { a: string; b: string; c: string };
  leaf: string;
  note: string;
  nf_order: string;
  root: string;
  side: 0 | 1;
  size: bigint;
  limitPrice: bigint;
  salt: bigint;
  pairId: number;
}
export async function dpSubmitOrder(o: DpOrderInput): Promise<{ note: string; nf_order: string; batch_id: string; tx?: string }> {
  const owner = requireWalletAddress();
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/dp/order`, {
    method: "POST", headers: coordHeaders(),
    body: JSON.stringify({
      owner,
      proof: o.proof,
      leaf: o.leaf,
      note: o.note,
      nf_order: o.nf_order,
      root: o.root,
      side: o.side,
      size: o.size.toString(), limit_price: o.limitPrice.toString(), salt: o.salt.toString(),
      pair_id: o.pairId,
    }),
  });
  if (!r.ok) throw new Error("dp/order: " + (await r.text()));
  return r.json();
}

// Sign one auth entry covering the deposit (owner, token, amount via require_auth_for_args) + the
// nested SAC transfer, for deposit_and_place_order. The coordinator co-authorizes as source.
async function buildSignedDepositOrderAuth(owner: string, depositTokenC: string, depositAmountDec: string): Promise<string> {
  const srv = server();
  const latest = await srv.getLatestLedger();
  const validUntil = latest.sequence + 120;
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: contractFn(CONFIG.DP_CONTRACT_ID, "deposit_and_place_order", [
      Address.fromString(owner).toScVal(),
      Address.fromString(depositTokenC).toScVal(),
      nativeI128(depositAmountDec),
    ]),
    subInvocations: [transferSub(depositTokenC, owner, CONFIG.DP_CONTRACT_ID, depositAmountDec)],
  });
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: Address.fromString(owner).toScAddress(),
      nonce: new xdr.Int64(randomI64()),
      signatureExpirationLedger: validUntil,
      signature: xdr.ScVal.scvVoid(),
    }),
  );
  const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: invocation });
  const signed = await authorizeEntry(entry, walletSigningCallback, validUntil, CONFIG.NETWORK_PASSPHRASE);
  return signed.toXDR("base64");
}

// Deposit (if needed) + place the sealed order in ONE coordinator tx. The trader signs a single auth
// entry; depositAmountDec "0" uses pre-funded escrow (no deposit, no signature).
export interface DpDepositOrderInput extends DpOrderInput {
  depositTokenC: string;
  depositAmountDec: string;
}
export async function dpDepositAndPlaceOrder(o: DpDepositOrderInput): Promise<{ note: string; nf_order: string; batch_id: string; tx?: string }> {
  const owner = requireWalletAddress();
  const authEntry = Number(o.depositAmountDec) > 0
    ? await buildSignedDepositOrderAuth(owner, o.depositTokenC, o.depositAmountDec)
    : null;
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/dp/order`, {
    method: "POST", headers: coordHeaders(),
    body: JSON.stringify({
      owner,
      proof: o.proof, leaf: o.leaf, note: o.note, nf_order: o.nf_order, root: o.root,
      side: o.side, size: o.size.toString(), limit_price: o.limitPrice.toString(), salt: o.salt.toString(),
      pair_id: o.pairId,
      deposit_token: o.depositTokenC,
      deposit_amount: o.depositAmountDec,
      auth_entry: authEntry,
    }),
  });
  if (!r.ok) throw new Error("dp/order: " + (await r.text()));
  return r.json();
}

export interface DpCancelInput {
  proof: { a: string; b: string; c: string };
  note: string;
  nf_cancel: string;
  leaf: string;
  root: string;
  pair_id: number;
  batch_id: string | number | bigint;
}
export async function dpCancelOrder(o: DpCancelInput): Promise<string> {
  const pub = requireWalletAddress();
  const srv = server();
  const src = await srv.getAccount(pub);
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: CONFIG.NETWORK_PASSPHRASE })
    .addOperation(Operation.invokeContractFunction({
      contract: CONFIG.DP_CONTRACT_ID,
      function: "cancel_order",
      args: [
        Address.fromString(pub).toScVal(),
        proofScVal(o.proof),
        b32(o.note),
        b32(o.nf_cancel),
        b32(o.leaf),
        nativeToScVal(o.pair_id, { type: "u32" }),
        nativeToScVal(BigInt(o.batch_id), { type: "u64" }),
        b32(o.root),
      ],
    }))
    .setTimeout(1200)
    .build();
  const prepared = await srv.prepareTransaction(tx);
  return signAndSubmit(srv, prepared);
}
export async function dpCancelCoordinator(note: string): Promise<{ note: string; cancelled: boolean }> {
  const owner = requireWalletAddress();
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/dp/cancel`, {
    method: "POST", headers: coordHeaders(),
    body: JSON.stringify({ owner, note }),
  });
  if (!r.ok) throw new Error("dp/cancel: " + (await r.text()));
  return r.json();
}
export async function dpBatch(): Promise<{ batch_id: string; open_count: number; min_open_count?: number }> {
  return (await fetch(`${CONFIG.COORDINATOR_URL}/dp/batch`)).json();
}
export async function dpFills(owner?: string): Promise<any[]> {
  const who = owner ?? requireWalletAddress();
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/dp/fills/${who}`, { headers: coordHeaders(false) });
  if (!r.ok) return [];
  return r.json();
}
export async function dpClose(): Promise<any> {
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/dp/close`, { method: "POST", headers: coordHeaders(false) });
  if (!r.ok) throw new Error("dp/close: " + (await r.text()));
  return r.json();
}

// Dark-pool registration: owner = THIS trader (so settle resolves escrow via owner_by_leaf).
// The trader signs an auth entry for register(owner, pk_x, pk_y, h_sk, leaf) on the DP contract;
// the coordinator (source) co-authorizes. The auth-entry args byte-match the coordinator's
// registerArgs (fieldScVal for pk/h_sk, bytes32ScVal for leaf), so require_auth matches.
async function buildSignedRegisterAuth(owner: string, pkX: bigint, pkY: bigint, hSk: bigint, leaf: bigint): Promise<string> {
  const srv = server();
  const latest = await srv.getLatestLedger();
  const validUntil = latest.sequence + 120;
  const args = [
    Address.fromString(owner).toScVal(),
    b32(frHex(pkX)), b32(frHex(pkY)), b32(frHex(hSk)), b32(frHex(leaf)),
  ];
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: contractFn(CONFIG.DP_CONTRACT_ID, "register", args),
    subInvocations: [],
  });
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(
    new xdr.SorobanAddressCredentials({
      address: Address.fromString(owner).toScAddress(),
      nonce: new xdr.Int64(randomI64()),
      signatureExpirationLedger: validUntil,
      signature: xdr.ScVal.scvVoid(),
    }),
  );
  const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: invocation });
  const signed = await authorizeEntry(entry, walletSigningCallback, validUntil, CONFIG.NETWORK_PASSPHRASE);
  return signed.toXDR("base64");
}

export async function coordDpRegister(pkX: bigint, pkY: bigint, hSk: bigint, leaf: bigint): Promise<{ index: number; root_hex: string; leaf: string }> {
  const owner = requireWalletAddress();
  const authEntry = await buildSignedRegisterAuth(owner, pkX, pkY, hSk, leaf);
  const r = await fetch(`${CONFIG.COORDINATOR_URL}/dp/register`, {
    method: "POST", headers: coordHeaders(),
    body: JSON.stringify({
      owner,
      pk_x: pkX.toString(), pk_y: pkY.toString(), h_sk: hSk.toString(), leaf: frHex(leaf),
      auth_entry: authEntry,
    }),
  });
  if (!r.ok) throw new Error("dp/register: " + (await r.text()));
  return r.json();
}
