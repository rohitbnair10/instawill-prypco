/**
 * InstaWill domain types.
 *
 * These mirror the Supabase/Postgres data model in supabase/schema.sql so the
 * localStorage store (src/lib/store.ts) and a future Postgres backend share one
 * shape. Every enum here has a matching Postgres enum. The whole business case
 * rests on timing/state data, so state transitions are always timestamped.
 */

// ---------- shared enums ----------

export type PreferredChannel = "email" | "whatsapp" | "phone";

export type ResidencyStatus = "resident" | "non_resident" | "unknown";

export type LeadStage =
  | "about"
  | "family"
  | "assets"
  | "beneficiaries"
  | "safety"
  | "documents"
  | "review"
  | "submitted"
  | "in_lawyer_review"
  | "approved"
  | "registered"
  | "abandoned";

export type Recoverability = "high" | "medium" | "low";

export type WillType =
  | "full"
  | "property"
  | "financial_assets"
  | "business"
  | "guardianship"
  | "digital";

export type Jurisdiction = "difc" | "adjd";

export type WillStatus =
  | "draft"
  | "content_complete"
  | "documents_pending"
  | "submitted"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "registered"
  | "abandoned";

export type AssetType = "property" | "bank_account" | "business_shares" | "other";

export type Emirate = "dubai" | "rak" | "abu_dhabi" | "other" | "n_a";

export type ExecutorRole =
  | "executor"
  | "substitute_executor"
  | "guardian"
  | "substitute_guardian";

export type DocType =
  | "passport"
  | "emirates_id"
  | "title_deed"
  | "witness_passport"
  | "draft_will_pdf";

export type DocStatus = "pending" | "uploaded" | "validated" | "rejected";

export type MatchResult = "match" | "mismatch" | "needs_review" | "n_a";

/** The severity model used everywhere (intake, rules engine, lawyer desk). */
export type Severity = "block" | "warn" | "info" | "ok";

/** Who can resolve a check: client-fixable, lawyer-judgment, or none. */
export type CheckOwner = "client" | "lawyer" | "none";

export type CheckKey =
  | "shares_sum"
  | "no_uae_asset"
  | "passport_expired"
  | "passport_missing"
  | "minor_no_trust"
  | "adjd_routing"
  | "foreign_will_revocation"
  | "name_mismatch"
  | "deed_joint_owner"
  | "business_shares"
  | "witness_is_beneficiary"
  | "ai_distribution"
  | "guardian_needed"
  | "non_resident_path";

export type UserRole = "lawyer" | "ops_agent" | "admin";

export type ReviewOutcome = "approved" | "changes_requested" | "escalated";

export type CaseComplexity = "standard" | "complex";

export type ReviewItemAction =
  | "confirmed"
  | "verified"
  | "returned_to_client"
  | "doc_received";

export type ReminderType = "automated_email" | "automated_whatsapp" | "agent_call";

export type ReminderOutcome = "sent" | "no_response" | "recovered" | "opted_out";

export type PortalMethod = "manual_ops" | "rpa_v2";

export type PaymentStatus = "pending" | "paid";

export type RegistrationOutcome = "pending" | "registered" | "rejected";

// ---------- table rows ----------

export interface Lead {
  id: string;
  created_at: string;
  updated_at: string;
  full_name: string;
  email: string;
  phone: string;
  preferred_channel: PreferredChannel;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  gclid?: string;
  referrer?: string;
  residency_status: ResidencyStatus;
  current_stage: LeadStage;
  stage_updated_at: string;
  recoverability: Recoverability;
  assigned_agent_id?: string | null;
}

export interface Will {
  id: string;
  lead_id: string;
  created_at: string;
  updated_at: string;
  will_type: WillType;
  jurisdiction: Jurisdiction;
  status: WillStatus;
  structured_json: StructuredWill | null;
  ai_structured: boolean;
  content_complete_at?: string | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  registered_at?: string | null;
}

export interface Beneficiary {
  id: string;
  will_id: string;
  name: string;
  relationship: string;
  share_pct: number;
  is_minor: boolean;
  held_in_trust: boolean;
  substitution: string; // where the share goes if they predecease (e.g. "to their issue")
}

export interface Asset {
  id: string;
  will_id: string;
  asset_type: AssetType;
  emirate: Emirate;
  needs_adjd: boolean;
  description: string;
}

export interface Executor {
  id: string;
  will_id: string;
  role: ExecutorRole;
  name: string;
  relationship: string;
}

export interface WillDocument {
  id: string;
  will_id: string;
  doc_type: DocType;
  status: DocStatus;
  ocr_extracted: Record<string, unknown> | null;
  match_result: MatchResult;
  uploaded_at?: string | null;
  validated_at?: string | null;
}

export interface Check {
  id: string;
  will_id: string;
  check_key: CheckKey;
  severity: Severity;
  owner: CheckOwner;
  detail: string;
  created_at: string;
  resolved_at?: string | null;
  resolved_by?: string | null;
}

export interface ReviewSession {
  id: string;
  will_id: string;
  lawyer_id: string;
  started_at: string;
  ended_at?: string | null;
  duration_seconds?: number | null;
  outcome?: ReviewOutcome | null;
  items_total: number;
  items_cleared: number;
  case_complexity: CaseComplexity;
}

