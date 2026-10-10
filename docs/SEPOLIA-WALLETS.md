# Sepolia wallets

SupplyRight on Ethereum Sepolia (chain `11155111`) uses one independent EOA per role, kept as an encrypted Foundry keystore outside the repository, plus the existing deployer. Suppliers stay offchain and need no wallet. Collateral, payouts and gas are native Sepolia ETH (no value).

## Role → address → keystore

| Role | Public address | Keystore alias | Onchain authority (granted by `SupplyRightRoles`) |
| --- | --- | --- | --- |
| Deployer (existing) | `0x959a7CDa30042C26deAAE4Cf27Cc319dFE2CB5B8` | `supplyright-sepolia-deployer.json` | `DEFAULT_ADMIN_ROLE` on all five contracts at deployment; sends the role grants |
| Registrar / Admin | `0x5b0D0561fa0FFeA6a45cAC5B95d593C3CCcA17C6` | `supplyright-admin` | SupplyRightNFT: `DEFAULT_ADMIN`, `REGISTRAR`, `TRANSFER_APPROVER` · RecoveryClaimNFT: `DEFAULT_ADMIN`, `TRANSFER_APPROVER` · ProtectionNFT, Vault, ClaimManager: `DEFAULT_ADMIN` |
| Buyer / Manufacturer | `0x8b6Dd69Ea85C80dd545408e6eD35157aaC70838a` | `supplyright-buyer` | SupplyRightNFT: `BUYER_ROLE`; buyer/beneficiary checks in the vault and claim manager |
| Protection Provider | `0x1Abf1953e7176D4265eC7887A8B34C149d091d15` | `supplyright-provider` | SupplyProtectionVault: `PROVIDER_ROLE` |
| Independent Verifier | `0xfF84e00835e2902C5d2336459da69BB70E81d9C8` | `supplyright-verifier` | SupplyClaimManager: `VERIFIER_ROLE` (independence from buyer and provider is checked onchain) |

Only public addresses are stored, in [`config/wallets.sepolia.json`](../config/wallets.sepolia.json), together with the chain id, the RPC env var name (`SEPOLIA_RPC_URL`), the explorer and, once deployed and verified onchain, the contract addresses. The four role wallets were created on 10 October 2026 with `cast wallet new` (Foundry 1.8.5). The addresses in an earlier commit of this file belonged to keystores that are not on this machine and had never been used (0 ETH, nonce 0), so they were replaced.

The deployer keeps `DEFAULT_ADMIN_ROLE` as a bootstrap admin. To leave the admin wallet as the only admin, run `SetupRoles` once with `RENOUNCE_DEPLOYER_ADMIN=true` after the matrix is verified.

## Creating the wallets

```bash
bash scripts/setup-supplyright-wallets.sh
```

On Windows PowerShell: `& 'C:\Program Files\Git\bin\bash.exe' scripts/setup-supplyright-wallets.sh`.

For each alias the script runs `cast wallet new ~/.foundry/keystores <alias> --json`. Cast asks for the keystore password in a hidden prompt; the script never sees, passes, stores or echoes it. An existing keystore with the same name, and every other file in the keystore directory (the deployer, other projects), is left untouched; `--force` is never used. The script refuses a keystore directory inside the repository, writes only the public address into the config, and finally checks that all addresses are valid and distinct from each other and from the deployer.

Check a keystore's address at any time (asks for its password):

```bash
cast wallet address --account supplyright-buyer
```

## Rules

- Private keys and mnemonics are never printed, committed or put in `.env`; scripts sign with `--account <alias>` and forge/cast ask for the password interactively.
- One key per role. `SupplyRightRoles.validate` rejects duplicate role wallets, and `SupplyRightRoles.problems` (run after every deploy/role setup) fails if any role wallet holds another role's privileges.
- Keystores live in `%USERPROFILE%\.foundry\keystores` (Windows) / `~/.foundry/keystores`. Back them up together with their passwords; a lost password cannot be recovered.
- `contracts/.env.sepolia.local` (ignored by git, not used by any script) still contains plaintext keys of an older wallet set. Delete it, or import a wallet you still need with `cast wallet import`.

## Funding

```bash
node scripts/prepare-funding.mjs              # plan only
node scripts/prepare-funding.mjs --execute    # plan, confirm with "yes", then cast send per top-up
```

The planner reads every balance, the current gas price and the gas profile measured on a Sepolia fork (`config/gas-profile.sepolia-fork.json`, + 10%). It then prints the source, destination, amount, transfer gas and the total each wallet and the source need. Nothing is sent without the typed confirmation, and cast asks for the source keystore password for each transfer.

Sepolia's Glamsterdam upgrade (6 October 2026, EIP-8037) made contract and storage creation about 7× more expensive than on a plain local chain. Deploying the five contracts takes ~99M gas; the role wallets need 1.4–2.9M gas each. Gas prices are very low (~0.001 gwei on 10 October 2026), so the ETH needed is dominated by the provider's 0.010 ETH escrow:

| Wallet | Top-up | Covers |
| --- | --- | --- |
| admin | 0.0005 ETH | mint, supplier acknowledgement, delivery note |
| buyer | 0.0015 ETH | protection request, claim, 0.001 ETH transfer smoke test |
| provider | 0.0105 ETH | 0.010 ETH escrow + funding transaction |
| verifier | 0.0005 ETH | approval + settlement |
| deployer | ≥ 0.0152 ETH total | the four top-ups + ~0.0022 ETH deployment gas at a 0.02 gwei planning price |

On 10 October 2026 every one of these wallets held 0 Sepolia ETH, so the deployer must first receive at least ~0.016 Sepolia ETH (0.02 recommended) from a faucet or another wallet.
