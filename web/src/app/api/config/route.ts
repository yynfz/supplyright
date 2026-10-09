import { NextResponse } from "next/server";
import { loadDeployments } from "@/lib/server/deployments";

export const dynamic = "force-dynamic";

/** Public: contract addresses per chain. Contains no private data. */
export function GET() {
  return NextResponse.json({ deployments: loadDeployments() });
}
