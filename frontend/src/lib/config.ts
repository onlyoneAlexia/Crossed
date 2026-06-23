// Crossed — testnet wiring.
export const CONFIG = {
  CONTRACT_ID: "CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24", // client-order-proof superset (OTC == DP)

  // Dark-pool contract (live; see docs/DEPLOYMENT.md). place_order/settle are coordinator-driven;
  // the FE calls deposit/withdraw/escrow_balance directly on this id.
  DP_CONTRACT_ID: "CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24",
  DP_CONTRACT_ID_HEX: "4d6311fdc39d7f23fbe44d5321a09663d788d85d2bc06081be99e310a8f836d2",
  DP_PAIR_ID: 1,

  RPC_URL: "https://soroban-testnet.stellar.org",
  NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  HORIZON_URL: "https://horizon-testnet.stellar.org",
  RELAYER_URL: "http://127.0.0.1:8787",      // rendezvous (receipt-gated /intent + /poll)
  COORDINATOR_URL: "http://127.0.0.1:8790",  // register / post_root / mint / settle
  RELAYER_API_TOKEN: import.meta.env.VITE_RELAYER_API_TOKEN ?? "",
  COORDINATOR_API_TOKEN: import.meta.env.VITE_COORDINATOR_API_TOKEN ?? "",

  // 32-byte payloads (hex) the circuits/contract bind to
  CHAIN_ID_HEX: "cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472",
  CONTRACT_ID_HEX: "4d6311fdc39d7f23fbe44d5321a09663d788d85d2bc06081be99e310a8f836d2",

  // SAC tokens (C... ids + 32-byte contract-id payloads) — real-named mock SACs on testnet.
  // TOKEN_A/B kept for the legacy bilateral OTC path; the dark pool uses the TOKENS registry below.
  TOKEN_A: "CAZ2G2KVLXUZOPCIF5VHB5NSC7PJDLJ57VCPDFZTJG7E46I2Y5JNJ32O", // USDC
  TOKEN_A_HEX: "33a369555de9973c482f6a70f5b217de91ad3dfd44f1973349be4e791ac752d4",
  TOKEN_B: "CC6EOFWKZODPBQ2SHGA4HSVI4RM6WRRO7B6ZHANKEWYB4HIJ765JCDEX", // XLM
  TOKEN_B_HEX: "bc4716cacb86f0c3523981c3caa8e459eb462ef87d9381aa25b01e1d09ffba91",

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

  EPOCH: 7n,
  EXPIRY: 1800000000n,
};
export const isChainWired = () => CONFIG.CONTRACT_ID.length > 0;
