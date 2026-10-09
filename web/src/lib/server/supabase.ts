import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { HttpError } from "./http";

export const DOCUMENT_BUCKET = "supply-documents";

let client: SupabaseClient | null = null;

/**
 * Service-role Supabase client. Server-only: the key bypasses RLS, so every API route must authenticate
 * the wallet and authorize the action before calling this.
 */
export function supabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new HttpError(
      503,
      "Supabase belum dikonfigurasi: isi NEXT_PUBLIC_SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY di web/.env.local.",
    );
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
