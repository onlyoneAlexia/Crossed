#![no_std]

use soroban_sdk::{
    address_payload::AddressPayload,
    contract, contractevent, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    token::TokenClient,
    vec, Address, BytesN, Env, IntoVal, MuxedAddress, Val, Vec,
};

mod fixtures_intent;
mod fixtures_match;
mod fixtures_order;
mod fixtures_order_v2;
mod fixtures_cancel_order;
mod fixtures_cancel_order_v2;
mod fixtures_dpmatch;
mod fixtures_dpmatch_v2;
mod fixtures_dpmatch_v3;
#[cfg(test)]
mod fixtures_intent_b;
#[cfg(test)]
mod test;

#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: BytesN<64>,
    pub b: BytesN<128>,
    pub c: BytesN<64>,
}

#[contracttype]
#[derive(Clone)]
struct VerifyingKey {
    alpha1: BytesN<64>,
    beta2: BytesN<128>,
    gamma2: BytesN<128>,
    delta2: BytesN<128>,
    ic: Vec<BytesN<64>>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IntentRecord {
    pub id: u64,
    pub owner: Address,
    pub c: BytesN<32>,
    pub nf: BytesN<32>,
    pub epoch: u64,
    pub root: BytesN<32>,
    pub submitted_ledger: u32,
    pub cancelled: bool,
    pub settled: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Registration {
    pub index: u32,
    pub owner: Address,
    pub pk_x: BytesN<32>,
    pub pk_y: BytesN<32>,
    pub h_sk: BytesN<32>,
    pub leaf: BytesN<32>,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct OpenOrderRecord {
    pub batch_id: u64,
    pub pair_id: u32,
    pub expiry: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SettlementTerms {
    pub a_sell_asset: BytesN<32>,
    pub a_buy_asset: BytesN<32>,
    pub a_sell_amount: i128,
    pub a_buy_amount: i128,
}

#[contractevent(topics = ["Registered"])]
#[derive(Clone)]
pub struct RegisteredEvent {
    pub index: u32,
    pub owner: Address,
    pub leaf: BytesN<32>,
}

#[contractevent(topics = ["RootPosted"])]
#[derive(Clone)]
pub struct RootPostedEvent {
    pub root: BytesN<32>,
    pub leaf_count: u32,
    pub leaves_digest: BytesN<32>,
}

#[contractevent(topics = ["IntentSubmitted"])]
#[derive(Clone)]
pub struct IntentSubmittedEvent {
    pub id: u64,
    pub owner: Address,
    pub c: BytesN<32>,
    pub nf: BytesN<32>,
    pub epoch: u64,
    pub root: BytesN<32>,
}

#[contractevent(topics = ["IntentCancelled"])]
#[derive(Clone)]
pub struct IntentCancelledEvent {
    pub id: u64,
    pub owner: Address,
}

#[contractevent(topics = ["MatchSettled"])]
#[derive(Clone)]
pub struct MatchSettledEvent {
    pub match_id: BytesN<32>,
    pub intent_a: u64,
    pub intent_b: u64,
    pub owner_a: Address,
    pub owner_b: Address,
    pub a_sell_asset: BytesN<32>,
    pub a_buy_asset: BytesN<32>,
    pub a_sell_amount: i128,
    pub a_buy_amount: i128,
    pub terms_hash: BytesN<32>,
}

#[contractevent(topics = ["OrderPlaced"])]
#[derive(Clone)]
pub struct OrderPlacedEvent {
    pub note: BytesN<32>,
    pub pair_id: u32,
    pub batch_id: u64,
}

#[contractevent(topics = ["OrderCancelled"])]
#[derive(Clone)]
pub struct OrderCancelledEvent {
    pub owner: Address,
    pub note: BytesN<32>,
    pub leaf: BytesN<32>,
    pub pair_id: u32,
    pub batch_id: u64,
}

#[contractevent(topics = ["DpSettled"])]
#[derive(Clone)]
pub struct DpSettledEvent {
    pub match_id: BytesN<32>,
    pub leaf_sell: BytesN<32>,
    pub leaf_buy: BytesN<32>,
    pub base_amount: i128,
    pub quote_amount: i128,
    pub pair_id: u32,
}

#[contractevent(topics = ["Paused"])]
#[derive(Clone)]
pub struct PausedEvent {
    pub paused: bool,
}

#[contractevent(topics = ["CoordinatorProposed"])]
#[derive(Clone)]
pub struct CoordinatorProposedEvent {
    pub new_coordinator: Address,
    pub unlock_ledger: u32,
}

#[contractevent(topics = ["CoordinatorExecuted"])]
#[derive(Clone)]
pub struct CoordinatorExecutedEvent {
    pub new_coordinator: Address,
}

#[contractevent(topics = ["GuardianProposed"])]
#[derive(Clone)]
pub struct GuardianProposedEvent {
    pub new_guardian: Address,
    pub unlock_ledger: u32,
}

#[contractevent(topics = ["GuardianExecuted"])]
#[derive(Clone)]
pub struct GuardianExecutedEvent {
    pub new_guardian: Address,
}

#[contractevent(topics = ["AdminTransferProposed"])]
#[derive(Clone)]
pub struct AdminTransferProposedEvent {
    pub new_admin: Address,
    pub unlock_ledger: u32,
}

#[contractevent(topics = ["AdminTransferExecuted"])]
#[derive(Clone)]
pub struct AdminTransferExecutedEvent {
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contractevent(topics = ["TierChanged"])]
#[derive(Clone)]
pub struct TierChangedEvent {
    pub leaf: BytesN<32>,
    pub tier: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PendingAddressChange {
    pub proposed: Address,
    pub unlock_ledger: u32,
    pub proposed_by: Address,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    Admin,
    Guardian,
    Paused,
    Coordinator,
    ChainId,
    ContractId,
    LeafCount,
    Leaf(u32),
    Registration(u32),
    RegistrationByLeaf(BytesN<32>),
    CurrentRoot,
    PreviousRoot,
    RootPosted(BytesN<32>),
    IntentCount,
    Intent(u64),
    IntentByC(BytesN<32>),
    PendingAdmin,
    PendingCoordinator,
    PendingGuardian,
    SubmittedNullifier(BytesN<32>),
    SpentNullifier(BytesN<32>),
    Match(BytesN<32>),
    // --- dark pool (Phase 1) ---
    Escrow(Address, Address),     // (owner, token) -> i128 balance held in the contract
    OpenOrder(BytesN<32>),        // note -> OpenOrderRecord (an open, opaque order)
    PairBase(u32),                // pair_id -> base token Address (e.g. AAA)
    PairQuote(u32),               // pair_id -> quote token Address (e.g. BBB)
    TierByLeaf(BytesN<32>),       // leaf -> counterparty tier
}

const TREE_CAPACITY: u32 = 16;
const DELAY_LEDGERS: u32 = 17_280;
const TTL_THRESHOLD: u32 = 17_280;
const TTL_EXTEND_TO: u32 = 518_400;

#[contract]
pub struct Crossed;

#[contractimpl]
impl Crossed {
    pub fn __constructor(
        env: Env,
        admin: Address,
        coordinator: Address,
        chain_id: BytesN<32>,
    ) {
        // Derive the contract id from the deployed address — avoids a chicken-and-egg
        // at deploy (the id isn't known until after deployment) and is tamper-proof.
        let contract_id = current_contract_id(&env);
        initialize_state(env, admin, coordinator, chain_id, contract_id);
    }

    pub fn initialize(
        env: Env,
        admin: Address,
        coordinator: Address,
        chain_id: BytesN<32>,
        contract_id: BytesN<32>,
    ) {
        let _ = (env, admin, coordinator, chain_id, contract_id);
        panic!("deprecated: use constructor");
    }

    pub fn propose_set_coordinator(env: Env, new_coordinator: Address) {
        require_initialized(&env);
        let unlock_ledger = propose_address_change(
            &env,
            DataKey::PendingCoordinator,
            new_coordinator.clone(),
        );
        CoordinatorProposedEvent {
            new_coordinator,
            unlock_ledger,
        }
        .publish(&env);
    }

    pub fn set_coordinator(env: Env, new_coordinator: Address) {
        Self::propose_set_coordinator(env, new_coordinator);
    }

    pub fn execute_set_coordinator(env: Env, new_coordinator: Address) {
        require_initialized(&env);
        let new_coordinator =
            execute_address_change(&env, DataKey::PendingCoordinator, &new_coordinator);
        env.storage()
            .instance()
            .set(&DataKey::Coordinator, &new_coordinator);
        CoordinatorExecutedEvent { new_coordinator }.publish(&env);
    }

    pub fn set_paused(env: Env, paused: bool) {
        require_initialized(&env);
        guardian(&env).require_auth();
        let was_paused = paused_raw(&env);
        env.storage().persistent().set(&DataKey::Paused, &paused);
        refresh_persistent_ttl(&env, &DataKey::Paused);
        if was_paused != paused {
            PausedEvent { paused }.publish(&env);
        }
    }

    pub fn propose_set_guardian(env: Env, new_guardian: Address) {
        require_initialized(&env);
        let unlock_ledger =
            propose_address_change(&env, DataKey::PendingGuardian, new_guardian.clone());
        GuardianProposedEvent {
            new_guardian,
            unlock_ledger,
        }
        .publish(&env);
    }

    pub fn set_guardian(env: Env, new_guardian: Address) {
        Self::propose_set_guardian(env, new_guardian);
    }

    pub fn execute_set_guardian(env: Env, new_guardian: Address) {
        require_initialized(&env);
        let new_guardian = execute_address_change(&env, DataKey::PendingGuardian, &new_guardian);
        env.storage()
            .persistent()
            .set(&DataKey::Guardian, &new_guardian);
        refresh_persistent_ttl(&env, &DataKey::Guardian);
        GuardianExecutedEvent { new_guardian }.publish(&env);
    }

    pub fn propose_admin_transfer(env: Env, new_admin: Address) {
        require_initialized(&env);
        let unlock_ledger =
            propose_address_change(&env, DataKey::PendingAdmin, new_admin.clone());
        AdminTransferProposedEvent {
            new_admin,
            unlock_ledger,
        }
        .publish(&env);
    }

    pub fn execute_admin_transfer(env: Env, new_admin: Address) {
        require_initialized(&env);
        let old_admin = admin(&env);
        let new_admin = execute_address_change(&env, DataKey::PendingAdmin, &new_admin);
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        AdminTransferExecutedEvent {
            old_admin,
            new_admin,
        }
        .publish(&env);
    }

    pub fn register(
        env: Env,
        owner: Address,
        pk_x: BytesN<32>,
        pk_y: BytesN<32>,
        h_sk: BytesN<32>,
        leaf: BytesN<32>,
    ) -> u32 {
        require_initialized(&env);
        owner.require_auth();
        coordinator(&env).require_auth();
        if leaf == h_sk {
            panic!("leaf must bind key");
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::RegistrationByLeaf(leaf.clone()))
        {
            panic!("duplicate leaf");
        }

        let index = leaf_count_raw(&env);
        if index >= TREE_CAPACITY {
            panic!("tree full");
        }
        let registration = Registration {
            index,
            owner: owner.clone(),
            pk_x,
            pk_y,
            h_sk,
            leaf: leaf.clone(),
        };
        let leaf_key = DataKey::Leaf(index);
        env.storage().persistent().set(&leaf_key, &leaf);
        refresh_persistent_ttl(&env, &leaf_key);
        let registration_key = DataKey::Registration(index);
        env.storage()
            .persistent()
            .set(&registration_key, &registration);
        refresh_persistent_ttl(&env, &registration_key);
        let leaf_registration_key = DataKey::RegistrationByLeaf(leaf.clone());
        env.storage()
            .persistent()
            .set(&leaf_registration_key, &index);
        refresh_persistent_ttl(&env, &leaf_registration_key);
        env.storage()
            .instance()
            .set(&DataKey::LeafCount, &(index + 1));
        RegisteredEvent { index, owner, leaf }.publish(&env);
        index
    }

    pub fn set_tier(env: Env, leaf: BytesN<32>, tier: u32) {
        require_initialized(&env);
        admin(&env).require_auth();
        let _owner = owner_by_leaf(&env, &leaf);
        let key = DataKey::TierByLeaf(leaf.clone());
        env.storage().persistent().set(&key, &tier);
        refresh_persistent_ttl(&env, &key);
        TierChangedEvent { leaf, tier }.publish(&env);
    }

    pub fn tier_of(env: Env, leaf: BytesN<32>) -> u32 {
        tier_of_raw(&env, &leaf)
    }

    pub fn post_root(env: Env, root: BytesN<32>, leaf_count: u32, leaves_digest: BytesN<32>) {
        require_initialized(&env);
        coordinator(&env).require_auth();
        if leaf_count > TREE_CAPACITY {
            panic!("tree full");
        }
        if leaf_count != leaf_count_raw(&env) {
            panic!("leaf count mismatch");
        }
        // TODO(security #4): root correctness is still coordinator-trusted because the
        // contract does not store a Poseidon frontier. Move to append-only frontier
        // verification or multisig/signed root attestations before mainnet.
        let prev = current_root(&env);
        env.storage().instance().set(&DataKey::PreviousRoot, &prev);
        env.storage().instance().set(&DataKey::CurrentRoot, &root);
        let root_key = DataKey::RootPosted(root.clone());
        env.storage()
            .persistent()
            .set(&root_key, &true);
        refresh_persistent_ttl(&env, &root_key);
        RootPostedEvent {
            root,
            leaf_count,
            leaves_digest,
        }
        .publish(&env);
    }

    pub fn submit_intent(
        env: Env,
        owner: Address,
        proof: Proof,
        c: BytesN<32>,
        nf: BytesN<32>,
        epoch: u64,
        root: BytesN<32>,
    ) -> u64 {
        require_initialized(&env);
        owner.require_auth();
        if !is_accepted_root(&env, &root) {
            panic!("root not accepted");
        }
        if is_submitted_nullifier_raw(&env, &nf) {
            panic!("nullifier submitted");
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::IntentByC(c.clone()))
        {
            panic!("commitment submitted");
        }
        // TODO(security #6): the current intent circuit public inputs do not expose
        // the member leaf or owner address, so the contract cannot prove that this
        // owner owns the witness leaf. Add a public self leaf and enforce
        // RegistrationByLeaf(leaf).owner == owner when the circuit is regenerated.

        let pubs = intent_public_signals(&env, &c, &nf, epoch, &root);
        if !verify(&env, intent_vk(&env), proof, pubs) {
            panic!("invalid intent proof");
        }

        let id: u64 = env.storage().instance().get(&DataKey::IntentCount).unwrap_or(0);
        let record = IntentRecord {
            id,
            owner: owner.clone(),
            c: c.clone(),
            nf: nf.clone(),
            epoch,
            root: root.clone(),
            submitted_ledger: env.ledger().sequence(),
            cancelled: false,
            settled: false,
        };
        let intent_key = DataKey::Intent(id);
        env.storage().persistent().set(&intent_key, &record);
        refresh_persistent_ttl(&env, &intent_key);
        let c_key = DataKey::IntentByC(c.clone());
        env.storage()
            .persistent()
            .set(&c_key, &id);
        refresh_persistent_ttl(&env, &c_key);
        let nf_key = DataKey::SubmittedNullifier(nf.clone());
        env.storage()
            .persistent()
            .set(&nf_key, &true);
        refresh_persistent_ttl(&env, &nf_key);
        env.storage()
            .instance()
            .set(&DataKey::IntentCount, &(id + 1));
        IntentSubmittedEvent {
            id,
            owner,
            c,
            nf,
            epoch,
            root,
        }
        .publish(&env);
        id
    }

    pub fn cancel_intent(env: Env, owner: Address, intent_id: u64) {
        require_initialized(&env);
        owner.require_auth();
        let mut record = intent_by_id(&env, intent_id);
        if record.owner != owner {
            panic!("owner mismatch");
        }
        if record.settled {
            panic!("already settled");
        }
        record.cancelled = true;
        let intent_key = DataKey::Intent(intent_id);
        env.storage()
            .persistent()
            .set(&intent_key, &record);
        refresh_persistent_ttl(&env, &intent_key);
        IntentCancelledEvent {
            id: intent_id,
            owner,
        }
        .publish(&env);
    }

    #[allow(clippy::too_many_arguments)]
    pub fn settle_match(
        env: Env,
        proof: Proof,
        match_id: BytesN<32>,
        c_a: BytesN<32>,
        c_b: BytesN<32>,
        terms_hash: BytesN<32>,
        a_sell_asset: BytesN<32>,
        a_buy_asset: BytesN<32>,
        a_sell_amount: i128,
        a_buy_amount: i128,
        epoch: u64,
        expiry: u64,
        root: BytesN<32>,
    ) {
        require_initialized(&env);
        if env.ledger().timestamp() > expiry {
            panic!("expired");
        }
        if a_sell_amount <= 0 || a_buy_amount <= 0 {
            panic!("amount must be positive");
        }
        if is_matched_raw(&env, &match_id) {
            panic!("match used");
        }

        let mut record_a = intent_by_c(&env, &c_a);
        let mut record_b = intent_by_c(&env, &c_b);
        if record_a.cancelled || record_b.cancelled {
            panic!("intent cancelled");
        }
        if record_a.settled || record_b.settled {
            panic!("intent settled");
        }
        if record_a.epoch != epoch || record_b.epoch != epoch {
            panic!("epoch mismatch");
        }
        if record_a.root != root || record_b.root != root {
            panic!("root mismatch");
        }
        if is_spent_nullifier_raw(&env, &record_a.nf) || is_spent_nullifier_raw(&env, &record_b.nf)
        {
            panic!("nullifier spent");
        }

        let pubs = match_public_signals(
            &env,
            &match_id,
            &c_a,
            &c_b,
            &terms_hash,
            &a_sell_asset,
            &a_buy_asset,
            a_sell_amount,
            a_buy_amount,
            epoch,
            expiry,
            &root,
        );
        if !verify(&env, match_vk(&env), proof, pubs) {
            panic!("invalid match proof");
        }

        let auth_args = settlement_auth_args(
            &env,
            &match_id,
            &c_a,
            &c_b,
            &terms_hash,
            &a_sell_asset,
            &a_buy_asset,
            a_sell_amount,
            a_buy_amount,
            epoch,
            expiry,
        );
        record_a.owner.require_auth_for_args(auth_args.clone());
        record_b.owner.require_auth_for_args(auth_args);

        let match_key = DataKey::Match(match_id.clone());
        env.storage().persistent().set(&match_key, &true);
        refresh_persistent_ttl(&env, &match_key);
        let spent_a_key = DataKey::SpentNullifier(record_a.nf.clone());
        env.storage()
            .persistent()
            .set(&spent_a_key, &true);
        refresh_persistent_ttl(&env, &spent_a_key);
        let spent_b_key = DataKey::SpentNullifier(record_b.nf.clone());
        env.storage()
            .persistent()
            .set(&spent_b_key, &true);
        refresh_persistent_ttl(&env, &spent_b_key);
        record_a.settled = true;
        record_b.settled = true;
        let intent_a_key = DataKey::Intent(record_a.id);
        env.storage()
            .persistent()
            .set(&intent_a_key, &record_a);
        refresh_persistent_ttl(&env, &intent_a_key);
        let intent_b_key = DataKey::Intent(record_b.id);
        env.storage()
            .persistent()
            .set(&intent_b_key, &record_b);
        refresh_persistent_ttl(&env, &intent_b_key);

        let sell_token = token_address(&env, &a_sell_asset);
        let buy_token = token_address(&env, &a_buy_asset);
        TokenClient::new(&env, &sell_token).transfer(
            &record_a.owner,
            &MuxedAddress::from(record_b.owner.clone()),
            &a_sell_amount,
        );
        TokenClient::new(&env, &buy_token).transfer(
            &record_b.owner,
            &MuxedAddress::from(record_a.owner.clone()),
            &a_buy_amount,
        );

        MatchSettledEvent {
            match_id,
            intent_a: record_a.id,
            intent_b: record_b.id,
            owner_a: record_a.owner,
            owner_b: record_b.owner,
            a_sell_asset,
            a_buy_asset,
            a_sell_amount,
            a_buy_amount,
            terms_hash,
        }
        .publish(&env);
    }

    // =========================== DARK POOL (Phase 1) ===========================

    /// Admin: map a pair_id to its base (e.g. AAA) and quote (e.g. BBB) SAC token addresses.
    pub fn configure_pair(env: Env, pair_id: u32, base_token: Address, quote_token: Address) {
        require_initialized(&env);
        admin(&env).require_auth();
        if base_token == quote_token {
            panic!("pair tokens must differ");
        }
        // Immutable once set: a proof binds only pair_id, so changing the tokens under a placed
        // order would let the same proof move different tokens (Codex review #2).
        if env.storage().instance().has(&DataKey::PairBase(pair_id)) {
            panic!("pair already configured");
        }
        env.storage().instance().set(&DataKey::PairBase(pair_id), &base_token);
        env.storage().instance().set(&DataKey::PairQuote(pair_id), &quote_token);
    }

    /// Deposit funds into escrow so an order can be settled later without a live signature.
    pub fn deposit(env: Env, from: Address, token: Address, amount: i128) {
        require_initialized(&env);
        from.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        TokenClient::new(&env, &token).transfer(&from, &env.current_contract_address(), &amount);
        let bal = escrow_get(&env, &from, &token)
            .checked_add(amount)
            .unwrap_or_else(|| panic!("escrow overflow"));
        let escrow_key = DataKey::Escrow(from, token);
        env.storage().persistent().set(&escrow_key, &bal);
        refresh_persistent_ttl(&env, &escrow_key);
    }

    /// Withdraw unused escrow.
    pub fn withdraw(env: Env, owner: Address, token: Address, amount: i128) {
        require_initialized(&env);
        owner.require_auth();
        if amount <= 0 {
            panic!("amount must be positive");
        }
        let bal = escrow_get(&env, &owner, &token);
        if bal < amount {
            panic!("insufficient escrow");
        }
        let escrow_key = DataKey::Escrow(owner.clone(), token.clone());
        env.storage().persistent().set(&escrow_key, &(bal - amount));
        refresh_persistent_ttl(&env, &escrow_key);
        TokenClient::new(&env, &token).transfer(&env.current_contract_address(), &owner, &amount);
    }

    /// Place an OPAQUE order: only the commitment + placement nullifier are recorded.
    /// Verifies the order Groth16 proof (membership + well-formedness). The coordinator submits it.
    pub fn place_order(
        env: Env,
        proof: Proof,
        note: BytesN<32>,
        nf_order: BytesN<32>,
        pair_id: u32,
        batch_id: u64,
        root: BytesN<32>,
    ) {
        require_initialized(&env);
        require_not_paused(&env);
        coordinator(&env).require_auth();
        let (_base_token, _quote_token) = configured_pair(&env, pair_id);
        if !is_accepted_root(&env, &root) {
            panic!("root not accepted");
        }
        if is_spent_nullifier_raw(&env, &nf_order) {
            panic!("order nullifier spent");
        }
        if env.storage().persistent().has(&DataKey::OpenOrder(note.clone())) {
            panic!("order already open");
        }
        let pubs = order_public_signals(&env, &note, &nf_order, pair_id, batch_id, &root);
        if !verify(&env, order_vk(&env), proof, pubs) {
            panic!("invalid order proof");
        }
        let nf_key = DataKey::SpentNullifier(nf_order.clone());
        env.storage().persistent().set(&nf_key, &true);
        refresh_persistent_ttl(&env, &nf_key);
        let order_key = DataKey::OpenOrder(note.clone());
        let order_record = OpenOrderRecord {
            batch_id,
            pair_id,
            expiry: u64::MAX,
        };
        env.storage()
            .persistent()
            .set(&order_key, &order_record);
        refresh_persistent_ttl(&env, &order_key);
        OrderPlacedEvent { note, pair_id, batch_id }.publish(&env);
    }

    /// v2 order placement. Adds expiry, minimum acceptable quantity, and counterparty tier
    /// to the proof's public inputs while preserving the v1 entrypoint.
    #[allow(clippy::too_many_arguments)]
    pub fn place_order_v2(
        env: Env,
        proof: Proof,
        note: BytesN<32>,
        nf_order: BytesN<32>,
        pair_id: u32,
        batch_id: u64,
        root: BytesN<32>,
        expiry: u64,
        maq: u64,
        tier: u32,
    ) {
        require_initialized(&env);
        require_not_paused(&env);
        coordinator(&env).require_auth();
        if env.ledger().timestamp() > expiry {
            panic!("order expired");
        }
        let (_base_token, _quote_token) = configured_pair(&env, pair_id);
        if !is_accepted_root(&env, &root) {
            panic!("root not accepted");
        }
        if is_spent_nullifier_raw(&env, &nf_order) {
            panic!("order nullifier spent");
        }
        if env.storage().persistent().has(&DataKey::OpenOrder(note.clone())) {
            panic!("order already open");
        }
        let pubs = order_v2_public_signals(
            &env,
            &note,
            &nf_order,
            pair_id,
            batch_id,
            &root,
            expiry,
            maq,
            tier,
        );
        if !verify(&env, order_v2_vk(&env), proof, pubs) {
            panic!("invalid order proof");
        }
        let nf_key = DataKey::SpentNullifier(nf_order.clone());
        env.storage().persistent().set(&nf_key, &true);
        refresh_persistent_ttl(&env, &nf_key);
        let order_key = DataKey::OpenOrder(note.clone());
        let order_record = OpenOrderRecord {
            batch_id,
            pair_id,
            expiry,
        };
        env.storage()
            .persistent()
            .set(&order_key, &order_record);
        refresh_persistent_ttl(&env, &order_key);
        OrderPlacedEvent { note, pair_id, batch_id }.publish(&env);
    }

    /// Deposit escrow AND place the opaque order in ONE coordinator-submitted transaction. The trader
    /// signs a single auth entry covering `owner.require_auth()` + the nested SAC `transfer`; the
    /// coordinator co-authorizes (source). Atomic: an invalid order proof reverts the deposit too, so
    /// there is never stranded escrow. `deposit_amount == 0` skips the deposit leg (uses existing escrow).
    #[allow(clippy::too_many_arguments)]
    pub fn deposit_and_place_order(
        env: Env,
        owner: Address,
        deposit_token: Address,
        deposit_amount: i128,
        proof: Proof,
        note: BytesN<32>,
        nf_order: BytesN<32>,
        pair_id: u32,
        batch_id: u64,
        root: BytesN<32>,
    ) {
        require_initialized(&env);
        require_not_paused(&env);
        coordinator(&env).require_auth();
        // Deposit leg — trader authorizes the transfer + escrow credit (skipped if pre-funded).
        if deposit_amount > 0 {
            // Trader authorizes ONLY the deposit (owner, token, amount) — never the opaque order proof.
            owner.require_auth_for_args(vec![
                &env,
                owner.clone().into_val(&env),
                deposit_token.clone().into_val(&env),
                deposit_amount.into_val(&env),
            ]);
            TokenClient::new(&env, &deposit_token).transfer(
                &owner,
                &env.current_contract_address(),
                &deposit_amount,
            );
            let bal = escrow_get(&env, &owner, &deposit_token)
                .checked_add(deposit_amount)
                .unwrap_or_else(|| panic!("escrow overflow"));
            let escrow_key = DataKey::Escrow(owner.clone(), deposit_token.clone());
            env.storage().persistent().set(&escrow_key, &bal);
            refresh_persistent_ttl(&env, &escrow_key);
        }
        // Order leg — identical to place_order.
        let (_base_token, _quote_token) = configured_pair(&env, pair_id);
        if !is_accepted_root(&env, &root) {
            panic!("root not accepted");
        }
        if is_spent_nullifier_raw(&env, &nf_order) {
            panic!("order nullifier spent");
        }
        if env.storage().persistent().has(&DataKey::OpenOrder(note.clone())) {
            panic!("order already open");
        }
        let pubs = order_public_signals(&env, &note, &nf_order, pair_id, batch_id, &root);
        if !verify(&env, order_vk(&env), proof, pubs) {
            panic!("invalid order proof");
        }
        let nf_key = DataKey::SpentNullifier(nf_order.clone());
        env.storage().persistent().set(&nf_key, &true);
        refresh_persistent_ttl(&env, &nf_key);
        let order_key = DataKey::OpenOrder(note.clone());
        let order_record = OpenOrderRecord {
            batch_id,
            pair_id,
            expiry: u64::MAX,
        };
        env.storage().persistent().set(&order_key, &order_record);
        refresh_persistent_ttl(&env, &order_key);
        OrderPlacedEvent { note, pair_id, batch_id }.publish(&env);
    }

    /// Cancel an open opaque order. Edit is implemented client-side as cancel + replace.
    /// The cancellation proof reveals the member leaf so the contract can bind wallet auth to
    /// the registered owner, but it does not reveal side, amount, limit price, or salt.
    #[allow(clippy::too_many_arguments)]
    pub fn cancel_order(
        env: Env,
        owner: Address,
        proof: Proof,
        note: BytesN<32>,
        nf_cancel: BytesN<32>,
        leaf: BytesN<32>,
        pair_id: u32,
        batch_id: u64,
        root: BytesN<32>,
    ) {
        require_initialized(&env);
        owner.require_auth();
        let (_base_token, _quote_token) = configured_pair(&env, pair_id);
        if !is_accepted_root(&env, &root) {
            panic!("root not accepted");
        }
        if is_spent_nullifier_raw(&env, &nf_cancel) {
            panic!("cancel nullifier spent");
        }

        let order_key = DataKey::OpenOrder(note.clone());
        let order: OpenOrderRecord = env
            .storage()
            .persistent()
            .get(&order_key)
            .unwrap_or_else(|| panic!("order not open"));
        refresh_persistent_ttl(&env, &order_key);
        if order.batch_id != batch_id {
            panic!("batch mismatch");
        }
        if order.pair_id != pair_id {
            panic!("pair mismatch");
        }

        let registered_owner = owner_by_leaf(&env, &leaf);
        if registered_owner != owner {
            panic!("owner mismatch");
        }

        let pubs = cancel_order_public_signals(&env, &note, &nf_cancel, &leaf, pair_id, batch_id, &root);
        if !verify(&env, cancel_order_vk(&env), proof, pubs) {
            panic!("invalid cancel proof");
        }

        let cancel_key = DataKey::SpentNullifier(nf_cancel.clone());
        env.storage().persistent().set(&cancel_key, &true);
        refresh_persistent_ttl(&env, &cancel_key);
        env.storage().persistent().remove(&order_key);

        OrderCancelledEvent {
            owner,
            note,
            leaf,
            pair_id,
            batch_id,
        }
        .publish(&env);
    }

    /// Cancel a v2/v3 opaque order. The public signals add expiry, minimum
    /// acceptable quantity, and tier to bind the same note preimage as newer
    /// order and change-note circuits.
    #[allow(clippy::too_many_arguments)]
    pub fn cancel_order_v2(
        env: Env,
        owner: Address,
        proof: Proof,
        note: BytesN<32>,
        nf_cancel: BytesN<32>,
        leaf: BytesN<32>,
        pair_id: u32,
        batch_id: u64,
        root: BytesN<32>,
        expiry: u64,
        maq: u64,
        tier: u32,
    ) {
        require_initialized(&env);
        owner.require_auth();
        let (_base_token, _quote_token) = configured_pair(&env, pair_id);
        if !is_accepted_root(&env, &root) {
            panic!("root not accepted");
        }
        if is_spent_nullifier_raw(&env, &nf_cancel) {
            panic!("cancel nullifier spent");
        }

        let order_key = DataKey::OpenOrder(note.clone());
        let order: OpenOrderRecord = env
            .storage()
            .persistent()
            .get(&order_key)
            .unwrap_or_else(|| panic!("order not open"));
        refresh_persistent_ttl(&env, &order_key);
        if order.batch_id != batch_id {
            panic!("batch mismatch");
        }
        if order.pair_id != pair_id {
            panic!("pair mismatch");
        }
        if order.expiry != expiry {
            panic!("expiry mismatch");
        }

        let registered_owner = owner_by_leaf(&env, &leaf);
        if registered_owner != owner {
            panic!("owner mismatch");
        }

        let pubs = cancel_order_v2_public_signals(
            &env, &note, &nf_cancel, &leaf, pair_id, batch_id, &root, expiry, maq, tier,
        );
        if !verify(&env, cancel_order_v2_vk(&env), proof, pubs) {
            panic!("invalid cancel proof");
        }

        let cancel_key = DataKey::SpentNullifier(nf_cancel.clone());
        env.storage().persistent().set(&cancel_key, &true);
        refresh_persistent_ttl(&env, &cancel_key);
        env.storage().persistent().remove(&order_key);

        OrderCancelledEvent {
            owner,
            note,
            leaf,
            pair_id,
            batch_id,
        }
        .publish(&env);
    }

    /// Settle a crossed pair at the midpoint. Verifies the match Groth16 proof, then debits each
    /// owner's escrow and atomically swaps both legs. Owners are resolved from the public leaves.
    #[allow(clippy::too_many_arguments)]
    pub fn settle_dp_match(
        env: Env,
        proof: Proof,
        match_id: BytesN<32>,
        note_sell: BytesN<32>,
        note_buy: BytesN<32>,
        nf_sell: BytesN<32>,
        nf_buy: BytesN<32>,
        leaf_sell: BytesN<32>,
        leaf_buy: BytesN<32>,
        base_amount: i128,
        quote_amount: i128,
        pair_id: u32,
        batch_id: u64,
        root: BytesN<32>,
    ) {
        let _ = (
            env,
            proof,
            match_id,
            note_sell,
            note_buy,
            nf_sell,
            nf_buy,
            leaf_sell,
            leaf_buy,
            base_amount,
            quote_amount,
            pair_id,
            batch_id,
            root,
        );
        panic!("deprecated: use settle_dp_match_v3");
    }

    /// v2 dark-pool settlement. The proof exposes fill_base/fill_quote, which are used
    /// as the actual base/quote settlement amounts.
    #[allow(clippy::too_many_arguments)]
    pub fn settle_dp_match_v2(
        env: Env,
        proof: Proof,
        match_id: BytesN<32>,
        note_sell: BytesN<32>,
        note_buy: BytesN<32>,
        nf_sell: BytesN<32>,
        nf_buy: BytesN<32>,
        leaf_sell: BytesN<32>,
        leaf_buy: BytesN<32>,
        fill_base: i128,
        fill_quote: i128,
        pair_id: u32,
        batch_id: u64,
        root: BytesN<32>,
    ) {
        let _ = (
            env,
            proof,
            match_id,
            note_sell,
            note_buy,
            nf_sell,
            nf_buy,
            leaf_sell,
            leaf_buy,
            fill_base,
            fill_quote,
            pair_id,
            batch_id,
            root,
        );
        panic!("deprecated: use settle_dp_match_v3");
    }

    /// v3 dark-pool settlement. Adds change notes and counterparty-tier binding
    /// while preserving the v1/v2 entrypoints.
    #[allow(clippy::too_many_arguments)]
    pub fn settle_dp_match_v3(
        env: Env,
        proof: Proof,
        match_id: BytesN<32>,
        note_sell: BytesN<32>,
        note_buy: BytesN<32>,
        nf_sell: BytesN<32>,
        nf_buy: BytesN<32>,
        leaf_sell: BytesN<32>,
        leaf_buy: BytesN<32>,
        fill_base: i128,
        fill_quote: i128,
        change_note_sell: BytesN<32>,
        change_note_buy: BytesN<32>,
        assigned_tier_sell: u32,
        assigned_tier_buy: u32,
        pair_id: u32,
        batch_id: u64,
        root: BytesN<32>,
    ) {
        require_initialized(&env);
        require_not_paused(&env);
        coordinator(&env).require_auth();
        if fill_base <= 0 || fill_quote <= 0 {
            panic!("amounts must be positive");
        }
        if is_matched_raw(&env, &match_id) {
            panic!("match used");
        }
        if !is_accepted_root(&env, &root) {
            panic!("root not accepted");
        }

        let sell_order_key = DataKey::OpenOrder(note_sell.clone());
        let buy_order_key = DataKey::OpenOrder(note_buy.clone());
        let sell_order: OpenOrderRecord = env
            .storage()
            .persistent()
            .get(&sell_order_key)
            .unwrap_or_else(|| panic!("sell order not open"));
        let buy_order: OpenOrderRecord = env
            .storage()
            .persistent()
            .get(&buy_order_key)
            .unwrap_or_else(|| panic!("buy order not open"));
        refresh_persistent_ttl(&env, &sell_order_key);
        refresh_persistent_ttl(&env, &buy_order_key);
        if sell_order.batch_id != batch_id || buy_order.batch_id != batch_id {
            panic!("batch mismatch");
        }
        if sell_order.pair_id != pair_id || buy_order.pair_id != pair_id {
            panic!("pair mismatch");
        }
        let now = env.ledger().timestamp();
        if now > sell_order.expiry || now > buy_order.expiry {
            panic!("order expired");
        }
        if is_spent_nullifier_raw(&env, &nf_sell) || is_spent_nullifier_raw(&env, &nf_buy) {
            panic!("order already settled");
        }

        if assigned_tier_sell != tier_of_raw(&env, &leaf_sell) {
            panic!("seller tier mismatch");
        }
        if assigned_tier_buy != tier_of_raw(&env, &leaf_buy) {
            panic!("buyer tier mismatch");
        }

        let zero = zero_b32(&env);
        let has_sell_change = change_note_sell != zero;
        let has_buy_change = change_note_buy != zero;
        if has_sell_change
            && env
                .storage()
                .persistent()
                .has(&DataKey::OpenOrder(change_note_sell.clone()))
        {
            panic!("sell change note already open");
        }
        if has_buy_change
            && env
                .storage()
                .persistent()
                .has(&DataKey::OpenOrder(change_note_buy.clone()))
        {
            panic!("buy change note already open");
        }
        if has_sell_change && has_buy_change && change_note_sell == change_note_buy {
            panic!("duplicate change note");
        }

        let pubs = dpmatch_v3_public_signals(
            &env,
            &match_id,
            &note_sell,
            &note_buy,
            &nf_sell,
            &nf_buy,
            &leaf_sell,
            &leaf_buy,
            fill_base,
            fill_quote,
            &change_note_sell,
            &change_note_buy,
            assigned_tier_sell,
            assigned_tier_buy,
            pair_id,
            batch_id,
            &root,
        );
        if !verify(&env, dpmatch_v3_vk(&env), proof, pubs) {
            panic!("invalid match proof");
        }

        let seller = owner_by_leaf(&env, &leaf_sell);
        let buyer = owner_by_leaf(&env, &leaf_buy);
        let (base_token, quote_token) = configured_pair(&env, pair_id);

        let seller_base = escrow_get(&env, &seller, &base_token);
        let buyer_quote = escrow_get(&env, &buyer, &quote_token);
        if seller_base < fill_base {
            panic!("seller escrow insufficient");
        }
        if buyer_quote < fill_quote {
            panic!("buyer escrow insufficient");
        }
        let seller_escrow_key = DataKey::Escrow(seller.clone(), base_token.clone());
        let buyer_escrow_key = DataKey::Escrow(buyer.clone(), quote_token.clone());
        env.storage()
            .persistent()
            .set(&seller_escrow_key, &(seller_base - fill_base));
        env.storage()
            .persistent()
            .set(&buyer_escrow_key, &(buyer_quote - fill_quote));
        refresh_persistent_ttl(&env, &seller_escrow_key);
        refresh_persistent_ttl(&env, &buyer_escrow_key);

        let spent_sell_key = DataKey::SpentNullifier(nf_sell.clone());
        let spent_buy_key = DataKey::SpentNullifier(nf_buy.clone());
        let match_key = DataKey::Match(match_id.clone());
        env.storage().persistent().set(&spent_sell_key, &true);
        env.storage().persistent().set(&spent_buy_key, &true);
        env.storage().persistent().set(&match_key, &true);
        refresh_persistent_ttl(&env, &spent_sell_key);
        refresh_persistent_ttl(&env, &spent_buy_key);
        refresh_persistent_ttl(&env, &match_key);

        env.storage().persistent().remove(&sell_order_key);
        env.storage().persistent().remove(&buy_order_key);
        if has_sell_change {
            let change_key = DataKey::OpenOrder(change_note_sell.clone());
            let change_record = OpenOrderRecord {
                batch_id,
                pair_id,
                expiry: sell_order.expiry,
            };
            env.storage().persistent().set(&change_key, &change_record);
            refresh_persistent_ttl(&env, &change_key);
        }
        if has_buy_change {
            let change_key = DataKey::OpenOrder(change_note_buy.clone());
            let change_record = OpenOrderRecord {
                batch_id,
                pair_id,
                expiry: buy_order.expiry,
            };
            env.storage().persistent().set(&change_key, &change_record);
            refresh_persistent_ttl(&env, &change_key);
        }

        let contract = env.current_contract_address();
        TokenClient::new(&env, &base_token).transfer(&contract, &buyer, &fill_base);
        TokenClient::new(&env, &quote_token).transfer(&contract, &seller, &fill_quote);

        DpSettledEvent {
            match_id,
            leaf_sell,
            leaf_buy,
            base_amount: fill_base,
            quote_amount: fill_quote,
            pair_id,
        }
        .publish(&env);
    }

    pub fn escrow_balance(env: Env, owner: Address, token: Address) -> i128 {
        escrow_get(&env, &owner, &token)
    }
    pub fn is_order_open(env: Env, note: BytesN<32>) -> bool {
        let key = DataKey::OpenOrder(note);
        let exists = env.storage().persistent().has(&key);
        if exists {
            refresh_persistent_ttl(&env, &key);
        }
        exists
    }

    pub fn get_root(env: Env) -> BytesN<32> {
        current_root(&env)
    }

    pub fn get_previous_root(env: Env) -> BytesN<32> {
        refresh_instance_ttl(&env);
        env.storage()
            .instance()
            .get(&DataKey::PreviousRoot)
            .unwrap_or_else(|| zero_b32(&env))
    }

    pub fn leaf_count(env: Env) -> u32 {
        refresh_instance_ttl(&env);
        leaf_count_raw(&env)
    }

    pub fn get_registration(env: Env, index: u32) -> Registration {
        let key = DataKey::Registration(index);
        let registration = env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("registration missing"));
        refresh_persistent_ttl(&env, &key);
        registration
    }

    pub fn get_leaf(env: Env, index: u32) -> BytesN<32> {
        let key = DataKey::Leaf(index);
        let leaf = env.storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic!("leaf missing"));
        refresh_persistent_ttl(&env, &key);
        leaf
    }

    pub fn get_intent(env: Env, id: u64) -> IntentRecord {
        intent_by_id(&env, id)
    }

    pub fn get_intent_by_c(env: Env, c: BytesN<32>) -> IntentRecord {
        intent_by_c(&env, &c)
    }

    pub fn is_submitted_nullifier(env: Env, nf: BytesN<32>) -> bool {
        is_submitted_nullifier_raw(&env, &nf)
    }

    pub fn is_spent_nullifier(env: Env, nf: BytesN<32>) -> bool {
        is_spent_nullifier_raw(&env, &nf)
    }

    pub fn is_matched(env: Env, match_id: BytesN<32>) -> bool {
        is_matched_raw(&env, &match_id)
    }
}

fn verify(env: &Env, vk: VerifyingKey, proof: Proof, pub_signals: Vec<BytesN<32>>) -> bool {
    let bn = env.crypto().bn254();
    let ic0 = Bn254G1Affine::from_bytes(vk.ic.get(0).unwrap());
    let mut points: Vec<Bn254G1Affine> = Vec::new(env);
    let mut scalars: Vec<Bn254Fr> = Vec::new(env);
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

    let vp1 = vec![env, neg_a, alpha1, vk_x, c];
    let vp2 = vec![env, b, beta2, gamma2, delta2];
    bn.pairing_check(vp1, vp2)
}

fn intent_vk(env: &Env) -> VerifyingKey {
    vk_from_parts(
        env,
        &fixtures_intent::VK_ALPHA1,
        &fixtures_intent::VK_BETA2,
        &fixtures_intent::VK_GAMMA2,
        &fixtures_intent::VK_DELTA2,
        &fixtures_intent::IC,
    )
}

fn match_vk(env: &Env) -> VerifyingKey {
    vk_from_parts(
        env,
        &fixtures_match::VK_ALPHA1,
        &fixtures_match::VK_BETA2,
        &fixtures_match::VK_GAMMA2,
        &fixtures_match::VK_DELTA2,
        &fixtures_match::IC,
    )
}

fn order_vk(env: &Env) -> VerifyingKey {
    vk_from_parts(
        env,
        &fixtures_order::VK_ALPHA1,
        &fixtures_order::VK_BETA2,
        &fixtures_order::VK_GAMMA2,
        &fixtures_order::VK_DELTA2,
        &fixtures_order::IC,
    )
}

fn order_v2_vk(env: &Env) -> VerifyingKey {
    vk_from_parts(
        env,
        &fixtures_order_v2::VK_ALPHA1,
        &fixtures_order_v2::VK_BETA2,
        &fixtures_order_v2::VK_GAMMA2,
        &fixtures_order_v2::VK_DELTA2,
        &fixtures_order_v2::IC,
    )
}

fn cancel_order_vk(env: &Env) -> VerifyingKey {
    vk_from_parts(
        env,
        &fixtures_cancel_order::VK_ALPHA1,
        &fixtures_cancel_order::VK_BETA2,
        &fixtures_cancel_order::VK_GAMMA2,
        &fixtures_cancel_order::VK_DELTA2,
        &fixtures_cancel_order::IC,
    )
}

fn cancel_order_v2_vk(env: &Env) -> VerifyingKey {
    vk_from_parts(
        env,
        &fixtures_cancel_order_v2::VK_ALPHA1,
        &fixtures_cancel_order_v2::VK_BETA2,
        &fixtures_cancel_order_v2::VK_GAMMA2,
        &fixtures_cancel_order_v2::VK_DELTA2,
        &fixtures_cancel_order_v2::IC,
    )
}

fn dpmatch_v3_vk(env: &Env) -> VerifyingKey {
    vk_from_parts(
        env,
        &fixtures_dpmatch_v3::VK_ALPHA1,
        &fixtures_dpmatch_v3::VK_BETA2,
        &fixtures_dpmatch_v3::VK_GAMMA2,
        &fixtures_dpmatch_v3::VK_DELTA2,
        &fixtures_dpmatch_v3::IC,
    )
}

fn order_public_signals(
    env: &Env,
    note: &BytesN<32>,
    nf_order: &BytesN<32>,
    pair_id: u32,
    batch_id: u64,
    root: &BytesN<32>,
) -> Vec<BytesN<32>> {
    vec![
        env,
        note.clone(),
        nf_order.clone(),
        u64_bytes(env, pair_id as u64),
        u64_bytes(env, batch_id),
        root.clone(),
    ]
}

#[allow(clippy::too_many_arguments)]
fn order_v2_public_signals(
    env: &Env,
    note: &BytesN<32>,
    nf_order: &BytesN<32>,
    pair_id: u32,
    batch_id: u64,
    root: &BytesN<32>,
    expiry: u64,
    maq: u64,
    tier: u32,
) -> Vec<BytesN<32>> {
    vec![
        env,
        note.clone(),
        nf_order.clone(),
        u64_bytes(env, pair_id as u64),
        u64_bytes(env, batch_id),
        root.clone(),
        u64_bytes(env, expiry),
        u64_bytes(env, maq),
        u64_bytes(env, tier as u64),
    ]
}

fn cancel_order_public_signals(
    env: &Env,
    note: &BytesN<32>,
    nf_cancel: &BytesN<32>,
    leaf: &BytesN<32>,
    pair_id: u32,
    batch_id: u64,
    root: &BytesN<32>,
) -> Vec<BytesN<32>> {
    vec![
        env,
        note.clone(),
        nf_cancel.clone(),
        leaf.clone(),
        u64_bytes(env, pair_id as u64),
        u64_bytes(env, batch_id),
        root.clone(),
    ]
}

#[allow(clippy::too_many_arguments)]
fn cancel_order_v2_public_signals(
    env: &Env,
    note: &BytesN<32>,
    nf_cancel: &BytesN<32>,
    leaf: &BytesN<32>,
    pair_id: u32,
    batch_id: u64,
    root: &BytesN<32>,
    expiry: u64,
    maq: u64,
    tier: u32,
) -> Vec<BytesN<32>> {
    vec![
        env,
        note.clone(),
        nf_cancel.clone(),
        leaf.clone(),
        u64_bytes(env, pair_id as u64),
        u64_bytes(env, batch_id),
        root.clone(),
        u64_bytes(env, expiry),
        u64_bytes(env, maq),
        u64_bytes(env, tier as u64),
    ]
}

#[allow(clippy::too_many_arguments)]
fn dpmatch_v3_public_signals(
    env: &Env,
    match_id: &BytesN<32>,
    note_sell: &BytesN<32>,
    note_buy: &BytesN<32>,
    nf_sell: &BytesN<32>,
    nf_buy: &BytesN<32>,
    leaf_sell: &BytesN<32>,
    leaf_buy: &BytesN<32>,
    fill_base: i128,
    fill_quote: i128,
    change_note_sell: &BytesN<32>,
    change_note_buy: &BytesN<32>,
    assigned_tier_sell: u32,
    assigned_tier_buy: u32,
    pair_id: u32,
    batch_id: u64,
    root: &BytesN<32>,
) -> Vec<BytesN<32>> {
    vec![
        env,
        match_id.clone(),
        note_sell.clone(),
        note_buy.clone(),
        nf_sell.clone(),
        nf_buy.clone(),
        leaf_sell.clone(),
        leaf_buy.clone(),
        i128_bytes(env, fill_base),
        i128_bytes(env, fill_quote),
        change_note_sell.clone(),
        change_note_buy.clone(),
        u64_bytes(env, assigned_tier_sell as u64),
        u64_bytes(env, assigned_tier_buy as u64),
        u64_bytes(env, pair_id as u64),
        u64_bytes(env, batch_id),
        root.clone(),
    ]
}

fn owner_by_leaf(env: &Env, leaf: &BytesN<32>) -> Address {
    let leaf_key = DataKey::RegistrationByLeaf(leaf.clone());
    let index: u32 = env
        .storage()
        .persistent()
        .get(&leaf_key)
        .unwrap_or_else(|| panic!("leaf not registered"));
    refresh_persistent_ttl(env, &leaf_key);
    let registration_key = DataKey::Registration(index);
    let reg: Registration = env
        .storage()
        .persistent()
        .get(&registration_key)
        .unwrap_or_else(|| panic!("registration missing"));
    refresh_persistent_ttl(env, &registration_key);
    reg.owner
}

fn tier_of_raw(env: &Env, leaf: &BytesN<32>) -> u32 {
    let key = DataKey::TierByLeaf(leaf.clone());
    let tier = env.storage().persistent().get(&key).unwrap_or(0);
    if tier != 0 || env.storage().persistent().has(&key) {
        refresh_persistent_ttl(env, &key);
    }
    tier
}

fn escrow_get(env: &Env, owner: &Address, token: &Address) -> i128 {
    let key = DataKey::Escrow(owner.clone(), token.clone());
    let balance = env.storage().persistent().get(&key).unwrap_or(0);
    if balance != 0 {
        refresh_persistent_ttl(env, &key);
    }
    balance
}

fn configured_pair(env: &Env, pair_id: u32) -> (Address, Address) {
    let base_token: Address = env
        .storage()
        .instance()
        .get(&DataKey::PairBase(pair_id))
        .unwrap_or_else(|| panic!("pair not configured"));
    let quote_token: Address = env
        .storage()
        .instance()
        .get(&DataKey::PairQuote(pair_id))
        .unwrap_or_else(|| panic!("pair not configured"));
    if base_token == quote_token {
        panic!("pair tokens must differ");
    }
    (base_token, quote_token)
}

fn refresh_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn refresh_persistent_ttl(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
    }
}

fn vk_from_parts<const N: usize>(
    env: &Env,
    alpha1: &[u8; 64],
    beta2: &[u8; 128],
    gamma2: &[u8; 128],
    delta2: &[u8; 128],
    ic_raw: &[[u8; 64]; N],
) -> VerifyingKey {
    let mut ic = Vec::new(env);
    for row in ic_raw.iter() {
        ic.push_back(BytesN::from_array(env, row));
    }
    VerifyingKey {
        alpha1: BytesN::from_array(env, alpha1),
        beta2: BytesN::from_array(env, beta2),
        gamma2: BytesN::from_array(env, gamma2),
        delta2: BytesN::from_array(env, delta2),
        ic,
    }
}

fn require_initialized(env: &Env) {
    if !env.storage().instance().has(&DataKey::Admin) {
        panic!("not initialized");
    }
    refresh_instance_ttl(env);
}

fn initialize_state(
    env: Env,
    admin: Address,
    coordinator: Address,
    chain_id: BytesN<32>,
    contract_id: BytesN<32>,
) {
    if env.storage().instance().has(&DataKey::Admin) {
        panic!("already initialized");
    }
    admin.require_auth();
    if env.ledger().network_id() != chain_id {
        panic!("chain id mismatch");
    }
    if current_contract_id(&env) != contract_id {
        panic!("contract id mismatch");
    }

    env.storage().instance().set(&DataKey::Admin, &admin);
    env.storage().persistent().set(&DataKey::Guardian, &admin);
    env.storage().persistent().set(&DataKey::Paused, &false);
    refresh_persistent_ttl(&env, &DataKey::Guardian);
    refresh_persistent_ttl(&env, &DataKey::Paused);
    env.storage()
        .instance()
        .set(&DataKey::Coordinator, &coordinator);
    env.storage().instance().set(&DataKey::ChainId, &chain_id);
    env.storage()
        .instance()
        .set(&DataKey::ContractId, &contract_id);
    env.storage().instance().set(&DataKey::LeafCount, &0u32);
    env.storage().instance().set(&DataKey::IntentCount, &0u64);
    refresh_instance_ttl(&env);
}

fn propose_address_change(env: &Env, key: DataKey, proposed: Address) -> u32 {
    let proposed_by = admin(env);
    proposed_by.require_auth();
    let unlock_ledger = env
        .ledger()
        .sequence()
        .checked_add(DELAY_LEDGERS)
        .unwrap_or_else(|| panic!("unlock ledger overflow"));
    let pending = PendingAddressChange {
        proposed,
        unlock_ledger,
        proposed_by,
    };
    env.storage().instance().set(&key, &pending);
    unlock_ledger
}

fn execute_address_change(env: &Env, key: DataKey, expected: &Address) -> Address {
    let pending: PendingAddressChange = env
        .storage()
        .instance()
        .get(&key)
        .unwrap_or_else(|| panic!("change not proposed"));
    if pending.proposed != *expected {
        panic!("proposal mismatch");
    }
    if pending.proposed_by != admin(env) {
        panic!("admin changed");
    }
    if env.ledger().sequence() < pending.unlock_ledger {
        panic!("timelock active");
    }
    env.storage().instance().remove(&key);
    pending.proposed
}

fn admin(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .unwrap_or_else(|| panic!("not initialized"))
}

fn coordinator(env: &Env) -> Address {
    env.storage()
        .instance()
        .get(&DataKey::Coordinator)
        .unwrap_or_else(|| panic!("not initialized"))
}

fn guardian(env: &Env) -> Address {
    let key = DataKey::Guardian;
    let guardian = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| admin(env));
    refresh_persistent_ttl(env, &key);
    guardian
}

fn paused_raw(env: &Env) -> bool {
    let key = DataKey::Paused;
    let paused = env.storage().persistent().get(&key).unwrap_or(false);
    refresh_persistent_ttl(env, &key);
    paused
}

fn require_not_paused(env: &Env) {
    if paused_raw(env) {
        panic!("paused");
    }
}

fn chain_id(env: &Env) -> BytesN<32> {
    env.storage()
        .instance()
        .get(&DataKey::ChainId)
        .unwrap_or_else(|| panic!("not initialized"))
}

fn configured_contract_id(env: &Env) -> BytesN<32> {
    env.storage()
        .instance()
        .get(&DataKey::ContractId)
        .unwrap_or_else(|| panic!("not initialized"))
}

fn current_contract_id(env: &Env) -> BytesN<32> {
    match AddressPayload::from_address(&env.current_contract_address()) {
        Some(AddressPayload::ContractIdHash(id)) => id,
        _ => panic!("current address is not a contract"),
    }
}

fn token_address(env: &Env, contract_id: &BytesN<32>) -> Address {
    AddressPayload::ContractIdHash(contract_id.clone()).to_address(env)
}

fn zero_b32(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn u64_bytes(env: &Env, value: u64) -> BytesN<32> {
    let mut out = [0u8; 32];
    out[24..32].copy_from_slice(&value.to_be_bytes());
    BytesN::from_array(env, &out)
}

fn i128_bytes(env: &Env, value: i128) -> BytesN<32> {
    if value < 0 {
        panic!("negative field value");
    }
    let mut out = [0u8; 32];
    out[16..32].copy_from_slice(&(value as u128).to_be_bytes());
    BytesN::from_array(env, &out)
}

fn limb_signal(env: &Env, raw: &BytesN<32>, high: bool) -> BytesN<32> {
    let bytes = raw.to_array();
    let mut out = [0u8; 32];
    if high {
        out[16..32].copy_from_slice(&bytes[0..16]);
    } else {
        out[16..32].copy_from_slice(&bytes[16..32]);
    }
    BytesN::from_array(env, &out)
}

fn intent_public_signals(
    env: &Env,
    c: &BytesN<32>,
    nf: &BytesN<32>,
    epoch: u64,
    root: &BytesN<32>,
) -> Vec<BytesN<32>> {
    let chain_id = chain_id(env);
    let contract_id = configured_contract_id(env);
    vec![
        env,
        c.clone(),
        nf.clone(),
        limb_signal(env, &chain_id, true),
        limb_signal(env, &chain_id, false),
        limb_signal(env, &contract_id, true),
        limb_signal(env, &contract_id, false),
        u64_bytes(env, epoch),
        root.clone(),
    ]
}

#[allow(clippy::too_many_arguments)]
fn match_public_signals(
    env: &Env,
    match_id: &BytesN<32>,
    c_a: &BytesN<32>,
    c_b: &BytesN<32>,
    terms_hash: &BytesN<32>,
    a_sell_asset: &BytesN<32>,
    a_buy_asset: &BytesN<32>,
    a_sell_amount: i128,
    a_buy_amount: i128,
    epoch: u64,
    expiry: u64,
    root: &BytesN<32>,
) -> Vec<BytesN<32>> {
    let chain_id = chain_id(env);
    let contract_id = configured_contract_id(env);
    vec![
        env,
        match_id.clone(),
        c_a.clone(),
        c_b.clone(),
        terms_hash.clone(),
        limb_signal(env, a_sell_asset, true),
        limb_signal(env, a_sell_asset, false),
        limb_signal(env, a_buy_asset, true),
        limb_signal(env, a_buy_asset, false),
        i128_bytes(env, a_sell_amount),
        i128_bytes(env, a_buy_amount),
        limb_signal(env, &chain_id, true),
        limb_signal(env, &chain_id, false),
        limb_signal(env, &contract_id, true),
        limb_signal(env, &contract_id, false),
        u64_bytes(env, epoch),
        u64_bytes(env, expiry),
        root.clone(),
    ]
}

#[allow(clippy::too_many_arguments)]
fn settlement_auth_args(
    env: &Env,
    match_id: &BytesN<32>,
    c_a: &BytesN<32>,
    c_b: &BytesN<32>,
    terms_hash: &BytesN<32>,
    a_sell_asset: &BytesN<32>,
    a_buy_asset: &BytesN<32>,
    a_sell_amount: i128,
    a_buy_amount: i128,
    epoch: u64,
    expiry: u64,
) -> Vec<Val> {
    vec![
        env,
        match_id.clone().into_val(env),
        c_a.clone().into_val(env),
        c_b.clone().into_val(env),
        terms_hash.clone().into_val(env),
        a_sell_asset.clone().into_val(env),
        a_buy_asset.clone().into_val(env),
        a_sell_amount.into_val(env),
        a_buy_amount.into_val(env),
        epoch.into_val(env),
        expiry.into_val(env),
    ]
}

fn leaf_count_raw(env: &Env) -> u32 {
    env.storage().instance().get(&DataKey::LeafCount).unwrap_or(0)
}

fn current_root(env: &Env) -> BytesN<32> {
    env.storage()
        .instance()
        .get(&DataKey::CurrentRoot)
        .unwrap_or_else(|| zero_b32(env))
}

fn is_accepted_root(env: &Env, root: &BytesN<32>) -> bool {
    if &current_root(env) == root {
        return true;
    }
    let previous: Option<BytesN<32>> = env.storage().instance().get(&DataKey::PreviousRoot);
    previous.as_ref() == Some(root)
}

fn is_submitted_nullifier_raw(env: &Env, nf: &BytesN<32>) -> bool {
    let key = DataKey::SubmittedNullifier(nf.clone());
    let value = env.storage().persistent().get(&key).unwrap_or(false);
    if value {
        refresh_persistent_ttl(env, &key);
    }
    value
}

fn is_spent_nullifier_raw(env: &Env, nf: &BytesN<32>) -> bool {
    let key = DataKey::SpentNullifier(nf.clone());
    let value = env.storage().persistent().get(&key).unwrap_or(false);
    if value {
        refresh_persistent_ttl(env, &key);
    }
    value
}

fn is_matched_raw(env: &Env, match_id: &BytesN<32>) -> bool {
    let key = DataKey::Match(match_id.clone());
    let value = env.storage().persistent().get(&key).unwrap_or(false);
    if value {
        refresh_persistent_ttl(env, &key);
    }
    value
}

fn intent_by_id(env: &Env, id: u64) -> IntentRecord {
    let key = DataKey::Intent(id);
    let record = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic!("intent missing"));
    refresh_persistent_ttl(env, &key);
    record
}

fn intent_by_c(env: &Env, c: &BytesN<32>) -> IntentRecord {
    let key = DataKey::IntentByC(c.clone());
    let id: u64 = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| panic!("intent missing"));
    refresh_persistent_ttl(env, &key);
    intent_by_id(env, id)
}