export interface ReviewItem {
  id: string;
  review_session_id: string;
  check_id: string;
  cleared_at: string;
  action: ReviewItemAction;
}

export interface Reminder {
  id: string;
  lead_id: string;
  type: ReminderType;
  triggered_at: string;
  triggered_by: "system" | "agent";
  agent_id?: string | null;
  outcome: ReminderOutcome;
  blocking_reason_snapshot: string;
}

export interface PortalSubmission {
  id: string;
  will_id: string;
  package_json: PortalPackage;
  method: PortalMethod;
  ops_user_id?: string | null;
  submitted_at?: string | null;
  appointment_at?: string | null;
  payment_status: PaymentStatus;
  registration_outcome: RegistrationOutcome;
  rejection_reason?: string | null;
}

export interface StaffUser {
  id: string;
  name: string;
  role: UserRole;
  email: string;
}

export interface EventRow {
  id: string;
  lead_id?: string | null;
  will_id?: string | null;
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}

// ---------- structured will (LLM output — the crown jewel schema) ----------

/**
 * StructuredWill is the strict JSON the LLM must produce from the client's
 * free-text/answer intake. It is validated against a zod schema before it is
 * trusted (src/lib/schema.ts). On malformed output the will is flagged
 * `ai_structured = true` and surfaced to the lawyer as "AI-structured — verify".
 */
export interface StructuredWill {
  testator: {
    full_name: string;
    passport_number: string;
    passport_expiry: string; // ISO date
    passport_expired: boolean;
    residency_status: ResidencyStatus;
    emirates_id_number?: string | null;
    address?: string | null;
  };
  declaration_non_muslim: boolean;
  children: Array<{
    name: string;
    under_21: boolean;
    resides_in_dubai_or_rak: boolean;
  }>;
  guardians: Array<{
    name: string;
    relationship: string;
    role: "guardian" | "substitute_guardian";
  }>;
  assets: Array<{
    asset_type: AssetType;
    emirate: Emirate;
    needs_adjd: boolean;
    description: string;
  }>;
  beneficiaries: Array<{
    name: string;
    relationship: string;
    share_pct: number;
    is_minor: boolean;
    held_in_trust: boolean;
    substitution: string;
  }>;
  executors: Array<{
    name: string;
    relationship: string;
    role: "executor" | "substitute_executor";
  }>;
  has_foreign_will: boolean;
  foreign_will_detail?: string | null;
  /**
   * True when the LLM had to interpret/normalise free-text distribution intent
   * (rather than copy explicit numbers). Drives the lawyer "verify" flag.
   */
  distribution_interpreted: boolean;
  distribution_summary: string;
}

// ---------- portal package (DIFC 10-step handoff) ----------

export interface PortalPackage {
  generated_at: string;
  step_1_service: { will_type: string; jurisdiction: string };
  step_2_personal: Record<string, unknown>;
  step_3_real_estate: Array<Record<string, unknown>>;
  step_4_executor: Array<Record<string, unknown>>;
  step_5_beneficiaries: Array<Record<string, unknown>>;
  step_6_distribution: { summary: string; interpreted: boolean };
  step_7_witnesses: { note: string };
  step_8_documents: Array<Record<string, unknown>>;
  step_9_appointment: { status: "client_to_book"; note: string };
  step_10_payment: { status: "client_to_pay"; note: string };
}

// ---------- intake draft (client-side working state) ----------

/**
 * IntakeDraft is the raw client-side answers as they flow through the 7 steps,
 * before/after LLM structuring. It carries the free-text the LLM structures.
 */
export interface IntakeDraft {
  lead_id: string;
  will_id: string;
  // step 0 — identity
  passport: {
    uploaded: boolean;
    ocr: {
      full_name: string;
      passport_number: string;
      passport_expiry: string;
    } | null;
    full_name: string;
    passport_number: string;
    passport_expiry: string;
  };
  residency_status: ResidencyStatus;
  emirates_id: {
    uploaded: boolean;
    ocr: { full_name: string; address: string } | null;
    number: string;
  };
  // step 1 — family
  has_children_under_21: boolean;
  children: Array<{ name: string; under_21: boolean; resides_in_dubai_or_rak: boolean }>;
  guardians: Array<{ name: string; relationship: string; role: "guardian" | "substitute_guardian" }>;
  // step 2 — assets
  assets: Array<{ asset_type: AssetType; emirate: Emirate; description: string }>;
  // step 3 — beneficiaries & executor
  beneficiaries: Array<{
    name: string;
    relationship: string;
    share_pct: number;
    is_minor: boolean;
    held_in_trust: boolean;
    substitution: string;
  }>;
  executors: Array<{ name: string; relationship: string; role: "executor" | "substitute_executor" }>;
  /** free-text distribution intent that the LLM structures (crown-jewel input) */
  distribution_notes: string;
  // step 4 — safety
  has_foreign_will: boolean;
  foreign_will_detail: string;
  // step 5 — documents
  title_deed: {
    uploaded: boolean;
    ocr: { owner: string; joint_owner: boolean } | null;
  };
}
