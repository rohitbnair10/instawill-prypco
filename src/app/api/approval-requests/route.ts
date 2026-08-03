/**
 * POST /api/approval-requests — mirrors "lawyer approves draft -> sent to
 * client" into Postgres so the n8n approval-request workflow
 * (n8n/client-approval/) can email the client that their will is ready to
 * review. Same fire-and-forget mirror pattern as /api/clarifications: the
 * local demo store stays the UI's source of truth, this is best-effort.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient, SUPABASE_ADMIN_CONFIGURED } from "@/lib/supabaseAdmin";
import { findOrCreateLead, findOrCreateWill } from "@/lib/supabaseSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  leadName: string;
  leadEmail: string;
  leadPhone?: string;
  preferredChannel?: "email" | "whatsapp" | "phone";
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
    if (!body.leadEmail) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  if (!SUPABASE_ADMIN_CONFIGURED) {
    return NextResponse.json({ ok: true, skipped: "supabase not configured" });
  }
  const db = getSupabaseAdminClient();
  if (!db) return NextResponse.json({ ok: true, skipped: "supabase not configured" });

  try {
    const leadId = await findOrCreateLead(db, body, "pending_client_approval");
    const willId = await findOrCreateWill(db, leadId, "pending_client_approval");

    // status='pending_client_approval' + approval_notified_at reset to null
    // is exactly what the n8n poller
    // (n8n/client-approval/client_approval_email.json) looks for. Resetting
    // on every approve means a re-approval after changes emails again.
    const { error } = await db
      .from("wills")
      .update({
        status: "pending_client_approval",
        lawyer_approved_at: new Date().toISOString(),
        approval_notified_at: null,
      })
      .eq("id", willId);
    if (error) throw error;

    return NextResponse.json({ ok: true, will_id: willId });
  } catch (err) {
    console.error("[api/approval-requests] mirror to Supabase failed:", err);
    return NextResponse.json({ ok: true, skipped: "mirror failed" });
  }
}
