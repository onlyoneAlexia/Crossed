#![cfg(test)]

use super::*;
use crate::{fixtures_cancel_order, fixtures_dpmatch, fixtures_intent, fixtures_intent_b, fixtures_match, fixtures_order};
use soroban_sdk::{
    address_payload::AddressPayload,
    contract, contractimpl, contracttype,
    testutils::{Address as _, Ledger as _, MockAuth, MockAuthInvoke},
    token::TokenClient,
    Address, BytesN, Env, IntoVal, MuxedAddress,
};

const EPOCH: u64 = 7;
const EXPIRY: u64 = 1_800_000_000;
const A_SELL_AMOUNT: i128 = 10_000_000;
const A_BUY_AMOUNT: i128 = 25_000_000;

#[contracttype]
#[derive(Clone)]
enum TokenKey {
    Balance(Address),
}

#[contract]
struct TestToken;

#[contractimpl]
impl TestToken {
    pub fn mint(env: Env, to: Address, amount: i128) {
        if amount < 0 {
            panic!("negative mint");
        }
        let bal = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&TokenKey::Balance(to), &(bal + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&TokenKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: MuxedAddress, amount: i128) {
        if amount <= 0 {
            panic!("amount must be positive");
        }
        from.require_auth();
        let to = to.address();
        let from_bal = Self::balance(env.clone(), from.clone());
        if from_bal < amount {
            panic!("insufficient balance");
        }
        let to_bal = Self::balance(env.clone(), to.clone());
        env.storage()
            .persistent()
            .set(&TokenKey::Balance(from), &(from_bal - amount));
        env.storage()
            .persistent()
            .set(&TokenKey::Balance(to), &(to_bal + amount));
    }
}

fn proof_from(env: &Env, a: &[u8; 64], b: &[u8; 128], c: &[u8; 64]) -> Proof {
    Proof {
        a: BytesN::from_array(env, a),
        b: BytesN::from_array(env, b),
        c: BytesN::from_array(env, c),
    }
}

fn intent_a_proof(env: &Env) -> Proof {
    proof_from(
        env,
        &fixtures_intent::PROOF_A,
        &fixtures_intent::PROOF_B,
        &fixtures_intent::PROOF_C,
    )
}

fn intent_b_proof(env: &Env) -> Proof {
    proof_from(
        env,
        &fixtures_intent_b::PROOF_A,
        &fixtures_intent_b::PROOF_B,
        &fixtures_intent_b::PROOF_C,
    )
}

fn match_proof(env: &Env) -> Proof {
    proof_from(
        env,
        &fixtures_match::PROOF_A,
        &fixtures_match::PROOF_B,
        &fixtures_match::PROOF_C,
    )
}

fn order_proof(env: &Env) -> Proof {
    proof_from(
        env,
        &fixtures_order::PROOF_A,
        &fixtures_order::PROOF_B,
        &fixtures_order::PROOF_C,
    )
}

fn cancel_order_proof(env: &Env) -> Proof {
    proof_from(
        env,
        &fixtures_cancel_order::PROOF_A,
        &fixtures_cancel_order::PROOF_B,
        &fixtures_cancel_order::PROOF_C,
    )
}

fn b32(env: &Env, bytes: &[u8; 32]) -> BytesN<32> {
    BytesN::from_array(env, bytes)
}

fn bytes(value: u8) -> [u8; 32] {
    [value; 32]
}

fn raw_from_limbs(env: &Env, hi: &[u8; 32], lo: &[u8; 32]) -> BytesN<32> {
    let mut out = [0u8; 32];
    out[0..16].copy_from_slice(&hi[16..32]);
    out[16..32].copy_from_slice(&lo[16..32]);
    BytesN::from_array(env, &out)
}

fn chain_id(env: &Env) -> BytesN<32> {
    raw_from_limbs(env, &fixtures_intent::PUB[2], &fixtures_intent::PUB[3])
}

fn fixture_contract_id(env: &Env) -> BytesN<32> {
    raw_from_limbs(env, &fixtures_intent::PUB[4], &fixtures_intent::PUB[5])
}

fn sell_asset(env: &Env) -> BytesN<32> {
    raw_from_limbs(env, &fixtures_match::PUB[4], &fixtures_match::PUB[5])
}

fn buy_asset(env: &Env) -> BytesN<32> {
    raw_from_limbs(env, &fixtures_match::PUB[6], &fixtures_match::PUB[7])
}

fn contract_address(env: &Env, id: &BytesN<32>) -> Address {
    AddressPayload::ContractIdHash(id.clone()).to_address(env)
}

fn setup_at(contract_id_raw: [u8; 32]) -> (Env, CrossedClient<'static>, Address, Address, Address, Address) {
    let env = Env::default();
    let chain_id = chain_id(&env);
    let contract_id = BytesN::from_array(&env, &contract_id_raw);
    env.ledger().set_network_id(chain_id.to_array());
    env.ledger().set_sequence_number(100);
    env.ledger().set_timestamp(1_700_000_000);

    let admin = Address::generate(&env);
    let coordinator = Address::generate(&env);
    let owner_a = Address::generate(&env);
    let owner_b = Address::generate(&env);
    let crossed_address = contract_address(&env, &contract_id);
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &crossed_address,
            fn_name: "__constructor",
            args: (&admin, &coordinator, &chain_id).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    env.register_at(&crossed_address, Crossed, (&admin, &coordinator, &chain_id));
    env.set_auths(&[]);
    let client = CrossedClient::new(&env, &crossed_address);
    (env, client, coordinator, owner_a, owner_b, admin)
}

fn setup() -> (Env, CrossedClient<'static>, Address, Address, Address, Address) {
    let env = Env::default();
    let contract_id = fixture_contract_id(&env).to_array();
    setup_at(contract_id)
}

fn register_two(env: &Env, client: &CrossedClient, coordinator: &Address, owner_a: &Address, owner_b: &Address) {
    client.mock_all_auths().register(
        owner_a,
        &b32(env, &bytes(1)),
        &b32(env, &bytes(2)),
        &b32(env, &bytes(3)),
        &b32(env, &bytes(4)),
    );
    client.mock_all_auths().register(
        owner_b,
        &b32(env, &bytes(5)),
        &b32(env, &bytes(6)),
        &b32(env, &bytes(7)),
        &b32(env, &bytes(8)),
    );
    let _ = coordinator;
}

fn post_fixture_root(env: &Env, client: &CrossedClient, coordinator: &Address, owner_a: &Address, owner_b: &Address) {
    register_two(env, client, coordinator, owner_a, owner_b);
    client.mock_all_auths().post_root(
        &b32(env, &fixtures_match::PUB[16]),
        &2u32,
        &b32(env, &bytes(9)),
    );
}

fn submit_intent_a(env: &Env, client: &CrossedClient, owner: &Address) -> u64 {
    client.mock_all_auths().submit_intent(
        owner,
        &intent_a_proof(env),
        &b32(env, &fixtures_intent::PUB[0]),
        &b32(env, &fixtures_intent::PUB[1]),
        &EPOCH,
        &b32(env, &fixtures_intent::PUB[7]),
    )
}

fn submit_intent_b(env: &Env, client: &CrossedClient, owner: &Address) -> u64 {
    client.mock_all_auths().submit_intent(
        owner,
        &intent_b_proof(env),
        &b32(env, &fixtures_intent_b::PUB[0]),
        &b32(env, &fixtures_intent_b::PUB[1]),
        &EPOCH,
        &b32(env, &fixtures_intent_b::PUB[7]),
    )
}

fn install_tokens(env: &Env, owner_a: &Address, owner_b: &Address, enough_b: bool) -> (Address, Address) {
    let token_a = contract_address(env, &sell_asset(env));
    let token_b = contract_address(env, &buy_asset(env));
    env.register_at(&token_a, TestToken, ());
    env.register_at(&token_b, TestToken, ());
    let mint_a = TestTokenClient::new(env, &token_a);
    let mint_b = TestTokenClient::new(env, &token_b);
    mint_a.mint(owner_a, &(A_SELL_AMOUNT * 2));
    mint_b.mint(owner_b, &(if enough_b { A_BUY_AMOUNT * 2 } else { A_BUY_AMOUNT - 1 }));
    (token_a, token_b)
}

fn register_darkpool_fixture_leaves(env: &Env, client: &CrossedClient, owner_a: &Address, owner_b: &Address) {
    client.mock_all_auths().register(
        owner_a,
        &b32(env, &bytes(21)),
        &b32(env, &bytes(22)),
        &b32(env, &bytes(23)),
        &b32(env, &fixtures_dpmatch::PUB[5]),
    );
    client.mock_all_auths().register(
        owner_b,
        &b32(env, &bytes(24)),
        &b32(env, &bytes(25)),
        &b32(env, &bytes(26)),
        &b32(env, &fixtures_dpmatch::PUB[6]),
    );
    client.mock_all_auths().post_root(
        &b32(env, &fixtures_order::PUB[4]),
        &2u32,
        &b32(env, &bytes(27)),
    );
}

fn configure_darkpool_pair(env: &Env, client: &CrossedClient, owner_a: &Address, owner_b: &Address) -> (Address, Address) {
    let (token_a, token_b) = install_tokens(env, owner_a, owner_b, true);
    client
        .mock_all_auths()
        .configure_pair(&1u32, &token_a, &token_b);
    (token_a, token_b)
}

fn place_fixture_order(env: &Env, client: &CrossedClient) {
    client.mock_all_auths().place_order(
        &order_proof(env),
        &b32(env, &fixtures_order::PUB[0]),
        &b32(env, &fixtures_order::PUB[1]),
        &1u32,
        &1u64,
        &b32(env, &fixtures_order::PUB[4]),
    );
}

fn settle(env: &Env, client: &CrossedClient) {
    client.mock_all_auths_allowing_non_root_auth().settle_match(
        &match_proof(env),
        &b32(env, &fixtures_match::PUB[0]),
        &b32(env, &fixtures_match::PUB[1]),
        &b32(env, &fixtures_match::PUB[2]),
        &b32(env, &fixtures_match::PUB[3]),
        &sell_asset(env),
        &buy_asset(env),
        &A_SELL_AMOUNT,
        &A_BUY_AMOUNT,
        &EPOCH,
        &EXPIRY,
        &b32(env, &fixtures_match::PUB[16]),
    );
}

#[test]
fn cancel_dp_order_removes_open_order_with_owner_auth() {
    let (env, client, _coordinator, owner_a, owner_b, _admin) = setup();
    register_darkpool_fixture_leaves(&env, &client, &owner_a, &owner_b);
    configure_darkpool_pair(&env, &client, &owner_a, &owner_b);
    place_fixture_order(&env, &client);

    let note = b32(&env, &fixtures_order::PUB[0]);
    assert!(client.is_order_open(&note));

    client.mock_all_auths().cancel_order(
        &owner_a,
        &cancel_order_proof(&env),
        &note,
        &b32(&env, &fixtures_cancel_order::PUB[1]),
        &b32(&env, &fixtures_cancel_order::PUB[2]),
        &1u32,
        &1u64,
        &b32(&env, &fixtures_cancel_order::PUB[5]),
    );

    assert!(!client.is_order_open(&note));
    assert!(client.is_spent_nullifier(&b32(&env, &fixtures_cancel_order::PUB[1])));
}

#[test]
fn cancel_dp_order_rejects_wrong_owner() {
    let (env, client, _coordinator, owner_a, owner_b, _admin) = setup();
    register_darkpool_fixture_leaves(&env, &client, &owner_a, &owner_b);
    configure_darkpool_pair(&env, &client, &owner_a, &owner_b);
    place_fixture_order(&env, &client);

    assert!(client
        .mock_all_auths()
        .try_cancel_order(
            &owner_b,
            &cancel_order_proof(&env),
            &b32(&env, &fixtures_order::PUB[0]),
            &b32(&env, &fixtures_cancel_order::PUB[1]),
            &b32(&env, &fixtures_cancel_order::PUB[2]),
            &1u32,
            &1u64,
            &b32(&env, &fixtures_cancel_order::PUB[5]),
        )
        .is_err());
    assert!(client.is_order_open(&b32(&env, &fixtures_order::PUB[0])));
}

#[test]
fn initialize_once() {
    let (env, client, coordinator, _owner_a, _owner_b, admin) = setup();
    let chain_id = chain_id(&env);
    let contract_id = fixture_contract_id(&env);
    assert!(client
        .try_initialize(&admin, &coordinator, &chain_id, &contract_id)
        .is_err());
}

#[test]
fn register_requires_owner_and_coordinator_auth() {
    let (env, client, _coordinator, owner_a, _owner_b, _admin) = setup();
    assert!(client
        .try_register(
            &owner_a,
            &b32(&env, &bytes(1)),
            &b32(&env, &bytes(2)),
            &b32(&env, &bytes(3)),
            &b32(&env, &bytes(4)),
        )
        .is_err());
}

#[test]
fn register_stores_real_leaf_not_h_sk() {
    let (env, client, _coordinator, owner_a, _owner_b, _admin) = setup();
    let h_sk = b32(&env, &bytes(3));
    let leaf = b32(&env, &bytes(4));
    let index = client.mock_all_auths().register(
        &owner_a,
        &b32(&env, &bytes(1)),
        &b32(&env, &bytes(2)),
        &h_sk,
        &leaf,
    );
    let registration = client.get_registration(&index);
    assert_eq!(registration.leaf, leaf);
    assert_ne!(registration.leaf, h_sk);
}

#[test]
fn post_root_requires_coordinator() {
    let (env, client, _coordinator, owner_a, owner_b, _admin) = setup();
    register_two(&env, &client, &Address::generate(&env), &owner_a, &owner_b);
    assert!(client
        .try_post_root(&b32(&env, &fixtures_match::PUB[16]), &2u32, &b32(&env, &bytes(9)))
        .is_err());
}

#[test]
fn submit_intent_accepts_real_proof() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    let id = submit_intent_a(&env, &client, &owner_a);
    assert_eq!(id, 0);
    assert!(client.is_submitted_nullifier(&b32(&env, &fixtures_intent::PUB[1])));
    let record = client.get_intent(&id);
    assert_eq!(record.owner, owner_a);
    assert_eq!(record.c, b32(&env, &fixtures_intent::PUB[0]));
}

