Updated 2026-06-21 after the client-order-proof privacy hardening. Tests/builds were run locally.

**Critical**
1. MITIGATED: DP coordinator previously received trader DP `sk`.
   Change: `/dp/order` now rejects any submitted `sk`; the browser generates the order proof locally and sends only `proof`, `leaf`, `note`, `nf_order`, `root`, plus the one-time order opening fields. The matcher stores no `sk`, and DPMATCH spend nullifiers are derived from per-order salts instead of identity nullifier keys.
   Residual risk: this is still a semi-trusted coordinator. It sees submitted order terms/openings and has coordinator authority to place/settle notes, but it can no longer forge future orders from a stolen long-lived pool identity.
   Next fix: add wallet-signed bounded order permits so coordinator placement is authorized per note, and move toward encrypted/order-blind matching.

2. Coordinator API is unauthenticated and controls high-value actions.
   Evidence: wildcard CORS ([coordinator/server.js:77](</home/mimi/Stellar hack/coordinator/server.js:77>)), unauthenticated `/fund` ([coordinator/server.js:114](</home/mimi/Stellar hack/coordinator/server.js:114>)), `/mint` ([coordinator/server.js:124](</home/mimi/Stellar hack/coordinator/server.js:124>)), `/dp/order` ([coordinator/server.js:191](</home/mimi/Stellar hack/coordinator/server.js:191>)), `/dp/close` ([coordinator/server.js:199](</home/mimi/Stellar hack/coordinator/server.js:199>)); coordinator secret is a raw env secret ([coordinator/chain.js:187](</home/mimi/Stellar hack/coordinator/chain.js:187>)).
   Impact: any reachable browser/server can mint test assets, drain coordinator XLM through account creation, spam roots/orders, force batch closes, and DoS settlement. If the secret leaks, attacker owns coordinator/admin/issuer powers.
   Fix: private network or authenticated API, origin allowlist, rate limits, request signatures, separate issuer/admin/coordinator keys, multisig/timelock for admin, KMS/HSM-backed hot key with rotation.

**High**
3. `initialize` is unauthenticated.
   Evidence: no `require_auth` in `initialize` before setting admin/coordinator ([contracts/crossed/src/lib.rs:172](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:172>), [189](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:189>)).
   Impact: if deploy and initialize are not atomic, anyone can initialize first and become admin/coordinator.
   Fix: use Soroban `__constructor`, or deploy+init atomically with a factory; otherwise require deployer/admin auth.

4. Merkle roots are fully coordinator-trusted.
   Evidence: `post_root` only checks coordinator auth and `leaf_count`, not root correctness ([contracts/crossed/src/lib.rs:254](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:254>), [257](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:257>)).
   Impact: coordinator can censor members, post roots over arbitrary trees, break membership availability, and, combined with known DP `sk`, generate valid proofs against malicious roots.
   Fix: verify append-only root updates on-chain, or store tree frontier and recompute; at minimum require signed root attestations, audit logs, and multisig root posting.

5. PARTIALLY MITIGATED: browser DP identity storage.
   Change: the app no longer creates/stores a Stellar wallet secret. The DP identity is encrypted in `localStorage` with AES-GCM using a key derived from a wallet-signed message when the selected wallet supports `signMessage`.
   Residual risk: wallets that cannot sign messages fall back to the legacy plaintext DP identity format; XSS or malicious extensions can still attack the active page/session. Add CSP and consider non-exportable/passkey-backed key wrapping for production.

**Medium**
6. Bilateral OTC proofs are not bound to the submitting owner.
   Evidence: `submit_intent` takes arbitrary `owner` auth ([contracts/crossed/src/lib.rs:274](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:274>), [284](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:284>)); intent public signals omit owner/leaf ([contracts/crossed/src/lib.rs:932](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:932>)).
   Impact: leaked/front-run proof material can be submitted under another owner, consuming `c`/`nf` and causing intent DoS.
   Fix: output the self leaf and enforce `RegistrationByLeaf(leaf).owner == owner`, or bind owner address into the proof public inputs.

