// Live single-order cancellation smoke on testnet.
// Flow: fund -> register(owner=trader) -> place sealed order -> owner-signed cancel_order -> /dp/cancel.
import * as StellarSdk from "@stellar/stellar-sdk";
import { be32, buildTreeFromLeaves, identityFromSk, proveCancelOrder, proveOrder } from "./darkpool.js";

const {
  Keypair, TransactionBuilder, Operation, BASE_FEE, Address, xdr,
  nativeToScVal, scValToNative, rpc, authorizeEntry,
} = StellarSdk;

const COORD = process.env.COORDINATOR_URL ?? "http://127.0.0.1:8790";
const RPC = "https://soroban-testnet.stellar.org";
const PASS = "Test SDF Network ; September 2015";
const DP = process.env.DP_CONTRACT_ID ?? "CDFQ2O2CLVYGFONHDWSCJSBC4RNVPG5TDHH4ETLVLJ4W54UU4LAXMH5H";
const srv = new rpc.Server(RPC);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  for (let i = 0; i < 40; i += 1) {
    const result = await srv.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return sent.hash;
    if (result.status === "FAILED") throw new Error("tx FAILED on-chain: " + sent.hash);
    await sleep(1000);
  }
  throw new Error("tx not confirmed: " + sent.hash);
}

const bytes32 = (hex) => nativeToScVal(Buffer.from(hex.replace(/^0x/, ""), "hex"), { type: "bytes" });
const u32 = (value) => nativeToScVal(Number(value), { type: "u32" });
const u64 = (value) => nativeToScVal(BigInt(value), { type: "u64" });
function proofScVal(proof) {
  return nativeToScVal(
    {
      a: Buffer.from(proof.a, "hex"),
      b: Buffer.from(proof.b, "hex"),
      c: Buffer.from(proof.c, "hex"),
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

async function buildRegisterAuth(kp, id) {
  const latest = await srv.getLatestLedger();
  const validUntil = latest.sequence + 120;
  const args = [
    Address.fromString(kp.publicKey()).toScVal(),
    bytes32(be32(id.pk[0])), bytes32(be32(id.pk[1])), bytes32(be32(id.h_sk)), bytes32(be32(id.leaf)),
  ];
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({ contractAddress: Address.fromString(DP).toScAddress(), functionName: "register", args }),
    ),
    subInvocations: [],
  });
  const random = crypto.getRandomValues(new Uint8Array(8));
  let nonce = 0n;
  for (const byte of random) nonce = (nonce << 8n) | BigInt(byte);
  nonce &= (1n << 62n) - 1n;
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
    address: Address.fromString(kp.publicKey()).toScAddress(),
    nonce: new xdr.Int64(nonce),
    signatureExpirationLedger: validUntil,
    signature: xdr.ScVal.scvVoid(),
  }));
  const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: invocation });
  const signed = await authorizeEntry(entry, kp, validUntil, PASS);
  return signed.toXDR("base64");
}

async function isOrderOpen(kp, note) {
  const source = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({
      contract: DP,
      function: "is_order_open",
      args: [bytes32(note)],
    }))
    .setTimeout(30)
    .build();
  const sim = await srv.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error("is_order_open simulation failed");
  return Boolean(scValToNative(sim.result.retval));
}

async function placeOrder(kp, id, sk, opening) {
  const [directory, batch] = await Promise.all([get("/directory"), get("/dp/batch")]);
  const tree = await buildTreeFromLeaves(directory.leaves);
  const leafIndex = tree.indexByLeaf.get(`0x${be32(id.leaf)}`);
  if (leafIndex === undefined) throw new Error("registered leaf not found in coordinator directory");
  const proof = await proveOrder({
    sk: sk.toString(),
    ...opening,
    batch_id: batch.batch_id,
    tree,
    leafIndex,
  });
  const response = await post("/dp/order", {
    owner: kp.publicKey(),
    leaf: proof.leaf,
    proof: proof.proof,
    note: proof.note,
    nf_order: proof.nf_order,
    root: proof.root,
    side: opening.side,
    size: opening.size,
    limit_price: opening.limit_price,
    salt: opening.salt,
    pair_id: opening.pair_id,
  });
  return { response, leafIndex };
}

async function cancelOrder(kp, id, sk, opening, batchId) {
  const directory = await get("/directory");
  const tree = await buildTreeFromLeaves(directory.leaves);
  const leafIndex = tree.indexByLeaf.get(`0x${be32(id.leaf)}`);
  if (leafIndex === undefined) throw new Error("registered leaf not found in coordinator directory");
  const cancel = await proveCancelOrder({
    sk: sk.toString(),
    ...opening,
    batch_id: batchId,
    tree,
    leafIndex,
  });
  const source = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({
      contract: DP,
      function: "cancel_order",
      args: [
        Address.fromString(kp.publicKey()).toScVal(),
        proofScVal(cancel.proof),
        bytes32(cancel.note),
        bytes32(cancel.nf_cancel),
        bytes32(cancel.leaf),
        u32(cancel.pair_id),
        u64(cancel.batch_id),
        bytes32(cancel.root),
      ],
    }))
    .setTimeout(120)
    .build();
  const prepared = await srv.prepareTransaction(tx);
  const txHash = await submit(prepared, kp);
  await post("/dp/cancel", { owner: kp.publicKey(), note: cancel.note });
  return { ...cancel, tx: txHash };
}

async function main() {
  const sk = BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex"));
  const id = await identityFromSk(sk);
  const kp = Keypair.random();
  const opening = {
    side: 0,
    size: "100000000",
    limit_price: "24000000",
    salt: "333",
    pair_id: 1,
  };

  console.log("== setup ==");
  await post("/fund", { account: kp.publicKey() });
  for (let i = 0; i < 20; i += 1) {
    try { await srv.getAccount(kp.publicKey()); break; } catch { await sleep(1000); }
  }
  const auth = await buildRegisterAuth(kp, id);
  await post("/dp/register", {
    owner: kp.publicKey(),
    pk_x: id.pk[0].toString(),
    pk_y: id.pk[1].toString(),
    h_sk: id.h_sk.toString(),
    leaf: be32(id.leaf),
    auth_entry: auth,
  });

  console.log("== place ==");
  const { response } = await placeOrder(kp, id, sk, opening);
  const before = await isOrderOpen(kp, response.note);
  if (!before) throw new Error("order was not open after placement");
  console.log("  placed:", response.note.slice(0, 12), "tx", response.tx?.slice(0, 10));

  console.log("== cancel ==");
  const cancelled = await cancelOrder(kp, id, sk, opening, response.batch_id);
  if (cancelled.note !== response.note) throw new Error("cancel proof note mismatch");
  const after = await isOrderOpen(kp, response.note);
  const batch = await get("/dp/batch");
  if (after || batch.open_count !== 0) {
    throw new Error(`cancel verification failed: open=${after} coordinator_open=${batch.open_count}`);
  }
  console.log("  cancelled tx:", cancelled.tx.slice(0, 10));
  console.log("\n✅ LIVE CANCEL E2E PASSED — sealed order removed on-chain and from coordinator state");
  process.exit(0);
}

main().catch((error) => {
  console.error("CANCEL E2E ERROR:", error.message);
  process.exit(1);
});
