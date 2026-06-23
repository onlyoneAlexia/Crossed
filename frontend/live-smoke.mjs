// Live end-to-end test of the NEW RPC-only FE join path (no Horizon/friendbot).
import { Keypair, TransactionBuilder, Operation, Asset, BASE_FEE, Address, scValToNative, rpc } from "@stellar/stellar-sdk";

const RPC = "https://soroban-testnet.stellar.org";
const PASS = "Test SDF Network ; September 2015";
const COORD = "http://127.0.0.1:8790";
const ISSUER = "GDQPLQXZJWFGSVWM4JYCBXFOEAATO5TNH2MR674MABIBI5WU3LWTLOUK";
const TOKEN_A = "CAYSHVNZ6262YLKUYQRHY7OBMFMR7S3ZAJBMAHAXDFHEBB7YEUOQUJI6";
const TOKEN_B = "CDVD2IOLUSIEBMYKX2NV76QPFCZJ327BMIIVXQX4OYQDISDCTLTS7OWR";

const t0 = Date.now();
const ms = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
const sleep = (m) => new Promise((r) => setTimeout(r, m));
const srv = new rpc.Server(RPC);

async function exists(p) { try { await srv.getAccount(p); return true; } catch { return false; } }
async function submitClassic(tx) {
  const sent = await srv.sendTransaction(tx);
  if (sent.status === "ERROR") throw new Error("rejected: " + JSON.stringify(sent.errorResult));
  for (let i = 0; i < 30; i++) {
    const g = await srv.getTransaction(sent.hash);
    if (g.status === "SUCCESS") return sent.hash;
    if (g.status === "FAILED") throw new Error("failed on-chain: " + sent.hash);
    await sleep(1000);
  }
  throw new Error("not confirmed: " + sent.hash);
}
async function sacBalance(cid, acc) {
  const src = await srv.getAccount(acc);
  const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({ contract: cid, function: "balance", args: [Address.fromString(acc).toScVal()] }))
    .setTimeout(30).build();
  const sim = await srv.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) return 0n;
  return BigInt(scValToNative(sim.result.retval));
}

const kp = Keypair.random();
const G = kp.publicKey();
console.log(`[${ms()}] fresh account ${G}`);

// 1) fund via coordinator
console.log(`[${ms()}] POST /fund …`);
const fr = await fetch(`${COORD}/fund`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: G }) });
console.log(`[${ms()}] /fund -> ${fr.status} ${await fr.text()}`);

for (let i = 0; i < 20 && !(await exists(G)); i++) await sleep(1000);
console.log(`[${ms()}] account exists: ${await exists(G)}`);

// 2) trustlines via RPC
const assets = [new Asset("AAA", ISSUER), new Asset("BBB", ISSUER)];
const acct = await srv.getAccount(G);
let tb = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: PASS });
for (const a of assets) tb = tb.addOperation(Operation.changeTrust({ asset: a }));
const ttx = tb.setTimeout(120).build(); ttx.sign(kp);
console.log(`[${ms()}] submitting changeTrust AAA+BBB via RPC …`);
console.log(`[${ms()}] trustlines hash ${await submitClassic(ttx)}`);

// 3) mint A via coordinator
console.log(`[${ms()}] POST /mint A 100 …`);
const mr = await fetch(`${COORD}/mint`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ account: G, token: "A", amount: "1000000000" }) });
console.log(`[${ms()}] /mint -> ${mr.status} ${await mr.text()}`);

// 4) balances via SAC
const [a, b] = await Promise.all([sacBalance(TOKEN_A, G), sacBalance(TOKEN_B, G)]);
console.log(`[${ms()}] AAA=${Number(a) / 1e7}  BBB=${Number(b) / 1e7}`);
console.log(`[${ms()}] ${Number(a) / 1e7 === 100 ? "✅ PASS — full RPC join path works live" : "❌ unexpected balance"}`);
process.exit(0);
