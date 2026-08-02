/**
 * POST /api/structure — runs the LLM structuring step server-side so the API
 * key never reaches the browser. Body: { identity: Identity, wishes_text: string }.
 * Returns a StructureResult (structured will + ai_structured flag + honest
 * source note). This is the same function the standalone CLI
 * (scripts/demo-pipe.ts) calls directly — one code path, proven both ways.
 */
import { NextRequest, NextResponse } from "next/server";
import { structureWishes } from "@/lib/llm";
import type { Identity } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let identity: Identity;
  let wishesText: string;
  try {
    const body = await req.json();
    identity = body.identity as Identity;
    wishesText = body.wishes_text as string;
    if (!identity || typeof wishesText !== "string") {
      return NextResponse.json({ error: "invalid body" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  try {
    const result = await structureWishes(identity, wishesText);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "structuring failed" },
      { status: 500 }
    );
  }
}
