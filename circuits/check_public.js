#!/usr/bin/env node
const fs = require("fs");

const kind = process.argv[2];
if (!["intent", "match"].includes(kind)) {
  console.error("usage: node check_public.js <intent|match>");
  process.exit(2);
}

const names = kind === "intent"
  ? [
      "C",
      "nf",
      "chain_id_hi",
      "chain_id_lo",
      "contract_id_hi",
      "contract_id_lo",
      "epoch",
      "root",
    ]
  : [
      "match_id",
      "C_self",
      "C_partner",
      "terms_hash",
      "a_sell_asset_hi",
      "a_sell_asset_lo",
      "a_buy_asset_hi",
      "a_buy_asset_lo",
      "a_sell_amount",
      "a_buy_amount",
      "chain_id_hi",
      "chain_id_lo",
      "contract_id_hi",
      "contract_id_lo",
      "epoch",
      "expiry",
      "root",
    ];

const expected = JSON.parse(fs.readFileSync(`build/${kind}/${kind}_expected.json`, "utf8")).public.map(String);
const actual = JSON.parse(fs.readFileSync(`build/${kind}/${kind}_public.json`, "utf8")).map(String);

let ok = expected.length === actual.length;
for (let i = 0; i < Math.max(expected.length, actual.length); i++) {
  const same = expected[i] === actual[i];
  if (!same) ok = false;
  console.log(`${names[i] || `signal_${i}`}: expected=${expected[i]} actual=${actual[i]} ${same ? "OK" : "MISMATCH"}`);
}

if (!ok) {
  console.error(`${kind} public parity: FAIL`);
  process.exit(1);
}
console.log(`${kind} public parity: OK`);
