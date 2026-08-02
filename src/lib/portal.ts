/**
 * DIFC Courts portal handoff — maps the already-validated data to the 10-step
 * portal form. Steps 1–8 are data InstaWill already holds; steps 9–10
 * (appointment + payment) stay with the client. This is the second
 * bottleneck, deliberately deferred: today Ops pastes from here; v2 auto-fills
 * the portal via RPA.
 *
 * Two outputs from the same structured data:
 *   - buildPortalPackage()      -> structured object (JSON download)
 *   - buildPortalPackageText()  -> the human-readable copy-paste block ops
 *     actually reads and pastes field-by-field. NEVER raw JSON.
 */
import type {
  DocType,
  Identity,
  PortalPackage,
  StructuredWill,
  Will,
  WillDocument,
} from "./types";

export function buildPortalPackage(
  will: Will,
  structured: StructuredWill,
  identity: Identity,
  documents: WillDocument[]
): PortalPackage {
  const needsAdjd = structured.assets.some((a) => a.needs_adjd);
  const total = structured.beneficiaries.reduce((s, b) => s + (b.share_pct || 0), 0);

  return {
    generated_at: new Date().toISOString(),
    client_name: identity.full_name || structured.testator.name,
    jurisdiction_label: needsAdjd ? "DIFC + ADJD" : "DIFC",
    step_1_service: {
      will_type: will.will_type,
      jurisdiction: needsAdjd ? "difc + adjd split (adjd routed separately)" : "difc",
    },
    step_2_personal: {
      full_name: identity.full_name,
      nationality: structured.testator.nationality || identity.nationality,
      passport_number: identity.passport_number,
      emirates_id_number:
        identity.residency_status === "resident"
          ? identity.emirates_id_number ?? null
          : "Non-resident — N/A",
      residency_status: identity.residency_status,
      address: identity.emirates_id_address ?? null,
      email: identity.email ?? null,
      phone: identity.phone ?? null,
    },
    step_3_real_estate: structured.assets
      .filter((a) => a.type === "property")
      .map((a) => ({
        emirate: a.emirate,
        description: a.description,
        routes_to_adjd: a.needs_adjd,
      })),
    step_4_executor: {
      name: structured.executor.name,
      relationship: structured.executor.relationship,
      substitute: structured.substitute_executor,
    },
    step_5_beneficiaries: structured.beneficiaries.map((b) => ({
      name: b.name,
      relationship: b.relationship,
      share_pct: b.share_pct,
      is_minor: b.is_minor,
      held_in_trust: b.held_in_trust,
      substitution: b.substitution,
    })),
    step_6_distribution: {
      summary: structured.distribution_summary,
      sums_to_100: Math.round(total * 100) / 100 === 100,
    },
    step_7_witnesses: {
      note: "Two witnesses required at registration; neither may be a beneficiary.",
    },
    step_8_documents: documents
      .filter((d) => d.doc_type !== "witness_passport")
      .map((d) => ({
        doc_type: d.doc_type,
        status: d.status,
        file_url: d.file_url ?? null,
      })),
    step_9_appointment: {
      status: "client_to_book",
      note: will.appointment_at
        ? `Appointment already booked by the client for ${new Date(will.appointment_at).toLocaleString()} — confirm the DIFC WPR slot.`
        : "Client books the DIFC WPR appointment (stays with the client).",
    },
    step_10_payment: {
      status: "client_to_pay",
      note:
        will.payment_status === "paid"
          ? "Registration fee already paid by the client up front — no collection needed."
          : "Client pays the DIFC registration fee (stays with the client).",
    },
  };
}

const DOC_LABEL: Record<DocType, string> = {
  passport: "Passport",
  emirates_id: "Emirates ID",
  title_deed: "Title deed",
  witness_passport: "Witness passport",
  draft_will_pdf: "Draft will PDF",
};

function docLine(d: { doc_type: DocType; status: string; file_url?: string | null }): string {
  const icon = d.status === "validated" ? "✓" : d.status === "rejected" ? "✗" : "⧗";
  const label = DOC_LABEL[d.doc_type].padEnd(16, " ");
  const link = d.file_url ? d.file_url : "(not yet uploaded)";
  return `  ${icon} ${label} ${link}`;
}

/**
 * The human-readable, copy-paste block ops actually reads — grouped by the
 * DIFC portal's 10 steps, formatted so someone can read down it and paste
 * field-by-field into the government portal. Never raw JSON.
 */
