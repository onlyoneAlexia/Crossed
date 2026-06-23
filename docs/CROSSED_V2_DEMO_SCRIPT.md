# Crossed v2 — Demo Video Script (2–3 min)

> A tight, shot-by-shot walkthrough for the upgraded venue. Target runtime **2:30**.
> Live on Stellar **testnet**. Dark-pool contract `CBGWGEP5YOOX6I734RGVGINASZR5PCGYLUV4AYEBX2M6GEFI7A3NEE24`.
>
> Two roles on screen: **you (narrator/trader)** and a **second wallet** that supplies the
> crossing order so the sealed batch can match live. Have the coordinator already running
> (`PORT=8790 node coordinator/server.js`) and both wallets pre-funded via the Faucet page so the
> demo never stalls. Verbatim narration is in quotes; everything else is a stage/screen cue.

---

## 0:00 – 0:15 · Hook

**[Screen: the Crossed landing page, logo + tagline, contract id line visible.]**

> "Every time you place a large trade on a public order book, the whole market sees it before
> you're filled — and front-runs you. Crossed is a **dark pool on Stellar**: your order stays
> sealed until it crosses, and funds only move when a zero-knowledge proof says the trade is real."

**Cue:** click **Launch app**.

---

## 0:15 – 0:35 · The problem (why a dark pool, why ZK)

**[Screen: the dark-pool trade view, the "Orders are sealed…" info tooltip expanded.]**

> "On a normal exchange, your size and price are public the moment you post. On Crossed, the chain
> only ever sees an **opaque commitment** and, after a match, the settled fill. No size, no limit
> price, no leak. The catch a dark pool has to solve: if nobody can read the orders, how does anyone
> trust the operator settled fairly? Our answer is a **proof, not a promise.**"

---

## 0:35 – 1:35 · Live private swap with the v2 features

**[Screen: the generic swap form — pay X / receive Y.]**

> "This is the upgraded venue. First new thing: it's now **multi-asset** — six fully-meshed pairs
> across USDC, XLM, EURC, and USDT. I just pick what I'm paying and what I want back."

**Cue:** open the **from** token picker, choose **EURC**; open **to**, choose **USDC**; type a size
and a limit price. (The UI resolves this to a pair + side automatically.)

> "I'll sell EURC for USDC. Watch the status line as I place it."

**Cue:** click **Place sealed order**. Point the cursor at the status text as it updates:
`Generating your order proof locally…` → `Order sealed (batch #N)…`.

> "Second new thing — and this is the privacy upgrade: **my browser generated the Groth16 proof
> locally.** My pool identity key never left this machine; it's even encrypted at rest with my
> wallet signature. The coordinator only received a commitment and a one-time order opening — it can
> match this order, but it can **never use my key to forge a future one.**"

**[Screen: the Activity row showing `sealed · pending`, with Edit / Cancel buttons.]**

> "Third new thing: a sealed order isn't frozen. I can **cancel or edit** it — and even that is
> private."

**Cue:** click **Edit** (or **Cancel**). Point at the status: `Generating your cancel proof locally…`
→ `Cancelling the sealed order on-chain…`.

> "Cancelling uses a **separate zero-knowledge proof.** It reveals only that *I* own this one order
> so nobody else can cancel it — it still hides the side, the size, and the price. Edit is just
> cancel-and-replace, so adjusting a quote never exposes the old one."

**Cue:** re-place the (edited) order so there's a live resting order again. Then switch to the
**second wallet** and place the **crossing** order (buy EURC with USDC at a price that crosses).

> "Now there's a second, compatible order in the pool. Batches wait until at least two orders are
> present, then I close the batch."

**Cue:** click **Run match** / close batch. Show both balances flipping atomically — seller's EURC
escrow drops, USDC arrives; buyer's mirror.

> "Both sides settled in a **single atomic swap at the midpoint** — no partial leakage, no
> counterparty risk."

---

## 1:35 – 2:00 · On-chain proof shot

**[Screen: click the settle tx hash → stellar.expert testnet explorer.]**

> "And here's the receipt. This is the public Stellar explorer — not our app."

**Cue:** highlight, in order: the **`settle_dp_match`** invocation on contract `CBGWGEP5…`, and the
two token transfers in the same transaction.

> "Notice what's on-chain: a commitment, a nullifier, and the fills — but **nowhere** does it show
> who wanted what, at what size, or at what price. The match proof was **verified inside the
> contract** before a single token moved. If the proof didn't check, the swap would have reverted."

**Cue:** open the **contract** page to show it's a real, live, persistent contract (six configured
pairs, prior fills).

---

## 2:00 – 2:25 · How the ZK actually works

**[Screen: a simple 3-box diagram — Browser → Coordinator → Contract.]**

> "Three pieces. **One:** your browser proves, in zero knowledge, that you're a registered member
> and your order is well-formed — and keeps your key. **Two:** the coordinator collects sealed
> orders and, when two cross, builds a **dpmatch Groth16 proof** that the two orders genuinely
> overlap — same pair, prices that cross, amounts conserved. **Three:** the Soroban contract
> **verifies that proof on-chain** and, only if it passes, executes the atomic escrow swap at the
> midpoint."

> "So the operator can match, but it **cannot lie**: a bad fill produces an invalid proof, and the
> contract simply refuses to settle. Privacy from the sealed batch; honesty from the proof."

---

## 2:25 – 2:35 · Close

**[Screen: back to the app, balances updated, one clean sealed-order line in Activity.]**

> "Crossed: a private, multi-asset dark pool on Stellar where your orders stay yours, the operator
> can't cheat, and every fill is provably fair — live on testnet today. Thanks for watching."

---

## Pre-flight checklist (do before you hit record)
- Coordinator running on `:8790`, synced (log shows `Synced N registration(s)`); FE `config.ts`
  `DP_CONTRACT_ID` matches the coordinator's contract id (mismatch → `Auth, InvalidAction` on register).
- Both demo wallets entered the pool and **pre-funded via the Faucet page** (mints all tokens).
- Pick a pair/price where the two orders **will** cross, so the live match lands on the first try.
- Have the stellar.expert tx tab pre-loadable (copy the settle hash the instant it appears).
- Optional safety net: a pre-recorded successful `node coordinator/dp_e2e.js` run to cut to if the
  live match hiccups.

## Accurate-claims guardrail (do NOT overclaim on camera)
- Say "the coordinator sees submitted order **terms** for matching" — do **not** say it's
  operator-blind or that it can't see terms.
- Say "**identity key** never leaves the browser" — that's the precise, true privacy claim.
- Cancel "reveals ownership of the **one** canceled order" — don't claim canceled orders stay fully
  unlinkable to the owner.
- It's a "**trusted-coordinator** dark pool whose settlement is trustless," not a "fully trustless
  dark pool."
