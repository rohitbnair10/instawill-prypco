/**
 * Demo seed data — v2.
 *
 * Populates the store with:
 *  - four curated lawyer cases, FRESH and unresolved, so a live session can
 *    walk through the ordered-clearing gate interactively (Sarah Whitfield,
 *    Menon, Okoro, Voss — each a genuine judgment call a rules engine can't
 *    resolve on its own);
 *  - one case already lawyer-approved WITH an edit applied, sitting in
 *    `pending_client_approval`, so the client final-approval diff screen has
 *    something real to show without requiring manual setup first;
 *  - stalled intakes for the re-engagement desk (v2 shape: one free-text
 *    wishes field, not a multi-step wizard);
 *  - a little registered-will history so north-star/turnaround metrics are
 *    non-empty.
 *
 * Checks are produced by the real rules engine on each structured will — seed
 * data flows through the same trust boundary as live intake.
 */
import { runRules } from "./rules";
import type { DB } from "./store";
import { buildPortalPackage, buildPortalPackageText } from "./portal";
import type {
  Identity,
  Lead,
  StaffUser,
  StructuredWill,
  Will,
} from "./types";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function iso(daysAgo = 0): string {
  return new Date(Date.now() - daysAgo * 86400000).toISOString();
}
function futureDate(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}
function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

const LAWYER: StaffUser = { id: "user-lawyer-1", name: "Layla Haddad", role: "lawyer", email: "layla@instawill.ae" };
const AGENT: StaffUser = { id: "user-agent-1", name: "Omar Farooq", role: "ops_agent", email: "omar@instawill.ae" };
const ADMIN: StaffUser = { id: "user-admin-1", name: "Admin", role: "admin", email: "admin@instawill.ae" };

// ---------------------------------------------------------------------------
// Helper: add a fresh, unresolved lawyer-queue case (in_review).
// ---------------------------------------------------------------------------

interface SeedCaseInput {
  full_name: string;
  email: string;
  identity: Identity;
  wishesText: string;
  structured: StructuredWill;
  titleDeed?: { uploaded: boolean; owner?: string; joint_owner?: boolean };
  pendingTitleDeed?: boolean;
  submittedDaysAgo: number;
}

function addLawyerCase(d: DB, input: SeedCaseInput) {
  const leadId = uid();
  const willId = uid();
  const ts = iso(input.submittedDaysAgo);

  const lead: Lead = {
    id: leadId,
    created_at: iso(input.submittedDaysAgo + 2),
    updated_at: ts,
    full_name: input.full_name,
    email: input.email,
    phone: "+971 50 000 0000",
    preferred_channel: "email",
    residency_status: input.identity.residency_status,
    current_stage: "in_lawyer_review",
    stage_updated_at: ts,
    recoverability: "high",
    assigned_agent_id: null,
  };

  const rules = runRules(input.structured, {
    identity: input.identity,
    title_deed: input.titleDeed || null,
    ai_structured: true,
  });

  const will: Will = {
    id: willId,
    lead_id: leadId,
    created_at: iso(input.submittedDaysAgo + 2),
    updated_at: ts,
    will_type: "full",
    jurisdiction: input.structured.assets.some((a) => a.needs_adjd) ? "adjd" : "difc",
    status: "in_review",
    identity: input.identity,
    structured_json: input.structured,
    structured_json_pre_lawyer: clone(input.structured),
    raw_input_text: input.wishesText,
    ai_structured: true,
    ai_confidence_notes: input.structured.confidence_notes,
    lawyer_made_changes: false,
    content_complete_at: iso(input.submittedDaysAgo + 1),
    submitted_at: ts,
  };

  d.leads.push(lead);
  d.wills.push(will);

  input.structured.beneficiaries.forEach((b) => d.beneficiaries.push({ id: uid(), will_id: willId, ...b }));
  input.structured.assets.forEach((a) =>
    d.assets.push({ id: uid(), will_id: willId, asset_type: a.type, emirate: a.emirate, needs_adjd: a.needs_adjd, description: a.description })
  );
  if (input.structured.executor.name) d.executors.push({ id: uid(), will_id: willId, role: "executor", ...input.structured.executor });
  if (input.structured.substitute_executor)
    d.executors.push({ id: uid(), will_id: willId, role: "substitute_executor", ...input.structured.substitute_executor });
  if (input.structured.guardian) d.executors.push({ id: uid(), will_id: willId, role: "guardian", ...input.structured.guardian });
  if (input.structured.substitute_guardian)
    d.executors.push({ id: uid(), will_id: willId, role: "substitute_guardian", ...input.structured.substitute_guardian });

  rules.forEach((r) =>
    d.checks.push({
      id: uid(),
      will_id: willId,
      check_key: r.check_key,
      severity: r.severity,
      owner: r.owner,
      detail: r.detail,
      created_at: ts,
      resolved_at: null,
      resolved_by: null,
    })
  );

  d.documents.push({
    id: uid(),
    will_id: willId,
    doc_type: "passport",
    status: "validated",
    file_url: null,
    ocr_extracted: { name: input.identity.full_name },
    match_result: "n_a",
    uploaded_at: ts,
    validated_at: ts,
  });
  if (input.identity.residency_status === "resident") {
    d.documents.push({
      id: uid(),
      will_id: willId,
      doc_type: "emirates_id",
      status: "validated",
      file_url: null,
      ocr_extracted: { address: input.identity.emirates_id_address },
      match_result: "match",
      uploaded_at: ts,
      validated_at: ts,
    });
  }
  if (input.structured.assets.some((a) => a.type === "property")) {
    d.documents.push({
      id: uid(),
      will_id: willId,
      doc_type: "title_deed",
      status: input.pendingTitleDeed ? "pending" : "validated",
      file_url: null,
      ocr_extracted: input.titleDeed ? { owner_name: input.titleDeed.owner, joint_owner: input.titleDeed.joint_owner } : null,
      match_result: input.titleDeed?.joint_owner ? "needs_review" : "n_a",
      uploaded_at: input.pendingTitleDeed ? null : ts,
      validated_at: input.pendingTitleDeed ? null : ts,
    });
  }

  d.events.push({ id: uid(), lead_id: leadId, will_id: willId, event_type: "will_submitted", payload: {}, created_at: ts });
  return { leadId, willId };
}

