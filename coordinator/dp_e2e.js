// Live two-party dark-pool e2e on testnet. Drives the REAL coordinator endpoints + DP contract.
// Mirrors the FE flow: fund -> trustlines -> mint -> register(owner=trader) -> deposit -> order -> close -> settle.
// Run with the coordinator up on :8790 (OTC_CONTRACT_ID=DP_CONTRACT_ID=CDFQ2O2...).
import * as StellarSdk from "@stellar/stellar-sdk";
import { buildTreeFromLeaves, identityFromSk, be32, proveOrder } from "./darkpool.js";

const {
  Keypair, TransactionBuilder, Operation, Asset, BASE_FEE, Address, xdr,
  nativeToScVal, scValToNative, rpc, authorizeEntry,
} = StellarSdk;

const COORD = process.env.COORDINATOR_URL ?? "http://127.0.0.1:8790";
const RPC = "https://soroban-testnet.stellar.org";
const PASS = "Test SDF Network ; September 2015";
const DP = "CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24";
// Pair + tokens are env-driven so any configured pair can be tested. Defaults = pair 1 (USDC/XLM).
//   DP_PAIR_ID=2 BASE_SYM=EURC QUOTE_SYM=USDC node dp_e2e.js
const TOKENS = {
  USDC: "CAZ2G2KVLXUZOPCIF5VHB5NSC7PJDLJ57VCPDFZTJG7E46I2Y5JNJ32O",
  XLM:  "CC6EOFWKZODPBQ2SHGA4HSVI4RM6WRRO7B6ZHANKEWYB4HIJ765JCDEX",
  EURC: "CBPK5QDKOPY2OCFUOP5TX2EVCYDQRWIDLCVMXXILUU7CBN6MH4QZIS5P",
  USDT: "CC6MUXKGNHZ4NMAFMX4HWLPA5R6MVHJCSYIC4KL7RATUB25KMDSM2SA2",
};
const PAIR_ID = Number(process.env.DP_PAIR_ID ?? 1);
const BASE_SYM = process.env.BASE_SYM ?? "USDC";
const QUOTE_SYM = process.env.QUOTE_SYM ?? "XLM";
const TOKEN_A = TOKENS[BASE_SYM];  // base (seller gives)
const TOKEN_B = TOKENS[QUOTE_SYM]; // quote (buyer gives)
const ISSUER = "GDQPLQXZJWFGSVWM4JYCBXFOEAATO5TNH2MR674MABIBI5WU3LWTLOUK";

const srv = new rpc.Server(RPC);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

async function post(path, body) {
  const r = await fetch(COORD + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`);
  return t ? JSON.parse(t) : {};
}

async function get(path) {
  const r = await fetch(COORD + path);
  const t = await r.text();
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${t}`);
  return t ? JSON.parse(t) : {};
}

async function submit(tx, kp) {
  tx.sign(kp);
  const sent = await srv.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error("send rejected: " + JSON.stringify(sent.errorResult ?? sent));
  for (let i = 0; i < 40; i++) {
    const g = await srv.getTransaction(sent.hash);
    if (g.status === "SUCCESS") return sent.hash;
    if (g.status === "FAILED") throw new Error("tx FAILED on-chain: " + sent.hash);
    await sleep(1000);
  }
  throw new Error("tx not confirmed: " + sent.hash);
}

const i128 = (dec) => nativeToScVal(BigInt(dec), { type: "i128" });

async function trustlines(kp) {
  const acct = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.changeTrust({ asset: new Asset(BASE_SYM, ISSUER) }))
    .addOperation(Operation.changeTrust({ asset: new Asset(QUOTE_SYM, ISSUER) }))
    .setTimeout(120).build();
  return submit(tx, kp);
}

async function deposit(kp, token, amount) {
  const acct = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({
      contract: DP, function: "deposit",
      args: [Address.fromString(kp.publicKey()).toScVal(), Address.fromString(token).toScVal(), i128(amount)],
    }))
    .setTimeout(120).build();
  const prepared = await srv.prepareTransaction(tx);
  return submit(prepared, kp);
}

