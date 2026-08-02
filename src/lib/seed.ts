/**
 * Demo seed data.
 *
 * Populates the store with:
 *  - four curated lawyer cases, each a genuine judgment call a rules engine
 *    can't resolve (Sarah Whitfield, Menon, James Okoro, Elena Voss);
 *  - stalled intakes for the re-engagement desk;
 *  - a little history (approved + registered wills, review sessions) so the
 *    metrics are non-empty and the 90 -> 15 story is visible.
 *
 * Checks are produced by the real rules engine on each structured will — seed
 * data flows through the same trust boundary as live intake.
 */
import { runRules } from "./rules";
import type { DB } from "./store";
import { buildPortalPackage } from "./portal";
import type {
  IntakeDraft,
  Lead,
  StaffUser,
  StructuredWill,
  Will,
} from "./types";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto)
    return crypto.randomUUID();
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
function pastDate(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - years);
  return d.toISOString().slice(0, 10);
}

const LAWYER: StaffUser = {
  id: "user-lawyer-1",
  name: "Layla Haddad",
  role: "lawyer",
  email: "layla@instawill.ae",
};
const AGENT: StaffUser = {
  id: "user-agent-1",
  name: "Omar Farooq",
  role: "ops_agent",
  email: "omar@instawill.ae",
};
const ADMIN: StaffUser = {
  id: "user-admin-1",
  name: "Admin",
  role: "admin",
  email: "admin@instawill.ae",
};

interface SeedCaseInput {
  lead: Partial<Lead> & { full_name: string; email: string };
  structured: StructuredWill;
  passportOcrName: string;
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
    full_name: input.lead.full_name,
    email: input.lead.email,
    phone: input.lead.phone || "+971 50 000 0000",
    preferred_channel: input.lead.preferred_channel || "email",
    residency_status: input.structured.testator.residency_status,
    current_stage: "in_lawyer_review",
    stage_updated_at: ts,
    recoverability: "high",
    assigned_agent_id: null,
    utm_source: input.lead.utm_source,
    utm_medium: input.lead.utm_medium,
    utm_campaign: input.lead.utm_campaign,
  };

  const rules = runRules(input.structured, {
    passport_ocr_name: input.passportOcrName,
    passport_uploaded: true,
    title_deed: input.titleDeed || null,
    ai_structured: input.structured.distribution_interpreted,
  });

  const will: Will = {
    id: willId,
    lead_id: leadId,
    created_at: iso(input.submittedDaysAgo + 2),
    updated_at: ts,
    will_type: "full",
    jurisdiction: "difc",
    status: "in_review",
    structured_json: input.structured,
    ai_structured: input.structured.distribution_interpreted,
    content_complete_at: iso(input.submittedDaysAgo + 1),
    submitted_at: ts,
    approved_at: null,
    registered_at: null,
  };

  d.leads.push(lead);
  d.wills.push(will);

  input.structured.beneficiaries.forEach((b) =>
    d.beneficiaries.push({ id: uid(), will_id: willId, ...b })
  );
  input.structured.assets.forEach((a) =>
    d.assets.push({ id: uid(), will_id: willId, ...a })
  );
  input.structured.executors.forEach((e) =>
    d.executors.push({
      id: uid(),
      will_id: willId,
      role: e.role,
      name: e.name,
      relationship: e.relationship,
    })
  );
  input.structured.guardians.forEach((g) =>
    d.executors.push({
      id: uid(),
      will_id: willId,
      role: g.role,
      name: g.name,
      relationship: g.relationship,
    })
  );
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

  // Documents.
  d.documents.push({
    id: uid(),
    will_id: willId,
    doc_type: "passport",
    status: "validated",
    ocr_extracted: { name: input.passportOcrName },
    match_result:
      input.passportOcrName.toLowerCase() ===
      input.structured.testator.full_name.toLowerCase()
        ? "match"
        : "needs_review",
    uploaded_at: ts,
    validated_at: ts,
  });
  if (input.structured.testator.residency_status === "resident") {
    d.documents.push({
      id: uid(),
      will_id: willId,
      doc_type: "emirates_id",
      status: "validated",
      ocr_extracted: { address: input.structured.testator.address },
      match_result: "match",
      uploaded_at: ts,
      validated_at: ts,
    });
  }
  if (input.structured.assets.some((a) => a.asset_type === "property")) {
    d.documents.push({
      id: uid(),
      will_id: willId,
      doc_type: "title_deed",
      status: input.pendingTitleDeed ? "pending" : "validated",
      ocr_extracted: input.titleDeed
        ? { owner: input.titleDeed.owner, joint: input.titleDeed.joint_owner }
        : null,
      match_result: input.titleDeed?.joint_owner ? "needs_review" : "n_a",
      uploaded_at: input.pendingTitleDeed ? null : ts,
      validated_at: input.pendingTitleDeed ? null : ts,
    });
  }

  d.events.push({
    id: uid(),
    lead_id: leadId,
    will_id: willId,
    event_type: "will_submitted",
    payload: {},
    created_at: ts,
  });
  return { leadId, willId };
}