// ---------------------------------------------------------------------------
// Four curated cases
// ---------------------------------------------------------------------------

function sarahCase(): SeedCaseInput {
  const identity: Identity = {
    full_name: "Sarah A. Whitfield", // passport reads abbreviated middle name
    passport_number: "561234789",
    passport_expiry: futureDate(6),
    passport_expired: false,
    nationality: "British",
    residency_status: "resident",
    emirates_id_number: "784-1988-1234567-1",
    emirates_id_address: "Villa 12, Emirates Hills, Dubai",
  };
  const structured: StructuredWill = {
    testator: { name: "Sarah Anne Whitfield", nationality: "British", residency: "resident" },
    beneficiaries: [
      { name: "David Whitfield", relationship: "husband", share_pct: 60, is_minor: false, substitution: "to their issue in equal shares", held_in_trust: false },
      { name: "Thomas Whitfield", relationship: "son", share_pct: 40, is_minor: true, substitution: "to the residuary estate", held_in_trust: false },
    ],
    executor: { name: "David Whitfield", relationship: "husband" },
    substitute_executor: null,
    guardian: { name: "Margaret Whitfield", relationship: "sister" },
    substitute_guardian: null,
    assets: [
      { type: "property", emirate: "dubai", needs_adjd: false, description: "Villa 12, Emirates Hills" },
      { type: "bank_account", emirate: "n_a", needs_adjd: false, description: "Emirates NBD savings" },
    ],
    foreign_will: false,
    distribution_summary: "60% to husband David; 40% to son Thomas (a minor) — if David predeceases, Thomas's share passes to the residuary estate.",
    confidence_notes: "Assumed 'our son Thomas' is the only child; no other children mentioned.",
  };
  return {
    full_name: "Sarah Whitfield",
    email: "sarah.whitfield@example.com",
    identity,
    wishesText:
      "My husband David and I live in Villa 12, Emirates Hills, Dubai. I want 60% of everything to go to David, and the remaining 40% to our son Thomas, who's 9 — if David isn't around, Thomas's share should just go to the rest of my estate. David should be my executor. My sister Margaret should be Thomas's guardian if anything happens to both of us. We own our villa and have savings with Emirates NBD.",
    structured,
    pendingTitleDeed: true,
    submittedDaysAgo: 1,
  };
}

