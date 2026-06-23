import * as StellarSdk from "@stellar/stellar-sdk";
import { TOKEN_BY_SYM } from "./tokens.js";

export const DEFAULT_RPC_URL = "https://soroban-testnet.stellar.org";
export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const DEFAULT_CONTRACT_ID = "CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24";
export const DEFAULT_DP_CONTRACT_ID = "CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24";
export const DEFAULT_DP_PAIR_ID = 1;
export const DEFAULT_TOKEN_A = "CAZ2G2KVLXUZOPCIF5VHB5NSC7PJDLJ57VCPDFZTJG7E46I2Y5JNJ32O"; // USDC
export const DEFAULT_TOKEN_B = "CC6EOFWKZODPBQ2SHGA4HSVI4RM6WRRO7B6ZHANKEWYB4HIJ765JCDEX"; // XLM

const { Address, BASE_FEE, Keypair, Operation, TransactionBuilder, nativeToScVal, scValToNative, rpc, xdr } =
  StellarSdk;

function requireString(value, label) {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} is required`);
  return value;
}

function decimalBigInt(value, label) {
  if (typeof value !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a decimal string`);
  }
  return BigInt(value);
}

export function normalizeHex(value, bytes, label = "hex") {
  if (typeof value !== "string") throw new Error(`${label} must be a hex string`);
  const hex = value.startsWith("0x") || value.startsWith("0X") ? value.slice(2) : value;
  if (!new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`).test(hex)) {
    throw new Error(`${label} must be ${bytes} bytes of hex`);
  }
  return hex.toLowerCase();
}

export function hexToBytes(value, bytes, label = "hex") {
  return Buffer.from(normalizeHex(value, bytes, label), "hex");
}

export function fieldDecimalToBytes32(value, label = "field") {
  const field = decimalBigInt(value, label);
  if (field < 0n || field >= (1n << 256n)) throw new Error(`${label} must fit in 32 bytes`);
  return Buffer.from(field.toString(16).padStart(64, "0"), "hex");
}

export function bytes32ScVal(value, label) {
  return nativeToScVal(hexToBytes(value, 32, label), { type: "bytes" });
}

export function fieldScVal(value, label) {
  return nativeToScVal(fieldDecimalToBytes32(value, label), { type: "bytes" });
}

export function i128ScVal(value, label) {
  return nativeToScVal(decimalBigInt(value, label), { type: "i128" });
}

export function u32ScVal(value, label) {
  const n = Number(decimalBigInt(String(value), label));
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) throw new Error(`${label} must be u32`);
  return nativeToScVal(n, { type: "u32" });
}

export function u64ScVal(value, label) {
  const n = decimalBigInt(String(value), label);
  if (n < 0n || n > 0xffffffffffffffffn) throw new Error(`${label} must be u64`);
  return nativeToScVal(n, { type: "u64" });
}

export function addressScVal(value, label = "address") {
  return Address.fromString(requireString(value, label)).toScVal();
}

export function proofScVal(proof) {
  if (!proof || typeof proof !== "object") throw new Error("proof is required");
  return nativeToScVal(
    {
      a: hexToBytes(proof.a, 64, "proof.a"),
      b: hexToBytes(proof.b, 128, "proof.b"),
      c: hexToBytes(proof.c, 64, "proof.c"),
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

export function authEntryFromBase64(value, label = "auth") {
  return xdr.SorobanAuthorizationEntry.fromXDR(requireString(value, label), "base64");
}

// A source-account credentials auth entry for (contract.method(args)). Satisfies a
// require_auth() on the transaction source account when other custom auth is also provided
// (providing explicit auth disables the SDK's automatic source-account entry).
export function sourceAccountAuthEntry(contract, method, args) {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(contract).toScAddress(),
        functionName: method,
        args,
      }),
    ),
    subInvocations: [],
  });
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  });
}

export function registerArgs({ owner, pk_x, pk_y, h_sk, leaf }) {
  return [
    addressScVal(owner, "owner"),
    fieldScVal(pk_x, "pk_x"),
    fieldScVal(pk_y, "pk_y"),
    fieldScVal(h_sk, "h_sk"),
    bytes32ScVal(leaf, "leaf"),
  ];
}

export function postRootArgs({ root, leaf_count, leaves_digest }) {
  return [
    bytes32ScVal(root, "root"),
    u32ScVal(leaf_count, "leaf_count"),
    bytes32ScVal(leaves_digest, "leaves_digest"),
  ];
}

export function mintArgs({ account, amount }) {
  return [addressScVal(account, "account"), i128ScVal(amount, "amount")];
}

export function settleArgs(args) {
  if (!args || typeof args !== "object") throw new Error("args is required");
  return [
    proofScVal(args.proof),
    bytes32ScVal(args.match_id, "match_id"),
    bytes32ScVal(args.c_a, "c_a"),
    bytes32ScVal(args.c_b, "c_b"),
    bytes32ScVal(args.terms_hash, "terms_hash"),
    bytes32ScVal(args.a_sell_asset, "a_sell_asset"),
    bytes32ScVal(args.a_buy_asset, "a_buy_asset"),
    i128ScVal(args.a_sell_amount, "a_sell_amount"),
    i128ScVal(args.a_buy_amount, "a_buy_amount"),
    u64ScVal(args.epoch, "epoch"),
    u64ScVal(args.expiry, "expiry"),
    bytes32ScVal(args.root, "root"),
  ];
}

export function placeOrderArgs(args) {
  if (!args || typeof args !== "object") throw new Error("args is required");
  return [
    proofScVal(args.proof),
    bytes32ScVal(args.note, "note"),
    bytes32ScVal(args.nf_order, "nf_order"),
    u32ScVal(args.pair_id, "pair_id"),
    u64ScVal(args.batch_id, "batch_id"),
    bytes32ScVal(args.root, "root"),
  ];
}

// deposit_and_place_order: deposit leg (owner/token/amount) + the order leg (same as placeOrderArgs).
export function depositAndPlaceOrderArgs(args) {
  if (!args || typeof args !== "object") throw new Error("args is required");
  return [
    addressScVal(args.owner, "owner"),
    addressScVal(args.deposit_token, "deposit_token"),
    i128ScVal(args.deposit_amount, "deposit_amount"),
    proofScVal(args.proof),
    bytes32ScVal(args.note, "note"),
    bytes32ScVal(args.nf_order, "nf_order"),
    u32ScVal(args.pair_id, "pair_id"),
    u64ScVal(args.batch_id, "batch_id"),
    bytes32ScVal(args.root, "root"),
  ];
}

export function settleDpMatchArgs(args) {
  if (!args || typeof args !== "object") throw new Error("args is required");
  return [
    proofScVal(args.proof),
    bytes32ScVal(args.match_id, "match_id"),
    bytes32ScVal(args.note_sell, "note_sell"),
    bytes32ScVal(args.note_buy, "note_buy"),
    bytes32ScVal(args.nf_sell, "nf_sell"),
    bytes32ScVal(args.nf_buy, "nf_buy"),
    bytes32ScVal(args.leaf_sell, "leaf_sell"),
    bytes32ScVal(args.leaf_buy, "leaf_buy"),
    i128ScVal(args.base_amount, "base_amount"),
    i128ScVal(args.quote_amount, "quote_amount"),
    u32ScVal(args.pair_id, "pair_id"),
    u64ScVal(args.batch_id, "batch_id"),
    bytes32ScVal(args.root, "root"),
  ];
}

export function createChainFromEnv(env = process.env) {
  const secret = requireString(env.COORDINATOR_SECRET, "COORDINATOR_SECRET");
  const keypair = Keypair.fromSecret(secret);
  return createChain({
    keypair,
    rpcUrl: env.RPC_URL ?? DEFAULT_RPC_URL,
    contractId: env.OTC_CONTRACT_ID ?? DEFAULT_CONTRACT_ID,
    dpContractId: env.DP_CONTRACT_ID ?? DEFAULT_DP_CONTRACT_ID,
    dpPairId: env.DP_PAIR_ID ?? DEFAULT_DP_PAIR_ID,
    tokenA: env.TOKEN_A_CONTRACT_ID ?? DEFAULT_TOKEN_A,
    tokenB: env.TOKEN_B_CONTRACT_ID ?? DEFAULT_TOKEN_B,
    networkPassphrase: env.NETWORK_PASSPHRASE ?? NETWORK_PASSPHRASE,
  });
}

export function createChain({
  keypair,
  rpcUrl = DEFAULT_RPC_URL,
  rpcServer = new rpc.Server(rpcUrl),
  contractId = DEFAULT_CONTRACT_ID,
  dpContractId = DEFAULT_DP_CONTRACT_ID,
  dpPairId = DEFAULT_DP_PAIR_ID,
  tokenA = DEFAULT_TOKEN_A,
  tokenB = DEFAULT_TOKEN_B,
  networkPassphrase = NETWORK_PASSPHRASE,
  timeoutSeconds = 180,
  authLifetimeLedgers = 100,
  pollMs = 1000,
  maxPolls = 45,
}) {
  const address = keypair.publicKey();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function accountExists(pub) {
    try { await rpcServer.getAccount(pub); return true; } catch { return false; }
  }

  // Serialize every transaction off the shared coordinator account so back-to-back
  // calls (fund -> register -> post_root -> mint) never race on the sequence number.
  let opQueue = Promise.resolve();
  function serialize(fn) {
    const run = opQueue.then(fn, fn);
    opQueue = run.then(() => {}, () => {});
    return run;
  }
  // Retry on txBadSeq with a fresh sequence (handles RPC lag after a just-confirmed tx).
  async function withSeqRetry(fn) {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try { return await fn(); }
      catch (e) {
        lastErr = e;
        if (/txBadSeq/.test(String(e && e.message)) && attempt < 3) { await sleep(1500); continue; }
        throw e;
      }
    }
    throw lastErr;
  }

  // One contract invocation. Builds the tx exactly once (TransactionBuilder.build()
  // mutates the source account's sequence, so building twice would double-increment).
  function invoke(contract, method, args, { auth = [] } = {}) {
    return serialize(() => withSeqRetry(async () => {
      const account = await rpcServer.getAccount(address);
      const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
        .addOperation(Operation.invokeContractFunction({ source: address, contract, function: method, args, auth }))
        .setTimeout(timeoutSeconds)
        .build();

      let prepared;
      if (auth.length > 0) {
        // settle_match: the two traders' auth entries are already signed and attached;
        // simulate for resources and assemble WITHOUT discarding the provided auth.
        const simulation = await rpcServer.simulateTransaction(tx);
        if (rpc.Api.isSimulationError(simulation)) throw new Error(`simulation failed: ${simulation.error}`);
        prepared = rpc.assembleTransaction(tx, simulation).build();
      } else {
        // register / post_root / mint: auth is the coordinator (source account) itself,
        // covered by the tx signature. prepareTransaction simulates + assembles correctly.
        prepared = await rpcServer.prepareTransaction(tx);
      }
      prepared.sign(keypair);
      return submitAndWait(rpcServer, prepared, { pollMs, maxPolls });
    }));
  }

  async function simulateContract(contract, method, args) {
    const account = await rpcServer.getAccount(address);
    const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
      .addOperation(Operation.invokeContractFunction({ contract, function: method, args }))
      .setTimeout(timeoutSeconds)
      .build();
    const sim = await rpcServer.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) throw new Error(`${method} sim failed: ${sim.error}`);
    return scValToNative(sim.result.retval);
  }

  return {
    address,
    contractId,
    dpContractId,
    dpPairId: Number(dpPairId),
    tokenA,
    tokenB,

    // Read all on-chain registrations so the in-memory directory can be rebuilt after a restart
    // (the contract's LeafCount persists; the directory must mirror it or post_root reverts).
    async getRegistrations() {
      const count = Number(await simulateContract(contractId, "leaf_count", []));
      const toField = (b) => BigInt("0x" + Buffer.from(b).toString("hex")).toString();
      const toHex = (b) => "0x" + Buffer.from(b).toString("hex");
      const regs = [];
      for (let i = 0; i < count; i += 1) {
        const r = await simulateContract(contractId, "get_registration", [u32ScVal(i, "index")]);
        // include owner so the rebuilt directory satisfies the DP owner-binding check after a restart
        const owner = typeof r.owner === "string" ? r.owner : (r.owner != null ? String(r.owner) : undefined);
        regs.push({ index: i, owner, pk_x: toField(r.pk_x), pk_y: toField(r.pk_y), h_sk: toField(r.h_sk), leaf: toHex(r.leaf) });
      }
      return regs;
    },

    // The contract's authoritative LeafCount (the DP and OTC flows share the superset contract).
    async leafCount({ dp = false } = {}) {
      const id = dp ? dpContractId : contractId;
      return Number(await simulateContract(id, "leaf_count", []));
    },

    // After register() is confirmed, the RPC simulation snapshot can still lag one ledger behind
    // the committed tx (read-after-write). post_root now strictly requires
    // leaf_count == on-chain LeafCount, so block until the snapshot reflects the expected count
    // before posting the new root — otherwise post_root simulates against stale state and traps.
    async waitForLeafCount(expected, { dp = false, tries = 30, delayMs = pollMs } = {}) {
      const id = dp ? dpContractId : contractId;
      let last = -1;
      for (let i = 0; i < tries; i += 1) {
        try {
          last = Number(await simulateContract(id, "leaf_count", []));
          if (last >= expected) return last;
        } catch {
          // transient RPC blip while reading the snapshot — retry
        }
        await sleep(delayMs);
      }
      throw new Error(`leaf_count snapshot lag: saw ${last}, expected ${expected}`);
    },

    // Fund a fresh in-browser account (friendbot replacement: reliable over RPC).
    async fund({ account, startingBalance = "5" }) {
      requireString(account, "account");
      Address.fromString(account); // validate G-address
      if (await accountExists(account)) return { tx: null, already: true };
      const result = await serialize(() => withSeqRetry(async () => {
        const src = await rpcServer.getAccount(address);
        const tx = new TransactionBuilder(src, { fee: BASE_FEE, networkPassphrase })
          .addOperation(Operation.createAccount({ destination: account, startingBalance }))
          .setTimeout(timeoutSeconds)
          .build();
        tx.sign(keypair);
        return submitAndWait(rpcServer, tx, { pollMs, maxPolls });
      }));
      return { tx: result.tx, already: false };
    },

    // Register a member leaf on the bilateral contract. owner = coordinator (source-auth only).
    async register(entry, authEntry) {
      const args = registerArgs(entry);
      const auth = authEntry
        ? [authEntryFromBase64(authEntry, "register auth"), sourceAccountAuthEntry(contractId, "register", args)]
        : [];
      return invoke(contractId, "register", args, { auth });
    },

    async postRoot(entry) {
      return invoke(contractId, "post_root", postRootArgs(entry));
    },

    // Register a dark-pool member leaf. owner = trader, who supplies a signed auth
    // entry for owner.require_auth(); the coordinator source account also authorizes.
    async dpRegister(entry, authEntry) {
      const args = registerArgs(entry);
      const auth = [
        authEntryFromBase64(authEntry, "register auth"),
        sourceAccountAuthEntry(dpContractId, "register", args),
      ];
      return invoke(dpContractId, "register", args, { auth });
    },

    async dpPostRoot(entry) {
      return invoke(dpContractId, "post_root", postRootArgs(entry));
    },

    // Mint a mock token. `token` accepts: legacy "A"/"B", a token SYMBOL (USDC/XLM/EURC/USDT),
    // or a raw SAC C-address. All mock tokens are issued by the coordinator, so it can mint any.
    async mint({ account, token, amount }) {
      let tokenContract = token === "A" ? tokenA : token === "B" ? tokenB : TOKEN_BY_SYM[token] ?? null;
      if (!tokenContract && typeof token === "string" && /^C[A-Z2-7]{55}$/.test(token)) tokenContract = token;
      if (!tokenContract) throw new Error(`unknown token ${token} (use a symbol like USDC/EURC, "A"/"B", or a SAC id)`);
      return invoke(tokenContract, "mint", mintArgs({ account, amount }));
    },

    async settle({ args, auth }) {
      const authEntries = auth.map((entry, index) => authEntryFromBase64(entry, `auth[${index}]`));
      const result = await invoke(contractId, "settle_match", settleArgs(args), { auth: authEntries });
      return { tx: result.tx, success: true };
    },

    async placeOrder(args) {
      const result = await invoke(dpContractId, "place_order", placeOrderArgs(args));
      return { tx: result.tx, success: true };
    },

    // Deposit + place the opaque order in ONE tx. The trader's auth entry covers the deposit
    // (owner, token, amount) + the nested SAC transfer; the coordinator co-authorizes (source).
    // deposit_amount "0" skips the deposit leg (pre-funded escrow), needing no trader auth entry.
    async dpDepositAndPlaceOrder(args, authEntry) {
      const callArgs = depositAndPlaceOrderArgs(args);
      const auth = [];
      if (authEntry) auth.push(authEntryFromBase64(authEntry, "deposit-order auth"));
      auth.push(sourceAccountAuthEntry(dpContractId, "deposit_and_place_order", callArgs));
      const result = await invoke(dpContractId, "deposit_and_place_order", callArgs, { auth });
      return { tx: result.tx, success: true };
    },

    async settleDpMatch(args) {
      const result = await invoke(dpContractId, "settle_dp_match", settleDpMatchArgs(args));
      return { tx: result.tx, success: true };
    },

    async dpEscrowBalance({ owner, token }) {
      return simulateContract(dpContractId, "escrow_balance", [
        addressScVal(owner, "owner"),
        addressScVal(token, "token"),
      ]);
    },

    async isOrderOpen(note) {
      return simulateContract(dpContractId, "is_order_open", [bytes32ScVal(note, "note")]);
    },
  };
}

function txErrorCode(sent) {
  try { return sent.errorResult.result().switch().name; } catch { return sent.status || "unknown"; }
}

async function submitAndWait(rpcServer, tx, { pollMs, maxPolls }) {
  const sent = await rpcServer.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(`transaction rejected: ${txErrorCode(sent)}`);
  }
  const hash = sent.hash;
  if (!hash) return { tx: tx.hash().toString("hex"), confirmed: false };

  for (let i = 0; i < maxPolls; i += 1) {
    try {
      const result = await rpcServer.getTransaction(hash);
      if (result.status === "SUCCESS") return { tx: hash, confirmed: true };
      if (result.status === "FAILED") throw new Error(`transaction failed on-chain: ${hash}`);
      if (result.status !== "NOT_FOUND") throw new Error(`transaction status ${result.status}: ${hash}`);
    } catch (e) {
      // The tx is already submitted; a transient RPC/network blip (ECONNRESET, fetch failed)
      // while polling is non-fatal — keep polling. Only real on-chain failures abort.
      if (/failed on-chain|transaction status/.test(String(e && e.message))) throw e;
    }
    await new Promise((resolve) => setTimeout(resolve, i < 15 ? 400 : pollMs));
  }

  return { tx: hash, confirmed: false }; // polls exhausted without an observed SUCCESS
}
