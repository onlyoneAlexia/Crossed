// Place ONE crossing BUY into the current open batch (to cross a browser seller), then leave it
// for /dp/close. Used to demo the FE "Your fills" display end-to-end. Buy 10 USDC @ <= 2.6.
import * as StellarSdk from "@stellar/stellar-sdk";
import { buildTreeFromLeaves, identityFromSk, be32, proveOrder } from "./darkpool.js";

const { Keypair, TransactionBuilder, Operation, Asset, BASE_FEE, Address, xdr, nativeToScVal, rpc, authorizeEntry } = StellarSdk;
const COORD = process.env.COORDINATOR_URL ?? "http://127.0.0.1:8790", RPC = "https://soroban-testnet.stellar.org", PASS = "Test SDF Network ; September 2015";
const DP = "CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24";
const TOKEN_B = "CC6EOFWKZODPBQ2SHGA4HSVI4RM6WRRO7B6ZHANKEWYB4HIJ765JCDEX", ISSUER = "GDQPLQXZJWFGSVWM4JYCBXFOEAATO5TNH2MR674MABIBI5WU3LWTLOUK";
const srv = new rpc.Server(RPC), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), log = (...a) => console.log(...a);

async function post(path, body) { const r = await fetch(COORD + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`); return t ? JSON.parse(t) : {}; }
async function get(path) { const r = await fetch(COORD + path); const t = await r.text(); if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`); return t ? JSON.parse(t) : {}; }
async function submit(tx, kp) { tx.sign(kp); const s = await srv.sendTransaction(tx); if (s.status === "ERROR") throw new Error("send rejected: " + JSON.stringify(s.errorResult ?? s)); for (let i = 0; i < 40; i++) { const g = await srv.getTransaction(s.hash); if (g.status === "SUCCESS") return s.hash; if (g.status === "FAILED") throw new Error("tx FAILED " + s.hash); await sleep(1000); } throw new Error("not confirmed " + s.hash); }
const i128 = (d) => nativeToScVal(BigInt(d), { type: "i128" });

async function main() {
  const sk = BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex"));
  const id = await identityFromSk(sk);
  const kp = Keypair.random();
  log("buyer", kp.publicKey().slice(0, 8));
  await post("/fund", { account: kp.publicKey() });
  for (let i = 0; i < 20; i++) { try { await srv.getAccount(kp.publicKey()); break; } catch { await sleep(1000); } }
  // trustlines
  let acct = await srv.getAccount(kp.publicKey());
  await submit(new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.changeTrust({ asset: new Asset("USDC", ISSUER) }))
    .addOperation(Operation.changeTrust({ asset: new Asset("XLM", ISSUER) })).setTimeout(120).build(), kp);
  await post("/mint", { account: kp.publicKey(), token: "B", amount: "500000000" });
  // register (owner=trader)
  const latest = await srv.getLatestLedger(); const validUntil = latest.sequence + 120;
  const bytes = (f) => nativeToScVal(Buffer.from(be32(f), "hex"), { type: "bytes" });
  const args = [Address.fromString(kp.publicKey()).toScVal(), bytes(id.pk[0]), bytes(id.pk[1]), bytes(id.h_sk), bytes(id.leaf)];
  const invocation = new xdr.SorobanAuthorizedInvocation({ function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(new xdr.InvokeContractArgs({ contractAddress: Address.fromString(DP).toScAddress(), functionName: "register", args })), subInvocations: [] });
  const b = crypto.getRandomValues(new Uint8Array(8)); let nonce = 0n; for (const x of b) nonce = (nonce << 8n) | BigInt(x); nonce &= (1n << 62n) - 1n;
  const creds = xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({ address: Address.fromString(kp.publicKey()).toScAddress(), nonce: new xdr.Int64(nonce), signatureExpirationLedger: validUntil, signature: xdr.ScVal.scvVoid() }));
  const signed = await authorizeEntry(new xdr.SorobanAuthorizationEntry({ credentials: creds, rootInvocation: invocation }), kp, validUntil, PASS);
  await post("/dp/register", { owner: kp.publicKey(), pk_x: id.pk[0].toString(), pk_y: id.pk[1].toString(), h_sk: id.h_sk.toString(), leaf: be32(id.leaf), auth_entry: signed.toXDR("base64") });
  // deposit 26 XLM (covers midpoint quote for 10 @ 2.5..2.6)
  acct = await srv.getAccount(kp.publicKey());
  const depTx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({ contract: DP, function: "deposit", args: [Address.fromString(kp.publicKey()).toScVal(), Address.fromString(TOKEN_B).toScVal(), i128("260000000")] }))
    .setTimeout(120).build();
  await submit(await srv.prepareTransaction(depTx), kp);
  // place buy: size 10 USDC, limit 2.6
  const [directory, batch] = await Promise.all([get("/directory"), get("/dp/batch")]);
  const tree = await buildTreeFromLeaves(directory.leaves);
  const leafIndex = tree.indexByLeaf.get(`0x${be32(id.leaf)}`);
  if (leafIndex === undefined) throw new Error("registered leaf not found in coordinator directory");
  const order = await proveOrder({
    sk: sk.toString(),
    side: 1,
    size: "100000000",
    limit_price: "26000000",
    salt: "987654321",
    pair_id: 1,
    batch_id: batch.batch_id,
    tree,
    leafIndex,
  });
  const o = await post("/dp/order", {
    owner: kp.publicKey(),
    leaf: order.leaf,
    proof: order.proof,
    note: order.note,
    nf_order: order.nf_order,
    root: order.root,
    side: 1,
    size: "100000000",
    limit_price: "26000000",
    salt: "987654321",
    pair_id: 1,
  });
  log("buy placed:", o.note?.slice(0, 12), "batch", o.batch_id, "tx", o.tx?.slice(0, 10));
  log("DONE — now click 'Run batch match' in the browser (or POST /dp/close).");
}
main().catch((e) => { console.error("BUY ERROR:", e.message); process.exitCode = 1; });