function menonCase(): SeedCaseInput {
  const identity: Identity = {
    full_name: "Rajiv Menon",
    passport_number: "P8845213",
    passport_expiry: futureDate(4),
    passport_expired: false,
    nationality: "Indian",
    residency_status: "resident",
    emirates_id_number: "784-1980-7654321-2",
    emirates_id_address: "Apt 2203, Reem Island, Abu Dhabi",
  };
  const structured: StructuredWill = {
    testator: { name: "Rajiv Menon", nationality: "Indian", residency: "resident" },
    beneficiaries: [
      { name: "Priya Menon", relationship: "wife", share_pct: 100, is_minor: false, substitution: "to their nieces and nephews equally", held_in_trust: false },
    ],
    executor: { name: "Priya Menon", relationship: "wife" },
    substitute_executor: null,
    guardian: null,
    substitute_guardian: null,
    assets: [
      { type: "property", emirate: "abu_dhabi", needs_adjd: true, description: "Apartment 2203, Reem Island, Abu Dhabi" },
      { type: "property", emirate: "dubai", needs_adjd: false, description: "Studio, JLT, Dubai" },
    ],
    foreign_will: false,
    distribution_summary: "Entire UAE estate to wife Priya; this mirrors Priya's own will naming Rajiv.",
    confidence_notes: "Client mentioned this is a mirror arrangement with his wife's own will — flagging for consistency check, not a data conflict.",
  };
  return {
    full_name: "Rajiv Menon",
    email: "rajiv.menon@example.com",
    identity,
    wishesText:
      "My wife Priya and I want mirror wills. Everything goes to her — our apartment in Reem Island, Abu Dhabi, and our studio in JLT, Dubai. If anything happens to both of us, split between our nieces and nephews equally. Priya is my executor.",
    structured,
    titleDeed: { uploaded: true, owner: "Rajiv Menon", joint_owner: false },
    submittedDaysAgo: 2,
  };
}

function okoroCase(): SeedCaseInput {
  const identity: Identity = {
    full_name: "James Okoro",
    passport_number: "A04471182",
    passport_expiry: futureDate(3),
    passport_expired: false,
    nationality: "Nigerian",
    residency_status: "resident",
    emirates_id_number: "784-1975-2223334-5",
    emirates_id_address: "Downtown Views, Dubai",
  };
  const structured: StructuredWill = {
    testator: { name: "James Okoro", nationality: "Nigerian", residency: "resident" },
    beneficiaries: [
      { name: "Grace Okoro", relationship: "wife", share_pct: 50, is_minor: false, substitution: "to their children equally", held_in_trust: false },
      { name: "Daniel Okoro", relationship: "brother", share_pct: 50, is_minor: false, substitution: "to the residuary estate", held_in_trust: false },
    ],
    executor: { name: "Grace Okoro", relationship: "wife" },
    substitute_executor: null,
    guardian: null,
    substitute_guardian: null,
    assets: [
      { type: "business_shares", emirate: "n_a", needs_adjd: false, description: "35% shareholding in Okoro Trading DMCC (free zone)" },
      { type: "property", emirate: "dubai", needs_adjd: false, description: "Apartment, Downtown Views" },
    ],
    foreign_will: true,
    distribution_summary: "50% to wife Grace, 50% to brother Daniel.",
    confidence_notes: "Client mentioned an existing UK will — flagged for revocation-clause scoping. Also has DMCC free-zone business shares; shareholder agreement may restrict transfer.",
  };
  return {
    full_name: "James Okoro",
    email: "james.okoro@example.com",
    identity,
    wishesText:
      "I'm splitting things 50/50 between my wife Grace and my brother Daniel. I have a 35% stake in my company, Okoro Trading, which is DMCC free zone. We also have an apartment in Downtown Views. Grace is my executor. I should mention I already have a will in the UK from before I moved here.",
    structured,
    titleDeed: { uploaded: true, owner: "James Okoro", joint_owner: false },
    submittedDaysAgo: 3,
  };
}

function vossCase(): SeedCaseInput {
  const identity: Identity = {
    full_name: "Elena Voss",
    passport_number: "C0179923",
    passport_expiry: futureDate(5),
    passport_expired: false,
    nationality: "German",
    residency_status: "non_resident",
    emirates_id_number: null,
    emirates_id_address: null,
  };
  const structured: StructuredWill = {
    testator: { name: "Elena Voss", nationality: "German", residency: "non_resident" },
    beneficiaries: [
      { name: "Marco Bianchi", relationship: "partner (unmarried)", share_pct: 100, is_minor: false, substitution: "to the Voss Family Foundation", held_in_trust: false },
    ],
    executor: { name: "Marco Bianchi", relationship: "partner" },
    substitute_executor: null,
    guardian: null,
    substitute_guardian: null,
    assets: [{ type: "property", emirate: "dubai", needs_adjd: false, description: "Penthouse, Palm Jumeirah" }],
    foreign_will: false,
    distribution_summary: "Entire estate to unmarried partner Marco; the client was explicit that her estranged spouse should receive nothing.",
    confidence_notes: "Client explicitly excluded her estranged spouse and named her unmarried partner as sole beneficiary — confirm testamentary capacity and freedom from undue influence given the family dynamic described.",
  };
  return {
    full_name: "Elena Voss",
    email: "elena.voss@example.com",
    identity,
    wishesText:
      "I want everything to go to my partner Marco — we're not married but have been together for 8 years. I am legally still married to my estranged husband but we've been separated for 6 years and he gets nothing. Our penthouse on Palm Jumeirah is the main asset. If Marco isn't around, it should go to the Voss Family Foundation. Marco is my executor. I don't live in the UAE full-time.",
    structured,
    titleDeed: { uploaded: true, owner: "Elena Voss", joint_owner: true },
    submittedDaysAgo: 2,
  };
}

