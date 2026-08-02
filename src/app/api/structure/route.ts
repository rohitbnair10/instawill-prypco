/**
 * POST /api/structure — runs the LLM structuring step server-side so the API
 * key never reaches the browser. Body: { draft: IntakeDraft }. Returns a
 * StructureResult (structured will + ai_structured flag + honest source note).
 */
import { NextRequest, NextResponse } from "next/server";
import { structureWill } from "@/lib/llm";
import type { IntakeDraft } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let draft: IntakeDraft;
  try {
    const body = await req.json();
    draft = body.draft as IntakeDraft;
    if (!draft || !Array.isArray(draft.beneficiaries)) {
      return NextResponse.json({ error: "invalid draft" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await structureWill(draft);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "structuring failed" },
      { status: 500 }
    );
  }
}
