/**
 * Pure, client-safe structurer: turns an IntakeDraft into a StructuredWill with
 * no network and no secrets. Used for the live document preview on the client
 * AND as the deterministic fallback for the server LLM path (src/lib/llm.ts).
 */
import type { IntakeDraft, StructuredWill } from "./types";

export function isExpired(dateISO: string, todayISO: string): boolean {
  if (!dateISO) return false;
  const d = new Date(dateISO);
  const t = new Date(todayISO);
  if (isNaN(d.getTime()) || isNaN(t.getTime())) return false;
  return d.getTime() < t.getTime();
}

function summariseDistribution(
  beneficiaries: Array<{ name: string; share_pct: number }>
): string {
  if (!beneficiaries.length) return "No beneficiaries specified.";
  return beneficiaries.map((b) => `${b.share_pct}% to ${b.name}`).join(", ");
}

export function deterministicStructure(
  draft: IntakeDraft,
  todayISO: string
): StructuredWill {
  const passportExpired = isExpired(draft.passport.passport_expiry, todayISO);

  const assets = draft.assets.map((a) => ({
    asset_type: a.asset_type,
    emirate: a.emirate,
    // Jurisdiction follows the asset: AD / other-emirate property -> ADJD.
    needs_adjd:
      a.asset_type === "property" &&
      (a.emirate === "abu_dhabi" || a.emirate === "other"),
    description: a.description,
  }));

  const beneficiaries = draft.beneficiaries.map((b) => ({
    name: b.name,
    relationship: b.relationship,
    share_pct: b.share_pct,
    is_minor: b.is_minor,
    held_in_trust: b.held_in_trust,
    substitution: b.substitution?.trim() || "to the residuary estate",
  }));

  return {
    testator: {
      full_name: draft.passport.full_name,
      passport_number: draft.passport.passport_number,
      passport_expiry: draft.passport.passport_expiry,
      passport_expired: passportExpired,
      residency_status: draft.residency_status,
      emirates_id_number: draft.emirates_id.number || null,
      address: draft.emirates_id.ocr?.address || null,
    },
    declaration_non_muslim: true,
    children: draft.children,
    guardians: draft.guardians,
    assets,
    beneficiaries,
    executors: draft.executors,
    has_foreign_will: draft.has_foreign_will,
    foreign_will_detail: draft.foreign_will_detail || null,
    distribution_interpreted: Boolean(draft.distribution_notes?.trim()),
    distribution_summary: summariseDistribution(beneficiaries),
  };
}
