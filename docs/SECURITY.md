# Security and limitations

This is an **unaudited testnet prototype**. mETH has no monetary value. NFT records do not by themselves establish legally enforceable obligations, insurance rights, subrogation, or debt assignment; valid separate agreements are required.

## Implemented controls

- Roles separate registrar, buyer, provider, and verifier; verification checks conflicts with buyer/provider.
- Counterpart bindings are one-time. The vault has no admin withdrawal or payout redirection.
- Coverage is funded before activation. Payout is capped by remaining coverage and locked funds and goes to the recorded beneficiary.
- Evidence and independent decisions are required. Duplicate claims/evidence and cumulative losses are constrained.
- Atomic settlement reverts on failed token payment or Recovery NFT issuance.
- Claims/appeal windows block collateral release; final supply status or expiry is also required.
- Supply/recovery transfers need one-time recipient authorization with an agreement hash. Protection NFTs cannot transfer.
- Supabase has RLS, revoked public table grants, and private storage. API authorization precedes service-role use.
- The UI simulates writes and waits for successful receipts. Deposit/funding advances only after allowance approval confirms.

## Operational limitations

The API/service-role key are trusted for private data. Evaluating roles have broad access. Keep the key server-only and use HTTPS. Signed wallet sessions are short-lived; onchain role readings may be cached for 30 seconds. Production use needs review of session replay protection, rate limits, key management, access scope, and storage.

RPC outages can delay refreshes. Confirmed onchain state remains authoritative after offchain synchronization fails. Hashes prove integrity, not document truth or legal validity. Recovery amounts are holder self-attestations and do not move tokens. Production impact uses user-entered estimates.

The UI/demo support the chosen 18-decimal MockETH configuration. Another token address does not establish decimals/transfer compatibility. Anvil keys are public and local-only. The offchain seed only upserts known demo records/edges without deleting rows; those demo identifiers are reserved and will be refreshed on rerun. Use a separate demo database to keep fictional data apart from real data.

## Foundry configuration

`contracts/foundry.toml` pins Solidity 0.8.28, Cancun, optimizer (200 runs), and `via_ir`. Fuzzing uses 256 runs; invariants use 64 runs at depth 32. On 9 October 2026, 58 tests passed across 4 suites, including a 2,048-call invariant run. Tests are not an audit.

The configuration's lint exclusions reference this document:

- `unsafe-typecast`: timestamp/bounded-value casts rely on reviewed prototype assumptions, not general overflow guarantees.
- `reentrancy-no-eth`, `reentrancy-events`: sensitive collateral/settlement entries have guards; protocol targets bind once. ERC-20 compatibility remains an assumption.
- `weak-prng`: settlement references are identifiers, not cryptographic randomness.
- `block-timestamp`: coarse deadlines/expiry tolerate normal timestamp drift.
- `unsafe-oz-erc721-mint`: `_mint` avoids receiver hooks so providers cannot block atomic settlement by refusing Recovery NFTs.
- `mixed-case-variable`, `mixed-case-function`, `asm-keccak256`: naming/optimization diagnostics are suppressed and provide no security assurance.

Real-value use requires an audit and review of verifier governance, disputes, token compatibility, legal agreements, monitoring, and private-data threats.
