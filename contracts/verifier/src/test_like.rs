#![cfg(test)]
//! Verifies a REAL "Crossed" LIKE proof (baby-jubjub ECDH rendezvous + Poseidon
//! C/nf + Merkle membership) against the generic Groth16/BN254 verifier.
use crate::fixtures_like::*;
use crate::{Proof, Verifier, VerifierClient, VerifyingKey};
use soroban_sdk::{BytesN, Env, Vec};

fn setup(env: &Env) -> (VerifyingKey, Proof, Vec<BytesN<32>>) {
    let mut ic: Vec<BytesN<64>> = Vec::new(env);
    for row in IC.iter() {
        ic.push_back(BytesN::from_array(env, row));
    }
    let vk = VerifyingKey {
        alpha1: BytesN::from_array(env, &VK_ALPHA1),
        beta2: BytesN::from_array(env, &VK_BETA2),
        gamma2: BytesN::from_array(env, &VK_GAMMA2),
        delta2: BytesN::from_array(env, &VK_DELTA2),
        ic,
    };
    let proof = Proof {
        a: BytesN::from_array(env, &PROOF_A),
        b: BytesN::from_array(env, &PROOF_B),
        c: BytesN::from_array(env, &PROOF_C),
    };
    let mut pubs: Vec<BytesN<32>> = Vec::new(env);
    for p in PUB.iter() {
        pubs.push_back(BytesN::from_array(env, p));
    }
    (vk, proof, pubs)
}

#[test]
fn verifies_real_like_proof() {
    let env = Env::default();
    let client = VerifierClient::new(&env, &env.register(Verifier, ()));
    let (vk, proof, pubs) = setup(&env);
    assert!(
        client.verify(&vk, &proof, &pubs),
        "a valid Crossed LIKE proof must verify on-chain"
    );
}

#[test]
fn rejects_tampered_like_nullifier() {
    let env = Env::default();
    let client = VerifierClient::new(&env, &env.register(Verifier, ()));
    let (vk, proof, mut pubs) = setup(&env);
    // tamper the nullifier public signal (index 1)
    let mut bad = PUB[1];
    bad[31] ^= 1;
    pubs.set(1, BytesN::from_array(&env, &bad));
    assert!(
        !client.verify(&vk, &proof, &pubs),
        "a tampered LIKE public signal must fail verification"
    );
}
