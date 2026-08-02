/**
 * Strict JSON schema for the LLM's structured-will output — v2.
 *
 * This is the trust boundary. The LLM's response is parsed against this zod
 * schema BEFORE anything downstream trusts it. On any validation failure the
 * caller marks the will `ai_structured = true` and routes it to the lawyer as
 * "AI-structured — verify" rather than silently using bad data.
 *
 * Identity (passport/Emirates ID facts) is deliberately NOT part of this
 * schema — it's collected as structured, rules-driven fields (src/lib/types.ts
 * `Identity`) and never invented by the model. Only the free-text wishes are
 * structured here.
 */
import { z } from "zod";

const emirate = z.enum(["dubai", "rak", "abu_dhabi", "other", "n_a"]);
const assetType = z.enum(["property", "bank_account", "business_shares", "other"]);
const residency = z.enum(["resident", "non_resident", "unknown"]);

// name is intentionally NOT min(1): the system prompt explicitly tells the
// model to leave executor.name empty (never invent one) when the client's
// wishes text didn't name an executor — requiring non-empty here would reject
// that correct, honest response and wrongly trigger the fallback path.
const personRef = z.object({
  name: z.string(),
  relationship: z.string(),
});

export const structuredWillSchema = z.object({
  testator: z.object({
    name: z.string().min(1),
    nationality: z.string(),
    residency: residency,
  }),
  beneficiaries: z
    .array(
      z.object({
        name: z.string().min(1),
        relationship: z.string(),
        share_pct: z.number().min(0).max(100),
        is_minor: z.boolean(),
        substitution: z.string(),
        // Not part of the model's required output — the lawyer sets this.
        // Defaulted to false if the model omits it.
        held_in_trust: z.boolean().default(false),
      })
    )
    .min(1),
  executor: personRef,
  substitute_executor: personRef.nullable(),
  guardian: personRef.nullable(),
  // App-level extension beyond the strict LLM schema — optional, may be null.
  substitute_guardian: personRef.nullable().optional(),
  assets: z.array(
    z.object({
      type: assetType,
      emirate: emirate,
      needs_adjd: z.boolean().default(false),
      description: z.string(),
    })
  ),
  foreign_will: z.boolean(),
  distribution_summary: z.string(),
  confidence_notes: z.string(),
});

export type StructuredWillParsed = z.infer<typeof structuredWillSchema>;

/**
 * JSON-Schema shape passed to the Anthropic tool definition (tool-use forced
 * output). Kept in lockstep with the zod schema above.
 */
export const structuredWillJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "testator",
    "beneficiaries",
    "executor",
    "substitute_executor",
    "guardian",
    "assets",
    "foreign_will",
    "distribution_summary",
    "confidence_notes",
  ],
  properties: {
    testator: {
      type: "object",
      additionalProperties: false,
      required: ["name", "nationality", "residency"],
      properties: {
        name: { type: "string" },
        nationality: { type: "string" },
        residency: { type: "string", enum: ["resident", "non_resident", "unknown"] },
      },
    },
    beneficiaries: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "relationship", "share_pct", "is_minor", "substitution"],
        properties: {
          name: { type: "string" },
          relationship: { type: "string" },
          share_pct: { type: "number", minimum: 0, maximum: 100 },
          is_minor: { type: "boolean", description: "true if beneficiary is under 21" },
          substitution: {
            type: "string",
            description: "where the share goes if this beneficiary predeceases the testator",
          },
        },
      },
    },
    executor: {
      type: "object",
      additionalProperties: false,
      required: ["name", "relationship"],
      properties: { name: { type: "string" }, relationship: { type: "string" } },
    },
    substitute_executor: {
      type: ["object", "null"],
      additionalProperties: false,
      properties: { name: { type: "string" }, relationship: { type: "string" } },
    },
    guardian: {
      type: ["object", "null"],
      description: "null if no children under 21",
      additionalProperties: false,
      properties: { name: { type: "string" }, relationship: { type: "string" } },
    },
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "emirate", "description"],
        properties: {
          type: {
            type: "string",
            enum: ["property", "bank_account", "business_shares", "other"],
          },
          emirate: {
            type: "string",
            enum: ["dubai", "rak", "abu_dhabi", "other", "n_a"],
          },
          needs_adjd: {
            type: "boolean",
            description: "true when property is in abu_dhabi or other emirate (routes to ADJD)",
          },
          description: { type: "string" },
        },
      },
    },
    foreign_will: {
      type: "boolean",
      description: "true if the client mentioned an existing will in another country",
    },
    distribution_summary: {
      type: "string",
      description: "one-sentence plain-language restatement of the client's intent",
    },
    confidence_notes: {
      type: "string",
      description: "anything ambiguous the model had to guess or interpret — empty string if none",
    },
  },
} as const;
