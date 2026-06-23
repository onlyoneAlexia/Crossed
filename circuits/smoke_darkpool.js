// Smoke test: generate valid inputs for order.circom + dpmatch.circom, prove, verify, cross-check.
const { buildBabyjub, buildPoseidon } = require("circomlibjs");
const snarkjs = require("/home/mimi/Stellar hack/frontend/node_modules/snarkjs");
const path = require("path");
const fs = require("fs");

const DEPTH = 4;
const DOM_NFKEY = 4n, DOM_ORDER = 9n, DOM_NFORD = 10n, DOM_NFSPEND = 11n, DOM_NFCANCEL = 12n, DOM_MATCH = 5n;
const SCALE = 10000000n;

function merkleTree(leaves, H) {
  const levels = [leaves.slice()];
  while (levels[levels.length - 1].length > 1) {
    const lv = levels[levels.length - 1], next = [];
    for (let i = 0; i < lv.length; i += 2) next.push(H([lv[i], lv[i + 1]]));
    levels.push(next);
  }
  return levels;
}
function pathOf(levels, idx) {
  const el = [], id = []; let i = idx;
  for (let d = 0; d < DEPTH; d++) { el.push(levels[d][i ^ 1]); id.push(BigInt(i & 1)); i >>= 1; }
  return { el, id };
}

