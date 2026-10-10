# SupplyRight web

Next.js 15 / React 19 app with TypeScript, Tailwind, wagmi/viem, RainbowKit, React Query, and Supabase. Collateral, coverage, and payouts are native ETH (18 decimals; Sepolia or local Anvil test ETH), the same asset that pays gas. There is no settlement token, faucet, or allowance.

## Run

```bash
npm ci
```

Copy `.env.example` to `.env.local`, apply the Supabase migration described in the [repository README](../README.md), and provide an existing deployment. The server reads numeric JSON files in `../contracts/deployments`. With Foundry output present, `npm run sync:contracts` refreshes ABIs and regenerates `src/generated/wallets.sepolia.ts` (public role-wallet addresses from `../config/wallets.sepolia.json`). Those addresses are display labels only; the UI derives roles from onchain `hasRole` and every transaction is signed by the connected wallet.

```bash
npm run dev
```

Open `http://localhost:3000`. Private operations request a wallet login signature; contract writes require wallet confirmation and gas.

## Configuration

| Variable | Use |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Project API URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only database/private storage access; never expose in browser |
| `NEXT_PUBLIC_ENABLE_LOCAL_CHAIN` | Local chain enabled unless exactly `false` |
| `NEXT_PUBLIC_DEFAULT_CHAIN_ID` | `31337` locally or `11155111` on Sepolia |
| `NEXT_PUBLIC_LOCAL_RPC_URL`, `NEXT_PUBLIC_SEPOLIA_RPC_URL` | Browser RPC endpoints |
| `LOCAL_RPC_URL`, `SEPOLIA_RPC_URL` | Optional server RPC overrides |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | Optional WalletConnect project; not required for injected wallets |
| `NEXT_PUBLIC_LOG_CHUNK_SIZE` | Initial event range, default 20,000 blocks |
| `CONTRACTS_DEPLOYMENTS_DIR` | Server JSON directory, default `../contracts/deployments` relative to web cwd |
| `SUPPLYRIGHT_DEPLOYMENTS` | JSON array of deployments; overrides files by chain ID |

Deployment objects contain `chainId`, `startBlock`, `deployedAt`, `deployer`, `settlementAsset` (`"native"`), `supplyRightNFT`, `protectionNFT`, `recoveryClaimNFT`, `vault`, and `claimManager`, as written by `Deploy.s.sol`. Legacy token-settled deployment files (with `settlementToken`) are ignored; redeploy them. Preserve the real start block. Public variables are bundled at build time.

For Sepolia hosting: disable local chain, choose default chain 11155111, set an RPC, and provide the actual deployment. The server needs Supabase credentials, not wallet private keys.

## Checks and seeding

```bash
npm run typecheck
npm run lint
npm run build
npm test
npm run test:protocol
```

`test:protocol` requires compiled Foundry artifacts (`forge build` in `contracts/`) and Anvil. It starts and stops its own fresh chain on `127.0.0.1:8547`, refusing an occupied port. It executes the supply, protection, verification, and settlement flow, then checks the frontend snapshot/event readers: 0.008 ETH paid to the buyer, 0.002 ETH still locked (vault ETH balance equals free + locked collateral), and a Recovery Claim NFT owned by the provider. It does not write deployment files or use Supabase. Set `SUPPLYRIGHT_ANVIL_PATH` if Anvil is outside the normal installation path.

`npm run seed:offchain` reads `.env.local` and imports fictional agreements/documents/dependencies from `../demo`. It defaults to chain 31337 and supports `DEMO_CHAIN_ID` and `DEMO_*_ADDRESS` overrides. It upserts known demo PO hashes, material codes, product SKUs, and exact dependency edges, preserving IDs and unrelated records. Document paths use `demo/<chainId>/<filename>`; legacy files remain intact. Use a separate demo project for fictional data. See the [demo guide](../docs/DEMO.md).