export function buildPortalPackageText(
  will: Will,
  structured: StructuredWill,
  identity: Identity,
  documents: WillDocument[]
): string {
  const pkg = buildPortalPackage(will, structured, identity, documents);
  const rule = "═".repeat(42);
  const thin = "─".repeat(42);
  const lines: string[] = [];

  lines.push(rule);
  lines.push(`DIFC PORTAL SUBMISSION PACKAGE — ${pkg.client_name}`);
  lines.push(
    `Generated ${new Date(pkg.generated_at).toISOString().slice(0, 10)} · Full Will · ${pkg.jurisdiction_label}`
  );
  lines.push(rule);
  lines.push("");

  lines.push("STEP 1 · SERVICE SELECTION");
  lines.push(`  Will type:            ${pkg.step_1_service.will_type === "full" ? "Full Will" : pkg.step_1_service.will_type}`);
  lines.push("");

  lines.push("STEP 2 · PERSONAL INFORMATION");
  const p2 = pkg.step_2_personal as Record<string, unknown>;
  lines.push(`  Full name:            ${p2.full_name || "—"}`);
  lines.push(`  Nationality:          ${p2.nationality || "—"}`);
  lines.push(`  Passport number:      ${p2.passport_number || "—"}`);
  lines.push(`  Emirates ID:          ${p2.emirates_id_number || "Non-resident — N/A"}`);
  lines.push(`  Residency status:     ${cap(String(p2.residency_status || ""))}`);
  lines.push(`  Address:              ${p2.address || "(pending — see documents)"}`);
  lines.push(`  Email / phone:        ${p2.email || "—"} / ${p2.phone || "—"}`);
  lines.push("");

  lines.push("STEP 3 · REAL ESTATE");
  if (pkg.step_3_real_estate.length === 0) {
    lines.push("  (no real property named — movables only)");
  } else {
    pkg.step_3_real_estate.forEach((r) => {
      const rr = r as Record<string, unknown>;
      lines.push(`  Property:             ${rr.description || "—"}`);
      lines.push(`  Emirate:              ${cap(String(rr.emirate || ""))}`);
      if (rr.routes_to_adjd) {
        lines.push("  ⚠ Abu Dhabi / other-emirate property → route to ADJD (separate will)");
      }
    });
  }
  lines.push("");

  lines.push("STEP 4 · EXECUTOR");
  const ex = pkg.step_4_executor as Record<string, unknown>;
  lines.push(`  Name:                 ${ex.name || "—"}`);
  lines.push(`  Relationship:         ${ex.relationship || "—"}`);
  const sub = ex.substitute as { name: string; relationship: string } | null;
  if (sub?.name) lines.push(`  Substitute:           ${sub.name} (${sub.relationship})`);
  lines.push("");

  lines.push("STEP 5 · BENEFICIARIES");
  pkg.step_5_beneficiaries.forEach((b, i) => {
    const bb = b as Record<string, unknown>;
    const flags = [
      bb.is_minor ? (bb.held_in_trust ? "minor — in trust" : "minor — ⚠ NO TRUST") : null,
    ].filter(Boolean);
    lines.push(
      `  ${i + 1}. ${String(bb.name).padEnd(20, " ")} ${String(bb.relationship).padEnd(10, " ")} ${bb.share_pct}%${
        flags.length ? "   (" + flags.join(", ") + ")" : ""
      }`
    );
    if (bb.substitution) lines.push(`     ↳ if predeceased: ${bb.substitution}`);
  });
  lines.push("");

  lines.push("STEP 6 · DISTRIBUTION");
  lines.push(`  ${pkg.step_6_distribution.summary}`);
  lines.push(`  By shares of estate · sums to 100% ${pkg.step_6_distribution.sums_to_100 ? "✓" : "✗"}`);
  lines.push("");

  lines.push("STEP 7 · WITNESSES");
  lines.push(`  ${pkg.step_7_witnesses.note}`);
  lines.push("");

  lines.push("STEP 8 · DOCUMENT UPLOADS  (links ready to attach)");
  if (pkg.step_8_documents.length === 0) {
    lines.push("  (none required for this case)");
  } else {
    pkg.step_8_documents.forEach((d) => lines.push(docLine(d)));
  }
  lines.push("");

  lines.push(`STEP 9 · APPOINTMENT     → ${pkg.step_9_appointment.note}`);
  lines.push(`STEP 10 · PAYMENT        → ${pkg.step_10_payment.note}`);
  lines.push("");
  lines.push(rule);
  lines.push(thin);
  lines.push("Ops pastes from here — no re-keying. v2 auto-fills the portal via RPA.");

  return lines.join("\n");
}

function cap(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ");
}