#[test]
fn submit_intent_rejects_wrong_root() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    let mut wrong = fixtures_intent::PUB[7];
    wrong[31] ^= 1;
    assert!(client
        .mock_all_auths()
        .try_submit_intent(
            &owner_a,
            &intent_a_proof(&env),
            &b32(&env, &fixtures_intent::PUB[0]),
            &b32(&env, &fixtures_intent::PUB[1]),
            &EPOCH,
            &b32(&env, &wrong),
        )
        .is_err());
}

#[test]
fn submit_intent_rejects_wrong_contract_publics() {
    let env = Env::default();
    let mut wrong_contract = fixture_contract_id(&env).to_array();
    wrong_contract[31] ^= 1;

    let (_env, client, coordinator, owner_a, owner_b, _admin) =
        setup_at(wrong_contract);
    post_fixture_root(&_env, &client, &coordinator, &owner_a, &owner_b);
    assert!(client
        .mock_all_auths()
        .try_submit_intent(
            &owner_a,
            &intent_a_proof(&_env),
            &b32(&_env, &fixtures_intent::PUB[0]),
            &b32(&_env, &fixtures_intent::PUB[1]),
            &EPOCH,
            &b32(&_env, &fixtures_intent::PUB[7]),
        )
        .is_err());
}

#[test]
fn submit_intent_rejects_duplicate_nf() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    submit_intent_a(&env, &client, &owner_a);
    assert!(client
        .mock_all_auths()
        .try_submit_intent(
            &owner_a,
            &intent_a_proof(&env),
            &b32(&env, &fixtures_intent::PUB[0]),
            &b32(&env, &fixtures_intent::PUB[1]),
            &EPOCH,
            &b32(&env, &fixtures_intent::PUB[7]),
        )
        .is_err());
}

