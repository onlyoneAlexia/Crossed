// Shared token + trading-pair registry for the dark pool.
// All tokens are mock SAC-wrapped classic assets issued by the coordinator/deployer
// (GDQPLQXZ…), so the coordinator can mint any of them. Pairs must be configured on-chain
// via configure_pair(pair_id, base, quote) before orders on that pair will settle.
export const TOKENS = [
  { sym: "USDC", id: "CAZ2G2KVLXUZOPCIF5VHB5NSC7PJDLJ57VCPDFZTJG7E46I2Y5JNJ32O" },
  { sym: "XLM",  id: "CC6EOFWKZODPBQ2SHGA4HSVI4RM6WRRO7B6ZHANKEWYB4HIJ765JCDEX" },
  { sym: "EURC", id: "CBPK5QDKOPY2OCFUOP5TX2EVCYDQRWIDLCVMXXILUU7CBN6MH4QZIS5P" },
  { sym: "USDT", id: "CC6MUXKGNHZ4NMAFMX4HWLPA5R6MVHJCSYIC4KL7RATUB25KMDSM2SA2" },
];

// pair_id -> (base, quote). base = the asset a "sell" escrows; price is quote-per-base.
// Mirrors the on-chain configure_pair calls. Fully meshed over the 4 tokens (6 pairs).
export const PAIRS = [
  { id: 1, base: "USDC", quote: "XLM" },
  { id: 2, base: "EURC", quote: "USDC" },
  { id: 3, base: "USDT", quote: "USDC" },
  { id: 4, base: "EURC", quote: "XLM" },
  { id: 5, base: "USDT", quote: "XLM" },
  { id: 6, base: "EURC", quote: "USDT" },
];

export const TOKEN_BY_SYM = Object.fromEntries(TOKENS.map((t) => [t.sym, t.id]));
export const VALID_PAIR_IDS = new Set(PAIRS.map((p) => p.id));
