// Verifies deposit_and_place_order: deposit + sealed order in ONE tx via a SINGLE trader auth entry
// (mirrors the FE buildSignedDepositOrderAuth, but signs with a keypair instead of Freighter).
// Run with the coordinator up on :8790 (OTC_CONTRACT_ID=DP_CONTRACT_ID=<current DP>).
import * as StellarSdk from "@stellar/stellar-sdk";
import { buildTreeFromLeaves, identityFromSk, be32, proveOrder } from "./darkpool.js";

const { Keypair, TransactionBuilder, Operation, Asset, BASE_FEE, Address, xdr, nativeToScVal, scValToNative, rpc, authorizeEntry } = StellarSdk;
const COORD = process.env.COORDINATOR_URL ?? "http://127.0.0.1:8790";
const RPC = "https://soroban-testnet.stellar.org", PASS = "Test SDF Network ; September 2015";
const DP = "CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24";
const USDC = "CAZ2G2KVLXUZOPCIF5VHB5NSC7PJDLJ57VCPDFZTJG7E46I2Y5JNJ32O";
const ISSUER = "GDQPLQXZJWFGSVWM4JYCBXFOEAATO5TNH2MR674MABIBI5WU3LWTLOUK";
const srv = new rpc.Server(RPC), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.log(...a);

async function post(path, body) { const r = await fetch(COORD + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`); return t ? JSON.parse(t) : {}; }
async function get(path) { const r = await fetch(COORD + path); const t = await r.text(); if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`); return t ? JSON.parse(t) : {}; }
async function submit(tx, kp) { tx.sign(kp); const s = await srv.sendTransaction(tx); if (s.status === "ERROR") throw new Error("send rejected: " + JSON.stringify(s.errorResult ?? s)); for (let i = 0; i < 40; i++) { const g = await srv.getTransaction(s.hash); if (g.status === "SUCCESS") return s.hash; if (g.status === "FAILED") throw new Error("tx FAILED " + s.hash); await sleep(1000); } throw new Error("not confirmed " + s.hash); }
const i128 = (d) => nativeToScVal(BigInt(d), { type: "i128" });
const addr = (a) => Address.fromString(a).toScVal();
function contractFn(cid, fn, args) { return xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: Address.fromString(cid).toScAddress(), functionName: fn, args })); }
function randNonce() { const b = crypto.getRandomValues(new Uint8Array(8)); let n = 0n; for (const x of b) n = (n << 8n) | BigInt(x); return n & ((1n << 62n) - 1n); }
function addrCreds(pub, validUntil) { return xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({ address: Address.fromString(pub).toScAddress(), nonce: new xdr.Int64(randNonce()), signatureExpirationLedger: validUntil, signature: xdr.ScVal.scvVoid() })); }

async function escrow(token, owner) { let src; try { src = await srv.getAccount(owner); } catch { return 0n; } const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS }).addOperation(Operation.invokeContractFunction({ contract: DP, function: "escrow_balance", args: [addr(owner), addr(token)] })).setTimeout(30).build(); const sim = await srv.simulateTransaction(tx); if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return 0n; try { return BigInt(scValToNative(sim.result.retval)); } catch { return 0n; } }
async function trustlines(kp) { const acct = await srv.getAccount(kp.publicKey()); const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASS }).addOperation(Operation.changeTrust({ asset: new Asset("USDC", ISSUER) })).addOperation(Operation.changeTrust({ asset: new Asset("XLM", ISSUER) })).setTimeout(120).build(); return submit(tx, kp); }
async function buildRegisterAuth(kp, id) { const latest = await srv.getLatestLedger(); const validUntil = latest.sequence + 120; const bytes = (f) => nativeToScVal(Buffer.from(be32(f), "hex"), { type: "bytes" }); const inv = new xdr.SorobanAuthorizedInvocation({ function: contractFn(DP, "register", [addr(kp.publicKey()), bytes(id.pk[0]), bytes(id.pk[1]), bytes(id.h_sk), bytes(id.leaf)]), subInvocations: [] }); const entry = new xdr.SorobanAuthorizationEntry({ credentials: addrCreds(kp.publicKey(), validUntil), rootInvocation: inv }); return (await authorizeEntry(entry, kp, validUntil, PASS)).toXDR("base64"); }