#[test]
fn settle_match_accepts_real_proof_and_transfers_both_tokens() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    submit_intent_a(&env, &client, &owner_a);
    submit_intent_b(&env, &client, &owner_b);
    let (token_a, token_b) = install_tokens(&env, &owner_a, &owner_b, true);
    let token_a_client = TokenClient::new(&env, &token_a);
    let token_b_client = TokenClient::new(&env, &token_b);

    settle(&env, &client);

    assert_eq!(token_a_client.balance(&owner_a), A_SELL_AMOUNT);
    assert_eq!(token_a_client.balance(&owner_b), A_SELL_AMOUNT);
    assert_eq!(token_b_client.balance(&owner_a), A_BUY_AMOUNT);
    assert_eq!(token_b_client.balance(&owner_b), A_BUY_AMOUNT);
    assert!(client.is_spent_nullifier(&b32(&env, &fixtures_intent::PUB[1])));
    assert!(client.is_spent_nullifier(&b32(&env, &fixtures_intent_b::PUB[1])));
    assert!(client.is_matched(&b32(&env, &fixtures_match::PUB[0])));
}

#[test]
fn settle_match_rejects_wrong_terms() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    submit_intent_a(&env, &client, &owner_a);
    submit_intent_b(&env, &client, &owner_b);
    install_tokens(&env, &owner_a, &owner_b, true);
    let mut wrong_terms = fixtures_match::PUB[3];
    wrong_terms[31] ^= 1;

    assert!(client
        .mock_all_auths_allowing_non_root_auth()
        .try_settle_match(
            &match_proof(&env),
            &b32(&env, &fixtures_match::PUB[0]),
            &b32(&env, &fixtures_match::PUB[1]),
            &b32(&env, &fixtures_match::PUB[2]),
            &b32(&env, &wrong_terms),
            &sell_asset(&env),
            &buy_asset(&env),
            &A_SELL_AMOUNT,
            &A_BUY_AMOUNT,
            &EPOCH,
            &EXPIRY,
            &b32(&env, &fixtures_match::PUB[16]),
        )
        .is_err());
}

