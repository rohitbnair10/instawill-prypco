/**
 * POST /api/ocr — runs document OCR server-side (keeps the Anthropic key off
 * the client). Body: { doc_type, image_base64, media_type }. Returns an
 * OcrResult (extracted fields + honest source note).
 */
import { NextRequest, NextResponse } from "next/server";
import { extractDocument } from "@/lib/ocr";
import type { OcrDocType } from "@/lib/ocrSchema";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_TYPES: OcrDocType[] = ["passport", "emirates_id", "title_deed"];
const MAX_BASE64_LEN = 8_000_000; // ~6MB decoded, generous for a phone photo

export async function POST(req: NextRequest) {
  let body: {
    doc_type?: string;
    image_base64?: string;
    media_type?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const { doc_type, image_base64, media_type } = body;
  if (!doc_type || !VALID_TYPES.includes(doc_type as OcrDocType)) {
    return NextResponse.json({ error: "invalid doc_type" }, { status: 400 });
  }
  if (!image_base64 || typeof image_base64 !== "string") {
    return NextResponse.json({ error: "missing image_base64" }, { status: 400 });
  }
  if (image_base64.length > MAX_BASE64_LEN) {
    return NextResponse.json({ error: "image too large" }, { status: 413 });
  }
  const mt = media_type && /^image\/(jpeg|png|webp|gif)$/.test(media_type)
    ? media_type
    : "image/jpeg";

  try {
    const result = await extractDocument(doc_type as OcrDocType, image_base64, mt);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "ocr failed" },
      { status: 500 }
    );
  }
}
