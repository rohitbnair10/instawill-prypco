/**
 * POST /api/clarification-draft — drafts a client-facing clarification message
 * server-side (keeps the key off the client). Body matches
 * DraftClarificationInput. Returns { text, source, note }.
 */
import { NextRequest, NextResponse } from "next/server";
import { draftClarificationMessage, type DraftClarificationInput } from "@/lib/clarification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: DraftClarificationInput;
  try {
    body = await req.json();
    if (!body.clientName || !body.mode || !body.question) {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await draftClarificationMessage(body);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "draft failed" },
      { status: 500 }
    );
  }
}
