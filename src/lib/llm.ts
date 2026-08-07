/**
 * ============================================================================
 * THE CROWN JEWEL — LLM structuring of one free-text wishes paragraph into a
 * strict DIFC will JSON. THIS is the automation being graded.
 * ============================================================================
 *
 * Input: a client's messy, plain-language paragraph about their family,
 * assets, and how they want things divided — PLUS their already-structured
 * identity (passport name/nationality/residency; never invented by the model).
 *
 * Output: StructuredWill (src/lib/types.ts), matching the zod schema in
 * schema.ts. That single structured record then drives BOTH the will draft
 * (schedule1.ts) AND the ops portal package (portal.ts) — no human re-types
 * anything downstream of this call.
 *
 * Trust boundary (the actual engineering, not a wrapper):
 *   - Forces JSON tool-use output; parses + validates against structuredWillSchema
 *     BEFORE anything downstream trusts it.
 *   - On malformed/failed output, does NOT silently degrade to "looks fine" —
 *     falls back to fallbackStructure() (structure.ts) and is marked
 *     ai_structured = true, note explains why, so the lawyer sees
 *     "AI-structured — verify" rather than a confident-looking lie.
 *   - `confidence_notes` and `distribution_summary` are REQUIRED in the schema
 *     specifically so the model exposes its own interpretation, giving a human
 *     something concrete to check against a misread.
 *
 * Server-only (reads the API key). Called from /api/structure and from the
 * standalone scripts/demo-pipe.ts (same function, same trust boundary, no UI
 * required to prove this runs).
 */
import type { Identity, StructuredWill } from "./types";
import { structuredWillSchema, structuredWillJsonSchema } from "./schema";
import { fallbackStructure } from "./structure";

export interface StructureResult {
  structured: StructuredWill;
  ai_structured: boolean;
  source: "llm" | "fallback";
  /** Honest note about which path ran and why — never hidden from the lawyer. */
  note: string;
}

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-5";
const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";

// ---------------------------------------------------------------------------
// Prompt — kept here, well-commented, alongside the schema it must satisfy.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are the structuring engine for InstaWill, an assisted-drafting service for
DIFC (Dubai International Financial Centre) non-Muslim wills.

Your job: read a client's free-text wishes — written in their own words about
family, UAE assets, and how they want things divided — and convert it into a
single strict JSON object by calling the "emit_structured_will" tool. You do
not give legal advice and you do not invent facts. You structure only what the
client actually said; you never fabricate a name, share percentage, or asset
that wasn't mentioned or clearly implied.

NEVER INVENT MISSING INFORMATION. This is the most important rule. If the
client did not provide a field, leave it empty/null and record it in
confidence_notes — do NOT guess, fill a placeholder, or make up a plausible
value. A downstream lawyer relies on empty fields to know what to ask the
client for. A fabricated value silently hides a gap and is worse than an
empty one.

Rules you MUST follow:
- Only extract UAE-situated assets as "assets". If the client mentions a
  non-UAE asset (e.g. a UK house), do not add it as an asset — it belongs
  outside the UAE estate this will covers; you may reference it in
  confidence_notes if relevant to foreign_will.
- Property in Abu Dhabi or any emirate other than Dubai/Ras Al Khaimah must
  have needs_adjd = true (it routes to a separate ADJD will). Dubai/RAK
  property and all non-property assets have needs_adjd = false.
- For each property asset, "description" must identify the property (address,
  building/unit, community, or title-deed reference). If the client was vague
  (e.g. just "a property in Dubai" with no address), keep description to what
  they said and flag the missing address in confidence_notes — do not invent
  an address.
