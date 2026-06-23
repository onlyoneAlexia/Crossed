# Day-1 Verifier Spike — RESULT: ✅ SUCCESS

**Date:** 2026-06-18 · Goal: verify one Circom/snarkjs Groth16 proof inside a Soroban contract (the #1 project-killing risk). **Retired — natively AND on live testnet.**

## Outcome
- Native unit tests: `verifies_real_groth16_proof` ✅, `rejects_tampered_public_input` ✅
- Testnet contract: **`CDICWPWA47VIHI3QVAOQOEATJEIMFUKLXNRQQJS3GCCG7LGX2VAVTWLA`**
  - `verify(valid proof)` → **true**
  - `verify(wrong public input)` → **false**
- Deployer (testnet): `GDQPLQXZJWFGSVWM4JYCBXFOEAATO5TNH2MR674MABIBI5WU3LWTLOUK`

## Toolchain (installed)
rustc/cargo 1.96.0 · target **wasm32v1-none** (NOT wasm32-unknown-unknown — stellar-cli 27 uses v1) · stellar 27.0.0 · circom 2.2.3 · snarkjs 0.7.6 · soroban-sdk **26** (env 26.1.3). PATH needs `~/.cargo/bin:~/.local/bin`.

## The serialization (authoritative, from soroban-sdk 26.1.0 `crypto/bn254.rs`)
- **G1** (64B): `be(x) ‖ be(y)`, 32B big-endian each. Infinity = 64 zero bytes.
- **G2** (128B): `be(x) ‖ be(y)`, each Fp2 = **`be(c1) ‖ be(c0)`** — *imaginary part first*. snarkjs stores `[c0, c1]`, so **swap** when converting. ← the gotcha that breaks most ports; handled in `scripts/to_soroban.js` / `to_invoke.js`.
- **Fr** (32B): big-endian, auto-reduced mod r.
- Groth16 check: `pairing_check([-A, α, vk_x, C], [B, β, γ, δ])` with `vk_x = IC₀ + g1_msm(IC₁.., pub)`. API: `g1_add/g1_mul/g1_msm`, `pairing_check`, `Neg for Bn254G1Affine`.

## Artifacts in repo
- `contracts/verifier/` — generic Groth16/BN254 verifier (`verify(vk, proof, pub_signals) -> bool`) + tests.
- `circuits/multiplier.circom` + `circuits/input.json` — spike circuit (a·b=c, 1 public signal).
- `scripts/to_soroban.js` — snarkjs JSON → Rust fixtures (`contracts/verifier/src/fixtures.rs`).
- `scripts/to_invoke.js` — snarkjs JSON → CLI hex args.

## Reproduce
```bash
export PATH="$HOME/.cargo/bin:$HOME/.local/bin:$PATH"
# 1. proof: cd circuits && circom multiplier.circom --r1cs --wasm --sym -p bn128 -o build && (snarkjs groth16 pipeline)
# 2. fixtures + native test:
node scripts/to_soroban.js circuits/build contracts/verifier/src/fixtures.rs
cargo test -p verifier
# 3. testnet:
stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/verifier.wasm --source crossed-deployer --network testnet
node scripts/to_invoke.js circuits/build /tmp
stellar contract invoke --id <CID> --source crossed-deployer --network testnet -- \
  verify --vk "$(cat /tmp/vk.json)" --proof "$(cat /tmp/proof.json)" --pub_signals "$(cat /tmp/pub.json)"
```

## Next (Day 3 per build plan — we're ahead)
Write the real **LIKE** circuit (baby-jubjub keygen + ECDH `rdv` + Poseidon `C`/`nf` with the private-key-bound nullifier fix + Merkle membership), reusing this exact verifier + serialization. Reuse the spike's snarkjs→soroban pipeline unchanged.