#[test]
fn settle_match_rejects_tampered_match_id() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    submit_intent_a(&env, &client, &owner_a);
    submit_intent_b(&env, &client, &owner_b);
    install_tokens(&env, &owner_a, &owner_b, true);
    let mut bad_mid = fixtures_match::PUB[0];
    bad_mid[31] ^= 1;
    assert!(client
        .mock_all_auths_allowing_non_root_auth()
        .try_settle_match(
            &match_proof(&env),
            &b32(&env, &bad_mid),
            &b32(&env, &fixtures_match::PUB[1]),
            &b32(&env, &fixtures_match::PUB[2]),
            &b32(&env, &fixtures_match::PUB[3]),
            &sell_asset(&env),
            &buy_asset(&env),
            &A_SELL_AMOUNT,
            &A_BUY_AMOUNT,
            &EPOCH,
            &EXPIRY,
            &b32(&env, &fixtures_match::PUB[16]),
        )
        .is_err());
}

#[test]
fn settle_match_rejects_expired() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    submit_intent_a(&env, &client, &owner_a);
    submit_intent_b(&env, &client, &owner_b);
    install_tokens(&env, &owner_a, &owner_b, true);
    env.ledger().set_timestamp(EXPIRY + 1);
    assert!(client
        .mock_all_auths_allowing_non_root_auth()
        .try_settle_match(
            &match_proof(&env),
            &b32(&env, &fixtures_match::PUB[0]),
            &b32(&env, &fixtures_match::PUB[1]),
            &b32(&env, &fixtures_match::PUB[2]),
            &b32(&env, &fixtures_match::PUB[3]),
            &sell_asset(&env),
            &buy_asset(&env),
            &A_SELL_AMOUNT,
            &A_BUY_AMOUNT,
            &EPOCH,
            &EXPIRY,
            &b32(&env, &fixtures_match::PUB[16]),
        )
        .is_err());
}

