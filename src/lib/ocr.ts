/**
 * Real document OCR — sends an uploaded photo to Claude's vision capability
 * (same ANTHROPIC_API_KEY already used for will structuring, so no new vendor
 * or key is required) with a forced tool call so the response MUST match one
 * of the schemas in ocrSchema.ts. Validated with zod before trusting it.
 *
 * Without a key (or on failure), falls back to a canned extraction and is
 * labelled honestly as simulated — same trust-boundary pattern as llm.ts.
 *
 * Server-only. Called from /api/ocr.
 */
import {
  OCR_TOOL_DEF,
  schemaFor,
  type OcrDocType,
} from "./ocrSchema";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

const SYSTEM_PROMPT = `You extract structured fields from a photo of an identity or property
document for InstaWill, a DIFC will-drafting assistant. Read only what is visibly
printed on the document — never guess or invent a value. If a field isn't visible,
omit it (or set legible=false if the document as a whole can't be read reliably).
Call the provided tool with the extracted fields.`;

export interface OcrResult<T> {
  extracted: T;
  source: "vision" | "fallback";
  note: string;
}

const FALLBACK: Record<OcrDocType, unknown> = {
  passport: {
    full_name: "Sarah Anne Whitfield",
    passport_number: "561234789",
    passport_expiry: "2031-04-01",
    nationality: "British",
    legible: true,
  },
  emirates_id: {
    full_name: "Sarah Anne Whitfield",
    id_number: "784-1988-1234567-1",
    address: "Villa 12, Emirates Hills, Dubai",
    expiry: "2028-04-01",
    legible: true,
  },
  title_deed: {
    owner_name: "Sarah Anne Whitfield",
    joint_owner: false,
    other_owner_name: null,
    property_description: "Villa 12, Emirates Hills, Dubai",
    legible: true,
  },
};

async function callVision(
  docType: OcrDocType,
  imageBase64: string,
  mediaType: string
): Promise<unknown> {
  const apiKey = process.env.ANTHROPIC_API_KEY as string;
  const tool = OCR_TOOL_DEF[docType];

  const body = {
    model: MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      },
    ],
    tool_choice: { type: "tool", name: tool.name },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: imageBase64 },
          },
          {
            type: "text",
            text: `Extract the ${docType.replace("_", " ")} fields from this photo.`,
          },
        ],
      },
    ],
  };

  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; name?: string; input?: unknown }>;
  };
  const toolUse = json.content?.find(
    (b) => b.type === "tool_use" && b.name === tool.name
  );
  if (!toolUse || !toolUse.input) {
    throw new Error("Anthropic response contained no tool_use block");
  }
  return toolUse.input;
}

export async function extractDocument(
  docType: OcrDocType,
  imageBase64: string,
  mediaType: string
): Promise<OcrResult<unknown>> {
  const schema = schemaFor(docType);

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const raw = await callVision(docType, imageBase64, mediaType);
      const extracted = schema.parse(raw);
      return {
        extracted,
        source: "vision",
        note: "Extracted by Claude vision from the uploaded photo.",
      };
    } catch (err) {
      return {
        extracted: schema.parse(FALLBACK[docType]),
        source: "fallback",
        note: `Vision call/validation failed (${
          err instanceof Error ? err.message : "unknown"
        }) — used simulated extraction.`,
      };
    }
  }

  return {
    extracted: schema.parse(FALLBACK[docType]),
    source: "fallback",
    note: "No ANTHROPIC_API_KEY set — used simulated extraction (offline demo mode).",
  };
}
