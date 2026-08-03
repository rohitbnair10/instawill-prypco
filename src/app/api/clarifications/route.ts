/**
 * POST /api/clarifications — the one write that makes the n8n clarification
 * workflow real. The lawyer desk still runs on the local demo store (that's
 * the source of truth for the UI); this route mirrors a raised clarification
 * into Postgres so the n8n poller (n8n/clarification/) picks it up and emails
 * the client within a minute.
 *
 * Best-effort: if Supabase isn't configured, or any step here fails, we return
 * ok so the local demo flow never breaks — same fallback philosophy as
 * llm.ts / ocr.ts. The caller doesn't await this to gate the UI.
 */
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient, SUPABASE_ADMIN_CONFIGURED } from "@/lib/supabaseAdmin";
import { findOrCreateLead, findOrCreateWill, findOrCreateStaffUser } from "@/lib/supabaseSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  leadName: string;
  leadEmail: string;
  leadPhone?: string;
  preferredChannel?: "email" | "whatsapp" | "phone";
  mode: "question" | "document_reupload";
  question: string;
  docType?: string | null;
  channel: "email" | "whatsapp";
  messagePreview: string;
  messageFinal: string;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = await req.json();
    if (!body.leadEmail || !body.question || !body.messageFinal) {
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
    const leadId = await findOrCreateLead(db, body, "awaiting_client");
    const willId = await findOrCreateWill(db, leadId, "awaiting_client");
    const lawyerId = await findOrCreateStaffUser(db, "lawyer", "Demo Lawyer", "lawyer@instawill.ae");

    // Insert the clarification — status 'sent' is exactly what the n8n
    // poller (n8n/clarification/clarification_email.json) looks for.
    const { data: clarification, error: clarErr } = await db
      .from("clarifications")
      .insert({
        will_id: willId,
        raised_by: lawyerId,
        mode: body.mode,
        question: body.question,
        doc_type: body.docType || null,
        message_preview: body.messagePreview,
        message_final: body.messageFinal,
        channel: body.channel,
        status: "sent",
      })
      .select("id")
      .single();
    if (clarErr || !clarification) throw clarErr || new Error("clarification insert failed");

    return NextResponse.json({ ok: true, will_id: willId, clarification_id: clarification.id });
  } catch (err) {
    // Best-effort mirror — log and return ok so the local demo flow isn't
    // blocked by a Postgres hiccup.
    console.error("[api/clarifications] mirror to Supabase failed:", err);
    return NextResponse.json({ ok: true, skipped: "mirror failed" });
  }
}