async function buildRegisterAuth(kp, id) {
  const latest = await srv.getLatestLedger();
  const validUntil = latest.sequence + 120;
  const bytes = (field) => nativeToScVal(Buffer.from(be32(field), "hex"), { type: "bytes" });
  const args = [
    Address.fromString(kp.publicKey()).toScVal(),
    bytes(id.pk[0]), bytes(id.pk[1]), bytes(id.h_sk), bytes(id.leaf),
  ];
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: Address.fromString(DP).toScAddress(), functionName: "register", args })),
    subInvocations: [],
  });
  const b = crypto.getRandomValues(new Uint8Array(8));
  let nonce = 0n; for (const x of b) nonce = (nonce << 8n) | BigInt(x); nonce &= (1n << 62n) - 1n;
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
    address: Address.fromString(kp.publicKey()).toScAddress(),
    nonce: new xdr.Int64(nonce), signatureExpirationLedger: validUntil, signature: xdr.ScVal.scvVoid(),
  }));
  const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: invocation });
  const signed = await authorizeEntry(entry, kp, validUntil, PASS);
  return signed.toXDR("base64");
}

async function sacBalance(token, account) {
  let src; try { src = await srv.getAccount(account); } catch { return 0n; }
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({ contract: token, function: "balance", args: [Address.fromString(account).toScVal()] }))
    .setTimeout(30).build();
  const sim = await srv.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return 0n;
  try { return BigInt(scValToNative(sim.result.retval)); } catch { return 0n; }
}

async function escrow(token, owner) {
  let src; try { src = await srv.getAccount(owner); } catch { return 0n; }
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({ contract: DP, function: "escrow_balance", args: [Address.fromString(owner).toScVal(), Address.fromString(token).toScVal()] }))
    .setTimeout(30).build();
  const sim = await srv.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return 0n;
  try { return BigInt(scValToNative(sim.result.retval)); } catch { return 0n; }
}

async function setup(kp, id, mintToken, mintAmt) {
  log(`  fund ${kp.publicKey().slice(0, 6)}...`);
  await post("/fund", { account: kp.publicKey() });
  for (let i = 0; i < 20; i++) { try { await srv.getAccount(kp.publicKey()); break; } catch { await sleep(1000); } }
  log("  trustlines...");
  await trustlines(kp);
  const mintSym = mintToken === TOKEN_A ? BASE_SYM : QUOTE_SYM;
  log(`  mint ${mintAmt} of ${mintSym}...`);
  await post("/mint", { account: kp.publicKey(), token: mintSym, amount: mintAmt });
  log("  register (owner=trader)...");
  const auth = await buildRegisterAuth(kp, id);
  await post("/dp/register", {
    owner: kp.publicKey(), pk_x: id.pk[0].toString(), pk_y: id.pk[1].toString(),
    h_sk: id.h_sk.toString(), leaf: be32(id.leaf), auth_entry: auth,
  });
}

async function buildOrderBody({ kp, id, sk, side, size, limit_price, salt, pair_id = PAIR_ID }) {
  const [directory, batch] = await Promise.all([get("/directory"), get("/dp/batch")]);
  const tree = await buildTreeFromLeaves(directory.leaves);
  const leaf = `0x${be32(id.leaf)}`;
  const leafIndex = tree.indexByLeaf.get(leaf);
  if (leafIndex === undefined) throw new Error("registered leaf not found in coordinator directory");
  const order = await proveOrder({
    sk: sk.toString(),
    side,
    size,
    limit_price,
    salt,
    pair_id,
    batch_id: batch.batch_id,
    tree,
    leafIndex,
  });
  return {
    owner: kp.publicKey(),
    leaf: order.leaf,
    proof: order.proof,
    note: order.note,
    nf_order: order.nf_order,
    root: order.root,
    side,
    size,
    limit_price,
    salt,
    pair_id,
  };
}