// The single auth entry: root = deposit_and_place_order(owner, token, amount) [matches require_auth_for_args],
// sub = token.transfer(owner, contract, amount) [matches the SAC from.require_auth]. No proof in the auth.
async function buildDepositOrderAuth(kp, token, amount) {
  const latest = await srv.getLatestLedger(); const validUntil = latest.sequence + 120;
  const root = new xdr.SorobanAuthorizedInvocation({
    function: contractFn(DP, "deposit_and_place_order", [addr(kp.publicKey()), addr(token), i128(amount)]),
    subInvocations: [new xdr.SorobanAuthorizedInvocation({ function: contractFn(token, "transfer", [addr(kp.publicKey()), addr(DP), i128(amount)]), subInvocations: [] })],
  });
  const entry = new xdr.SorobanAuthorizationEntry({ credentials: addrCreds(kp.publicKey(), validUntil), rootInvocation: root });
  return (await authorizeEntry(entry, kp, validUntil, PASS)).toXDR("base64");
}

async function main() {
  const SIZE = "100000000"; // 10 USDC, sell @ 2.5 on pair 1
  const sk = BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex"));
  const id = await identityFromSk(sk);
  const kp = Keypair.random();
  log("oneshot trader", kp.publicKey().slice(0, 8));
  await post("/fund", { account: kp.publicKey() });
  for (let i = 0; i < 20; i++) { try { await srv.getAccount(kp.publicKey()); break; } catch { await sleep(1000); } }
  log("trustlines..."); await trustlines(kp);
  log("mint 20 USDC..."); await post("/mint", { account: kp.publicKey(), token: "USDC", amount: "200000000" });
  log("register..."); await post("/dp/register", { owner: kp.publicKey(), pk_x: id.pk[0].toString(), pk_y: id.pk[1].toString(), h_sk: id.h_sk.toString(), leaf: be32(id.leaf), auth_entry: await buildRegisterAuth(kp, id) });

  const escBefore = await escrow(USDC, kp.publicKey());
  log("escrow USDC before:", escBefore.toString(), "(expect 0 — no separate deposit)");

  const [directory, batch] = await Promise.all([get("/directory"), get("/dp/batch")]);
  const tree = await buildTreeFromLeaves(directory.leaves);
  const leafIndex = tree.indexByLeaf.get(`0x${be32(id.leaf)}`);
  if (leafIndex === undefined) throw new Error("leaf not in directory");
  const order = await proveOrder({ sk: sk.toString(), side: 0, size: SIZE, limit_price: "25000000", salt: "7777", pair_id: 1, batch_id: batch.batch_id, tree, leafIndex });

  log("ONE-SHOT: deposit 10 USDC + place sealed order in ONE tx (single auth entry)...");
  const authEntry = await buildDepositOrderAuth(kp, USDC, SIZE);
  const res = await post("/dp/order", {
    owner: kp.publicKey(), proof: order.proof, leaf: order.leaf, note: order.note, nf_order: order.nf_order, root: order.root,
    side: 0, size: SIZE, limit_price: "25000000", salt: "7777", pair_id: 1,
    deposit_token: USDC, deposit_amount: SIZE, auth_entry: authEntry,
  });
  log("placed:", res.note?.slice(0, 12), "tx", res.tx?.slice(0, 12));

  const escAfter = await escrow(USDC, kp.publicKey());
  log(`escrow USDC: ${escBefore} -> ${escAfter} (expect +${SIZE})`);
  const ok = escAfter - escBefore === BigInt(SIZE) && !!res.tx;
  log(ok ? "\n✅ ONE-SHOT PASSED — deposit_and_place_order escrowed + sealed the order in ONE tx, ONE signature" : "\n❌ one-shot mismatch");
  if (!ok) process.exitCode = 1;
}
main().catch((e) => { console.error("ONESHOT ERROR:", e.message); process.exitCode = 1; });
