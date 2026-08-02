/**
 * POST /api/will-pdf — renders the Schedule 1 draft to a real PDF server-side.
 * Body: { structured: StructuredWill, identity: Identity }. Returns
 * application/pdf bytes. Used for the "draft will PDF" document link in the
 * ops portal package.
 */
import { NextRequest, NextResponse } from "next/server";
import { renderWillPdf } from "@/lib/pdf";
import type { Identity, StructuredWill } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { structured?: StructuredWill; identity?: Identity };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  if (!body.structured) {
    return NextResponse.json({ error: "missing structured will" }, { status: 400 });
  }

  try {
    const pdf = await renderWillPdf(body.structured, body.identity ?? null);
    return new NextResponse(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": 'inline; filename="difc-draft-will.pdf"',
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "pdf generation failed" },
      { status: 500 }
    );
  }
}
