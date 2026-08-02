/**
 * InstaWill domain types — v2 (automation-first).
 *
 * Key v2 shift from the original wizard prototype: intake is now IDENTITY
 * (structured, rules-driven, safety-critical) + ONE free-text WISHES field
 * (the LLM's job). `Identity` therefore lives separately from `StructuredWill`
 * — passport/Emirates ID facts are never invented by the model; only the
 * free-text wishes are structured by it.
 *
 * These mirror the Supabase/Postgres data model in supabase/schema.sql so the
 * localStorage store (src/lib/store.ts) and a future Postgres backend share
 * one shape. Every state transition is timestamped because the timing data is
 * the whole business case.
 */

// ---------- shared enums ----------

export type PreferredChannel = "email" | "whatsapp" | "phone";

export type ResidencyStatus = "resident" | "non_resident" | "unknown";

/**
 * v2 funnel: identity -> wishes -> confirm -> documents -> review -> submitted
 * -> in_lawyer_review -> lawyer_approved -> pending_client_approval ->
 * client_approved -> portal_ready -> registered (or abandoned at any point
 * before submission).
 *
 * `awaiting_client` is a detour, not forward progress: the lawyer raised a
 * clarification (§1B-ter) mid-review and the case is paused on the client's
 * response. It always returns to `in_lawyer_review` once answered — it is
 * NOT the same as `changes_requested` (a targeted one-item question/re-upload
 * vs. a heavier "redo part of intake").
 */
export type LeadStage =
  | "identity"
  | "wishes"
  | "confirm"
  | "documents"
  | "review"
  | "submitted"
  | "in_lawyer_review"
  | "awaiting_client"
  | "lawyer_approved"
  | "pending_client_approval"
  | "client_approved"
  | "portal_ready"
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
  | "awaiting_client"
  | "changes_requested"
  | "lawyer_approved"
  | "pending_client_approval"
  | "client_approved"
  | "portal_ready"
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
  | "executor_missing"
  | "executor_relationship_missing"
  | "beneficiary_incomplete"
  | "beneficiary_relationship_missing"
  | "property_address_missing"
  | "minor_no_trust"
  | "duplicate_beneficiary"
  | "adjd_routing"
  | "foreign_will_revocation"
  | "name_mismatch"
  | "deed_joint_owner"
  | "business_shares"
  | "witness_is_beneficiary"
  | "ai_distribution"
  | "guardian_needed"
  | "guardian_for_minor_missing"
  | "substitution_missing"
  | "non_resident_path";

export type UserRole = "lawyer" | "ops_agent" | "admin";

export type ReviewOutcome =
  | "approved"
  | "changes_requested"
  | "escalated"
  | "raised_clarification";

export type CaseComplexity = "standard" | "complex";

export type ReviewItemAction =
  | "confirmed"
  | "verified"
  | "returned_to_client"
  | "doc_received";

export type ReminderType = "automated_email" | "automated_whatsapp" | "agent_call";

export type ReminderOutcome = "sent" | "no_response" | "recovered" | "opted_out";

// ---------- clarifications (§1B-ter) ----------

export type ClarificationMode = "question" | "document_reupload";
export type ClarificationChannel = "email" | "whatsapp";
export type ClarificationStatus = "sent" | "answered" | "resolved";

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
  /** Structured, rules-driven identity (passport/Emirates ID) — never LLM output. */
  identity: Identity | null;
  /** Current structured content (post-lawyer, if amended). */
  structured_json: StructuredWill | null;
  /** Snapshot BEFORE any lawyer edits — powers the client final-approval diff. */
  structured_json_pre_lawyer: StructuredWill | null;
  /** The client's free-text wishes, verbatim — audit trail / retraining data. */
  raw_input_text: string;
  ai_structured: boolean;
  ai_confidence_notes: string;
  lawyer_made_changes: boolean;
  content_complete_at?: string | null;
  submitted_at?: string | null;
  lawyer_approved_at?: string | null;
  client_approved_at?: string | null;
  portal_ready_at?: string | null;
  registered_at?: string | null;
  /**
   * Registration appointment + payment are collected from the client UP FRONT,
   * before the will enters the lawyer queue — a paying, committed client with a
   * booked slot is what the lawyer's time is spent on. Null/`pending` until the
   * client books and pays on the review step.
   */
  appointment_at?: string | null;
  payment_status?: PaymentStatus;
}

export interface Beneficiary {
  id: string;
  will_id: string;
  name: string;
  relationship: string;
  share_pct: number;
  is_minor: boolean;
  held_in_trust: boolean;
  substitution: string; // where the share goes if they predecease the testator
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
  file_path?: string | null;
  /** Signed URL (Supabase Storage) or a local object URL fallback — see storage.ts. */
  file_url?: string | null;
  expires_at?: string | null;
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
  /** HEADLINE METRIC — excludes clarification waits. Finalised at session end. */
  active_seconds?: number | null;
  /** Paused time (clarification waits), accumulated and reported separately — not lawyer work. */
  clarification_wait_seconds: number;
  /** Internal bookkeeping: when the CURRENT pause started, if any (§1B-ter). Not a public metric. */
  paused_at?: string | null;
  outcome?: ReviewOutcome | null;
  items_total: number;
  items_cleared: number;
  case_complexity: CaseComplexity;
}

