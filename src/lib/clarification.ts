/**
 * Clarification message drafting (§1B-ter).
 *
 * When a lawyer raises a clarification mid-review, the LLM drafts a
 * personalised message from the underlying question + case context — the
 * lawyer previews, edits if needed, and one-click sends. Not auto-fired (a
 * human eye reviews every message before it reaches a client), but one click,
 * not a handoff to ops.
 *
 * Same trust-boundary pattern as llm.ts/ocr.ts: a real Anthropic call when a
 * key is present, an honest templated fallback otherwise — always labelled.
 */
import type { ClarificationMode, DocType } from "./types";

export interface DraftClarificationInput {
  clientName: string;
  mode: ClarificationMode;
  question: string;
  docType?: DocType | null;
}

export interface DraftClarificationResult {
  text: string;
  source: "llm" | "fallback";
  note: string;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

const DOC_LABEL: Record<string, string> = {
  passport: "a clearer photo of your passport",
  emirates_id: "a clearer photo of your Emirates ID",
  title_deed: "your title deed",
  witness_passport: "your witness's passport",
  draft_will_pdf: "your draft will",
};

function fallbackTemplate(input: DraftClarificationInput): string {
  const { clientName, mode, question, docType } = input;
  const first = clientName.split(" ")[0] || "there";
  if (mode === "document_reupload") {
    return `Hi ${first},\n\nQuick one from your InstaWill lawyer — could you re-upload ${
      docType ? DOC_LABEL[docType] || "the document" : "the document"
    }? ${question}\n\nUse the secure link below to upload it directly — takes a minute.\n\nThanks,\nYour InstaWill legal team`;
  }
  return `Hi ${first},\n\nQuick one from your InstaWill lawyer before we can move your will forward: ${question}\n\nJust reply using the secure link below — no need to log back into the full form.\n\nThanks,\nYour InstaWill legal team`;
}

async function callAnthropic(input: DraftClarificationInput): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY as string;

  const system = `You draft short, warm, plain-English client messages for InstaWill, a DIFC
will-drafting service. A lawyer has a specific question or needs a document
re-uploaded before they can approve a client's will draft. Write a brief
message (3-5 sentences) to the client that:
- Uses their first name.
- States the question or the document needed, in plain language (no legal jargon).
- Reassures them this is routine and won't take long.
- Mentions they'll use a secure link to respond (do not invent a URL).
- Signs off as "Your InstaWill legal team".
Return ONLY the message text, no preamble, no markdown.`;

  const user = `Client name: ${input.clientName}\nMode: ${input.mode}\n${
    input.mode === "document_reupload"
      ? `Document needed: ${input.docType ? DOC_LABEL[input.docType] || input.docType : "a document"}\n`
      : ""
  }Question/context from the lawyer: ${input.question}`;

  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 300,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = (await res.json()) as { content?: Array<{ type: string; text?: string }> };
  const block = json.content?.find((b) => b.type === "text" && b.text);
  if (!block?.text) throw new Error("Anthropic response contained no text block");
  return block.text.trim();
}

export async function draftClarificationMessage(
  input: DraftClarificationInput
): Promise<DraftClarificationResult> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const text = await callAnthropic(input);
      return { text, source: "llm", note: "Drafted by Claude from the lawyer's question and case context." };
    } catch (err) {
      return {
        text: fallbackTemplate(input),
        source: "fallback",
        note: `LLM call failed (${err instanceof Error ? err.message : "unknown"}) — used a template draft. Review before sending.`,
      };
    }
  }
  return {
    text: fallbackTemplate(input),
    source: "fallback",
    note: "No ANTHROPIC_API_KEY set — used a template draft. Review before sending.",
  };
}