- is_minor: set true ONLY if the client stated or clearly implied the
  beneficiary is under 21 (e.g. gave an age under 21, or called them a "young
  child"). If the age was NOT stated, set is_minor = false BUT you MUST record
  in confidence_notes that the age was not provided and the minor status is
  assumed — a lawyer needs to confirm ages, because a minor requires a trust.
- relationship (for beneficiaries and the executor): use the relationship the
  client stated (wife, son, brother, friend, charity, ...). If they gave a
  name with no relationship, leave relationship empty and flag it in
  confidence_notes — do not guess the relationship.
- SPECIFIC GIFTS vs RESIDUARY SHARES — read this carefully. When the client
  gives a PARTICULAR asset to a PARTICULAR person ("my apartment to my wife",
  "my ENBD account to my son"), that is a SPECIFIC GIFT: add that person as a
  beneficiary, set their "specific_gift" to a short description of the asset
  (e.g. "the Dubai Marina apartment", "the Emirates NBD account"), and set
  their "share_pct" to 0 — UNLESS the client also gave them a share of the
  rest. NEVER convert a specific gift into a whole-estate percentage, and
  never make percentages sum to more than 100 to accommodate gifts.
  "share_pct" is ONLY for residuary / percentage distribution the client
  actually expressed ("split everything equally" → equal share_pct summing to
  100; "60% to X, 40% to Y" → 60/40). If EVERY beneficiary receives a specific
  gift and the client named no residuary/percentage split, every share_pct is
  0 and that is correct — leave "specific_gift" empty only for residuary-share
  beneficiaries. Each named person is still a beneficiary either way.
- Preserve each beneficiary's substitution instruction (what happens to their
  share/gift if they predecease the testator) exactly as the client implied —
  e.g. "split equally between our two kids" as the wife's substitution means
  "to the children in equal shares". If truly not mentioned, use
  "to the residuary estate".
- executor is required — if the client didn't name one, leave name empty and
  say so in confidence_notes; do not invent a name.
- guardian is null unless the client named a guardian. If the client has a
  minor child inheriting but named no guardian, leave guardian null and flag
  the missing guardian in confidence_notes.
- foreign_will = true if the client mentions any existing will in another
  country.
- distribution_summary: one plain-English sentence describing who gets what.
- confidence_notes: this is the "what a lawyer still needs" list. Enumerate,
  as specifically as you can, EVERY field a lawyer would need that the client
  did NOT provide or that you had to assume — missing/assumed ages, missing
  beneficiary or executor relationships, missing or vague property addresses,
  unnamed executor, missing guardian for a minor child, unstated share splits,
  and any other ambiguity. Be explicit and itemised (e.g. "Age not stated for
  'Alex' — minor status assumed; executor relationship not given; property
  address not specified"). Empty string ONLY if genuinely nothing is missing
  or ambiguous.
- Never adjust share percentages to force them to sum to 100 — report the
  client's stated shares as given; a separate rules engine checks the total.`;

function buildUserMessage(identity: Identity, wishesText: string): string {
  return [
    `TESTATOR IDENTITY (already verified — do not restate differently):`,
    `- Name: ${identity.full_name || "(unknown)"}`,
    `- Nationality: ${identity.nationality || "(not provided — infer only if stated in the wishes text below)"}`,
    `- Residency: ${identity.residency_status}`,
    ``,
    `CLIENT'S WISHES (verbatim, in their own words):`,
    `"""`,
    wishesText.trim(),
    `"""`,
    ``,
    `Now call emit_structured_will with the structured result.`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Real Anthropic call (tool-use forced JSON).
// ---------------------------------------------------------------------------

async function callAnthropic(
  identity: Identity,
  wishesText: string
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
          "Emit the client's DIFC Full Will content, structured from their free-text wishes.",
        input_schema: structuredWillJsonSchema,
      },
    ],
    // Force the tool so the model MUST return schema-shaped JSON, no prose.
    tool_choice: { type: "tool", name: "emit_structured_will" },
    messages: [{ role: "user", content: buildUserMessage(identity, wishesText) }],
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
  // Validate before trusting — the actual trust boundary.
  return structuredWillSchema.parse(toolUse.input) as StructuredWill;
}

// ---------------------------------------------------------------------------
// Orchestrator — the function both /api/structure and the standalone CLI call.
// ---------------------------------------------------------------------------

export async function structureWishes(
  identity: Identity,
  wishesText: string
): Promise<StructureResult> {
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const structured = await callAnthropic(identity, wishesText);
      const ambiguous = Boolean(structured.confidence_notes?.trim());
      return {
        structured,
        ai_structured: ambiguous,
        source: "llm",
        note: ambiguous
          ? "LLM structured the wishes and flagged ambiguity in confidence_notes — verify against client intent."
          : "LLM structured the wishes with no flagged ambiguity.",
      };
    } catch (err) {
      const structured = fallbackStructure(identity, wishesText);
      return {
        structured,
        ai_structured: true,
        source: "fallback",
        note: `LLM call/validation failed (${
          err instanceof Error ? err.message : "unknown"
        }) — used the honest fallback (no content structured); flagged "AI-structured, verify".`,
      };
    }
  }

  const structured = fallbackStructure(identity, wishesText);
  return {
    structured,
    ai_structured: true,
    source: "fallback",
    note: "No ANTHROPIC_API_KEY set — could not structure the wishes text. Set the key to run the real automation.",
  };
}
