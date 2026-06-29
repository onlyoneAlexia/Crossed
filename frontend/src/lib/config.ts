// Crossed — testnet wiring.
export const CONFIG = {
  CONTRACT_ID: "CAR5DF4XFMD2ENXVIZPGHNQCRHHO4EBIGAOJ22NVJB6ZGAEEX4DD74QP", // v3.1 superset (partial fills, tiers, cancel_v2, expiry-enforced, hardened)

  // Dark-pool contract (live; see docs/DEPLOYMENT.md). place_order/settle are coordinator-driven;
  // the FE calls deposit/withdraw/escrow_balance directly on this id.
  DP_CONTRACT_ID: "CAR5DF4XFMD2ENXVIZPGHNQCRHHO4EBIGAOJ22NVJB6ZGAEEX4DD74QP",
  DP_CONTRACT_ID_HEX: "23d197972b07a236f5465e63b60289ceee1028301c9d69b5487d930084bf063f",
  DP_PAIR_ID: 1,

  RPC_URL: "https://soroban-testnet.stellar.org",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  COORDINATOR_URL: "http://127.0.0.1:8790",  // register / post_root / mint / settle
  COORDINATOR_API_TOKEN: import.meta.env.VITE_COORDINATOR_API_TOKEN ?? "",

  // SAC tokens (C... ids + 32-byte contract-id payloads) — real-named mock SACs on testnet.
  // Full token registry (all mock SACs issued by the deployer, so the coordinator can mint any).
  TOKENS: [
    { sym: "USDC", c: "CAZ2G2KVLXUZOPCIF5VHB5NSC7PJDLJ57VCPDFZTJG7E46I2Y5JNJ32O", hex: "33a369555de9973c482f6a70f5b217de91ad3dfd44f1973349be4e791ac752d4", icon: "usdc" },
    { sym: "XLM",  c: "CC6EOFWKZODPBQ2SHGA4HSVI4RM6WRRO7B6ZHANKEWYB4HIJ765JCDEX", hex: "bc4716cacb86f0c3523981c3caa8e459eb462ef87d9381aa25b01e1d09ffba91", icon: "xlm" },
    { sym: "EURC", c: "CBPK5QDKOPY2OCFUOP5TX2EVCYDQRWIDLCVMXXILUU7CBN6MH4QZIS5P", hex: "5eaec06a73f1a708b473fb3be895160708d90358aacbdd0ba53e20b7cc3f2194", icon: "eurc" },
    { sym: "USDT", c: "CC6MUXKGNHZ4NMAFMX4HWLPA5R6MVHJCSYIC4KL7RATUB25KMDSM2SA2", hex: "bcca5d4669f3c6b00565f87b2de0ec7cca9d2296102e297f882740ebaa60e4cd", icon: "usdt" },
  ] as { sym: string; c: string; hex: string; icon: string }[],

  // Configured trading pairs (mirror the on-chain configure_pair calls). price = quote per base.
  PAIRS: [
    { id: 1, base: "USDC", quote: "XLM" },
    { id: 2, base: "EURC", quote: "USDC" },
    { id: 3, base: "USDT", quote: "USDC" },
    { id: 4, base: "EURC", quote: "XLM" },
    { id: 5, base: "USDT", quote: "XLM" },
    { id: 6, base: "EURC", quote: "USDT" },
  ] as { id: number; base: string; quote: string }[],
  // v2 gap-closure feature flags. ALL default false so the live demo stays byte-for-byte
  // identical until each backend feature is verified green, then flipped here. See
  // docs/CROSSED_V2_PLAN.md. Each new UI piece is gated behind exactly one of these.
  FEATURES: {
    partialFills: true,
    tif: true,
    maq: true,
    tiers: true,
    killSwitch: true,
    viewingKeys: false,
    tca: true,
    passkey: false,
    refPrice: false,
  },
};