// ---------- structured wills for the four cases ----------

function sarahWill(): StructuredWill {
  return {
    testator: {
      full_name: "Sarah Anne Whitfield",
      passport_number: "561234789",
      passport_expiry: futureDate(6),
      passport_expired: false,
      residency_status: "resident",
      emirates_id_number: "784-1988-1234567-1",
      address: "Villa 12, Emirates Hills, Dubai",
    },
    declaration_non_muslim: true,
    children: [
      { name: "Thomas Whitfield", under_21: true, resides_in_dubai_or_rak: true },
    ],
    guardians: [
      { name: "Margaret Whitfield", relationship: "sister", role: "guardian" },
    ],
    assets: [
      {
        asset_type: "property",
        emirate: "dubai",
        needs_adjd: false,
        description: "Villa 12, Emirates Hills",
      },
      {
        asset_type: "bank_account",
        emirate: "n_a",
        needs_adjd: false,
        description: "Emirates NBD accounts",
      },
    ],
    beneficiaries: [
      {
        name: "David Whitfield",
        relationship: "husband",
        share_pct: 60,
        is_minor: false,
        held_in_trust: false,
        substitution: "to their issue in equal shares",
      },
      {
        name: "Thomas Whitfield",
        relationship: "son",
        share_pct: 40,
        is_minor: true,
        held_in_trust: false,
        substitution: "to the residuary estate",
      },
    ],
    executors: [
      { name: "David Whitfield", relationship: "husband", role: "executor" },
      {
        name: "Margaret Whitfield",
        relationship: "sister",
        role: "substitute_executor",
      },
    ],
    has_foreign_will: false,
    foreign_will_detail: null,
    distribution_interpreted: true,
    distribution_summary:
      "60% to husband David; 40% to son Thomas (a minor).",
  };
}

function menonWill(): StructuredWill {
  return {
    testator: {
      full_name: "Rajiv Menon",
      passport_number: "P8845213",
      passport_expiry: futureDate(4),
      passport_expired: false,
      residency_status: "resident",
      emirates_id_number: "784-1980-7654321-2",
      address: "Apt 2203, Reem Island, Abu Dhabi",
    },
    declaration_non_muslim: true,
    children: [],
    guardians: [],
    assets: [
      {
        asset_type: "property",
        emirate: "abu_dhabi",
        needs_adjd: true,
        description: "Apartment 2203, Reem Island, Abu Dhabi",
      },
      {
        asset_type: "property",
        emirate: "dubai",
        needs_adjd: false,
        description: "Studio, JLT, Dubai",
      },
    ],
    beneficiaries: [
      {
        name: "Priya Menon",
        relationship: "wife",
        share_pct: 100,
        is_minor: false,
        held_in_trust: false,
        substitution: "to their nieces and nephews equally",
      },
    ],
    executors: [
      { name: "Priya Menon", relationship: "wife", role: "executor" },
    ],
    has_foreign_will: false,
    foreign_will_detail: null,
    distribution_interpreted: false,
    distribution_summary: "Entire UAE estate to wife Priya (mirror will).",
  };
}

function okoroWill(): StructuredWill {
  return {
    testator: {
      full_name: "James Okoro",
      passport_number: "A04471182",
      passport_expiry: futureDate(3),
      passport_expired: false,
      residency_status: "resident",
      emirates_id_number: "784-1975-2223334-5",
      address: "Downtown Views, Dubai",
    },
    declaration_non_muslim: true,
    children: [],
    guardians: [],
    assets: [
      {
        asset_type: "business_shares",
        emirate: "n_a",
        needs_adjd: false,
        description: "35% shareholding in Okoro Trading DMCC (free zone)",
      },
      {
        asset_type: "property",
        emirate: "dubai",
        needs_adjd: false,
        description: "Apartment, Downtown Views",
      },
    ],
    beneficiaries: [
      {
        name: "Grace Okoro",
        relationship: "wife",
        share_pct: 50,
        is_minor: false,
        held_in_trust: false,
        substitution: "to their children equally",
      },
      {
        name: "Daniel Okoro",
        relationship: "brother",
        share_pct: 50,
        is_minor: false,
        held_in_trust: false,
        substitution: "to the residuary estate",
      },
    ],
    executors: [
      { name: "Grace Okoro", relationship: "wife", role: "executor" },
    ],
    has_foreign_will: true,
    foreign_will_detail: "Existing UK will covering English property",
    distribution_interpreted: false,
    distribution_summary: "50% to wife Grace, 50% to brother Daniel.",
  };
}

