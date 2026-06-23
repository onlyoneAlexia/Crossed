# Crossed Relayer

In-memory rendezvous relayer for Crossed OTC intents. It exposes no token lookup or equality-test endpoint: submissions are accepted only after a successful on-chain `IntentSubmitted` receipt is verified.

```bash
cd relayer
npm install
npm start
```

Default URL: `http://127.0.0.1:8787`.

Optional:

```bash
PORT=8787
STELLAR_RPC_URL=https://soroban-testnet.stellar.org
```

## API

`POST /intent`

```json
{
  "network": "testnet",
  "contract_id": "<C... or hex32>",
  "tx_hash": "<64-char tx hash>",
  "record_id": 0,
  "c": "<hex32>",
  "token": "<hex32>",
  "inbox": "<hex32>",
  "envelope": {
    "v": 1,
    "alg": "AES-256-GCM",
    "nonce": "<base64url>",
    "ciphertext": "<base64url>",
    "tag": "<base64url>"
  }
}
```

Returns:

```json
{ "matched": false }
```

or:

```json
{ "matched": true }
```

`GET /poll/:inbox`

```json
{ "matched": false }
```

or:

```json
{
  "matched": true,
  "counterpart": {
    "record_id": 1,
    "c": "<hex32>",
    "envelope": {
      "v": 1,
      "alg": "AES-256-GCM",
      "nonce": "<base64url>",
      "ciphertext": "<base64url>",
      "tag": "<base64url>"
    }
  }
}
```