#[test]
fn settle_match_rejects_replay_same_match_id() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    submit_intent_a(&env, &client, &owner_a);
    submit_intent_b(&env, &client, &owner_b);
    install_tokens(&env, &owner_a, &owner_b, true);
    settle(&env, &client);
    assert!(client
        .mock_all_auths_allowing_non_root_auth()
        .try_settle_match(
            &match_proof(&env),
            &b32(&env, &fixtures_match::PUB[0]),
            &b32(&env, &fixtures_match::PUB[1]),
            &b32(&env, &fixtures_match::PUB[2]),
            &b32(&env, &fixtures_match::PUB[3]),
            &sell_asset(&env),
            &buy_asset(&env),
            &A_SELL_AMOUNT,
            &A_BUY_AMOUNT,
            &EPOCH,
            &EXPIRY,
            &b32(&env, &fixtures_match::PUB[16]),
        )
        .is_err());
}

#[test]
fn settle_match_rejects_cancelled_intent() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    let id_a = submit_intent_a(&env, &client, &owner_a);
    submit_intent_b(&env, &client, &owner_b);
    install_tokens(&env, &owner_a, &owner_b, true);
    client.mock_all_auths().cancel_intent(&owner_a, &id_a);
    assert!(client
        .mock_all_auths_allowing_non_root_auth()
        .try_settle_match(
            &match_proof(&env),
            &b32(&env, &fixtures_match::PUB[0]),
            &b32(&env, &fixtures_match::PUB[1]),
            &b32(&env, &fixtures_match::PUB[2]),
            &b32(&env, &fixtures_match::PUB[3]),
            &sell_asset(&env),
            &buy_asset(&env),
            &A_SELL_AMOUNT,
            &A_BUY_AMOUNT,
            &EPOCH,
            &EXPIRY,
            &b32(&env, &fixtures_match::PUB[16]),
        )
        .is_err());
}

