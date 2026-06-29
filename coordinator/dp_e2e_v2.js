// Self-contained two-party v2 dark-pool e2e on testnet.
// Flow: friendbot fund -> trustlines -> mint -> register(owner=trader) -> post root
// -> deposit escrow -> place_order_v2 x2 -> settle_dp_match_v2 -> balance assertions.
import * as StellarSdk from "@stellar/stellar-sdk";

import { createChainFromEnv, NETWORK_PASSPHRASE } from "./chain.js";
import { createDirectory } from "./directory.js";
import { PAIRS, TOKEN_BY_SYM } from "./tokens.js";
import { be32, buildTreeFromLeaves, identityFromSk, proveMatchV2, proveOrderV2 } from "./darkpool.js";

const {
  Address,
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  authorizeEntry,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} = StellarSdk;

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const FRIENDBOT_URL = process.env.FRIENDBOT_URL ?? "https://friendbot.stellar.org";
const PASS = process.env.NETWORK_PASSPHRASE ?? NETWORK_PASSPHRASE;
const PAIR_ID = Number(process.env.DP_PAIR_ID ?? 1);
const ISSUER = process.env.TOKEN_ISSUER ?? "GDQPLQXZJWFGSVWM4JYCBXFOEAATO5TNH2MR674MABIBI5WU3LWTLOUK";

const SIZE = "100000000";       // 10 base units at 7 decimals
const LIMIT_SELL = "24000000";  // 2.4 quote/base
const LIMIT_BUY = "26000000";   // 2.6 quote/base, midpoint 2.5
const QUOTE = "250000000";      // 25 quote units at midpoint
const MAQ = "1";
const SELL_TIER = 1;
const BUY_TIER = 1;

const srv = new rpc.Server(RPC_URL);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log(...args);

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function pairConfig(pairId) {
  const pair = PAIRS.find((entry) => entry.id === pairId);
  if (!pair) throw new Error(`DP_PAIR_ID ${pairId} is not known in coordinator/tokens.js`);
  return {
    ...pair,
    baseToken: TOKEN_BY_SYM[pair.base],
    quoteToken: TOKEN_BY_SYM[pair.quote],
  };
}

async function submit(tx, kp) {
  tx.sign(kp);
  const sent = await srv.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error("send rejected: " + JSON.stringify(sent.errorResult ?? sent));
  }
  for (let i = 0; i < 45; i += 1) {
    const result = await srv.getTransaction(sent.hash);
    if (result.status === "SUCCESS") return sent.hash;
    if (result.status === "FAILED") throw new Error("tx FAILED on-chain: " + sent.hash);
    await sleep(i < 15 ? 400 : 1000);
  }
  throw new Error("tx not confirmed: " + sent.hash);
}

async function friendbotFund(account) {
  const response = await fetch(`${FRIENDBOT_URL}?addr=${encodeURIComponent(account)}`);
  const text = await response.text();
  if (!response.ok) throw new Error(`friendbot ${response.status}: ${text}`);
  for (let i = 0; i < 30; i += 1) {
    try {
      await srv.getAccount(account);
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`funded account not visible via RPC: ${account}`);
}

async function trustlines(kp, pair) {
  const account = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.changeTrust({ asset: new Asset(pair.base, ISSUER) }))
    .addOperation(Operation.changeTrust({ asset: new Asset(pair.quote, ISSUER) }))
    .setTimeout(120)
    .build();
  return submit(tx, kp);
}

function i128(value) {
  return nativeToScVal(BigInt(value), { type: "i128" });
}

async function deposit(kp, contractId, token, amount) {
  const account = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({
      contract: contractId,
      function: "deposit",
      args: [
        Address.fromString(kp.publicKey()).toScVal(),
        Address.fromString(token).toScVal(),
        i128(amount),
      ],
    }))
    .setTimeout(120)
    .build();
  const prepared = await srv.prepareTransaction(tx);
  return submit(prepared, kp);
}

function bytes32(hex) {
  return nativeToScVal(Buffer.from(String(hex).replace(/^0x/i, ""), "hex"), { type: "bytes" });
}

function randomNonce() {
  const random = crypto.getRandomValues(new Uint8Array(8));
  let nonce = 0n;
  for (const byte of random) nonce = (nonce << 8n) | BigInt(byte);
  return nonce & ((1n << 62n) - 1n);
}

async function buildRegisterAuth(kp, contractId, id) {
  const latest = await srv.getLatestLedger();
  const validUntil = latest.sequence + 120;
  const args = [
    Address.fromString(kp.publicKey()).toScVal(),
    bytes32(be32(id.pk[0])),
    bytes32(be32(id.pk[1])),
    bytes32(be32(id.h_sk)),
    bytes32(be32(id.leaf)),
  ];
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contractId).toScAddress(),
        functionName: "register",
        args,
      }),
    ),
    subInvocations: [],
  });
  const credentials = xdr.SorobanCredentials.sorobanCredentialsAddress(new xdr.SorobanAddressCredentials({
    address: Address.fromString(kp.publicKey()).toScAddress(),
    nonce: new xdr.Int64(randomNonce()),
    signatureExpirationLedger: validUntil,
    signature: xdr.ScVal.scvVoid(),
  }));
  const entry = new xdr.SorobanAuthorizationEntry({ credentials, rootInvocation: invocation });
  return (await authorizeEntry(entry, kp, validUntil, PASS)).toXDR("base64");
}

