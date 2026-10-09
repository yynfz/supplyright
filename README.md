# SupplyRight

SupplyRight records supply commitments, funded protection, independently verified default claims, and recovery records. This is an **unaudited hackathon prototype for Anvil and Ethereum Sepolia**. Sepolia must be deployed and configured before use.

Settlement uses the chosen **MockETH (mETH), an ERC-20 with 18 decimals and no monetary value**. Native ETH pays gas. Private documents and production dependencies are stored in **Supabase**; public records contain document hashes and protocol state.

## Application

| Route | Purpose |
| --- | --- |
| `/dashboard` | Supply exposure, compensation, estimated production risk |
| `/registry`, `/supply/[id]` | Submission, registrar review, minting, delivery lifecycle |
| `/production` | Private material/product dependencies and disruption estimates |
| `/protection`, `/provider` | Requests, underwriting, collateral, recovery progress |
| `/claims` | Evidence, independent verification, disputes, appeals, atomic settlement |
| `/verify` | Public NFT, receipt, and document hash verification |
| `/admin` | Contract roles and bounded claim settings |

The wallet signs transactions; success is reported after a successful receipt. Private data access uses a wallet login signature.

## Setup

Requirements: Node.js 20.6+ (22 LTS recommended), npm, Foundry, Git with submodules, and Supabase. Optional local Supabase also requires its CLI and Docker.

```bash
git submodule update --init --recursive
cd contracts
forge build
forge test -vv
cd ../web
npm ci
npm run sync:contracts
```

Copy `web/.env.example` to `web/.env.local`; fill the Supabase URL and **server-only** service-role key. Apply `supabase/migrations/20261009000000_supplyright_offchain.sql` to a new project using its SQL editor, or link the Supabase CLI project and run `supabase db push` from the repository root. This creates the tables and private `supply-documents` bucket.

For a fresh disposable local chain, start this in a separate terminal:

```bash
anvil --chain-id 31337
```

From `contracts/`:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast
```

This writes `contracts/deployments/31337.json`. The first four Anvil accounts are admin/registrar, buyer, provider, and independent verifier. Reuse an existing deployment when continuing work: redeployment writes new addresses. Anvil keys are public development credentials for a disposable local chain only.

From `web/`:

```bash
npm run dev
```

Open `http://localhost:3000`; add Anvil to the wallet (chain 31337, RPC `http://127.0.0.1:8545`, currency ETH). Injected wallets work without a WalletConnect project ID.

## Validation and demo

```bash
cd contracts
forge test -vv
cd ../web
npm run typecheck
npm run lint
npm run build
```

On 9 October 2026 the Foundry suite passed **58 tests in 4 suites**, including 256 fuzz runs and a 64-run / 2,048-call invariant campaign. Tests do not constitute an audit.

See [Demo guide](docs/DEMO.md) for **100 mETH PO → 20 mETH coverage → 16 mETH payout → 4 mETH remaining collateral**. The offchain seed currently clears production dependency rows while recreating the demo; use an isolated database.

## Sepolia and hosting

Copy `contracts/.env.example` to `contracts/.env`; fill the Sepolia RPC, funded deployment key, and separate buyer/provider/verifier addresses. From `contracts/`:

```bash
forge script script/Deploy.s.sol:Deploy --rpc-url sepolia --broadcast
```

Add `--verify` after setting `ETHERSCAN_API_KEY`. The script writes `contracts/deployments/11155111.json`; these instructions do not assert an existing Sepolia deployment.

Build hosting from `web/`; configure RPC/chain values and server-only Supabase credentials. Provide actual deployments using `CONTRACTS_DEPLOYMENTS_DIR` or a JSON array in `SUPPLYRIGHT_DEPLOYMENTS`; environment records override files by chain ID. Set `NEXT_PUBLIC_ENABLE_LOCAL_CHAIN=false` and default chain `11155111` for a Sepolia-only site. The server does not need wallet private keys.

See [Architecture](docs/ARCHITECTURE.md), [Security](docs/SECURITY.md), and [Web configuration](web/README.md).
