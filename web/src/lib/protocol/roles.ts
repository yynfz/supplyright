import { keccak256, toBytes, type Hex } from "viem";

export const ROLES = {
  DEFAULT_ADMIN_ROLE: ("0x" + "00".repeat(32)) as Hex,
  REGISTRAR_ROLE: keccak256(toBytes("REGISTRAR_ROLE")),
  BUYER_ROLE: keccak256(toBytes("BUYER_ROLE")),
  TRANSFER_APPROVER_ROLE: keccak256(toBytes("TRANSFER_APPROVER_ROLE")),
  PROVIDER_ROLE: keccak256(toBytes("PROVIDER_ROLE")),
  VERIFIER_ROLE: keccak256(toBytes("VERIFIER_ROLE")),
} as const;

export const ROLE_HASHES: Record<string, string> = Object.fromEntries(
  Object.entries(ROLES).map(([name, hash]) => [hash.toLowerCase(), name]),
);