async function sacBalance(token, account) {
  const source = await srv.getAccount(account);
  const tx = new TransactionBuilder(source, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({
      contract: token,
      function: "balance",
      args: [Address.fromString(account).toScVal()],
    }))
    .setTimeout(30)
    .build();
  const sim = await srv.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(sim) || !sim.result) throw new Error("balance simulation failed");
  return BigInt(scValToNative(sim.result.retval));
}

async function escrow(chain, owner, token) {
  return BigInt(await chain.dpEscrowBalance({ owner, token }));
}

function randomSk() {
  return BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex"));
}

async function registerMember({ chain, directory, kp, id }) {
  const prepared = await directory.prepare({
    owner: kp.publicKey(),
    pk_x: id.pk[0].toString(),
    pk_y: id.pk[1].toString(),
    h_sk: id.h_sk.toString(),
    leaf: be32(id.leaf),
  });
  if (!prepared.added) throw new Error("fresh identity unexpectedly duplicated an existing leaf");
  const auth = await buildRegisterAuth(kp, chain.dpContractId, id);
  await chain.dpRegister({
    owner: kp.publicKey(),
    pk_x: id.pk[0].toString(),
    pk_y: id.pk[1].toString(),
    h_sk: id.h_sk.toString(),
    leaf: prepared.leaf,
  }, auth);
  directory.commit(prepared);
  return prepared;
}

async function setupTrader({ chain, directory, kp, id, mintToken, mintSym, mintAmount }) {
  log(`  friendbot ${kp.publicKey().slice(0, 6)}...`);
  await friendbotFund(kp.publicKey());
  log("  trustlines...");
  await trustlines(kp, pairConfig(PAIR_ID));
  log(`  mint ${mintAmount} ${mintSym}...`);
  await chain.mint({ account: kp.publicKey(), token: mintToken, amount: mintAmount });
  log("  register member...");
  return registerMember({ chain, directory, kp, id });
}

async function proveV2Order({ sk, id, tree, side, size, limitPrice, salt, pairId, batchId, expiry, tier }) {
  const leafIndex = tree.indexByLeaf.get(`0x${be32(id.leaf)}`);
  if (leafIndex === undefined) throw new Error("registered leaf not found in local directory tree");
  return proveOrderV2({
    sk: sk.toString(),
    side,
    size,
    limit_price: limitPrice,
    salt,
    pair_id: pairId,
    batch_id: batchId,
    expiry,
    maq: MAQ,
    tier,
    tree,
    leafIndex,
  });
}