// ---------------------------------------------------------------------------
// One case already lawyer-approved WITH an edit, pending client approval —
// gives the Client tab's final-approval diff screen something real to show.
// ---------------------------------------------------------------------------

function addPendingClientApprovalCase(d: DB) {
  const leadId = uid();
  const willId = uid();
  const ts = iso(1);

  const identity: Identity = {
    full_name: "Michael Grant",
    passport_number: "M7712340",
    passport_expiry: futureDate(4),
    passport_expired: false,
    nationality: "Irish",
    residency_status: "resident",
    emirates_id_number: "784-1979-9988776-3",
    emirates_id_address: "Arabian Ranches, Dubai",
  };
  const preLawyer: StructuredWill = {
    testator: { name: "Michael Grant", nationality: "Irish", residency: "resident" },
    beneficiaries: [
      { name: "Claire Grant", relationship: "wife", share_pct: 60, is_minor: false, substitution: "to their children equally", held_in_trust: false },
      { name: "Ella Grant", relationship: "daughter", share_pct: 40, is_minor: true, substitution: "to the residuary estate", held_in_trust: false },
    ],
    executor: { name: "Claire Grant", relationship: "wife" },
    substitute_executor: null,
    guardian: { name: "Peter Grant", relationship: "brother" },
    substitute_guardian: null,
    assets: [{ type: "property", emirate: "dubai", needs_adjd: false, description: "Villa, Arabian Ranches" }],
    foreign_will: false,
    distribution_summary: "60% to wife Claire, 40% to daughter Ella (a minor).",
    confidence_notes: "",
  };
  const postLawyer: StructuredWill = {
    ...clone(preLawyer),
    beneficiaries: [
      preLawyer.beneficiaries[0],
      { ...preLawyer.beneficiaries[1], held_in_trust: true },
    ],
  };

  const lead: Lead = {
    id: leadId,
    created_at: iso(3),
    updated_at: ts,
    full_name: "Michael Grant",
    email: "michael.grant@example.com",
    phone: "+971 50 222 3344",
    preferred_channel: "email",
    residency_status: "resident",
    current_stage: "pending_client_approval",
    stage_updated_at: ts,
    recoverability: "high",
    assigned_agent_id: null,
  };
  const will: Will = {
    id: willId,
    lead_id: leadId,
    created_at: iso(3),
    updated_at: ts,
    will_type: "full",
    jurisdiction: "difc",
    status: "pending_client_approval",
    identity,
    structured_json: postLawyer,
    structured_json_pre_lawyer: preLawyer,
    raw_input_text:
      "My wife Claire and I live in Arabian Ranches, Dubai. 60% to Claire, 40% to our daughter Ella, who's 7. Claire is my executor. My brother Peter should be Ella's guardian if needed.",
    ai_structured: false,
    ai_confidence_notes: "",
    lawyer_made_changes: true,
    content_complete_at: iso(3),
    submitted_at: iso(2),
    lawyer_approved_at: ts,
  };

  d.leads.push(lead);
  d.wills.push(will);
  postLawyer.beneficiaries.forEach((b) => d.beneficiaries.push({ id: uid(), will_id: willId, ...b }));
  postLawyer.assets.forEach((a) =>
    d.assets.push({ id: uid(), will_id: willId, asset_type: a.type, emirate: a.emirate, needs_adjd: a.needs_adjd, description: a.description })
  );
  d.executors.push({ id: uid(), will_id: willId, role: "executor", ...postLawyer.executor });
  if (postLawyer.guardian) d.executors.push({ id: uid(), will_id: willId, role: "guardian", ...postLawyer.guardian });

  // The minor_no_trust check is now resolved (the lawyer's edit fixed it).
  const rules = runRules(postLawyer, { identity, title_deed: { uploaded: true, owner: "Michael Grant", joint_owner: false }, ai_structured: false });
  rules.forEach((r) =>
    d.checks.push({
      id: uid(),
      will_id: willId,
      check_key: r.check_key,
      severity: r.severity,
      owner: r.owner,
      detail: r.detail,
      created_at: iso(2),
      resolved_at: r.severity === "ok" ? null : iso(1),
      resolved_by: r.severity === "warn" ? LAWYER.id : null,
    })
  );

  d.review_sessions.push({
    id: uid(),
    will_id: willId,
    lawyer_id: LAWYER.id,
    started_at: iso(2),
    ended_at: ts,
    active_seconds: 11 * 60,
    clarification_wait_seconds: 0,
    paused_at: null,
    outcome: "approved",
    items_total: 1,
    items_cleared: 1,
    case_complexity: "standard",
  });

  d.events.push(
    { id: uid(), lead_id: leadId, will_id: willId, event_type: "will_submitted", payload: {}, created_at: iso(2) },
    { id: uid(), lead_id: leadId, will_id: willId, event_type: "lawyer_approved", payload: { lawyer_made_changes: true }, created_at: ts },
    { id: uid(), lead_id: leadId, will_id: willId, event_type: "sent_for_client_approval", payload: {}, created_at: ts }
  );
}