async function main() {
  const babyJub = await buildBabyjub();
  const poseidon = await buildPoseidon();
  const F = poseidon.F;
  const H = (arr) => F.toObject(poseidon(arr));
  const pkOf = (sk) => { const p = babyJub.mulPointEscalar(babyJub.Base8, sk); return [babyJub.F.toObject(p[0]), babyJub.F.toObject(p[1])]; };

  const skSell = 1842691506730593589715640265812303443278722616060409963675235883983912748183n;
  const skBuy = 2506352711390682365749481717887863839384675139060050738479224417377419301n;
  const pkSell = pkOf(skSell), pkBuy = pkOf(skBuy);
  const hskSell = H([skSell]), hskBuy = H([skBuy]);
  const leafSell = H([pkSell[0], pkSell[1], hskSell]);
  const leafBuy = H([pkBuy[0], pkBuy[1], hskBuy]);

  const leaves = new Array(1 << DEPTH).fill(0n);
  const idxSell = 3, idxBuy = 10;
  leaves[idxSell] = leafSell; leaves[idxBuy] = leafBuy;
  const levels = merkleTree(leaves, H);
  const root = levels[levels.length - 1][0];
  const pSell = pathOf(levels, idxSell), pBuy = pathOf(levels, idxBuy);

  const pair_id = 1n, batch_id = 1n;
  const sizeSell = 100000000n, sizeBuy = 100000000n;   // 10 AAA
  const limitSell = 24000000n, limitBuy = 26000000n;   // 2.4 / 2.6 (x1e7)
  const saltSell = 111n, saltBuy = 222n;

  // expected note/nf for the sell order
  const noteSell = H([DOM_ORDER, leafSell, 0n, pair_id, sizeSell, limitSell, saltSell, batch_id]);
  const noteBuy = H([DOM_ORDER, leafBuy, 1n, pair_id, sizeBuy, limitBuy, saltBuy, batch_id]);
  const nfOrderSell = H([DOM_NFORD, saltSell, noteSell]);
  const nfCancelSell = H([DOM_NFCANCEL, saltSell, noteSell]);
  const nfSpendSell = H([DOM_NFSPEND, saltSell, noteSell]);
  const nfSpendBuy = H([DOM_NFSPEND, saltBuy, noteBuy]);

  // midpoint + quote witness
  const sum = limitSell + limitBuy;            // 50000000
  const cross = sum / 2n;                       // 25000000
  const parity = sum % 2n;                      // 0
  const product = sizeSell * cross;             // base*cross
  const quote = product / SCALE;               // floor
  const rem = product % SCALE;
  const matchId = H([DOM_MATCH, noteSell, noteBuy, pair_id, batch_id, root]);

  const orderInput = {
    sk: skSell.toString(), side: "0", size: sizeSell.toString(), limit_price: limitSell.toString(),
    salt: saltSell.toString(), path_el: pSell.el.map(String), path_idx: pSell.id.map(String),
    pair_id: pair_id.toString(), batch_id: batch_id.toString(), root: root.toString(),
  };
  const matchInput = {
    leaf_sell_w: leafSell.toString(), size_sell: sizeSell.toString(), limit_sell: limitSell.toString(),
    salt_sell: saltSell.toString(),
    leaf_buy_w: leafBuy.toString(), size_buy: sizeBuy.toString(), limit_buy: limitBuy.toString(),
    salt_buy: saltBuy.toString(),
    cross_price: cross.toString(), parity: parity.toString(), quote_amount_w: quote.toString(), rem: rem.toString(),
    pair_id: pair_id.toString(), batch_id: batch_id.toString(), root: root.toString(),
  };
  const cancelInput = {
    sk: skSell.toString(), side: "0", size: sizeSell.toString(), limit_price: limitSell.toString(),
    salt: saltSell.toString(), path_el: pSell.el.map(String), path_idx: pSell.id.map(String),
    pair_id: pair_id.toString(), batch_id: batch_id.toString(), root: root.toString(),
  };

  const B = (c) => path.join("build", c);
  // ORDER proof
  const o = await snarkjs.groth16.fullProve(orderInput, B("order/order_js/order.wasm"), B("order/order_final.zkey"));
  const ovk = require("./build/order/order_vk.json");
  const ook = await snarkjs.groth16.verify(ovk, o.publicSignals, o.proof);
  fs.writeFileSync(B("order/verification_key.json"), JSON.stringify(ovk));
  fs.writeFileSync(B("order/proof.json"), JSON.stringify(o.proof));
  fs.writeFileSync(B("order/public.json"), JSON.stringify(o.publicSignals));
  console.log("ORDER verify:", ook, "publicSignals:", o.publicSignals);
  console.log("  expect [note,nf_order,pair,batch,root] =", [noteSell, nfOrderSell, pair_id, batch_id, root].map(String));

  // CANCEL ORDER proof
  const c = await snarkjs.groth16.fullProve(cancelInput, B("cancel_order/cancel_order_js/cancel_order.wasm"), B("cancel_order/cancel_order_final.zkey"));
  const cvk = require("./build/cancel_order/cancel_order_vk.json");
  const cok = await snarkjs.groth16.verify(cvk, c.publicSignals, c.proof);
  fs.writeFileSync(B("cancel_order/verification_key.json"), JSON.stringify(cvk));
  fs.writeFileSync(B("cancel_order/proof.json"), JSON.stringify(c.proof));
  fs.writeFileSync(B("cancel_order/public.json"), JSON.stringify(c.publicSignals));
  console.log("CANCEL verify:", cok, "publicSignals:", c.publicSignals);
  console.log("  expect [note,nf_cancel,leaf,pair,batch,root] =", [noteSell, nfCancelSell, leafSell, pair_id, batch_id, root].map(String));

  // MATCH proof
  const m = await snarkjs.groth16.fullProve(matchInput, B("dpmatch/dpmatch_js/dpmatch.wasm"), B("dpmatch/dpmatch_final.zkey"));
  const mvk = require("./build/dpmatch/dpmatch_vk.json");
  const mok = await snarkjs.groth16.verify(mvk, m.publicSignals, m.proof);
  fs.writeFileSync(B("dpmatch/verification_key.json"), JSON.stringify(mvk));
  fs.writeFileSync(B("dpmatch/proof.json"), JSON.stringify(m.proof));
  fs.writeFileSync(B("dpmatch/public.json"), JSON.stringify(m.publicSignals));
  console.log("MATCH verify:", mok);
  const ps = m.publicSignals;
  console.log("  match publicSignals:", ps);
  console.log("  expect match_id:", matchId.toString());
  console.log("  expect note_sell:", noteSell.toString(), "note_buy:", noteBuy.toString());
  console.log("  expect base_amount:", sizeSell.toString(), "quote_amount:", quote.toString(), "(cross", cross.toString(), ")");
  // cross-check order note == match note_sell
  const consistent = o.publicSignals[0] === ps[1];
  console.log("CROSS-CHECK order.note == match.note_sell:", consistent);

  const cancelConsistent = c.publicSignals[0] === o.publicSignals[0] && c.publicSignals[2] === leafSell.toString();
  console.log("CROSS-CHECK cancel.note == order.note:", cancelConsistent);

  const pass = ook && cok && mok && consistent && cancelConsistent && ps[7] === sizeSell.toString() && ps[8] === quote.toString();
  console.log(pass ? "\n✅ SMOKE PASS — circuits prove + verify with consistent public outputs" : "\n❌ SMOKE FAIL");
  process.exit(pass ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
