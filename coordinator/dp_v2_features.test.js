// Live v2 enforcement harness for the deployed dark-pool contract.
// Run manually with network access; this file intentionally performs live testnet calls.
import { randomBytes } from "node:crypto";

import * as StellarSdk from "@stellar/stellar-sdk";

import {
  addressScVal,
  createChainFromEnv,
  i128ScVal,
  NETWORK_PASSPHRASE,
  placeOrderV2Args,
} from "./chain.js";
import { be32, buildTreeFromLeaves, identityFromSk, proveMatchV2, proveOrderV2 } from "./darkpool.js";
import { PAIRS, TOKEN_BY_SYM } from "./tokens.js";

const {
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} = StellarSdk;

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const FRIENDBOT_URL = process.env.FRIENDBOT_URL ?? "https://friendbot.stellar.org";
const PASS = process.env.NETWORK_PASSPHRASE ?? NETWORK_PASSPHRASE;
const PAIR_ID = Number(process.env.DP_PAIR_ID ?? 1);
const BATCH_ID = process.env.DP_BATCH_ID ?? "1";
const ISSUER = process.env.TOKEN_ISSUER ?? "GDQPLQXZJWFGSVWM4JYCBXFOEAATO5TNH2MR674MABIBI5WU3LWTLOUK";

const SIZE = "100000000";
const LIMIT_SELL = "24000000";
const LIMIT_BUY = "26000000";
const MAQ = "1";
const TIER = 1;
const ESCROW_PROBE_AMOUNT = "1";

const srv = new rpc.Server(RPC_URL);