function vossWill(): StructuredWill {
  return {
    testator: {
      full_name: "Elena Voss",
      passport_number: "C0179923",
      passport_expiry: futureDate(5),
      passport_expired: false,
      residency_status: "non_resident",
      emirates_id_number: null,
      address: null,
    },
    declaration_non_muslim: true,
    children: [],
    guardians: [],
    assets: [
      {
        asset_type: "property",
        emirate: "dubai",
        needs_adjd: false,
        description: "Penthouse, Palm Jumeirah",
      },
    ],
    beneficiaries: [
      {
        name: "Marco Bianchi",
        relationship: "partner (unmarried)",
        share_pct: 100,
        is_minor: false,
        held_in_trust: false,
        substitution: "to the Voss Family Foundation",
      },
    ],
    executors: [
      { name: "Marco Bianchi", relationship: "partner", role: "executor" },
    ],
    has_foreign_will: false,
    foreign_will_detail: null,
    distribution_interpreted: true,
    distribution_summary:
      "Entire estate to unmarried partner Marco; estranged spouse deliberately excluded — confirm intent, capacity, undue influence.",
  };
}

// ---------- stalled intakes for the ops desk ----------

interface StalledInput {
  full_name: string;
  email: string;
  phone: string;
  channel: "email" | "whatsapp" | "phone";
  stage: Lead["current_stage"];
  daysStuck: number;
  recoverability: "high" | "medium" | "low";
  utm_source?: string;
  configureDraft: (draft: IntakeDraft) => void;
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
    residency_status: "unknown",
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
    structured_json: null,
    ai_structured: false,
    content_complete_at: null,
    submitted_at: null,
    approved_at: null,
    registered_at: null,
  };
  const draft: IntakeDraft = {
    lead_id: leadId,
    will_id: willId,
    passport: {
      uploaded: false,
      ocr: null,
      full_name: input.full_name,
      passport_number: "",
      passport_expiry: "",
    },
    residency_status: "unknown",
    emirates_id: { uploaded: false, ocr: null, number: "" },
    has_children_under_21: false,
    children: [],
    guardians: [],
    assets: [],
    beneficiaries: [],
    executors: [],
    distribution_notes: "",
    has_foreign_will: false,
    foreign_will_detail: "",
    title_deed: { uploaded: false, ocr: null },
  };
  input.configureDraft(draft);

  d.leads.push(lead);
  d.wills.push(will);
  d.drafts.push(draft);
  if (input.configureWill) input.configureWill(d, willId);
  d.events.push({
    id: uid(),
    lead_id: leadId,
    will_id: willId,
    event_type: "intake_started",
    payload: {},
    created_at: created,
  });
}

// ---------- history so metrics are non-empty ----------

function addHistoricalRegistered(
  d: DB,
  name: string,
  complexity: "standard" | "complex",
  durationSeconds: number,
  daysAgo: number
) {
  const leadId = uid();
  const willId = uid();
  const structured = menonWill();
  structured.testator.full_name = name;
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
    jurisdiction: "difc",
    status: "registered",
    structured_json: structured,
    ai_structured: false,
    content_complete_at: iso(daysAgo + 4),
    submitted_at: iso(daysAgo + 3),
    approved_at: iso(daysAgo + 2),
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
    duration_seconds: durationSeconds,
    outcome: "approved",
    items_total: complexity === "complex" ? 4 : 1,
    items_cleared: complexity === "complex" ? 4 : 1,
    case_complexity: complexity,
  });
  const pkg = buildPortalPackage(will, structured);
  d.portal_submissions.push({
    id: uid(),
    will_id: willId,
    package_json: pkg,
    method: "manual_ops",
    ops_user_id: AGENT.id,
    submitted_at: iso(daysAgo + 1),
    appointment_at: iso(daysAgo),
    payment_status: "paid",
    registration_outcome: "registered",
    rejection_reason: null,
  });
}

// ---------- entry point ----------

