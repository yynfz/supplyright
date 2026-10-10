# Sepolia end-to-end test

A real run of the SupplyRight flow on Ethereum Sepolia, with every step signed by its own role wallet (see [SEPOLIA-WALLETS.md](SEPOLIA-WALLETS.md)) and settled in native Sepolia ETH.

**Live status on 10 October 2026: BLOCKED.** Nothing has been sent to Sepolia yet. The deployer and all four role wallets hold 0 Sepolia ETH, and live transactions wait for the owner's approval. Local tests and a full rehearsal on a fork of Sepolia pass; see [Results](#results).

## Scenario

| Step | Signer | Onchain action | Contract check |
| --- | --- | --- | --- |
| 1 | admin | `mintSupplyRight` to the buyer (PO 50 MT for 0.050 ETH), `activate` (supplier acknowledgement), `recordDelivery` (10 MT) | `REGISTRAR_ROLE`; buyer must hold `BUYER_ROLE` |
| 2 | buyer | `requestProtection`: 0.010 ETH coverage at 20% of verified loss, provider designated | caller owns the NFT and is its buyer |
| 3 | provider | `fundAndApproveProtection{value: 0.010 ETH}`: escrow into the vault, Protection NFT to the buyer | `PROVIDER_ROLE`, designated provider, coverage fully funded |
| 4 | buyer | after the delivery deadline, `submitClaim` (partial default, 40 MT missing, loss 0.040 ETH) | beneficiary only, deadline passed, unused evidence, loss ≤ undelivered value |
| 5 | verifier | `approveClaim` (10 MT delivered, eligible loss 0.040 ETH) | `VERIFIER_ROLE`, not the buyer or provider |
| 6 | verifier | `settleClaim`: one transaction pays the buyer and mints the Recovery Claim NFT to the provider | claim approved, settlement delay elapsed; any failure reverts all of it |

Settlement is permissionless; the verifier triggers it so that the buyer pays no gas in that transaction and their balance change equals the payout exactly.

Economics follow the unchanged contract rules: payout = verified loss × coverage bps, capped by remaining coverage and locked collateral. Here that is 0.040 × 20% = **0.008 ETH to the buyer**. **0.002 ETH stays locked** in the vault (protection still `Active`, claim status `PartiallyPaid`). The scenario's target numbers therefore match what the contract computes; the runner checks this and would say so if they differed. The remaining 0.002 ETH returns to the provider only through the contract's rules: the registrar closes the defaulted supply right, anyone calls `releaseCollateral`, and the provider withdraws. The Foundry E2E test exercises that path; the live run leaves it locked.

## Running it

```bash
node scripts/prepare-funding.mjs                 # what each wallet needs (read-only)
node scripts/prepare-funding.mjs --execute       # deployer tops up the role wallets after "yes"
bash scripts/run-sepolia-e2e.sh all              # or one command at a time:
#   preflight | deploy | roles | setup | wait | claim | smoke | check | status | report
```

- **Confirmation before every spend.** Each sending command first shows a dry run against live Sepolia state and the signer, then waits for `yes`. Forge and cast ask for each keystore password themselves; no password or key passes through the scripts.
- **One signer per step.** `--account supplyright-admin --account supplyright-buyer …` loads the keystores; `vm.startBroadcast(address)` picks the signer by address, so a missing keystore fails before anything is sent.
- **Confirmed before the next transaction.** `--slow` waits for each receipt before sending the next transaction.
- **Gas from the node.** `--skip-simulation` makes the Sepolia node estimate each transaction's gas when it is sent. Since Glamsterdam (EIP-8037, 6 October 2026), forge's local simulation underprices contract and storage creation about 7×. The fork rehearsal showed the deployment running out of gas without this flag.
- **Resume without duplicates.** `RunSepoliaE2E` derives the next step from onchain state for the case named by `E2E_RUN_ID` (its PO reference hash), never from a local file. Re-running after a failure continues where the chain stands. A settled claim is only reported, never settled again, and the contract also rejects a second settlement. `Deploy` writes `contracts/deployments/11155111.json` when broadcasting. The runner copies the addresses into `config/wallets.sepolia.json` only after checking that all five contracts have code.
- **Delivery deadline.** Steps 1–3 set the deadline `E2E_DEADLINE_DELAY` seconds ahead (default 300). `wait` polls Sepolia time, and `claim` refuses to file before the deadline.
- **Direct transfer.** `smoke` sends 0.001 ETH from the buyer to the verifier with `cast send` and records the hash in `contracts/deployments/11155111-transfers.json`.

