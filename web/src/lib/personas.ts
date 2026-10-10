import { createConnector } from "wagmi";
import { getAddress, numberToHex, type Address, type EIP1193RequestFn } from "viem";
import { LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID, localRpcUrl } from "@/lib/chains";
import { SEPOLIA_WALLETS, type SepoliaRoleKey } from "@/generated/wallets.sepolia";

/**
 * Demo personas for the LOCAL Anvil chain only. They map to Anvil's publicly known dev accounts, which the
 * node keeps unlocked, so transactions are signed by Anvil itself and no private key ever reaches the
 * browser. The Deploy script grants these accounts their roles by default on chain 31337.
 */
export const PERSONAS = [
  {
    id: "persona-registrar",
    name: "Registrar & Admin",
    short: "Registrar",
    address: getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"),
    description: "Memverifikasi dokumen, mencetak Supply Right, mengatur peran.",
  },
  {
    id: "persona-buyer",
    name: "PT Contoh Manufaktur Baterai (Pembeli)",
    short: "Pembeli",
    address: getAddress("0x70997970C51812dc3A010C7d01b50e0d17dc79C8"),
    description: "Mendaftarkan PO, meminta proteksi, mengajukan klaim.",
  },
  {
    id: "persona-provider",
    name: "Contoh Proteksi Rantai Pasok (Provider)",
    short: "Provider",
    address: getAddress("0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC"),
    description: "Menyetor collateral, menyetujui proteksi, memegang Recovery Claim.",
  },
  {
    id: "persona-verifier",
    name: "Contoh Surveyor Independen (Verifikator)",
    short: "Verifikator",
    address: getAddress("0x90F79bf6EB2c4f870365E785982E1f101E93b906"),
    description: "Memverifikasi kuantitas & kerugian layak, menyetujui/menolak klaim.",
  },
] as const;

const SEPOLIA_ROLE_TEXT: Record<SepoliaRoleKey, { short: string; description: string }> = {
  admin: { short: "Admin", description: "Validasi dokumen, pencetakan Supply Right, dan administrasi peran." },
  buyer: { short: "Buyer", description: "Pendaftaran PO, kepemilikan SupplyRight NFT, pengajuan klaim." },
  provider: { short: "Provider", description: "Penyetoran escrow ETH, aktivasi proteksi, penerima Recovery Claim NFT." },
  verifier: { short: "Verifier", description: "Verifikasi kegagalan supplier dan persetujuan klaim independen." },
};

/**
 * The four Sepolia role wallets prepared for the demo (public addresses from config/wallets.sepolia.json, via
 * `npm run sync:contracts`). These are LABELS only: they say which wallet was set up for a role. Authority always
 * comes from onchain `hasRole` reads (useRoles), and every transaction is signed by the wallet actually connected.
 */
export const SEPOLIA_ROLES = (Object.keys(SEPOLIA_ROLE_TEXT) as SepoliaRoleKey[]).flatMap((key) => {
  const wallet = SEPOLIA_WALLETS.roles[key];
  if (!wallet.address) return [];
  return [
    {
      id: `sepolia-${key}`,
      key,
      name: `${wallet.label} (Sepolia)`,
      short: SEPOLIA_ROLE_TEXT[key].short,
      role: wallet.keystoreAlias,
      address: getAddress(wallet.address),
      description: SEPOLIA_ROLE_TEXT[key].description,
    },
  ];
});

export type LocalPersona = (typeof PERSONAS)[number];
export type SepoliaRoleAlias = (typeof SEPOLIA_ROLES)[number];
export type Persona = LocalPersona | SepoliaRoleAlias;

const storageKey = (id: string) => `supplyright.persona.${id}`;

let rpcId = 0;
const forward: EIP1193RequestFn = async ({ method, params }) => {
  const res = await fetch(localRpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const json = await res.json();
  if (json.error) {
    const err = new Error(json.error.message) as Error & { code?: number; data?: unknown };
    err.code = json.error.code;
    err.data = json.error.data;
    throw err;
  }
  return json.result;
};

const SIGNING_METHODS = new Set([
  "eth_sendTransaction",
  "eth_sign",
  "personal_sign",
  "eth_signTransaction",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
]);

/**
 * Personas sign through the node's unlocked accounts, so refuse to talk to any node that is not a 31337 chain
 * (e.g. a misconfigured NEXT_PUBLIC_LOCAL_RPC_URL pointing at Sepolia). Personas can never act on Sepolia.
 */
async function assertLocalNode() {
  const id = Number(await forward({ method: "eth_chainId" } as never));
  if (id !== LOCAL_CHAIN_ID) {
    throw new Error(`Persona demo hanya untuk chain Anvil lokal (${LOCAL_CHAIN_ID}); RPC lokal melaporkan chain ${id}.`);
  }
}

export function personaConnector(persona: LocalPersona) {
  const address: Address = persona.address;
  const provider = {
    request: (async ({ method, params }: { method: string; params?: unknown }) => {
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return [address];
        case "eth_chainId":
          return numberToHex(LOCAL_CHAIN_ID);
        case "wallet_switchEthereumChain": {
          const target = Number((params as [{ chainId: string }])[0].chainId);
          if (target !== LOCAL_CHAIN_ID) {
            const err = new Error("Persona demo hanya tersedia di chain Anvil lokal.") as Error & { code: number };
            err.code = 4902;
            throw err;
          }
          return null;
        }
        default:
          if (SIGNING_METHODS.has(method)) await assertLocalNode();
          return forward({ method, params } as never);
      }
    }) as EIP1193RequestFn,
  };

  return createConnector<typeof provider>(() => ({
    id: persona.id,
    name: `Demo: ${persona.short}`,
    type: "supplyrightPersona",
    async connect() {
      await assertLocalNode();
      try {
        localStorage.setItem(storageKey(persona.id), "1");
      } catch {}
      // The `withCapabilities` overload is not used by this connector.
      return { accounts: [address], chainId: LOCAL_CHAIN_ID } as never;
    },
    async disconnect() {
      try {
        localStorage.removeItem(storageKey(persona.id));
      } catch {}
    },
    async getAccounts() {
      return [address];
    },
    async getChainId() {
      return LOCAL_CHAIN_ID;
    },
    async getProvider() {
      return provider;
    },
    async isAuthorized() {
      try {
        return localStorage.getItem(storageKey(persona.id)) === "1";
      } catch {
        return false;
      }
    },
    async switchChain({ chainId }) {
      if (chainId !== LOCAL_CHAIN_ID) throw new Error("Persona demo hanya tersedia di chain Anvil lokal.");
      const { anvilChain } = await import("@/lib/chains");
      return anvilChain;
    },
    onAccountsChanged() {},
    onChainChanged() {},
    onDisconnect() {},
  }));
}

/**
 * Display label for a known address on a given chain: Anvil dev personas on the local chain, configured role
 * wallets on Sepolia. A label is never authority; use useRoles for that.
 */
export function personaFor(address: string | null | undefined, chainId: number): Persona | undefined {
  if (!address) return undefined;
  const lower = address.toLowerCase();
  const list: readonly Persona[] = chainId === LOCAL_CHAIN_ID ? PERSONAS : chainId === SEPOLIA_CHAIN_ID ? SEPOLIA_ROLES : [];
  return list.find((p) => p.address.toLowerCase() === lower);
}
