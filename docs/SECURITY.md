# Security and limitations

This is an **unaudited testnet prototype**. Sepolia and Anvil test ETH have no monetary value. NFT records do not by themselves establish legally enforceable obligations, insurance rights, subrogation, or debt assignment; valid separate agreements are required.

## Implemented controls

- Roles separate registrar/admin, buyer, provider, and verifier; verification checks conflicts with buyer/provider. `script/lib/SupplyRightRoles.sol` assigns the four-wallet matrix and fails deploy/role setup if any role wallet holds another role's privileges.
- Sepolia scripts sign with encrypted Foundry keystores (`--account`), one key per role; no private key is read from the environment.
- Counterpart bindings are one-time. The vault has no admin withdrawal or payout redirection.
- Coverage is funded before activation. Payout is capped by remaining coverage and locked funds and goes to the recorded beneficiary.
- Evidence and independent decisions are required. Duplicate claims/evidence and cumulative losses are constrained.
- Atomic settlement reverts on a failed ETH payout or Recovery NFT issuance. Payouts and withdrawals use `Address.sendValue` after all state changes, inside `nonReentrant` entry points; the vault accepts ETH only through `deposit`/`fundAndApproveProtection`, so its balance always covers free + locked collateral.
- Claims/appeal windows block collateral release; final supply status or expiry is also required.
- Supply/recovery transfers need one-time recipient authorization with an agreement hash. Protection NFTs cannot transfer.
- Supabase has RLS, revoked public table grants, and private storage. API authorization precedes service-role use.
- The UI simulates writes and waits for successful receipts; ETH is attached to deposit/funding transactions as `value`.

## Operational limitations

The API/service-role key are trusted for private data. Evaluating roles have broad access. Keep the key server-only and use HTTPS. Signed wallet sessions are short-lived; onchain role readings may be cached for 30 seconds. Production use needs review of session replay protection, rate limits, key management, access scope, and storage.

RPC outages can delay refreshes. Confirmed onchain state remains authoritative after offchain synchronization fails. Hashes prove integrity, not document truth or legal validity. Recovery amounts are holder self-attestations and do not move tokens. Production impact uses user-entered estimates.

A beneficiary contract that refuses ETH blocks its own settlement (it can withdraw the claim or receive with an EOA). Anvil keys are public and local-only. The offchain seed only upserts known demo records/edges without deleting rows; those demo identifiers are reserved and will be refreshed on rerun. Use a separate demo database to keep fictional data apart from real data.

## Foundry configuration

`contracts/foundry.toml` pins Solidity 0.8.28, Cancun, optimizer (200 runs), and `via_ir`. Fuzzing uses 256 runs; invariants use 64 runs at depth 32. On 10 October 2026, 76 tests passed across 5 suites, including a 2,048-call invariant run. Tests are not an audit.

The configuration's lint exclusions reference this document:

- `unsafe-typecast`: timestamp/bounded-value casts rely on reviewed prototype assumptions, not general overflow guarantees.
- `reentrancy-no-eth`, `reentrancy-events`: sensitive collateral/settlement entries have guards; protocol targets bind once; ETH is sent last.
- `weak-prng`: settlement references are identifiers, not cryptographic randomness.
- `block-timestamp`: coarse deadlines/expiry tolerate normal timestamp drift.
- `unsafe-oz-erc721-mint`: `_mint` avoids receiver hooks so providers cannot block atomic settlement by refusing Recovery NFTs.
- `mixed-case-variable`, `mixed-case-function`, `asm-keccak256`: naming/optimization diagnostics are suppressed and provide no security assurance.

Real-value use requires an audit and review of verifier governance, disputes, legal agreements, monitoring, and private-data threats.
