/**
 * Server-only helpers shared by the API routes that mirror a local-store
 * action into Postgres so an n8n poller can pick it up (clarifications,
 * client-approval requests, ...). Each mirror route needs the same three
 * lookups — find/create the lead, find/create a will for it, find/create a
 * demo staff user — so they live here once instead of copy-pasted per route.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface LeadFields {
  leadName: string;
  leadEmail: string;
  leadPhone?: string;
  preferredChannel?: "email" | "whatsapp" | "phone";
}

/** Find a lead by email, or create one. Returns its id. */
export async function findOrCreateLead(
  db: SupabaseClient,
  fields: LeadFields,
  stage: string
): Promise<string> {
  const { data: existing } = await db
    .from("leads")
    .select("id")
    .eq("email", fields.leadEmail)
    .maybeSingle();

  if (existing) {
    await db
      .from("leads")
      .update({ current_stage: stage, stage_updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return existing.id;
  }

  const { data: created, error } = await db
    .from("leads")
    .insert({
      full_name: fields.leadName || "Client",
      email: fields.leadEmail,
      phone: fields.leadPhone || null,
      preferred_channel: fields.preferredChannel || "email",
      current_stage: stage,
    })
    .select("id")
    .single();
  if (error || !created) throw error || new Error("lead insert failed");
  return created.id;
}

/** Find the most recent will for a lead, or create one. Returns its id. */
export async function findOrCreateWill(
  db: SupabaseClient,
  leadId: string,
  status: string
): Promise<string> {
  const { data: existing } = await db
    .from("wills")
    .select("id")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    await db.from("wills").update({ status }).eq("id", existing.id);
    return existing.id;
  }

  const { data: created, error } = await db
    .from("wills")
    .insert({ lead_id: leadId, status })
    .select("id")
    .single();
  if (error || !created) throw error || new Error("will insert failed");
  return created.id;
}

/**
 * Resolve a staff user id for FK columns that require one (e.g.
 * clarifications.raised_by). No real auth/session yet, so reuse or seed one
 * demo user for the given role.
 */
export async function findOrCreateStaffUser(
  db: SupabaseClient,
  role: "lawyer" | "ops_agent" | "admin",
  name: string,
  email: string
): Promise<string> {
  const { data: existing } = await db
    .from("users")
    .select("id")
    .eq("role", role)
    .limit(1)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await db
    .from("users")
    .insert({ name, role, email })
    .select("id")
    .single();
  if (error || !created) throw error || new Error(`${role} user insert failed`);
  return created.id;
}
