#![no_std]
//! Day-1 spike: a generic Groth16 verifier over BN254, verified inside Soroban
//! using the native BN254 host functions. This proves the end-to-end path
//! (Circom/snarkjs proof -> byte serialization -> on-chain pairing check) that
//! the "Crossed" Like/Match circuits will depend on.
//!
//! Groth16 check (snarkjs convention):
//!   e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
//! where vk_x = IC[0] + sum_i pub_i * IC[i+1].

use soroban_sdk::{
    contract, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    vec, BytesN, Env, Vec,
};

#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: BytesN<64>,  // G1
    pub b: BytesN<128>, // G2
    pub c: BytesN<64>,  // G1
}

#[contracttype]
#[derive(Clone)]
pub struct VerifyingKey {
    pub alpha1: BytesN<64>,    // G1
    pub beta2: BytesN<128>,    // G2
    pub gamma2: BytesN<128>,   // G2
    pub delta2: BytesN<128>,   // G2
    pub ic: Vec<BytesN<64>>,   // G1[], length = nPublic + 1
}

#[contract]
pub struct Verifier;

#[contractimpl]
impl Verifier {
    /// Returns true iff `proof` is a valid Groth16 proof for `pub_signals` under `vk`.
    pub fn verify(env: Env, vk: VerifyingKey, proof: Proof, pub_signals: Vec<BytesN<32>>) -> bool {
        let bn = env.crypto().bn254();

        // vk_x = IC[0] + Σ pub_i * IC[i+1]
        let ic0 = Bn254G1Affine::from_bytes(vk.ic.get(0).unwrap());
        let mut points: Vec<Bn254G1Affine> = Vec::new(&env);
        let mut scalars: Vec<Bn254Fr> = Vec::new(&env);
        for i in 0..pub_signals.len() {
            points.push_back(Bn254G1Affine::from_bytes(vk.ic.get(i + 1).unwrap()));
            scalars.push_back(Bn254Fr::from_bytes(pub_signals.get(i).unwrap()));
        }
        let vk_x = if points.is_empty() {
            ic0
        } else {
            bn.g1_add(&ic0, &bn.g1_msm(points, scalars))
        };

        let neg_a = -Bn254G1Affine::from_bytes(proof.a);
        let b = Bn254G2Affine::from_bytes(proof.b);
        let c = Bn254G1Affine::from_bytes(proof.c);
        let alpha1 = Bn254G1Affine::from_bytes(vk.alpha1);
        let beta2 = Bn254G2Affine::from_bytes(vk.beta2);
        let gamma2 = Bn254G2Affine::from_bytes(vk.gamma2);
        let delta2 = Bn254G2Affine::from_bytes(vk.delta2);

        let vp1 = vec![&env, neg_a, alpha1, vk_x, c];
        let vp2 = vec![&env, b, beta2, gamma2, delta2];
        bn.pairing_check(vp1, vp2)
    }
}

#[cfg(test)]
mod fixtures;
#[cfg(test)]
mod test;
#[cfg(test)]
mod fixtures_like;
#[cfg(test)]
mod test_like;