### Verification (step 7)

`bash scripts/run-sepolia-e2e.sh report` runs `web/scripts/sepolia-e2e-report.mjs`. It collects every hash forge recorded under `contracts/broadcast/*/11155111/` plus the transfer log, fetches each **receipt from Sepolia**, and reports status, block, gas used, fee and decoded events (including Glamsterdam's ETH-transfer logs). It then reads live balances, NFT ownership (`balanceOf` for all three NFTs per wallet), vault balance and free/locked/paid-out totals, and supply-right, protection and claim state. It writes **`docs/SEPOLIA-E2E-RESULTS.md`** with Sepolia Etherscan links. The verdict is PASS only when every step has a successful receipt, the Recovery Claim NFT belongs to the provider, the SupplyRight NFT to the buyer, and the settlement receipt's `PayoutExecuted` shows the payout going to the buyer. Reverted attempts that were later superseded stay listed.

### Negative and security checks

| Case | Foundry (`MultiSignerRoles.t.sol` + suites) | Live deployment (`CheckPermissions.s.sol`) |
| --- | --- | --- |
| Unauthorized role access | buyer/verifier/admin cannot deposit or fund; provider/verifier/admin cannot claim | buyer/verifier/admin cannot deposit escrow; provider cannot claim |
| Unauthorized minting | only the registrar mints, and only to an onboarded buyer; Protection/Recovery NFTs only by the bound contracts | same |
| Unauthorized claim approval | buyer/provider/admin/outsider rejected; a provider granted `VERIFIER_ROLE` still hits `VerifierConflict` | buyer/provider/admin rejected |
| Double claim | open claim blocks a second; evidence single-use; settled loss used up | evidence reuse and re-claiming the compensated loss rejected |
| Insufficient escrow | approve without funds, underfunded `fundAndApprove` (ETH returned), zero deposit, plain ETH sends | approve without funds, underfunded funding, plain ETH send |
| Invalid NFT transfer | SupplyRight/Recovery need a recorded authorization (authorized transfer works once); Protection NFT never moves | same three rules on the live tokens |
| Double settlement | second `settleClaim` → `InvalidClaimStatus(Settled)`, no second payout or NFT | same |
| Unauthorized admin action | role wallets cannot grant/revoke roles or change settings; bindings are one-time even for the admin | same |
| Atomic rollback | payout to an ETH-rejecting beneficiary or a failing Recovery mint reverts everything | ETH-rejecting beneficiary → nothing settled |

`CheckPermissions` runs as a **forked simulation**: every call executes against the deployed bytecode and current Sepolia state, but nothing is broadcast and no gas is spent. The script refuses `--broadcast`. Failing transactions are not sent to Sepolia on purpose; they would only burn gas and forge refuses to send transactions that fail estimation.

## Results

| Check | Result |
| --- | --- |
| `forge build` | success (Solidity 0.8.28, via-IR) |
| `forge test -vvv` | **76 passed, 0 failed** in 5 suites, including 256-run fuzzing and a 64 × 32 invariant campaign (vault solvency in native ETH, payouts accounted, coverage conserved) |
| Anvil integration (`scripts/anvil-integration.sh`) | **PASS**: Deploy → SetupRoles (re-run sends 0 tx) → setup → early claim attempt sends nothing → claim/approve/settle → re-run sends nothing; buyer +0.008 ETH, Recovery NFT → provider, vault 0.002 ETH, 31/31 permission checks, 0.001 ETH wallet transfer |
| Sepolia fork rehearsal (`scripts/rehearse-sepolia-fork.sh`) | **PASS twice**: the same runner with Sepolia code paths (config addresses, address-selected signers) against a local fork of live Sepolia. The second pass funded every wallet with exactly the planned amounts. 29 receipts verified, 31/31 checks, economics match |
| Live Sepolia | **BLOCKED**: wallets unfunded; waiting for funding and approval. No transaction hash exists yet, and `docs/SEPOLIA-E2E-RESULTS.md` will only be written by the report after a real run |

Hashes printed by the Anvil and fork runs belong to throwaway local chains and are not Sepolia transactions. The rehearsal deletes its artifacts so they cannot be mistaken for a real run.

A passing `forge test` is not evidence of a live Sepolia run.