export function seedDatabase(d: DB) {
  d.users.push(LAWYER, AGENT, ADMIN);

  // Four lawyer cases.
  addLawyerCase(d, {
    lead: {
      full_name: "Sarah Whitfield",
      email: "sarah.whitfield@example.com",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "difc-wills",
    },
    structured: sarahWill(),
    passportOcrName: "Sarah A. Whitfield",
    pendingTitleDeed: true,
    submittedDaysAgo: 1,
  });
  addLawyerCase(d, {
    lead: {
      full_name: "Rajiv Menon",
      email: "rajiv.menon@example.com",
      utm_source: "referral",
    },
    structured: menonWill(),
    passportOcrName: "Rajiv Menon",
    titleDeed: { uploaded: true, owner: "Rajiv Menon", joint_owner: false },
    submittedDaysAgo: 2,
  });
  addLawyerCase(d, {
    lead: {
      full_name: "James Okoro",
      email: "james.okoro@example.com",
      utm_source: "linkedin",
    },
    structured: okoroWill(),
    passportOcrName: "James Okoro",
    titleDeed: { uploaded: true, owner: "James Okoro", joint_owner: false },
    submittedDaysAgo: 3,
  });
  addLawyerCase(d, {
    lead: {
      full_name: "Elena Voss",
      email: "elena.voss@example.com",
      utm_source: "google",
      utm_medium: "cpc",
    },
    structured: vossWill(),
    passportOcrName: "Elena Voss",
    titleDeed: { uploaded: true, owner: "Elena Voss", joint_owner: true },
    submittedDaysAgo: 2,
  });

  // Stalled intakes (re-engagement desk).
  addStalledLead(d, {
    full_name: "Ahmed Rahman",
    email: "ahmed.rahman@example.com",
    phone: "+971 55 234 5678",
    channel: "whatsapp",
    stage: "documents",
    daysStuck: 4,
    recoverability: "high",
    utm_source: "google",
    configureDraft: (draft) => {
      draft.passport.uploaded = true;
      draft.passport.passport_number = "R2231987";
      draft.passport.passport_expiry = futureDate(5);
      draft.residency_status = "resident";
      draft.assets = [
        { asset_type: "property", emirate: "dubai", description: "Marina apartment" },
      ];
      draft.beneficiaries = [
        {
          name: "Nadia Rahman",
          relationship: "wife",
          share_pct: 100,
          is_minor: false,
          held_in_trust: false,
          substitution: "to children",
        },
      ];
      draft.executors = [
        { name: "Nadia Rahman", relationship: "wife", role: "executor" },
      ];
    },
    configureWill: (dd, willId) => {
      const will = dd.wills.find((w) => w.id === willId)!;
      will.status = "content_complete";
      will.content_complete_at = iso(4);
      dd.documents.push({
        id: uid(),
        will_id: willId,
        doc_type: "title_deed",
        status: "pending",
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
    stage: "beneficiaries",
    daysStuck: 9,
    recoverability: "medium",
    utm_source: "instagram",
    configureDraft: (draft) => {
      draft.passport.uploaded = true;
      draft.passport.passport_number = "B7781234";
      draft.passport.passport_expiry = futureDate(7);
      draft.residency_status = "resident";
      draft.assets = [
        { asset_type: "bank_account", emirate: "n_a", description: "HSBC UAE" },
      ];
      // Left mid-distribution — shares only 60%.
      draft.beneficiaries = [
        {
          name: "Oliver Bennett",
          relationship: "brother",
          share_pct: 60,
          is_minor: false,
          held_in_trust: false,
          substitution: "",
        },
      ];
    },
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
    stage: "assets",
    daysStuck: 16,
    recoverability: "low",
    utm_source: "google",
    configureDraft: (draft) => {
      draft.passport.uploaded = true;
      draft.passport.passport_number = "PV3312";
      draft.passport.passport_expiry = futureDate(2);
      draft.residency_status = "non_resident";
      draft.assets = [
        { asset_type: "property", emirate: "abu_dhabi", description: "Saadiyat villa" },
      ];
    },
    configureWill: (dd, willId) => {
      dd.checks.push({
        id: uid(),
        will_id: willId,
        check_key: "adjd_routing",
        severity: "warn",
        owner: "lawyer",
        detail:
          "Property outside Dubai/RAK detected. Routes to a separate ADJD will.",
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
    stage: "about",
    daysStuck: 25,
    recoverability: "low",
    utm_source: "referral",
    configureDraft: () => {
      /* barely started */
    },
  });

  // History for metrics: two standard (fast) + one complex (slow), registered.
  addHistoricalRegistered(d, "Priya Anand", "standard", 14 * 60, 3);
  addHistoricalRegistered(d, "Tom Fisher", "standard", 17 * 60, 8);
  addHistoricalRegistered(d, "Hassan Ali", "complex", 82 * 60, 12);
}
