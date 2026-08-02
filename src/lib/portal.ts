/**
 * DIFC Courts portal handoff — maps the already-validated data to the 10-step
 * portal form. Steps 1–8 are data InstaWill already holds; steps 9–10
 * (appointment + payment) stay with the client. This is the second bottleneck,
 * deliberately deferred: today Ops pastes from here; v2 auto-fills the portal.
 */
import type { PortalPackage, StructuredWill, Will } from "./types";

export function buildPortalPackage(
  will: Will,
  structured: StructuredWill
): PortalPackage {
  return {
    generated_at: new Date().toISOString(),
    step_1_service: {
      will_type: will.will_type,
      jurisdiction: structured.assets.some((a) => a.needs_adjd)
        ? "difc + adjd split (adjd routed separately)"
        : "difc",
    },
    step_2_personal: {
      full_name: structured.testator.full_name,
      passport_number: structured.testator.passport_number,
      passport_expiry: structured.testator.passport_expiry,
      residency_status: structured.testator.residency_status,
      emirates_id_number: structured.testator.emirates_id_number ?? null,
      address: structured.testator.address ?? null,
    },
    step_3_real_estate: structured.assets
      .filter((a) => a.asset_type === "property")
      .map((a) => ({
        emirate: a.emirate,
        description: a.description,
        routes_to_adjd: a.needs_adjd,
      })),
    step_4_executor: structured.executors.map((e) => ({
      role: e.role,
      name: e.name,
      relationship: e.relationship,
    })),
    step_5_beneficiaries: structured.beneficiaries.map((b) => ({
      name: b.name,
      relationship: b.relationship,
      share_pct: b.share_pct,
      is_minor: b.is_minor,
      held_in_trust: b.held_in_trust,
    })),
    step_6_distribution: {
      summary: structured.distribution_summary,
      interpreted: structured.distribution_interpreted,
    },
    step_7_witnesses: {
      note: "Two witnesses required at registration; neither may be a beneficiary.",
    },
    step_8_documents: [
      { doc_type: "passport", status: "held" },
      structured.testator.residency_status === "resident"
        ? { doc_type: "emirates_id", status: "held/pending" }
        : { doc_type: "remote_registration", status: "video path" },
      ...(structured.assets.some((a) => a.asset_type === "property")
        ? [{ doc_type: "title_deed", status: "held/pending" }]
        : []),
    ],
    step_9_appointment: {
      status: "client_to_book",
      note: "Client books the DIFC WPR appointment (stays with the client).",
    },
    step_10_payment: {
      status: "client_to_pay",
      note: "Client pays the DIFC registration fee (stays with the client).",
    },
  };
}