/**
 * A lawyer-raised, one-item clarification mid-review (§1B-ter). Lawyer-direct:
 * sent straight to the client (email/WhatsApp), no ops handoff in the path.
 * Ops gets read-only visibility (§1C Tab 2) and an optional follow-up
 * backstop — the flow completes without them.
 */
export interface Clarification {
  id: string;
  will_id: string;
  check_id: string | null;
  raised_by: string; // fk users (lawyer)
  mode: ClarificationMode;
  question: string;
  doc_type: DocType | null; // set only when mode = document_reupload
  message_preview: string; // LLM-drafted
  message_final: string; // after lawyer edit
  channel: ClarificationChannel;
  status: ClarificationStatus;
  response_text: string | null;
  response_file_path: string | null;
  sent_at: string;
  answered_at: string | null;
  resolved_at: string | null;
  /** Optional backstop only — never required for the flow to complete. */
  ops_followed_up: boolean;
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
  /** The human-readable copy-paste block ops actually reads — never raw JSON. */
  package_text: string;
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

// ---------- identity (structured, rules-driven — NOT LLM output) ----------

/**
 * Identity is collected via passport OCR + a resident/non-resident branch.
 * It is safety-critical (expired passport hard-blocks) and is deliberately
 * kept OUT of the LLM's structuring job — the model never invents identity
 * facts. Passed alongside StructuredWill wherever both are needed (the
 * Schedule 1 renderer, the portal package, the rules engine).
 */
export interface Identity {
  full_name: string;
  passport_number: string;
  passport_expiry: string; // ISO date
  passport_expired: boolean;
  nationality?: string | null;
  residency_status: ResidencyStatus;
  emirates_id_number?: string | null;
  emirates_id_address?: string | null;
  email?: string;
  phone?: string;
}

// ---------- structured will (LLM output — the crown jewel schema) ----------

/**
 * StructuredWill is the strict JSON the LLM produces from the client's ONE
 * free-text wishes field. It is validated against a zod schema before it is
 * trusted (src/lib/schema.ts). On malformed/low-confidence output the will is
 * flagged `ai_structured = true` and surfaced to the lawyer as
 * "AI-structured — verify" rather than trusted blind.
 *
 * `held_in_trust` on beneficiaries is NOT part of the LLM's output schema —
 * the model never decides trust mechanics. It defaults to false after
 * parsing and is set by the LAWYER during review (the human judgment call
 * the rules engine flags but cannot resolve itself).
 *
 * `substitute_guardian` is an app-level extension beyond the LLM's required
 * schema (optional, nullable) so Schedule 1 clause 5's predecease logic has
 * somewhere to live; the model may leave it null.
 */
export interface StructuredWill {
  testator: {
    name: string;
    nationality: string;
    residency: ResidencyStatus;
  };
  beneficiaries: Array<{
    name: string;
    relationship: string;
    share_pct: number;
    is_minor: boolean;
    substitution: string;
    held_in_trust: boolean;
  }>;
  executor: { name: string; relationship: string };
  substitute_executor: { name: string; relationship: string } | null;
  guardian: { name: string; relationship: string } | null;
  substitute_guardian?: { name: string; relationship: string } | null;
  assets: Array<{
    type: AssetType;
    emirate: Emirate;
    needs_adjd: boolean;
    description: string;
  }>;
  foreign_will: boolean;
  distribution_summary: string;
  confidence_notes: string;
}

// ---------- portal package (DIFC 10-step handoff) ----------

export interface PortalPackage {
  generated_at: string;
  client_name: string;
  jurisdiction_label: string; // "DIFC" | "DIFC + ADJD"
  step_1_service: { will_type: string; jurisdiction: string };
  step_2_personal: Record<string, unknown>;
  step_3_real_estate: Array<Record<string, unknown>>;
  step_4_executor: Record<string, unknown>;
  step_5_beneficiaries: Array<Record<string, unknown>>;
  step_6_distribution: { summary: string; sums_to_100: boolean };
  step_7_witnesses: { note: string };
  step_8_documents: Array<{
    doc_type: DocType;
    status: DocStatus;
    file_url?: string | null;
  }>;
  step_9_appointment: { status: "client_to_book"; note: string };
  step_10_payment: { status: "client_to_pay"; note: string };
}

// ---------- intake draft (client-side working state, v2) ----------

/**
 * IntakeDraft is deliberately thin in v2: structured identity + one free-text
 * wishes field. Everything else (family, assets, beneficiaries, foreign will)
 * used to be separate wizard steps; now the LLM structures all of it from
 * `wishes_text` in one call.
 */
export interface IntakeDraft {
  lead_id: string;
  will_id: string;
  passport: {
    uploaded: boolean;
    ocr: {
      full_name: string;
      passport_number: string;
      passport_expiry: string;
      nationality?: string | null;
    } | null;
    full_name: string;
    passport_number: string;
    passport_expiry: string;
    nationality: string;
  };
  residency_status: ResidencyStatus;
  emirates_id: {
    uploaded: boolean;
    ocr: { full_name: string; address: string } | null;
    number: string;
  };
  /** The single free-text field the LLM structures — the automation's input. */
  wishes_text: string;
  title_deed: {
    uploaded: boolean;
    ocr: { owner: string; joint_owner: boolean } | null;
  };
}

/** Plain-language description of one change the lawyer made, for client review. */
export interface ChangeSummaryItem {
  field: string;
  before: string;
  after: string;
  explanation: string;
}