async function main() {
  requireEnv("DP_CONTRACT_ID");
  requireEnv("COORDINATOR_SECRET");

  const chain = createChainFromEnv({
    ...process.env,
    RPC_URL,
    NETWORK_PASSPHRASE: PASS,
    DP_PAIR_ID: String(PAIR_ID),
  });
  const directory = await createDirectory();
  const pair = pairConfig(PAIR_ID);
  const batchId = process.env.DP_BATCH_ID ?? "1";
  const expiry = String(Math.floor(Date.now() / 1000) + 60 * 60);

  const skSell = randomSk();
  const skBuy = randomSk();
  const idSell = await identityFromSk(skSell);
  const idBuy = await identityFromSk(skBuy);
  const kpSell = Keypair.random();
  const kpBuy = Keypair.random();

  if (be32(idSell.leaf) === be32(idBuy.leaf)) throw new Error("test identities produced duplicate leaves");

  log("== SELLER setup ==");
  await setupTrader({
    chain,
    directory,
    kp: kpSell,
    id: idSell,
    mintToken: pair.base,
    mintSym: pair.base,
    mintAmount: "200000000",
  });

  log("== BUYER setup ==");
  await setupTrader({
    chain,
    directory,
    kp: kpBuy,
    id: idBuy,
    mintToken: pair.quote,
    mintSym: pair.quote,
    mintAmount: "500000000",
  });

  const snapshot = await directory.snapshot();
  log("== post directory root ==");
  await chain.waitForLeafCount(snapshot.count, { dp: true });
  await chain.dpPostRoot({
    root: snapshot.root_hex,
    leaf_count: snapshot.count,
    leaves_digest: snapshot.root_hex,
  });

  log("== deposits ==");
  log(`  seller deposits ${SIZE} ${pair.base}`);
  await deposit(kpSell, chain.dpContractId, pair.baseToken, SIZE);
  log(`  buyer deposits ${QUOTE} ${pair.quote}`);
  await deposit(kpBuy, chain.dpContractId, pair.quoteToken, QUOTE);

  const sellerBaseEscrowBefore = await escrow(chain, kpSell.publicKey(), pair.baseToken);
  const buyerQuoteEscrowBefore = await escrow(chain, kpBuy.publicKey(), pair.quoteToken);
  const sellerQuoteBefore = await sacBalance(pair.quoteToken, kpSell.publicKey());
  const buyerBaseBefore = await sacBalance(pair.baseToken, kpBuy.publicKey());

  log("== build and place v2 orders ==");
  const tree = await buildTreeFromLeaves(snapshot.leaves);
  const sellOpening = {
    side: 0,
    size: SIZE,
    limit_price: LIMIT_SELL,
    limitPrice: LIMIT_SELL,
    salt: "111111",
    pair_id: PAIR_ID,
    batch_id: batchId,
    expiry,
    maq: MAQ,
    tier: SELL_TIER,
  };
  const buyOpening = {
    side: 1,
    size: SIZE,
    limit_price: LIMIT_BUY,
    limitPrice: LIMIT_BUY,
    salt: "222222",
    pair_id: PAIR_ID,
    batch_id: batchId,
    expiry,
    maq: MAQ,
    tier: BUY_TIER,
  };

  const sellProof = await proveV2Order({
    sk: skSell,
    id: idSell,
    tree,
    side: sellOpening.side,
    size: sellOpening.size,
    limitPrice: sellOpening.limitPrice,
    salt: sellOpening.salt,
    pairId: PAIR_ID,
    batchId,
    expiry,
    tier: SELL_TIER,
  });
  const buyProof = await proveV2Order({
    sk: skBuy,
    id: idBuy,
    tree,
    side: buyOpening.side,
    size: buyOpening.size,
    limitPrice: buyOpening.limitPrice,
    salt: buyOpening.salt,
    pairId: PAIR_ID,
    batchId,
    expiry,
    tier: BUY_TIER,
  });

  if (sellProof.leaf === buyProof.leaf) throw new Error("v2 orders must use distinct leaves");
  const placedSell = await chain.placeOrderV2(sellProof);
  log("  sell placed:", sellProof.note.slice(0, 12), "tx", placedSell.tx?.slice(0, 10));
  const placedBuy = await chain.placeOrderV2(buyProof);
  log("  buy placed: ", buyProof.note.slice(0, 12), "tx", placedBuy.tx?.slice(0, 10));

  log("== prove and settle v2 match ==");
  const sell = { ...sellOpening, ...sellProof };
  const buy = { ...buyOpening, ...buyProof };
  const match = await proveMatchV2({ sell, buy, pair_id: PAIR_ID, batch_id: batchId, tree });
  if (match.leaf_sell === match.leaf_buy) throw new Error("match proof used identical leaves");
  if (match.fill_base !== SIZE || match.fill_quote !== QUOTE) {
    throw new Error(`unexpected midpoint fill: base=${match.fill_base} quote=${match.fill_quote}`);
  }
  const settled = await chain.settleDpMatchV2({
    proof: match.proof,
    match_id: match.match_id,
    note_sell: match.note_sell,
    note_buy: match.note_buy,
    nf_sell: match.nf_sell,
    nf_buy: match.nf_buy,
    leaf_sell: match.leaf_sell,
    leaf_buy: match.leaf_buy,
    fill_base: match.fill_base,
    fill_quote: match.fill_quote,
    pair_id: PAIR_ID,
    batch_id: batchId,
    root: sellProof.root,
  });
  log("  settled:", match.match_id.slice(0, 12), "tx", settled.tx?.slice(0, 10));

  log("== verify atomic midpoint swap ==");
  const sellerBaseEscrowAfter = await escrow(chain, kpSell.publicKey(), pair.baseToken);
  const buyerQuoteEscrowAfter = await escrow(chain, kpBuy.publicKey(), pair.quoteToken);
  const sellerQuoteAfter = await sacBalance(pair.quoteToken, kpSell.publicKey());
  const buyerBaseAfter = await sacBalance(pair.baseToken, kpBuy.publicKey());

  const ok =
    sellerBaseEscrowBefore - sellerBaseEscrowAfter === BigInt(SIZE) &&
    buyerQuoteEscrowBefore - buyerQuoteEscrowAfter === BigInt(QUOTE) &&
    sellerQuoteAfter - sellerQuoteBefore === BigInt(QUOTE) &&
    buyerBaseAfter - buyerBaseBefore === BigInt(SIZE);

  log(`  seller ${pair.base} escrow: ${sellerBaseEscrowBefore} -> ${sellerBaseEscrowAfter}`);
  log(`  buyer ${pair.quote} escrow: ${buyerQuoteEscrowBefore} -> ${buyerQuoteEscrowAfter}`);
  log(`  seller received ${pair.quote}: ${sellerQuoteBefore} -> ${sellerQuoteAfter}`);
  log(`  buyer received ${pair.base}: ${buyerBaseBefore} -> ${buyerBaseAfter}`);

  if (!ok) throw new Error("atomic midpoint swap balance assertions failed");
  log("\nV2 DARK-POOL E2E PASSED");
}

main().catch((error) => {
  console.error("V2 E2E ERROR:", error.message);
  process.exitCode = 1;
});
