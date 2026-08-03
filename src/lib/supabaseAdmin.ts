/**
 * Supabase SERVICE-ROLE client — server-only, bypasses RLS.
 *
 * Only ever import this from a route handler (`src/app/api/**\/route.ts`),
 * which always runs server-side in the Next.js App Router. Never import it
 * from a client component, and never expose SUPABASE_SERVICE_ROLE_KEY via a
 * NEXT_PUBLIC_ variable — it is the master key for every table's RLS.
 *
 * The anon client in supabaseClient.ts is for browser reads/uploads the RLS
 * policies already allow. This client exists for the one thing anon can't do:
 * insert lead/will/clarification rows so the n8n poller can pick them up.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null | undefined;

export function getSupabaseAdminClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    client = null;
    return client;
  }
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export const SUPABASE_ADMIN_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);
