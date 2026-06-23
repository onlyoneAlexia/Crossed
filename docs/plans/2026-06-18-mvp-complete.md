# Crossed MVP — COMPLETE ✅ (end-to-end, live in-browser, on testnet)

**Date:** 2026-06-18 · Built by Codex (backend) + Claude (frontend), coordinated via `docs/plans/2026-06-18-mvp-interface.md`.

## Proven live (two users in a real Chrome browser, via playwriter)
Alice (origin `127.0.0.1:5173`) and Bob (origin `localhost:5173`) = two isolated identities:
1. Both **Join** → register on testnet (index 0 / 1) + post directory root. ✓
2. Alice **likes** Bob → **Groth16 LIKE proof generated in the browser** → on-chain `submit_like` (opaque C + nf). ✓
3. Bob **likes** Alice → same. ✓
4. Alice **Check for matches** → relayer rendezvous detects reciprocity → **MATCH proof in browser** → on-chain `publish_match`. ✓
5. Both UIs show **"🎉 It's a Crossed!"** with the same `match_id` (`245dd0a052…`). ✓

Screenshots: `/tmp/crossed_alice_match.png`, `/tmp/crossed_bob_match.png`.

## Stack
- **Contract (testnet):** `CBHBVRKXBKRAPKPJAHE7DUQ4LEJGGZBTNKZNAHDQL7KDEW2SUNECAG5Z` — `contracts/crossed/` (register, post_root, submit_like, publish_match, views; LIKE+MATCH Groth16/BN254 vks baked in; 9 cargo tests pass).
- **Circuits:** `circuits/like.circom`, `circuits/match.circom` (baby-jubjub ECDH rendezvous, Poseidon C/nf with private-key-bound nullifier, depth-4 Merkle).
- **Relayer:** `relayer/server.js` (rendezvous matching, no lookup API; + CORS & profile directory for the FE).
- **Frontend:** `frontend/` (Vite/React/TS). `src/lib/crypto.ts` (mirrors circuits, snarkjs in-browser proving), `src/lib/chain.ts` (generated bindings + in-browser Stellar keypair, friendbot-funded), `src/lib/relayer.ts`, `src/App.tsx`.

## How to run
```bash
# backend already deployed (contract id above)
cd relayer && PORT=8787 node server.js          # relayer
cd frontend && npm run dev -- --host            # app on :5173 (use 127.0.0.1 and localhost for 2 users)
```

## MVP scope / deviations (honest)
- In-browser Stellar keypair (friendbot-funded) instead of Freighter — self-contained onboarding.
- Directory root is registrar-posted (`post_root`) from off-chain circomlib Poseidon (SDK 26 lacks a circomlib-compatible on-chain hash helper); contract still verifies real Groth16 and accepts current/previous root.
- Envelope "encryption" is base64 of the salt (MVP); design calls for HKDF(rdv) AEAD.
- Merkle depth 4 (≤16 users). Production: bump depth, real PoP on register, OPRF/PSI relayer, forward-secure per-epoch keys (all on the roadmap in the design doc).

## What's real (not faked)
Real baby-jubjub ECDH + Poseidon, real Groth16 proofs generated client-side, real on-chain BN254 verification in Soroban, real testnet transactions, real mutual-match privacy property. An unmatched like is only ever an opaque commitment + private-key-bound nullifier on-chain.