async function main() {
  const SIZE = "100000000";       // 10 AAA (base)
  const LIMIT_SELL = "24000000";  // 2.4
  const LIMIT_BUY = "26000000";   // 2.6  -> cross 2.5 -> quote 25 BBB
  const QUOTE = "250000000";      // 25 BBB

  // fresh circuit identities + stellar accounts
  const skSell = BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex"));
  const skBuy = BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex"));
  const idSell = await identityFromSk(skSell);
  const idBuy = await identityFromSk(skBuy);
  const kpSell = Keypair.random();
  const kpBuy = Keypair.random();
  const salt = (n) => BigInt(n).toString();

  log("== SELLER setup =="); await setup(kpSell, idSell, TOKEN_A, "200000000"); // 20 AAA (atomic)
  log("== BUYER setup ==");  await setup(kpBuy, idBuy, TOKEN_B, "500000000");  // 50 BBB (atomic)

  log("== deposits ==");
  log("  seller deposits 10 AAA (base)"); await deposit(kpSell, TOKEN_A, SIZE);
  log("  buyer deposits 25 BBB (quote)"); await deposit(kpBuy, TOKEN_B, QUOTE);

  const escSellBaseBefore = await escrow(TOKEN_A, kpSell.publicKey());
  const escBuyQuoteBefore = await escrow(TOKEN_B, kpBuy.publicKey());
  const sellBBefore = await sacBalance(TOKEN_B, kpSell.publicKey());
  const buyABefore = await sacBalance(TOKEN_A, kpBuy.publicKey());
  log(`  escrow: seller AAA=${escSellBaseBefore} buyer BBB=${escBuyQuoteBefore}`);

  log("== submit orders ==");
  const oSell = await post("/dp/order", await buildOrderBody({ kp: kpSell, id: idSell, sk: skSell, side: 0, size: SIZE, limit_price: LIMIT_SELL, salt: salt(111) }));
  log("  sell placed:", oSell.note?.slice(0, 12), "tx", oSell.tx?.slice(0, 10));
  const oBuy = await post("/dp/order", await buildOrderBody({ kp: kpBuy, id: idBuy, sk: skBuy, side: 1, size: SIZE, limit_price: LIMIT_BUY, salt: salt(222) }));
  log("  buy placed: ", oBuy.note?.slice(0, 12), "tx", oBuy.tx?.slice(0, 10));

  log("== close batch (match + settle) ==");
  const closed = await post("/dp/close", {});
  log("  fills:", JSON.stringify(closed.fills?.map((f) => ({ base: f.base_amount, quote: f.quote_amount, tx: f.tx?.slice(0, 10) }))));

  log("== verify on-chain swap ==");
  const escSellBaseAfter = await escrow(TOKEN_A, kpSell.publicKey());
  const escBuyQuoteAfter = await escrow(TOKEN_B, kpBuy.publicKey());
  const sellBAfter = await sacBalance(TOKEN_B, kpSell.publicKey());
  const buyAAfter = await sacBalance(TOKEN_A, kpBuy.publicKey());
  log(`  seller base escrow: ${escSellBaseBefore} -> ${escSellBaseAfter}  (expect -${SIZE})`);
  log(`  buyer quote escrow: ${escBuyQuoteBefore} -> ${escBuyQuoteAfter}  (expect -${QUOTE})`);
  log(`  seller received BBB: ${sellBBefore} -> ${sellBAfter}  (expect +${QUOTE})`);
  log(`  buyer received AAA:  ${buyABefore} -> ${buyAAfter}  (expect +${SIZE})`);

  const ok =
    escSellBaseBefore - escSellBaseAfter === BigInt(SIZE) &&
    escBuyQuoteBefore - escBuyQuoteAfter === BigInt(QUOTE) &&
    sellBAfter - sellBBefore === BigInt(QUOTE) &&
    buyAAfter - buyABefore === BigInt(SIZE);
  log(ok ? "\n✅ LIVE DARK-POOL E2E PASSED — atomic midpoint swap settled on testnet" : "\n❌ E2E mismatch");
  if (!ok) process.exitCode = 1;
}

main().catch((e) => { console.error("E2E ERROR:", e.message); process.exitCode = 1; });
