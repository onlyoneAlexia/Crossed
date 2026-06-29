# Crossed OTC Coordinator

Semi-trusted coordinator service for the deployed Crossed OTC testnet contracts.

It keeps an in-memory ordered registration directory, verifies Poseidon leaves locally, posts Merkle roots, mints the two SAC assets, and submits `settle_match` transactions with trader-provided Soroban auth entries.

## Files

- `server.js` - Express API and service bootstrap.
- `directory.js` - Poseidon leaf hashing and depth-4 Merkle directory.
- `chain.js` - Stellar SDK ScVal helpers and simulate/assemble/sign/submit flow.
- `coordinator.test.js` - Node unit tests for Merkle parity and mocked register verification.
- `package.json` - ESM Node package metadata.

## Setup

```bash
cd coordinator
npm install
npm test
```

The tests mock chain submission and do not contact Stellar RPC. This sandbox cannot resolve the public testnet RPC host.

## Run

From the repository root:

```bash
COORDINATOR_SECRET=$(stellar keys show crossed-deployer) node coordinator/server.js
```

Default URL: `http://127.0.0.1:8790`

Environment:

- `COORDINATOR_SECRET` - required Stellar secret for the coordinator/issuer.
- `PORT` - defaults to `8790`.
- `HOST` - defaults to `127.0.0.1`.
- `RPC_URL` - defaults to `https://soroban-testnet.stellar.org`.
- `OTC_CONTRACT_ID`, `DP_CONTRACT_ID`, `TOKEN_A_CONTRACT_ID`, `TOKEN_B_CONTRACT_ID` - optional overrides for the deployed IDs.
- `DP_MIN_BATCH_ORDERS` - minimum open orders before `/dp/close` advances a batch, default `2`.
- `DP_BATCH_MS` - optional auto-close interval in milliseconds. When set above `0`, the coordinator runs the same batch matcher on a timer.

## Endpoints

- `GET /health`
- `POST /register` with `{ pk_x, pk_y, h_sk, leaf }`
- `GET /directory`
- `POST /mint` with `{ account, token: "A"|"B", amount }`
- `POST /settle` with `{ args, auth }`
- `POST /dp/register` with trader owner, leaf fields, and a trader-signed register auth entry
- `POST /dp/order` with `{ owner, proof, leaf, note, nf_order, root, side, size, limit_price, salt, pair_id }`
- `POST /dp/close`
- `GET /dp/batch`
- `GET /dp/fills/:owner`

`/settle` expects both trader `SorobanAuthorizationEntry` values as base64 XDR. The coordinator only submits the assembled transaction and signs as the source account.

`/dp/order` must not receive a trader identity `sk`; order proofs are generated client-side.
