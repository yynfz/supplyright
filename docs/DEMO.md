# Demo guide

All parties/documents are fictional. Settlement uses **mETH, the 18-decimal MockETH ERC-20**; native ETH pays gas. Use a disposable chain and isolated Supabase project. Reuse existing deployments when continuing a demo.

## Fresh local setup

Follow the root README for build, environment examples, and Supabase migration. Start `anvil --chain-id 31337` separately. From `contracts/`:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
forge script script/SeedDemo.s.sol:SeedDemo --rpc-url http://127.0.0.1:8545 --broadcast
```

These create a new deployment and three agreements. `SeedDemo` uses unique POs; do not repeat it against the same deployment. It writes `deployments/31337-demo.json` with IDs. Redeployment replaces `31337.json`; avoid it when preserving existing state.

From `web/`:

```bash
npm run sync:contracts
npm run seed:offchain
npm run dev
```

The seed imports `demo/documents` and links PO hashes to tokens when RPC is available. Reruns upsert only known demo PO hashes, material codes, product SKUs, and the four exact demo dependency edges. Existing IDs and unrelated rows/relationships remain intact; documents use `demo/<chainId>/<filename>` paths and legacy demo documents are preserved. Use a separate project for fictional data.

## Accounts and case study

Use Anvil's first four accounts in the wallet; Anvil prints their public local development keys.

| Account | Role |
| --- | --- |
| #0 `0xf39F…2266` | Admin + registrar + transfer approver |
| #1 `0x7099…79C8` | Buyer |
| #2 `0x3C44…93BC` | Provider |
| #3 `0x90F7…b906` | Independent verifier |

| Agreement | Seeded state |
| --- | --- |
| A: Nikel Sulfat | 50 MT / 100 mETH; 10 MT delivered; 20 mETH coverage at 20% |
| B: Litium Karbonat | 12 MT / 36 mETH; fulfilled |
| C: Aluminium Ingot | 80 MT / 48 mETH; active, unprotected |

A's deadline defaults to 180 seconds after seeding (`DEMO_DEADLINE_DELAY`); protection expires 30 days later. Once chain time is **strictly past** the deadline, 40/50 MT is undelivered: eligible loss **80 mETH**, payout **16 mETH** at 20%, remaining locked collateral **4 mETH**. The Recovery NFT target equals the 16 mETH compensation; recording progress does not make a supplier payment.

## Live walkthrough

### Three-minute presentation

Prepare agreement A, the uploaded fictional evidence, and an approved claim whose settlement delay has elapsed before starting. Keep the buyer, verifier, and provider wallets ready.

| Time | Show |
| --- | --- |
| 0:00–0:30 | Dashboard and Production Risk: the missing nickel affects the EV-48V product; distinguish operational estimates from verified compensation. |
| 0:30–1:00 | Supply Right A: 50 MT ordered, 10 MT delivered, signed agreement/document hashes, and the delivery deadline. |
| 1:00–1:30 | Funded protection: 20 mETH collateral at 20%; provider's free and locked balances. |
| 1:30–2:00 | Claim evidence and independent approval: 80 mETH eligible loss produces 16 mETH compensation. |
| 2:00–2:30 | Settle the approved claim and open its actual successful receipt: payout and Recovery NFT mint share one transaction. |
| 2:30–3:00 | Provider and public verification: buyer received 16 mETH, provider owns the Recovery NFT, and 4 mETH remains locked. State that this is a testnet prototype. |

1. Buyer: Dashboard and Production Risk → **Buka data privat** → sign login. Show protected exposure and estimated material/product impact.
2. Registry/detail: inspect A's documents, acknowledgement, and delivery. A new agreement is buyer-submitted, registrar-verified/minted, then activated and updated with delivery evidence.
3. Protection: inspect the funded NFT. On a new eligible Supply Right, buyer uploads terms and requests coverage; provider records underwriting and fully funds it. Provider Dashboard shows balances, faucet, allowance, deposit, free/locked collateral.
4. After A's deadline, buyer files partial default using `CLAIM-EVIDENCE-0417.txt`, 10 MT delivered, 80 mETH loss.
5. Verifier #3 approves 10 MT delivered and 80 mETH loss with `VERIFIER-REPORT-0417.txt` or a private report. The contract computes 16 mETH payout. Objections/appeals require evidence and a new independent decision.
6. After the settlement delay, settle: show one actual receipt with **16 mETH paid to buyer and Recovery NFT minted to provider atomically**.
7. Provider: show 4 mETH still locked, settled claim, and recovery record. Update cumulative recovery with evidence. Release after eligible closure/fulfillment or expiry and clear claim/appeal guards, then withdraw free funds.
8. Verify: inspect NFT type/ID, metadata/owner, real receipt/event links; compare a file's SHA-256 to the public hash.

Admin manages roles and bounded settings; record actions still require the relevant contract permissions.

## Scripted claim alternative

For a standalone integration check, run `forge build` in `contracts/`, then `npm run test:protocol` in `web/`. This starts a fresh Anvil on port 8547 and removes that process afterward. It prints the actual transaction hashes from that disposable chain and verifies the 16 mETH payout, 4 mETH remaining coverage, NFT ownership, and atomic settlement events. These hashes belong to the temporary local chain, not Sepolia.

After the deadline, set `DEMO_STOP_AFTER=submit` or `approve` in `contracts/.env` to finish remaining steps in UI, or leave `settle`:

```bash
forge script script/SeedDemoClaim.s.sol:SeedDemoClaim --rpc-url http://127.0.0.1:8545 --broadcast
```

With nonzero settlement delay it stops after approval. It submits a new claim rather than resuming one; do not rerun to resume an unfinished claim.

## Sepolia

Use separately funded wallets. Fill `DEPLOYER_PRIVATE_KEY`, `BUYER_ADDRESSES`, `PROVIDER_ADDRESSES`, `VERIFIER_ADDRESSES`, and `SEPOLIA_RPC_URL` in `contracts/.env`. Scripted seeding also needs `BUYER_PRIVATE_KEY`, `PROVIDER_PRIVATE_KEY`, and `VERIFIER_PRIVATE_KEY` matching the onboarded addresses. Never use Anvil keys publicly.

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url sepolia --broadcast
forge script script/SeedDemo.s.sol:SeedDemo --rpc-url sepolia --broadcast
```

Set `DEMO_CHAIN_ID=11155111` and matching `DEMO_*_ADDRESS` overrides in `web/.env.local` for offchain seeding. Provide real `11155111.json` or `SUPPLYRIGHT_DEPLOYMENTS`. Wait for real Sepolia timestamps. This guide does not assert Sepolia is already deployed.
