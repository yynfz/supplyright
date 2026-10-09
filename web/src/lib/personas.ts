import { createConnector } from "wagmi";
import { getAddress, numberToHex, type Address, type EIP1193RequestFn } from "viem";
import { LOCAL_CHAIN_ID, localRpcUrl } from "@/lib/chains";

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

export type Persona = (typeof PERSONAS)[number];

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

export function personaConnector(persona: Persona) {
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
          return forward({ method, params } as never);
      }
    }) as EIP1193RequestFn,
  };

  return createConnector<typeof provider>(() => ({
    id: persona.id,
    name: `Demo: ${persona.short}`,
    type: "supplyrightPersona",
    async connect() {
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

export function personaFor(address?: string | null): Persona | undefined {
  if (!address) return undefined;
  return PERSONAS.find((p) => p.address.toLowerCase() === address.toLowerCase());
}
