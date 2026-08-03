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
    // 1) Find or create the lead by email.
    const { data: existingLead } = await db
      .from("leads")
      .select("id")
      .eq("email", body.leadEmail)
      .maybeSingle();

    let leadId: string;
    if (existingLead) {
      leadId = existingLead.id;
      await db
        .from("leads")
        .update({
          current_stage: "awaiting_client",
          stage_updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
    } else {
      const { data: newLead, error } = await db
        .from("leads")
        .insert({
          full_name: body.leadName || "Client",
          email: body.leadEmail,
          phone: body.leadPhone || null,
          preferred_channel: body.preferredChannel || "email",
          current_stage: "awaiting_client",
        })
        .select("id")
        .single();
      if (error || !newLead) throw error || new Error("lead insert failed");
      leadId = newLead.id;
    }

    // 2) Find or create a will for that lead.
    const { data: existingWill } = await db
      .from("wills")
      .select("id")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let willId: string;
    if (existingWill) {
      willId = existingWill.id;
      await db.from("wills").update({ status: "awaiting_client" }).eq("id", willId);
    } else {
      const { data: newWill, error } = await db
        .from("wills")
        .insert({ lead_id: leadId, status: "awaiting_client" })
        .select("id")
        .single();
      if (error || !newWill) throw error || new Error("will insert failed");
      willId = newWill.id;
    }

    // 3) Resolve a staff user for raised_by (clarifications.raised_by is NOT
    //    NULL). No real auth/session yet, so reuse or seed one demo lawyer.
    const { data: existingLawyer } = await db
      .from("users")
      .select("id")
      .eq("role", "lawyer")
      .limit(1)
      .maybeSingle();

    let lawyerId: string;
    if (existingLawyer) {
      lawyerId = existingLawyer.id;
    } else {
      const { data: newLawyer, error } = await db
        .from("users")
        .insert({ name: "Demo Lawyer", role: "lawyer", email: "lawyer@instawill.ae" })
        .select("id")
        .single();
      if (error || !newLawyer) throw error || new Error("lawyer user insert failed");
      lawyerId = newLawyer.id;
    }

    // 4) Insert the clarification — status 'sent' is exactly what the n8n
    //    poller (n8n/clarification/clarification_email.json) looks for.
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
