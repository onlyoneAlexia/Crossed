#![cfg(test)]
use crate::fixtures::*;
use crate::{Proof, Verifier, VerifierClient, VerifyingKey};
use soroban_sdk::{BytesN, Env, Vec};

fn vk(env: &Env) -> VerifyingKey {
    let mut ic: Vec<BytesN<64>> = Vec::new(env);
    for row in IC.iter() {
        ic.push_back(BytesN::from_array(env, row));
    }
    VerifyingKey {
        alpha1: BytesN::from_array(env, &VK_ALPHA1),
        beta2: BytesN::from_array(env, &VK_BETA2),
        gamma2: BytesN::from_array(env, &VK_GAMMA2),
        delta2: BytesN::from_array(env, &VK_DELTA2),
        ic,
    }
}

fn proof(env: &Env) -> Proof {
    Proof {
        a: BytesN::from_array(env, &PROOF_A),
        b: BytesN::from_array(env, &PROOF_B),
        c: BytesN::from_array(env, &PROOF_C),
    }
}

fn pubs(env: &Env) -> Vec<BytesN<32>> {
    let mut v: Vec<BytesN<32>> = Vec::new(env);
    for p in PUB.iter() {
        v.push_back(BytesN::from_array(env, p));
    }
    v
}

#[test]
fn verifies_real_groth16_proof() {
    let env = Env::default();
    let client = VerifierClient::new(&env, &env.register(Verifier, ()));
    assert!(
        client.verify(&vk(&env), &proof(&env), &pubs(&env)),
        "a valid Groth16 proof must verify on-chain"
    );
}

#[test]
fn rejects_tampered_public_input() {
    let env = Env::default();
    let client = VerifierClient::new(&env, &env.register(Verifier, ()));

    let mut bad = PUB[0];
    bad[31] ^= 1; // flip one bit of the public signal
    let mut tampered: Vec<BytesN<32>> = Vec::new(&env);
    tampered.push_back(BytesN::from_array(&env, &bad));

    assert!(
        !client.verify(&vk(&env), &proof(&env), &tampered),
        "a tampered public input must fail verification"
    );
}
