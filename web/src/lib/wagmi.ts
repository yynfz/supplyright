import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  coinbaseWallet,
  injectedWallet,
  metaMaskWallet,
  rabbyWallet,
  walletConnectWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { createConfig, http, type CreateConnectorFn } from "wagmi";
import {
  LOCAL_CHAIN_ID,
  SEPOLIA_CHAIN_ID,
  localChainEnabled,
  localRpcUrl,
  sepoliaRpcUrl,
  supportedChains,
} from "@/lib/chains";
import { PERSONAS, personaConnector } from "@/lib/personas";

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "";

function buildConnectors(): CreateConnectorFn[] {
  const wallets = walletConnectProjectId
    ? [metaMaskWallet, rabbyWallet, coinbaseWallet, walletConnectWallet, injectedWallet]
    : [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet];
  const rainbow = connectorsForWallets([{ groupName: "Wallet", wallets }], {
    appName: "SupplyRight",
    // WalletConnect is only offered when a project id is configured; injected wallets work without it.
    projectId: walletConnectProjectId || "supplyright-no-walletconnect",
  });
  const personas = localChainEnabled ? PERSONAS.map((p) => personaConnector(p)) : [];
  return [...rainbow, ...personas];
}

export const wagmiConfig = createConfig({
  chains: supportedChains,
  connectors: typeof window === "undefined" ? [] : buildConnectors(),
  transports: {
    [LOCAL_CHAIN_ID]: http(localRpcUrl),
    [SEPOLIA_CHAIN_ID]: http(sepoliaRpcUrl),
  },
  ssr: true,
  multiInjectedProviderDiscovery: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