// ---------------------------------------------------------------------------
// Stalled intakes for the ops desk (v2: one free-text wishes field)
// ---------------------------------------------------------------------------

interface StalledInput {
  full_name: string;
  email: string;
  phone: string;
  channel: "email" | "whatsapp" | "phone";
  stage: Lead["current_stage"];
  daysStuck: number;
  recoverability: "high" | "medium" | "low";
  utm_source?: string;
  wishesText?: string;
  passportUploaded?: boolean;
  residency?: Identity["residency_status"];
  configureWill?: (d: DB, willId: string) => void;
}

function addStalledLead(d: DB, input: StalledInput) {
  const leadId = uid();
  const willId = uid();
  const created = iso(input.daysStuck + 1);
  const stuck = iso(input.daysStuck);

  const lead: Lead = {
    id: leadId,
    created_at: created,
    updated_at: stuck,
    full_name: input.full_name,
    email: input.email,
    phone: input.phone,
    preferred_channel: input.channel,
    residency_status: input.residency ?? "unknown",
    current_stage: input.stage,
    stage_updated_at: stuck,
    recoverability: input.recoverability,
    assigned_agent_id: null,
    utm_source: input.utm_source,
  };
  const will: Will = {
    id: willId,
    lead_id: leadId,
    created_at: created,
    updated_at: stuck,
    will_type: "full",
    jurisdiction: "difc",
    status: "draft",
    identity: null,
    structured_json: null,
    structured_json_pre_lawyer: null,
    raw_input_text: input.wishesText ?? "",
    ai_structured: false,
    ai_confidence_notes: "",
    lawyer_made_changes: false,
  };
  const draft = {
    lead_id: leadId,
    will_id: willId,
    passport: {
      uploaded: Boolean(input.passportUploaded),
      ocr: null,
      full_name: input.full_name,
      passport_number: input.passportUploaded ? "P" + Math.floor(Math.random() * 9000000 + 1000000) : "",
      passport_expiry: input.passportUploaded ? futureDate(5) : "",
      nationality: "",
    },
    residency_status: input.residency ?? "unknown",
    emirates_id: { uploaded: false, ocr: null, number: "" },
    wishes_text: input.wishesText ?? "",
    title_deed: { uploaded: false, ocr: null },
  };

  d.leads.push(lead);
  d.wills.push(will);
  d.drafts.push(draft);
  if (input.configureWill) input.configureWill(d, willId);
  d.events.push({ id: uid(), lead_id: leadId, will_id: willId, event_type: "intake_started", payload: {}, created_at: created });
}

// ---------------------------------------------------------------------------
// History so metrics are non-empty
// ---------------------------------------------------------------------------

