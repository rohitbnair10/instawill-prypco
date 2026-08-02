/**
 * Strict JSON schema for the LLM's structured-will output.
 *
 * This is the trust boundary. The LLM's response is parsed against this zod
 * schema BEFORE anything downstream trusts it. On any validation failure the
 * caller marks the will `ai_structured = true` and routes it to the lawyer as
 * "AI-structured — verify" rather than silently using bad data.
 */
import { z } from "zod";

const emirate = z.enum(["dubai", "rak", "abu_dhabi", "other", "n_a"]);
const assetType = z.enum(["property", "bank_account", "business_shares", "other"]);
const residency = z.enum(["resident", "non_resident", "unknown"]);

export const structuredWillSchema = z.object({
  testator: z.object({
    full_name: z.string().min(1),
    passport_number: z.string().min(1),
    passport_expiry: z.string().min(1),
    passport_expired: z.boolean(),
    residency_status: residency,
    emirates_id_number: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
  }),
  declaration_non_muslim: z.boolean(),
  children: z.array(
    z.object({
      name: z.string().min(1),
      under_21: z.boolean(),
      resides_in_dubai_or_rak: z.boolean(),
    })
  ),
  guardians: z.array(
    z.object({
      name: z.string().min(1),
      relationship: z.string(),
      role: z.enum(["guardian", "substitute_guardian"]),
    })
  ),
  assets: z.array(
    z.object({
      asset_type: assetType,
      emirate: emirate,
      needs_adjd: z.boolean(),
      description: z.string(),
    })
  ),
  beneficiaries: z
    .array(
      z.object({
        name: z.string().min(1),
        relationship: z.string(),
        share_pct: z.number().min(0).max(100),
        is_minor: z.boolean(),
        held_in_trust: z.boolean(),
        substitution: z.string(),
      })
    )
    .min(1),
  executors: z
    .array(
      z.object({
        name: z.string().min(1),
        relationship: z.string(),
        role: z.enum(["executor", "substitute_executor"]),
      })
    )
    .min(1),
  has_foreign_will: z.boolean(),
  foreign_will_detail: z.string().nullable().optional(),
  distribution_interpreted: z.boolean(),
  distribution_summary: z.string(),
});

export type StructuredWillParsed = z.infer<typeof structuredWillSchema>;

/**
 * JSON-schema shape passed to the Anthropic tool definition (tool-use forced
 * output). Kept in lockstep with the zod schema above. Anthropic requires a
 * JSON-Schema (draft-like) object for tool input_schema.
 */
export const structuredWillJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "testator",
    "declaration_non_muslim",
    "children",
    "guardians",
    "assets",
    "beneficiaries",
    "executors",
    "has_foreign_will",
    "distribution_interpreted",
    "distribution_summary",
  ],
  properties: {
    testator: {
      type: "object",
      additionalProperties: false,
      required: [
        "full_name",
        "passport_number",
        "passport_expiry",
        "passport_expired",
        "residency_status",
      ],
      properties: {
        full_name: { type: "string" },
        passport_number: { type: "string" },
        passport_expiry: { type: "string", description: "ISO date YYYY-MM-DD" },
        passport_expired: { type: "boolean" },
        residency_status: { type: "string", enum: ["resident", "non_resident", "unknown"] },
        emirates_id_number: { type: ["string", "null"] },
        address: { type: ["string", "null"] },
      },
    },
    declaration_non_muslim: { type: "boolean" },
    children: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "under_21", "resides_in_dubai_or_rak"],
        properties: {
          name: { type: "string" },
          under_21: { type: "boolean" },
          resides_in_dubai_or_rak: { type: "boolean" },
        },
      },
    },
    guardians: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "relationship", "role"],
        properties: {
          name: { type: "string" },
          relationship: { type: "string" },
          role: { type: "string", enum: ["guardian", "substitute_guardian"] },
        },
      },
    },
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["asset_type", "emirate", "needs_adjd", "description"],
        properties: {
          asset_type: {
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
    beneficiaries: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "name",
          "relationship",
          "share_pct",
          "is_minor",
          "held_in_trust",
          "substitution",
        ],
        properties: {
          name: { type: "string" },
          relationship: { type: "string" },
          share_pct: { type: "number", minimum: 0, maximum: 100 },
          is_minor: { type: "boolean", description: "true if beneficiary is under 21" },
          held_in_trust: { type: "boolean" },
          substitution: {
            type: "string",
            description: "where the share goes if this beneficiary predeceases the testator",
          },
        },
      },
    },
    executors: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "relationship", "role"],
        properties: {
          name: { type: "string" },
          relationship: { type: "string" },
          role: { type: "string", enum: ["executor", "substitute_executor"] },
        },
      },
    },
    has_foreign_will: { type: "boolean" },
    foreign_will_detail: { type: ["string", "null"] },
    distribution_interpreted: {
      type: "boolean",
      description:
        "true if you had to interpret/normalise free-text distribution intent rather than copy explicit percentages",
    },
    distribution_summary: {
      type: "string",
      description: "one-sentence plain-English summary of the distribution",
    },
  },
} as const;
