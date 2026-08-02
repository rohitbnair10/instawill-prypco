/**
 * ============================================================================
 * THE CROWN JEWEL — LLM structuring of client intake into a strict will JSON.
 * ============================================================================
 *
 * This module takes the client's raw answers + free-text distribution intent
 * (IntakeDraft) and produces a StructuredWill that matches src/lib/schema.ts.
 *
 * Two paths, ONE trust boundary:
 *   1. REAL LLM  — when ANTHROPIC_API_KEY is set we call the Anthropic Messages
 *      API with a forced tool call so the model MUST return JSON matching our
 *      schema. We still validate the result with zod before trusting it.
 *   2. FALLBACK  — with no key (or on any LLM/validation failure) a deterministic
 *      structurer builds the JSON from the already-structured intake fields so
 *      the prototype is fully usable offline.
 *
 * Either way, if distribution intent had to be INTERPRETED (free-text notes, or
 * a fallback that couldn't truly reason over them) we set ai_structured = true,
 * which surfaces the will to the lawyer as "AI-structured — verify". We never
 * trust model output blind — validating before use IS the product.
 *
 * Server-only (reads the API key). Called from /api/structure.
 */
import type { IntakeDraft, StructuredWill } from "./types";
import { structuredWillSchema, structuredWillJsonSchema } from "./schema";
import { deterministicStructure } from "./structure";

export interface StructureResult {
  structured: StructuredWill;
  /** true → lawyer must verify distribution ("AI-structured — verify"). */
  ai_structured: boolean;
  source: "llm" | "fallback";
  /** honest note about which path ran and why. */
  note: string;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

// ---------------------------------------------------------------------------
// Prompt — kept here, well-commented, alongside the schema it must satisfy.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the structuring engine for InstaWill, an assisted-drafting service for
DIFC (Dubai International Financial Centre) non-Muslim wills.

Your job: convert a client's intake answers and their free-text distribution
notes into a single strict JSON object describing their DIFC Full Will, by
calling the "emit_structured_will" tool. You do not give legal advice and you do
not invent facts. You normalise and structure what the client provided.

Rules you MUST follow:
- Only cover UAE-situated assets. A DIFC will needs at least one UAE asset.
- Property in Abu Dhabi or any emirate other than Dubai/Ras Al Khaimah must have
  needs_adjd = true (it routes to a separate ADJD will). Dubai/RAK property and
  all non-property assets have needs_adjd = false.
- A beneficiary is a minor if under 21. Minors cannot inherit outright; set
  is_minor = true. Do not fabricate a trust — reflect held_in_trust only if the
  intake says so.
- passport_expired must reflect whether the passport expiry date is in the past
  relative to today.
- distribution_interpreted = true ONLY IF you had to interpret ambiguous or
  free-text distribution intent (e.g. "split evenly", "the rest to my kids")
  rather than copy explicit percentages the client already gave. If the client
  gave explicit clean percentages and you merely copied them, set it to false.
- Preserve each beneficiary's substitution instruction (where their share goes
  if they predecease the testator). If none given, use "to the residuary estate".
- distribution_summary: one plain-English sentence describing who gets what.
- Never change share percentages to "fix" them to 100. Report them as the client
  stated; the rules engine handles the 100% check separately.`;

function buildUserMessage(draft: IntakeDraft, todayISO: string): string {
  return [
    `Today's date is ${todayISO}. Structure the following intake into the will JSON.`,
    ``,
    `IDENTITY:`,
    `- Full name: ${draft.passport.full_name || "(unknown)"}`,
    `- Passport number: ${draft.passport.passport_number || "(unknown)"}`,
    `- Passport expiry: ${draft.passport.passport_expiry || "(unknown)"}`,
    `- Residency: ${draft.residency_status}`,
    draft.residency_status === "resident"
      ? `- Emirates ID number: ${draft.emirates_id.number || "(pending)"}`
      : `- Non-resident (no Emirates ID; remote registration path).`,
    ``,
    `CHILDREN: ${
      draft.children.length
        ? JSON.stringify(draft.children)
        : "none reported"
    }`,
    `GUARDIANS: ${
      draft.guardians.length ? JSON.stringify(draft.guardians) : "none"
    }`,
    ``,
    `ASSETS: ${JSON.stringify(draft.assets)}`,
    ``,
    `BENEFICIARIES (client-entered): ${JSON.stringify(draft.beneficiaries)}`,
    `EXECUTORS: ${JSON.stringify(draft.executors)}`,
    ``,
    `FREE-TEXT DISTRIBUTION NOTES FROM CLIENT:`,
    draft.distribution_notes?.trim()
      ? `"${draft.distribution_notes.trim()}"`
      : "(none — use the explicit beneficiary percentages above)",
    ``,
    `FOREIGN WILL: ${
      draft.has_foreign_will
        ? `yes — ${draft.foreign_will_detail || "(no detail)"}`
        : "no"
    }`,
    ``,
    `Now call emit_structured_will with the structured result.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Real Anthropic call (tool-use forced JSON).
// ---------------------------------------------------------------------------

async function callAnthropic(
  draft: IntakeDraft,
  todayISO: string
): Promise<StructuredWill> {
  const apiKey = process.env.ANTHROPIC_API_KEY as string;

  const body = {
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: "emit_structured_will",
        description:
          "Emit the client's DIFC Full Will as strict structured JSON.",
        input_schema: structuredWillJsonSchema,
      },
    ],
    // Force the tool so the model MUST return schema-shaped JSON.
    tool_choice: { type: "tool", name: "emit_structured_will" },
    messages: [{ role: "user", content: buildUserMessage(draft, todayISO) }],
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
    (b) => b.type === "tool_use" && b.name === "emit_structured_will"
  );
  if (!toolUse || !toolUse.input) {
    throw new Error("Anthropic response contained no tool_use block");
  }
  // Validate before trusting.
  return structuredWillSchema.parse(toolUse.input) as StructuredWill;
}

// ---------------------------------------------------------------------------
// Orchestrator.
// ---------------------------------------------------------------------------

export async function structureWill(
  draft: IntakeDraft,
  now: Date = new Date()
): Promise<StructureResult> {
  const todayISO = now.toISOString().slice(0, 10);

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const structured = await callAnthropic(draft, todayISO);
      return {
        structured,
        ai_structured: structured.distribution_interpreted,
        source: "llm",
        note: structured.distribution_interpreted
          ? "LLM interpreted free-text distribution intent — flagged for lawyer verification."
          : "LLM structured explicit intake; distribution copied verbatim.",
      };
    } catch (err) {
      // Fall through to deterministic path but flag for verification.
      const structured = deterministicStructure(draft, todayISO);
      return {
        structured,
        ai_structured: true,
        source: "fallback",
        note: `LLM call/validation failed (${
          err instanceof Error ? err.message : "unknown"
        }); used deterministic fallback — flagged "AI-structured, verify".`,
      };
    }
  }

  // No key: deterministic path.
  const structured = deterministicStructure(draft, todayISO);
  return {
    structured,
    ai_structured: structured.distribution_interpreted,
    source: "fallback",
    note: "No ANTHROPIC_API_KEY set — used deterministic structurer (offline demo mode).",
  };
}