function addHistoricalRegistered(
  d: DB,
  name: string,
  complexity: "standard" | "complex",
  durationSeconds: number,
  daysAgo: number
) {
  const leadId = uid();
  const willId = uid();
  const identity: Identity = {
    full_name: name,
    passport_number: "H" + Math.floor(Math.random() * 9000000 + 1000000),
    passport_expiry: futureDate(4),
    passport_expired: false,
    nationality: "British",
    residency_status: "resident",
    emirates_id_number: "784-1982-1112223-4",
    emirates_id_address: null,
  };
  const structured: StructuredWill = {
    testator: { name, nationality: "British", residency: "resident" },
    beneficiaries: [{ name: "Spouse", relationship: "spouse", share_pct: 100, is_minor: false, substitution: "to their children equally", held_in_trust: false }],
    executor: { name: "Spouse", relationship: "spouse" },
    substitute_executor: null,
    guardian: null,
    substitute_guardian: null,
    assets:
      complexity === "complex"
        ? [{ type: "property", emirate: "abu_dhabi", needs_adjd: true, description: "Abu Dhabi property" }]
        : [{ type: "property", emirate: "dubai", needs_adjd: false, description: "Dubai apartment" }],
    foreign_will: false,
    distribution_summary: "Entire UAE estate to spouse.",
    confidence_notes: "",
  };

  const lead: Lead = {
    id: leadId,
    created_at: iso(daysAgo + 5),
    updated_at: iso(daysAgo),
    full_name: name,
    email: `${name.split(" ")[0].toLowerCase()}@example.com`,
    phone: "+971 50 111 2222",
    preferred_channel: "email",
    residency_status: "resident",
    current_stage: "registered",
    stage_updated_at: iso(daysAgo),
    recoverability: "high",
    assigned_agent_id: null,
  };
  const will: Will = {
    id: willId,
    lead_id: leadId,
    created_at: iso(daysAgo + 5),
    updated_at: iso(daysAgo),
    will_type: "full",
    jurisdiction: complexity === "complex" ? "adjd" : "difc",
    status: "registered",
    identity,
    structured_json: structured,
    structured_json_pre_lawyer: clone(structured),
    raw_input_text: "Everything to my spouse.",
    ai_structured: false,
    ai_confidence_notes: "",
    lawyer_made_changes: false,
    content_complete_at: iso(daysAgo + 4),
    submitted_at: iso(daysAgo + 3),
    lawyer_approved_at: iso(daysAgo + 2),
    client_approved_at: iso(daysAgo + 2),
    portal_ready_at: iso(daysAgo + 1),
    registered_at: iso(daysAgo),
  };
  d.leads.push(lead);
  d.wills.push(will);
  d.review_sessions.push({
    id: uid(),
    will_id: willId,
    lawyer_id: LAWYER.id,
    started_at: iso(daysAgo + 2),
    ended_at: iso(daysAgo + 2),
    active_seconds: durationSeconds,
    clarification_wait_seconds: 0,
    paused_at: null,
    outcome: "approved",
    items_total: complexity === "complex" ? 3 : 1,
    items_cleared: complexity === "complex" ? 3 : 1,
    case_complexity: complexity,
  });
  const documents = d.documents.filter((doc) => doc.will_id === willId);
  const packageJson = buildPortalPackage(will, structured, identity, documents);
  const packageText = buildPortalPackageText(will, structured, identity, documents);
  d.portal_submissions.push({
    id: uid(),
    will_id: willId,
    package_json: packageJson,
    package_text: packageText,
    method: "manual_ops",
    ops_user_id: AGENT.id,
    submitted_at: iso(daysAgo + 1),
    appointment_at: iso(daysAgo),
    payment_status: "paid",
    registration_outcome: "registered",
    rejection_reason: null,
  });
}

// ---------------------------------------------------------------------------
// Clarifications (§1B-ter) demo scenarios
// ---------------------------------------------------------------------------

/** Attaches an ANSWERED (not yet resolved) clarification to an existing case's
 * check — so opening the Lawyer desk immediately shows a "Client responded"
 * blurb once that item unlocks, without requiring manual setup first. */
function addAnsweredClarification(
  d: DB,
  willId: string,
  checkKey: string,
  question: string,
  responseText: string
) {
  const check = d.checks.find((c) => c.will_id === willId && c.check_key === checkKey);
  if (!check) return;
  const sentAt = iso(1);
  const answeredAt = iso(0.5);
  d.clarifications.push({
    id: uid(),
    will_id: willId,
    check_id: check.id,
    raised_by: LAWYER.id,
    mode: "question",
    question,
    doc_type: null,
    message_preview: `Hi — quick one from your InstaWill lawyer: ${question}`,
    message_final: `Hi — quick one from your InstaWill lawyer: ${question}`,
    channel: "email",
    status: "answered",
    response_text: responseText,
    response_file_path: null,
    sent_at: sentAt,
    answered_at: answeredAt,
    resolved_at: null,
    ops_followed_up: false,
  });
  d.events.push(
    { id: uid(), will_id: willId, lead_id: null, event_type: "clarification_raised", payload: { check_key: checkKey }, created_at: sentAt },
    { id: uid(), will_id: willId, lead_id: null, event_type: "clarification_answered", payload: { check_key: checkKey }, created_at: answeredAt }
  );
}

