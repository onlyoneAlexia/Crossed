# Claude UI Handoff — Dark-Pool Privacy Update

Date: 2026-06-22

## What Changed

The dark-pool order flow is now a standard dApp-style client proof flow:

- The browser generates the ORDER Groth16 proof locally.
- `/dp/order` rejects any submitted long-lived pool identity `sk`.
- The coordinator receives only:
  - `proof`
  - `leaf`
  - `note`
  - `nf_order`
  - `root`
  - one-time order opening fields: `side`, `size`, `limit_price`, `salt`, `pair_id`
- The coordinator still sees order terms for matching. Do not call it fully operator-blind.
- Match spend nullifiers are now derived from one-time order salts, not identity nullifier keys.
- Batches now wait for at least `DP_MIN_BATCH_ORDERS` open orders, default `2`, before advancing.
- The browser encrypts the local pool identity with AES-GCM using a wallet-signed message when the selected wallet supports `signMessage`; unsupported wallets fall back to the legacy localStorage format.
- Open sealed orders can now be canceled by the owner. Edit is intentionally implemented as cancel + replace, not mutation.
- Cancellation uses a separate CANCEL_ORDER Groth16 proof generated in the browser. The cancel transaction reveals the registered member leaf for that canceled order so the contract can enforce wallet ownership, but it still does not reveal side, size, limit price, or salt.

## UI Copy To Use

Use accurate wording:

- "Generating your order proof locally..."
- "Your identity key stayed in the browser."
- "Your pool identity is encrypted locally when your wallet supports message signing."
- "The coordinator can match this submitted order, but cannot use your identity key to forge future orders."
- "Batch is waiting for more orders (1/2)."
- "Generating your cancel proof locally..."
- "Order cancelled; adjust the form and place the replacement."
- "Cancel reveals the owner leaf for this canceled order only; terms stay hidden."

Avoid overclaims:

- Do not say "the coordinator cannot see your order terms."
- Do not say "fully trustless dark pool."
- Do not say "operator-blind matching" yet.
- Do not say canceled orders remain fully unlinkable to the owner. The cancel path reveals the member leaf so the contract can enforce ownership.

## Existing Frontend Changes

Implemented in `frontend/src/DarkPool.tsx`:

- `placeOrder()` calls `proveDpOrder()` before `chain.dpSubmitOrder()`.
- The order payload no longer includes `sk`.
- `runMatch()` handles `pending` responses from `/dp/close`.
- The info tooltip now says the browser proves membership locally.
- Activity rows now include `Edit` and `Cancel` actions for locally known pending orders.
- Pending orders persist the minimum private opening locally so cancellation can be proven later.

Implemented in `frontend/src/lib/otc.ts`:

- `proveDpOrder()` uses `/circuits/order.wasm`, `/circuits/order_final.zkey`, and `/circuits/order_vk.json`.
- `proveDpCancelOrder()` uses `/circuits/cancel_order.wasm`, `/circuits/cancel_order_final.zkey`, and `/circuits/cancel_order_vk.json`.

Implemented in `frontend/src/lib/chain.ts`:

- `DpOrderInput` requires proof/public signals/opening fields, no `sk`.
- `dpCancelOrder()` submits the owner-signed `cancel_order` contract call.
- `dpCancelCoordinator()` tells the coordinator to drop the canceled in-memory order after the on-chain cancel succeeds.

## Suggested UI Polish

- Add a small local-proof state near the order button while `proveDpOrder()` runs.
- Add the same small local-proof state while `proveDpCancelOrder()` runs.
- Add a non-alarming pending-batch state in Activity:
  - pending note: "sealed · waiting for batch"
  - tooltip/copy: "The batch will close once another compatible order is present."
- Make Activity order actions visually calmer:
  - `Edit` should read as cancel + form refill + replacement.
  - `Cancel` should show a signing/proving state, then remove the row.
  - Keep the actions compact on mobile so the amount line does not collide with buttons.
- Keep the dark-pool trust model concise:
  - "On-chain observers see commitments and fills."
  - "Coordinator sees submitted terms for matching."
  - "Identity key never leaves your browser."
  - "Cancel reveals ownership for the canceled order so no one else can cancel it."

## Deployment Note

The live contract has been redeployed for the new verification keys:

- Current DP/OTC contract: `CDFQ2O2CLVYGFONHDWSCJSBC4RNVPG5TDHH4ETLVLJ4W54UU4LAXMH5H`
- Raw contract id hex: `cb0d3b425d7062b9a71da424c822e45b579bb319cfc24d755a796ef294e2c176`