function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${name} is required`);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortError(error) {
  return String(error?.message ?? error).replace(/\s+/g, " ").slice(0, 260);
}

async function submitAndWait(tx) {
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

async function invokeWithKeypair(kp, contract, method, args) {
  const account = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({
      source: kp.publicKey(),
      contract,
      function: method,
      args,
    }))
    .setTimeout(180)
    .build();
  const prepared = await srv.prepareTransaction(tx);
  prepared.sign(kp);
  return submitAndWait(prepared);
}

async function simulateWithKeypair(kp, contract, method, args) {
  const account = await srv.getAccount(kp.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASS })
    .addOperation(Operation.invokeContractFunction({
      source: kp.publicKey(),
      contract,
      function: method,
      args,
    }))
    .setTimeout(180)
    .build();
  const sim = await srv.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) throw new Error(`${method} simulation rejected: ${sim.error}`);
  if (!sim.result) return undefined;
  return scValToNative(sim.result.retval);
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
  tx.sign(kp);
  return submitAndWait(tx);
}

function randomSk() {
  return BigInt("0x" + randomBytes(31).toString("hex"));
}

async function localMemberTree(count = 1) {
  const members = [];
  const leaves = [];
  for (let i = 0; i < count; i += 1) {
    const sk = randomSk();
    const id = await identityFromSk(sk);
    members.push({ sk, id, leaf: be32(id.leaf) });
    leaves.push(`0x${be32(id.leaf)}`);
  }
  return { members, tree: await buildTreeFromLeaves(leaves) };
}

async function makeOrderProof({ expiry, salt = "111111", side = 0 }) {
  const { members, tree } = await localMemberTree(1);
  return proveOrderV2({
    sk: members[0].sk.toString(),
    side,
    size: SIZE,
    limit_price: side === 0 ? LIMIT_SELL : LIMIT_BUY,
    salt,
    pair_id: PAIR_ID,
    batch_id: BATCH_ID,
    expiry,
    maq: MAQ,
    tier: TIER,
    tree,
    leafIndex: 0,
  });
}

function opening({ leaf, side, salt, maq = MAQ, expiry }) {
  return {
    leaf,
    side,
    size: SIZE,
    limit_price: side === 0 ? LIMIT_SELL : LIMIT_BUY,
    salt,
    expiry,
    maq,
    tier: TIER,
  };
}

async function expectThrows(fn) {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  throw new Error("operation unexpectedly succeeded");
}

async function setPaused(kp, contractId, paused) {
  return invokeWithKeypair(kp, contractId, "set_paused", [nativeToScVal(paused)]);
}

async function setupWithdrawProbe({ chain, contractId, pair }) {
  const kp = Keypair.random();
  await friendbotFund(kp.publicKey());
  await trustlines(kp, pair);
  await chain.mint({ account: kp.publicKey(), token: pair.base, amount: "2" });
  await invokeWithKeypair(kp, contractId, "deposit", [
    addressScVal(kp.publicKey(), "owner"),
    addressScVal(pair.baseToken, "token"),
    i128ScVal(ESCROW_PROBE_AMOUNT, "amount"),
  ]);
  return { kp, token: pair.baseToken, amount: ESCROW_PROBE_AMOUNT };
}

async function cleanupWithdrawProbe(contractId, escrow) {
  if (!escrow) return;
  await invokeWithKeypair(escrow.kp, contractId, "withdraw", [
    addressScVal(escrow.kp.publicKey(), "owner"),
    addressScVal(escrow.token, "token"),
    i128ScVal(escrow.amount, "amount"),
  ]);
}

async function selfTradePrevention() {
  const expiry = String(Math.floor(Date.now() / 1000) + 3600);
  const { members, tree } = await localMemberTree(1);
  const leaf = members[0].leaf;
  const error = await expectThrows(() => proveMatchV2({
    sell: opening({ leaf, side: 0, salt: "101", expiry }),
    buy: opening({ leaf, side: 1, salt: "202", expiry }),
    pair_id: PAIR_ID,
    batch_id: BATCH_ID,
    tree,
  }));
  return `proveMatchV2 rejected identical sell/buy leaves (${shortError(error)})`;
}

async function minFillMaq() {
  const expiry = String(Math.floor(Date.now() / 1000) + 3600);
  const { members, tree } = await localMemberTree(2);
  const tooLargeMaq = (BigInt(SIZE) + 1n).toString();
  const error = await expectThrows(() => proveMatchV2({
    sell: opening({ leaf: members[0].leaf, side: 0, salt: "303", maq: tooLargeMaq, expiry }),
    buy: opening({ leaf: members[1].leaf, side: 1, salt: "404", expiry }),
    pair_id: PAIR_ID,
    batch_id: BATCH_ID,
    tree,
  }));
  return `proveMatchV2 rejected maq ${tooLargeMaq} above fill ${SIZE} (${shortError(error)})`;
}

async function expiryRejection({ coordinatorKp, contractId }) {
  const pastExpiry = String(Math.floor(Date.now() / 1000) - 3600);
  const order = await makeOrderProof({ expiry: pastExpiry, salt: "505" });
  const error = await expectThrows(() => simulateWithKeypair(
    coordinatorKp,
    contractId,
    "place_order_v2",
    placeOrderV2Args(order),
  ));
  return `place_order_v2 simulation rejected past expiry ${pastExpiry} (${shortError(error)})`;
}

async function killSwitch({ chain, coordinatorKp, contractId, pair }) {
  let escrow = null;
  let pauseSet = false;
  let bodyError = null;
  let reason = null;
  const restoreErrors = [];

  try {
    escrow = await setupWithdrawProbe({ chain, contractId, pair });
    const futureExpiry = String(Math.floor(Date.now() / 1000) + 3600);
    const order = await makeOrderProof({ expiry: futureExpiry, salt: "606" });

    await setPaused(coordinatorKp, contractId, true);
    pauseSet = true;

    const placeError = await expectThrows(() => simulateWithKeypair(
      coordinatorKp,
      contractId,
      "place_order_v2",
      placeOrderV2Args(order),
    ));

    await simulateWithKeypair(escrow.kp, contractId, "withdraw", [
      addressScVal(escrow.kp.publicKey(), "owner"),
      addressScVal(escrow.token, "token"),
      i128ScVal(escrow.amount, "amount"),
    ]);

    reason = `place_order_v2 rejected while paused; withdraw simulation succeeded; set_paused(false) restored (${shortError(placeError)})`;
  } catch (error) {
    bodyError = error;
  } finally {
    if (pauseSet) {
      try {
        await setPaused(coordinatorKp, contractId, false);
      } catch (error) {
        restoreErrors.push(`set_paused(false): ${shortError(error)}`);
      }
    }
    if (escrow) {
      try {
        await cleanupWithdrawProbe(contractId, escrow);
      } catch (error) {
        restoreErrors.push(`withdraw escrow cleanup: ${shortError(error)}`);
      }
    }
  }

  if (restoreErrors.length > 0) {
    throw new Error(`state restore failed after kill-switch test: ${restoreErrors.join("; ")}`);
  }
  if (bodyError) throw bodyError;
  return reason;
}

async function adminTimelock({ coordinatorKp, contractId, currentGuardian }) {
  await invokeWithKeypair(coordinatorKp, contractId, "propose_set_guardian", [
    addressScVal(currentGuardian, "new_guardian"),
  ]);
  const error = await expectThrows(() => invokeWithKeypair(
    coordinatorKp,
    contractId,
    "execute_set_guardian",
    [addressScVal(currentGuardian, "new_guardian")],
  ));
  return `execute_set_guardian rejected before delay elapsed (${shortError(error)})`;
}

async function runFeature(name, fn) {
  try {
    const reason = await fn();
    console.log(`PASS ${name}: ${reason}`);
    return true;
  } catch (error) {
    console.log(`FAIL ${name}: ${shortError(error)}`);
    return false;
  }
}

async function main() {
  const contractId = requireEnv("DP_CONTRACT_ID");
  const secret = requireEnv("COORDINATOR_SECRET");
  const coordinatorKp = Keypair.fromSecret(secret);
  const currentGuardian = coordinatorKp.publicKey();
  const chain = createChainFromEnv({
    ...process.env,
    RPC_URL,
    NETWORK_PASSPHRASE: PASS,
    DP_CONTRACT_ID: contractId,
    DP_PAIR_ID: String(PAIR_ID),
  });
  const pair = pairConfig(PAIR_ID);

  const results = [];
  results.push(await runFeature("SELF-TRADE PREVENTION", selfTradePrevention));
  results.push(await runFeature("MIN-FILL (MAQ)", minFillMaq));
  results.push(await runFeature("EXPIRY", () => expiryRejection({ coordinatorKp, contractId })));
  results.push(await runFeature("KILL-SWITCH", () => killSwitch({ chain, coordinatorKp, contractId, pair })));
  results.push(await runFeature("ADMIN TIMELOCK", () => adminTimelock({ coordinatorKp, contractId, currentGuardian })));

  const passed = results.filter(Boolean).length;
  console.log(`V2 FEATURES: ${passed}/5 passed`);
  if (passed !== 5) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FAIL HARNESS: ${shortError(error)}`);
  console.log("V2 FEATURES: 0/5 passed");
  process.exitCode = 1;
});
