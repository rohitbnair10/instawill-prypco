/**
 * Strict JSON schemas for document OCR extraction — one per doc type. Mirrors
 * the pattern in schema.ts: the model's output must match these shapes before
 * anything downstream trusts it.
 */
import { z } from "zod";

export const passportExtractSchema = z.object({
  full_name: z.string().min(1),
  passport_number: z.string().min(1),
  passport_expiry: z.string().min(1), // ISO date YYYY-MM-DD
  nationality: z.string().nullable().optional(),
  legible: z.boolean(),
});
export type PassportExtract = z.infer<typeof passportExtractSchema>;

export const emiratesIdExtractSchema = z.object({
  full_name: z.string().min(1),
  id_number: z.string().min(1),
  address: z.string().nullable().optional(),
  expiry: z.string().nullable().optional(),
  legible: z.boolean(),
});
export type EmiratesIdExtract = z.infer<typeof emiratesIdExtractSchema>;

export const titleDeedExtractSchema = z.object({
  owner_name: z.string().min(1),
  joint_owner: z.boolean(),
  other_owner_name: z.string().nullable().optional(),
  property_description: z.string(),
  legible: z.boolean(),
});
export type TitleDeedExtract = z.infer<typeof titleDeedExtractSchema>;

export type OcrDocType = "passport" | "emirates_id" | "title_deed";

export const OCR_TOOL_DEF: Record<
  OcrDocType,
  { name: string; description: string; input_schema: Record<string, unknown> }
> = {
  passport: {
    name: "emit_passport_fields",
    description: "Emit the extracted fields from a passport photo page.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["full_name", "passport_number", "passport_expiry", "legible"],
      properties: {
        full_name: { type: "string", description: "Full name exactly as printed" },
        passport_number: { type: "string" },
        passport_expiry: { type: "string", description: "ISO date YYYY-MM-DD" },
        nationality: { type: ["string", "null"] },
        legible: {
          type: "boolean",
          description: "false if the image is too blurry/dark/cropped to read reliably",
        },
      },
    },
  },
  emirates_id: {
    name: "emit_emirates_id_fields",
    description: "Emit the extracted fields from an Emirates ID card.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["full_name", "id_number", "legible"],
      properties: {
        full_name: { type: "string" },
        id_number: { type: "string", description: "784-YYYY-NNNNNNN-N format" },
        address: { type: ["string", "null"] },
        expiry: { type: ["string", "null"], description: "ISO date if visible" },
        legible: { type: "boolean" },
      },
    },
  },
  title_deed: {
    name: "emit_title_deed_fields",
    description: "Emit the extracted fields from a UAE property title deed.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["owner_name", "joint_owner", "property_description", "legible"],
      properties: {
        owner_name: { type: "string", description: "Primary registered owner name" },
        joint_owner: {
          type: "boolean",
          description: "true if more than one owner is listed on the deed",
        },
        other_owner_name: { type: ["string", "null"] },
        property_description: { type: "string" },
        legible: { type: "boolean" },
      },
    },
  },
};

export function schemaFor(docType: OcrDocType) {
  if (docType === "passport") return passportExtractSchema;
  if (docType === "emirates_id") return emiratesIdExtractSchema;
  return titleDeedExtractSchema;
}