#[test]
fn settle_match_underfunded_aborts_without_spending() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    submit_intent_a(&env, &client, &owner_a);
    submit_intent_b(&env, &client, &owner_b);
    install_tokens(&env, &owner_a, &owner_b, false);
    assert!(client
        .mock_all_auths_allowing_non_root_auth()
        .try_settle_match(
            &match_proof(&env),
            &b32(&env, &fixtures_match::PUB[0]),
            &b32(&env, &fixtures_match::PUB[1]),
            &b32(&env, &fixtures_match::PUB[2]),
            &b32(&env, &fixtures_match::PUB[3]),
            &sell_asset(&env),
            &buy_asset(&env),
            &A_SELL_AMOUNT,
            &A_BUY_AMOUNT,
            &EPOCH,
            &EXPIRY,
            &b32(&env, &fixtures_match::PUB[16]),
        )
        .is_err());
    assert!(!client.is_spent_nullifier(&b32(&env, &fixtures_intent::PUB[1])));
    assert!(!client.is_matched(&b32(&env, &fixtures_match::PUB[0])));
}

#[test]
fn settle_match_requires_both_party_auth() {
    let (env, client, coordinator, owner_a, owner_b, _admin) = setup();
    post_fixture_root(&env, &client, &coordinator, &owner_a, &owner_b);
    submit_intent_a(&env, &client, &owner_a);
    submit_intent_b(&env, &client, &owner_b);
    install_tokens(&env, &owner_a, &owner_b, true);
    assert!(client
        .try_settle_match(
            &match_proof(&env),
            &b32(&env, &fixtures_match::PUB[0]),
            &b32(&env, &fixtures_match::PUB[1]),
            &b32(&env, &fixtures_match::PUB[2]),
            &b32(&env, &fixtures_match::PUB[3]),
            &sell_asset(&env),
            &buy_asset(&env),
            &A_SELL_AMOUNT,
            &A_BUY_AMOUNT,
            &EPOCH,
            &EXPIRY,
            &b32(&env, &fixtures_match::PUB[16]),
        )
        .is_err());
}
