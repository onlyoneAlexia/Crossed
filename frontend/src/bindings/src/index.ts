import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}


export const networks = {
  testnet: {
    networkPassphrase: "Test SDF Network ; September 2015",
    contractId: "CDFQ2O2CLVYGFONHDWSCJSBC4RNVPG5TDHH4ETLVLJ4W54UU4LAXMH5H",
  }
} as const


export interface Proof {
  a: Buffer;
  b: Buffer;
  c: Buffer;
}


export interface IntentRecord {
  c: Buffer;
  cancelled: boolean;
  epoch: u64;
  id: u64;
  nf: Buffer;
  owner: string;
  root: Buffer;
  settled: boolean;
  submitted_ledger: u32;
}


export interface Registration {
  h_sk: Buffer;
  index: u32;
  leaf: Buffer;
  owner: string;
  pk_x: Buffer;
  pk_y: Buffer;
}


export interface SettlementTerms {
  a_buy_amount: i128;
  a_buy_asset: Buffer;
  a_sell_amount: i128;
  a_sell_asset: Buffer;
}






export interface Client {
  /**
   * Construct and simulate a get_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_root: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a register transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  register: ({owner, pk_x, pk_y, h_sk, leaf}: {owner: string, pk_x: Buffer, pk_y: Buffer, h_sk: Buffer, leaf: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a post_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  post_root: ({root, leaf_count, leaves_digest}: {root: Buffer, leaf_count: u32, leaves_digest: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_intent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_intent: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<IntentRecord>>

  /**
   * Construct and simulate a initialize transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  initialize: ({admin, coordinator, chain_id, contract_id}: {admin: string, coordinator: string, chain_id: Buffer, contract_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a is_matched transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_matched: ({match_id}: {match_id: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a leaf_count transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  leaf_count: (options?: MethodOptions) => Promise<AssembledTransaction<u32>>

  /**
   * Construct and simulate a settle_match transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  settle_match: ({proof, match_id, c_a, c_b, terms_hash, a_sell_asset, a_buy_asset, a_sell_amount, a_buy_amount, epoch, expiry, root}: {proof: Proof, match_id: Buffer, c_a: Buffer, c_b: Buffer, terms_hash: Buffer, a_sell_asset: Buffer, a_buy_asset: Buffer, a_sell_amount: i128, a_buy_amount: i128, epoch: u64, expiry: u64, root: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a cancel_intent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  cancel_intent: ({owner, intent_id}: {owner: string, intent_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a submit_intent transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  submit_intent: ({owner, proof, c, nf, epoch, root}: {owner: string, proof: Proof, c: Buffer, nf: Buffer, epoch: u64, root: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<u64>>

  /**
   * Construct and simulate a get_intent_by_c transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_intent_by_c: ({c}: {c: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<IntentRecord>>

  /**
   * Construct and simulate a set_coordinator transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_coordinator: ({new_coordinator}: {new_coordinator: string}, options?: MethodOptions) => Promise<AssembledTransaction<null>>

  /**
   * Construct and simulate a get_registration transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_registration: ({index}: {index: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Registration>>

  /**
   * Construct and simulate a get_previous_root transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_previous_root: (options?: MethodOptions) => Promise<AssembledTransaction<Buffer>>

  /**
   * Construct and simulate a is_spent_nullifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_spent_nullifier: ({nf}: {nf: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

  /**
   * Construct and simulate a is_submitted_nullifier transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  is_submitted_nullifier: ({nf}: {nf: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<boolean>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAQAAAAAAAAAAAAAABVByb29mAAAAAAAAAwAAAAAAAAABYQAAAAAAA+4AAABAAAAAAAAAAAFiAAAAAAAD7gAAAIAAAAAAAAAAAWMAAAAAAAPuAAAAQA==",
        "AAAAAAAAAAAAAAAIZ2V0X3Jvb3QAAAAAAAAAAQAAA+4AAAAg",
        "AAAAAAAAAAAAAAAIcmVnaXN0ZXIAAAAFAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABHBrX3gAAAPuAAAAIAAAAAAAAAAEcGtfeQAAA+4AAAAgAAAAAAAAAARoX3NrAAAD7gAAACAAAAAAAAAABGxlYWYAAAPuAAAAIAAAAAEAAAAE",
        "AAAAAAAAAAAAAAAJcG9zdF9yb290AAAAAAAAAwAAAAAAAAAEcm9vdAAAA+4AAAAgAAAAAAAAAApsZWFmX2NvdW50AAAAAAAEAAAAAAAAAA1sZWF2ZXNfZGlnZXN0AAAAAAAD7gAAACAAAAAA",
        "AAAAAAAAAAAAAAAKZ2V0X2ludGVudAAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAH0AAAAAxJbnRlbnRSZWNvcmQ=",
        "AAAAAAAAAAAAAAAKaW5pdGlhbGl6ZQAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAtjb29yZGluYXRvcgAAAAATAAAAAAAAAAhjaGFpbl9pZAAAA+4AAAAgAAAAAAAAAAtjb250cmFjdF9pZAAAAAPuAAAAIAAAAAA=",
        "AAAAAAAAAAAAAAAKaXNfbWF0Y2hlZAAAAAAAAQAAAAAAAAAIbWF0Y2hfaWQAAAPuAAAAIAAAAAEAAAAB",
        "AAAAAAAAAAAAAAAKbGVhZl9jb3VudAAAAAAAAAAAAAEAAAAE",
        "AAAAAQAAAAAAAAAAAAAADEludGVudFJlY29yZAAAAAkAAAAAAAAAAWMAAAAAAAPuAAAAIAAAAAAAAAAJY2FuY2VsbGVkAAAAAAAAAQAAAAAAAAAFZXBvY2gAAAAAAAAGAAAAAAAAAAJpZAAAAAAABgAAAAAAAAACbmYAAAAAA+4AAAAgAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAABHJvb3QAAAPuAAAAIAAAAAAAAAAHc2V0dGxlZAAAAAABAAAAAAAAABBzdWJtaXR0ZWRfbGVkZ2VyAAAABA==",
        "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",
        "AAAAAAAAAAAAAAASaXNfc3BlbnRfbnVsbGlmaWVyAAAAAAABAAAAAAAAAAJuZgAAAAAD7gAAACAAAAABAAAAAQ==",
        "AAAABQAAAAAAAAAAAAAAFEludGVudENhbmNlbGxlZEV2ZW50AAAAAQAAAA9JbnRlbnRDYW5jZWxsZWQAAAAAAgAAAAAAAAACaWQAAAAAAAYAAAAAAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAAAg==",
        "AAAABQAAAAAAAAAAAAAAFEludGVudFN1Ym1pdHRlZEV2ZW50AAAAAQAAAA9JbnRlbnRTdWJtaXR0ZWQAAAAABgAAAAAAAAACaWQAAAAAAAYAAAAAAAAAAAAAAAVvd25lcgAAAAAAABMAAAAAAAAAAAAAAAFjAAAAAAAD7gAAACAAAAAAAAAAAAAAAAJuZgAAAAAD7gAAACAAAAAAAAAAAAAAAAVlcG9jaAAAAAAAAAYAAAAAAAAAAAAAAARyb290AAAD7gAAACAAAAAAAAAAAg==",
        "AAAAAAAAAAAAAAAWaXNfc3VibWl0dGVkX251bGxpZmllcgAAAAAAAQAAAAAAAAACbmYAAAAAA+4AAAAgAAAAAQAAAAE=" ]),
      options
    )
  }
  public readonly fromJSON = {
    get_root: this.txFromJSON<Buffer>,
        register: this.txFromJSON<u32>,
        post_root: this.txFromJSON<null>,
        get_intent: this.txFromJSON<IntentRecord>,
        initialize: this.txFromJSON<null>,
        is_matched: this.txFromJSON<boolean>,
        leaf_count: this.txFromJSON<u32>,
        settle_match: this.txFromJSON<null>,
        cancel_intent: this.txFromJSON<null>,
        submit_intent: this.txFromJSON<u64>,
        get_intent_by_c: this.txFromJSON<IntentRecord>,
        set_coordinator: this.txFromJSON<null>,
        get_registration: this.txFromJSON<Registration>,
        get_previous_root: this.txFromJSON<Buffer>,
        is_spent_nullifier: this.txFromJSON<boolean>,
        is_submitted_nullifier: this.txFromJSON<boolean>
  }
}