7. Token binding for DP relies on mutable admin configuration, not the proof.
   Evidence: DP proof binds `pair_id` only ([circuits/dpmatch.circom:203](</home/mimi/Stellar hack/circuits/dpmatch.circom:203>)); contract resolves token addresses from `PairBase/PairQuote` at settlement ([contracts/crossed/src/lib.rs:612](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:612>)). `place_order` does not require the pair to already be configured ([contracts/crossed/src/lib.rs:529](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:529>)).
   Impact: bad deployment/admin action can bind existing proofs to unexpected assets for an unconfigured pair.
   Fix: require pair configured before `place_order`; include base/quote token contract IDs in order and match public inputs; reject base == quote.

8. Public service endpoints leak and DoS coordination state.
   Evidence: `/settle` accepts arbitrary `owner` keys into an in-memory map ([coordinator/server.js:155](</home/mimi/Stellar hack/coordinator/server.js:155>), [166](</home/mimi/Stellar hack/coordinator/server.js:166>)); `/dp/fills/:owner` is unauthenticated ([coordinator/server.js:211](</home/mimi/Stellar hack/coordinator/server.js:211>)); relayer profile directory is unauthenticated/spoofable ([relayer/server.js:36](</home/mimi/Stellar hack/relayer/server.js:36>)).
   Impact: spam can wedge settlements, scrape fills by address, and spoof profiles.
   Fix: authenticated owner lookups, signed requests, per-IP/account quotas, bounded maps with TTL, and private fill retrieval.

**Low**
9. Contract tree capacity is not enforced.
   Evidence: circuits use depth 4 / 16 leaves ([circuits/order.circom:116](</home/mimi/Stellar hack/circuits/order.circom:116>)); contract increments `LeafCount` without cap ([contracts/crossed/src/lib.rs:231](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:231>), [249](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:249>)).
   Impact: registrations beyond 16 cannot prove membership with current circuits.
   Fix: enforce `leaf_count < 16` or upgrade circuits/root scheme.

10. No TTL extension on persistent/instance state.
   Evidence: storage writes use persistent/instance storage throughout, with no `extend_ttl` calls.
   Impact: archival can break old registrations, nullifiers, roots, orders, and escrow accounting.
   Fix: define TTL policy and refresh critical keys on every touch.

**ZK / Accounting Summary**
Bilateral settlement binds token IDs, amounts, terms hash, chain ID, contract ID, epoch, expiry, and root in public signals ([contracts/crossed/src/lib.rs:955](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:955>)). DP match binds notes, spend nullifiers, leaves, amounts, pair, batch, and root ([contracts/crossed/src/lib.rs:782](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:782>)); price/limit midpoint math is constrained in-circuit ([circuits/dpmatch.circom:177](</home/mimi/Stellar hack/circuits/dpmatch.circom:177>), [181](</home/mimi/Stellar hack/circuits/dpmatch.circom:181>), [185](</home/mimi/Stellar hack/circuits/dpmatch.circom:185>)). Honest on-chain escrow accounting prevents simple double-settlement via open-order removal and match/nullifier flags ([contracts/crossed/src/lib.rs:628](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:628>), [631](</home/mimi/Stellar hack/contracts/crossed/src/lib.rs:631>)), but it does not protect against a coordinator that has trader DP secrets.

**Architecture Priorities**
1. Remove trusted coordinator custody of ZK secrets; client-side proving first, then decentralized matchers / threshold operators / encrypted mempool.
2. Split roles: issuer, admin, root poster, batch matcher, relayer; use multisig and timelocks for admin/root actions.
3. Add proper API auth, quotas, persistence, replay protection, and audit logs.
4. Replace panics with typed contract errors and document every invariant.
5. Add dark-pool Soroban tests for `deposit`, `withdraw`, `place_order`, `settle_dp_match`, replay, wrong pair, wrong root, escrow insufficiency, and malicious coordinator cases.

**Fix Before Mainnet**
- No user `sk` leaves browser/device.
- Constructor-based initialization.
- On-chain-verifiable or multisig-governed root updates.
- Pair token IDs bound in proofs.
- Authenticated/rate-limited coordinator and relayer.
- Wallet-based key management; no `localStorage` secrets.
- TTL strategy and capacity checks.
- Full DP contract test suite plus circuit/property tests for price, rounding, replay, and public-input tampering.
