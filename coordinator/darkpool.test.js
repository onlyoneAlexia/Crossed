import assert from "node:assert/strict";

import {
  buildDirectoryTree,
  proveCancelOrder,
  proveMatch,
  proveOrder,
  verifyCancelOrderProof,
  verifyMatchProof,
  verifyOrderProof,
} from "./darkpool.js";

const skSell = "1842691506730593589715640265812303443278722616060409963675235883983912748183";
const skBuy = "2506352711390682365749481717887863839384675139060050738479224417377419301";

const registrations = [
  {
    index: 3,
    pk_x: "12687799684184602287013427252911734969197142080880228106992503661977094739859",
    pk_y: "17012664891403336410326685643969223506868268510312459373628401289417343652080",
    h_sk: "7468010056132676029338864687252430967195512320768897625685386588663886933191",
    leaf: "0x0196952886ebfb31cf44429b61d4614e1cf144c3c78443bd3bc56fddf6b2afd0",
  },
  {
    index: 10,
    pk_x: "8786631853519632738182591870531851875965198383348374029942913716271500498034",
    pk_y: "5549077401385939457880598314090713029925467715168448641063833031389170809186",
    h_sk: "11211103954442107903149289523828883066837582018638814853343666545869152939254",
    leaf: "0x28e20421509a51d329e02d4f096d3813effaeb5104ffef7c9f9708ea723b3856",
  },
];

async function main() {
  const tree = await buildDirectoryTree(registrations);
  const pair_id = 1;
  const batch_id = 1;
  const sell = { sk: skSell, side: 0, size: "100000000", limit_price: "24000000", salt: "111", pair_id, batch_id, tree, leafIndex: 3 };
  const buy = { sk: skBuy, side: 1, size: "100000000", limit_price: "26000000", salt: "222", pair_id, batch_id, tree, leafIndex: 10 };

  const sellOrder = await proveOrder(sell);
  const buyOrder = await proveOrder(buy);
  const sellCancel = await proveCancelOrder(sell);
  const sellOpening = {
    side: 0,
    size: sell.size,
    limit_price: sell.limit_price,
    salt: sell.salt,
    leaf: registrations[0].leaf,
    note: sellOrder.note,
  };
  const buyOpening = {
    side: 1,
    size: buy.size,
    limit_price: buy.limit_price,
    salt: buy.salt,
    leaf: registrations[1].leaf,
    note: buyOrder.note,
  };
  const matched = await proveMatch({ sell: sellOpening, buy: buyOpening, pair_id, batch_id, tree });

  assert.equal(await verifyOrderProof(sellOrder.rawProof, sellOrder.publicSignals), true);
  assert.equal(await verifyOrderProof(buyOrder.rawProof, buyOrder.publicSignals), true);
  assert.equal(await verifyCancelOrderProof(sellCancel.rawProof, sellCancel.publicSignals), true);
  assert.equal(await verifyMatchProof(matched.rawProof, matched.publicSignals), true);

  assert.equal(sellOrder.publicSignals[0], BigInt(`0x${sellOrder.note}`).toString());
  assert.equal(sellOrder.publicSignals[1], BigInt(`0x${sellOrder.nf_order}`).toString());
  assert.equal(sellOrder.publicSignals[4], tree.root.toString());
  assert.equal(sellCancel.note, sellOrder.note);
  assert.equal(sellCancel.leaf, sellOrder.leaf);
  assert.equal(sellCancel.publicSignals[1], BigInt(`0x${sellCancel.nf_cancel}`).toString());
  assert.equal(sellCancel.publicSignals[5], tree.root.toString());
  assert.equal(buyOrder.publicSignals[0], BigInt(`0x${buyOrder.note}`).toString());
  assert.equal(matched.publicSignals[0], BigInt(`0x${matched.match_id}`).toString());
  assert.equal(matched.note_sell, sellOrder.note);
  assert.equal(matched.note_buy, buyOrder.note);
  assert.equal(matched.publicSignals[1], sellOrder.publicSignals[0]);
  assert.equal(matched.publicSignals[2], buyOrder.publicSignals[0]);
  assert.equal(matched.base_amount, "100000000");
  assert.equal(matched.quote_amount, "250000000");
  assert.equal(Object.hasOwn(sellOpening, "sk"), false);
  assert.equal(Object.hasOwn(buyOpening, "sk"), false);

  console.log("darkpool offline prover test passed");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