/** A case currently `awaiting_client` with one OPEN clarification — populates
 * the lawyer's "awaiting client" queue section, the ops read-only tab, and
 * the client's "your lawyer has a question" picker, all on first load. */
function addAwaitingClarificationCase(d: DB) {
  const leadId = uid();
  const willId = uid();
  const sentAt = iso(0.25); // ~6 hours ago

  const identity: Identity = {
    full_name: "Fatima Hassan",
    passport_number: "F5523190",
    passport_expiry: futureDate(4),
    passport_expired: false,
    nationality: "Jordanian",
    residency_status: "resident",
    emirates_id_number: "784-1983-4455667-8",
    emirates_id_address: "Jumeirah Village Circle, Dubai",
  };
  const structured: StructuredWill = {
    testator: { name: "Fatima Hassan", nationality: "Jordanian", residency: "resident" },
    beneficiaries: [
      { name: "Yousef Hassan", relationship: "husband", share_pct: 100, is_minor: false, substitution: "to their children equally", held_in_trust: false },
    ],
    executor: { name: "Yousef Hassan", relationship: "husband" },
    substitute_executor: null,
    guardian: null,
    substitute_guardian: null,
    assets: [{ type: "property", emirate: "dubai", needs_adjd: false, description: "Apartment, JVC, Dubai" }],
    foreign_will: false,
    distribution_summary: "Entire UAE estate to husband Yousef.",
    confidence_notes: "",
  };

  const lead: Lead = {
    id: leadId,
    created_at: iso(3),
    updated_at: sentAt,
    full_name: "Fatima Hassan",
    email: "fatima.hassan@example.com",
    phone: "+971 50 777 8899",
    preferred_channel: "whatsapp",
    residency_status: "resident",
    current_stage: "awaiting_client",
    stage_updated_at: sentAt,
    recoverability: "high",
    assigned_agent_id: null,
  };
  const will: Will = {
    id: willId,
    lead_id: leadId,
    created_at: iso(3),
    updated_at: sentAt,
    will_type: "full",
    jurisdiction: "difc",
    status: "awaiting_client",
    identity,
    structured_json: structured,
    structured_json_pre_lawyer: clone(structured),
    raw_input_text: "Everything to my husband Yousef. We own an apartment in JVC together.",
    ai_structured: false,
    ai_confidence_notes: "",
    lawyer_made_changes: false,
    content_complete_at: iso(2),
    submitted_at: iso(2),
  };

  d.leads.push(lead);
  d.wills.push(will);
  structured.beneficiaries.forEach((b) => d.beneficiaries.push({ id: uid(), will_id: willId, ...b }));
  structured.assets.forEach((a) =>
    d.assets.push({ id: uid(), will_id: willId, asset_type: a.type, emirate: a.emirate, needs_adjd: a.needs_adjd, description: a.description })
  );
  d.executors.push({ id: uid(), will_id: willId, role: "executor", ...structured.executor });

  const rules = runRules(structured, {
    identity,
    title_deed: { uploaded: true, owner: "Fatima Hassan", joint_owner: true },
    ai_structured: false,
  });
  rules.forEach((r) =>
    d.checks.push({
      id: uid(),
      will_id: willId,
      check_key: r.check_key,
      severity: r.severity,
      owner: r.owner,
      detail: r.detail,
      created_at: iso(2),
      resolved_at: null,
      resolved_by: null,
    })
  );
  const jointOwnerCheck = d.checks.find((c) => c.will_id === willId && c.check_key === "deed_joint_owner");

  const question = "Your title deed shows joint ownership — can you confirm the exact split (e.g. 50/50) so we can scope the gift correctly?";
  d.clarifications.push({
    id: uid(),
    will_id: willId,
    check_id: jointOwnerCheck?.id ?? null,
    raised_by: LAWYER.id,
    mode: "question",
    question,
    doc_type: null,
    message_preview: `Hi Fatima — quick one from your InstaWill lawyer: ${question}`,
    message_final: `Hi Fatima — quick one from your InstaWill lawyer: ${question}`,
    channel: "whatsapp",
    status: "sent",
    response_text: null,
    response_file_path: null,
    sent_at: sentAt,
    answered_at: null,
    resolved_at: null,
    ops_followed_up: false,
  });

  d.review_sessions.push({
    id: uid(),
    will_id: willId,
    lawyer_id: LAWYER.id,
    started_at: iso(2),
    ended_at: null,
    active_seconds: null,
    clarification_wait_seconds: 0,
    paused_at: sentAt,
    outcome: "raised_clarification",
    items_total: rules.filter((r) => r.severity === "warn").length,
    items_cleared: 0,
    case_complexity: "standard",
  });

  d.events.push(
    { id: uid(), lead_id: leadId, will_id: willId, event_type: "will_submitted", payload: {}, created_at: iso(2) },
    { id: uid(), lead_id: leadId, will_id: willId, event_type: "review_started", payload: { lawyer_id: LAWYER.id }, created_at: iso(2) },
    { id: uid(), lead_id: leadId, will_id: willId, event_type: "clarification_raised", payload: {}, created_at: sentAt }
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function seedDatabase(d: DB) {
  d.users.push(LAWYER, AGENT, ADMIN);

  const sarah = addLawyerCase(d, sarahCase());
  addAnsweredClarification(
    d,
    sarah.willId,
    "name_mismatch",
    "Your passport reads 'Sarah A. Whitfield' but the will names 'Sarah Anne Whitfield' — can you confirm 'Anne' is your full middle name?",
    "Yes, that's me — Anne is my middle name, I just abbreviated it on the passport renewal form."
  );
  addLawyerCase(d, menonCase());
  addLawyerCase(d, okoroCase());
  addLawyerCase(d, vossCase());
  addPendingClientApprovalCase(d);
  addAwaitingClarificationCase(d);

  addStalledLead(d, {
    full_name: "Ahmed Rahman",
    email: "ahmed.rahman@example.com",
    phone: "+971 55 234 5678",
    channel: "whatsapp",
    stage: "documents",
    daysStuck: 4,
    recoverability: "high",
    utm_source: "google",
    passportUploaded: true,
    residency: "resident",
    wishesText: "Everything to my wife Nadia. We have a Marina apartment.",
    configureWill: (dd, willId) => {
      const will = dd.wills.find((w) => w.id === willId)!;
      will.status = "content_complete";
      will.content_complete_at = iso(4);
      dd.documents.push({
        id: uid(),
        will_id: willId,
        doc_type: "title_deed",
        status: "pending",
        file_url: null,
        ocr_extracted: null,
        match_result: "n_a",
        uploaded_at: null,
        validated_at: null,
      });
    },
  });

  addStalledLead(d, {
    full_name: "Chloe Bennett",
    email: "chloe.bennett@example.com",
    phone: "+971 52 987 6543",
    channel: "email",
    stage: "confirm",
    daysStuck: 9,
    recoverability: "medium",
    utm_source: "instagram",
    passportUploaded: true,
    residency: "resident",
    wishesText: "Some to my brother Oliver, haven't decided the rest yet.",
    configureWill: (dd, willId) => {
      dd.checks.push({
        id: uid(),
        will_id: willId,
        check_key: "shares_sum",
        severity: "block",
        owner: "client",
        detail: "Beneficiary shares total 60% (must equal 100%).",
        created_at: iso(9),
        resolved_at: null,
        resolved_by: null,
      });
    },
  });

  addStalledLead(d, {
    full_name: "Viktor Petrov",
    email: "viktor.petrov@example.com",
    phone: "+971 50 456 7890",
    channel: "phone",
    stage: "confirm",
    daysStuck: 16,
    recoverability: "low",
    utm_source: "google",
    passportUploaded: true,
    residency: "non_resident",
    wishesText: "My villa in Saadiyat, Abu Dhabi should go to my kids.",
    configureWill: (dd, willId) => {
      dd.checks.push({
        id: uid(),
        will_id: willId,
        check_key: "adjd_routing",
        severity: "warn",
        owner: "lawyer",
        detail: "Property outside Dubai/RAK detected. Routes to a separate ADJD will.",
        created_at: iso(16),
        resolved_at: null,
        resolved_by: null,
      });
    },
  });

  addStalledLead(d, {
    full_name: "Grace Lin",
    email: "grace.lin@example.com",
    phone: "+971 56 111 2233",
    channel: "email",
    stage: "identity",
    daysStuck: 25,
    recoverability: "low",
    utm_source: "referral",
  });

  addHistoricalRegistered(d, "Priya Anand", "standard", 14 * 60, 3);
  addHistoricalRegistered(d, "Tom Fisher", "standard", 17 * 60, 8);
  addHistoricalRegistered(d, "Hassan Ali", "complex", 82 * 60, 12);
}
