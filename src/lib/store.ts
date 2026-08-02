/**
 * Data layer — v2.
 *
 * Source of truth for production is Supabase/Postgres (supabase/schema.sql).
 * For a zero-backend, genuinely-working prototype this is a localStorage-backed
 * store whose shape mirrors those tables 1:1. Every state transition writes a
 * timestamped row AND an `events` entry — the timing data is the whole business
 * case, so we capture it from day one rather than reconstructing it later.
 *
 * v2 flow this encodes: client submits -> lawyer reviews/amends/approves ->
 * CLIENT reviews final draft + lawyer changes -> client approves -> portal
 * package -> appointment booked -> registration. Three approvals for three
 * things: the LLM structures, the lawyer validates, the client consents.
 */
"use client";

import { useSyncExternalStore } from "react";
import type {
  Asset,
  Beneficiary,
  Check,
  Clarification,
  ClarificationChannel,
  ClarificationMode,
  DocType,
  EventRow,
  Executor,
  Identity,
  IntakeDraft,
  Lead,
  LeadStage,
  PortalSubmission,
  Reminder,
  ReminderType,
  ReviewItem,
  ReviewItemAction,
  ReviewOutcome,
  ReviewSession,
  StaffUser,
  StructuredWill,
  Will,
  WillDocument,
  WillStatus,
} from "./types";
import { runRules, type RuleContext, type RuleResult } from "./rules";
import { buildPortalPackage, buildPortalPackageText } from "./portal";

export interface DB {
  leads: Lead[];
  wills: Will[];
  beneficiaries: Beneficiary[];
  assets: Asset[];
  executors: Executor[];
  documents: WillDocument[];
  checks: Check[];
  review_sessions: ReviewSession[];
  review_items: ReviewItem[];
  clarifications: Clarification[];
  reminders: Reminder[];
  portal_submissions: PortalSubmission[];
  users: StaffUser[];
  events: EventRow[];
  drafts: IntakeDraft[];
  _seeded: boolean;
}

const STORAGE_KEY = "instawill.db.v3";

function emptyDB(): DB {
  return {
    leads: [],
    wills: [],
    beneficiaries: [],
    assets: [],
    executors: [],
    documents: [],
    checks: [],
    review_sessions: [],
    review_items: [],
    clarifications: [],
    reminders: [],
    portal_submissions: [],
    users: [],
    events: [],
    drafts: [],
    _seeded: false,
  };
}

let db: DB = emptyDB();
const listeners = new Set<() => void>();

// ---------- persistence ----------

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* quota / private mode — keep working in memory */
  }
}

function loadFromStorage(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    db = JSON.parse(raw) as DB;
    return true;
  } catch {
    return false;
  }
}

function notify() {
  db = { ...db }; // new top-level ref so getSnapshot sees a change
  persist();
  listeners.forEach((l) => l());
}

/** Run a mutation against the live db, then persist + notify. */
function mutate<T>(fn: (d: DB) => T): T {
  const result = fn(db);
  notify();
  return result;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// ---------- ids / time ----------

export function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return "id-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
export function nowISO(): string {
  return new Date().toISOString();
}

// ---------- external-store plumbing ----------

let initialised = false;
function ensureInit() {
  if (initialised) return;
  initialised = true;
  const had = loadFromStorage();
  if (!had || !db._seeded) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { seedDatabase } = require("./seed") as typeof import("./seed");
    seedDatabase(db);
    db._seeded = true;
    persist();
  }
  // Seeding mutates `db` in place; useSyncExternalStore only re-renders when
  // getSnapshot() returns a NEW reference (or a listener fires). Without this,
  // the very first render — which matched getServerSnapshot()'s pristine
  // empty db — would never be replaced by the seeded data, since the object
  // reference never changed. Bump it here so the post-subscribe re-check
  // (and every getSnapshot() call from here on) reflects the seed.
  db = { ...db };
}

export function subscribe(listener: () => void): () => void {
  ensureInit();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function getSnapshot(): DB {
  ensureInit();
  return db;
}
function getServerSnapshot(): DB {
  return db;
}

export function useDB(): DB {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/** Direct access for imperative code paths (event handlers). */
export function getDB(): DB {
  ensureInit();
  return db;
}

// ---------- event log ----------

export function logEvent(
  event_type: string,
  opts: {
    lead_id?: string | null;
    will_id?: string | null;
    payload?: Record<string, unknown>;
  } = {}
) {
  mutate((d) => {
    d.events.push({
      id: uid(),
      lead_id: opts.lead_id ?? null,
      will_id: opts.will_id ?? null,
      event_type,
      payload: opts.payload ?? {},
      created_at: nowISO(),
    });
  });
}

// ---------- selectors ----------

export function leadById(d: DB, id: string): Lead | undefined {
  return d.leads.find((l) => l.id === id);
}
export function willById(d: DB, id: string): Will | undefined {
  return d.wills.find((w) => w.id === id);
}
export function willsForLead(d: DB, leadId: string): Will[] {
  return d.wills.filter((w) => w.lead_id === leadId);
}
export function checksForWill(d: DB, willId: string): Check[] {
  return d.checks.filter((c) => c.will_id === willId);
}
export function documentsForWill(d: DB, willId: string): WillDocument[] {
  return d.documents.filter((doc) => doc.will_id === willId);
}
export function activeReviewSession(d: DB, willId: string): ReviewSession | undefined {
  return d.review_sessions.find((s) => s.will_id === willId && !s.ended_at);
}
export function beneficiariesForWill(d: DB, willId: string): Beneficiary[] {
  return d.beneficiaries.filter((b) => b.will_id === willId);
}
export function clarificationsForWill(d: DB, willId: string): Clarification[] {
  return d.clarifications.filter((c) => c.will_id === willId);
}
/** The clarification currently awaiting the client's response, if any. */
export function pendingClarificationForWill(d: DB, willId: string): Clarification | undefined {
  return d.clarifications.find((c) => c.will_id === willId && c.status === "sent");
}
/** All clarifications, across every will, still awaiting a client response — for the ops read-only tab (§1C Tab 2). */
export function allPendingClarifications(d: DB): Clarification[] {
  return d.clarifications.filter((c) => c.status === "sent");
}

function ruleContextFor(d: DB, will: Will): RuleContext {
  const titleDeedDoc = documentsForWill(d, will.id).find((doc) => doc.doc_type === "title_deed");
  return {
    identity: will.identity ?? {
      full_name: "",
      passport_number: "",
      passport_expiry: "",
      passport_expired: false,
      residency_status: "unknown",
    },
    title_deed: titleDeedDoc
      ? {
          uploaded: titleDeedDoc.status !== "pending",
          owner: (titleDeedDoc.ocr_extracted?.owner_name as string) ?? undefined,
          joint_owner: Boolean(titleDeedDoc.ocr_extracted?.joint_owner),
        }
      : null,
    ai_structured: will.ai_structured,
  };
}

// ---------- lead / will lifecycle ----------

export function createIntake(seed: {
  full_name?: string;
  email?: string;
  phone?: string;
  utm?: Partial<Pick<Lead, "utm_source" | "utm_medium" | "utm_campaign" | "gclid" | "referrer">>;
}): { lead: Lead; will: Will; draft: IntakeDraft } {
  return mutate((d) => {
    const ts = nowISO();
    const lead: Lead = {
      id: uid(),
      created_at: ts,
      updated_at: ts,
      full_name: seed.full_name || "",
      email: seed.email || "",
      phone: seed.phone || "",
      preferred_channel: "email",
      residency_status: "unknown",
      current_stage: "identity",
      stage_updated_at: ts,
      recoverability: "high",
      assigned_agent_id: null,
      ...seed.utm,
    };
    const will: Will = {
      id: uid(),
      lead_id: lead.id,
      created_at: ts,
      updated_at: ts,
      will_type: "full",
      jurisdiction: "difc",
      status: "draft",
      identity: null,
      structured_json: null,
      structured_json_pre_lawyer: null,
      raw_input_text: "",
      ai_structured: false,
      ai_confidence_notes: "",
      lawyer_made_changes: false,
      content_complete_at: null,
      submitted_at: null,
      lawyer_approved_at: null,
      client_approved_at: null,
      portal_ready_at: null,
      registered_at: null,
    };
    const draft: IntakeDraft = {
      lead_id: lead.id,
      will_id: will.id,
      passport: {
        uploaded: false,
        ocr: null,
        full_name: "",
        passport_number: "",
        passport_expiry: "",
        nationality: "",
      },
      residency_status: "unknown",
      emirates_id: { uploaded: false, ocr: null, number: "" },
      wishes_text: "",
      title_deed: { uploaded: false, ocr: null },
    };
    d.leads.push(lead);
    d.wills.push(will);
    d.drafts.push(draft);
    d.events.push({
      id: uid(),
      lead_id: lead.id,
      will_id: will.id,
      event_type: "intake_started",
      payload: {},
      created_at: ts,
    });
    return { lead, will, draft };
  });
}

export function saveDraft(draft: IntakeDraft) {
  mutate((d) => {
    const i = d.drafts.findIndex((x) => x.will_id === draft.will_id);
    if (i >= 0) d.drafts[i] = draft;
    else d.drafts.push(draft);
  });
}

export function setLeadStage(leadId: string, stage: LeadStage) {
  mutate((d) => {
    const lead = d.leads.find((l) => l.id === leadId);
    if (!lead) return;
    if (lead.current_stage === stage) return;
    lead.current_stage = stage;
    lead.stage_updated_at = nowISO();
    lead.updated_at = nowISO();
    d.events.push({
      id: uid(),
      lead_id: leadId,
      will_id: null,
      event_type: "stage_completed",
      payload: { stage },
      created_at: nowISO(),
    });
  });
}

export function updateLead(leadId: string, patch: Partial<Lead>) {
  mutate((d) => {
    const lead = d.leads.find((l) => l.id === leadId);
    if (!lead) return;
    Object.assign(lead, patch, { updated_at: nowISO() });
  });
}

/**
 * Persist the LLM structuring result (identity + raw wishes + structured JSON
 * + rules-engine output) and set content status. This is the moment
 * `structured_json_pre_lawyer` is snapshotted — a deep clone, so later lawyer
 * edits to `structured_json` never mutate the pre-lawyer record the client's
 * final-approval screen diffs against.
 */
export function commitStructuredWill(
  willId: string,
  identity: Identity,
  wishesText: string,
  structured: StructuredWill,
  aiStructured: boolean,
  rules: RuleResult[]
) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will) return;
    const ts = nowISO();
    will.identity = identity;
    will.raw_input_text = wishesText;
    will.structured_json = structured;
    will.structured_json_pre_lawyer = clone(structured);
    will.ai_structured = aiStructured;
    will.ai_confidence_notes = structured.confidence_notes;
    will.updated_at = ts;

    applyStructuredToChildRows(d, willId, structured);
    replaceChecks(d, willId, rules, ts);

    const hasBlock = rules.some((r) => r.severity === "block");
    if (!hasBlock && will.status === "draft") {
      will.status = "content_complete";
      will.content_complete_at = ts;
    }
    d.events.push({
      id: uid(),
      lead_id: will.lead_id,
      will_id: willId,
      event_type: "llm_structured",
      payload: { ai_structured: aiStructured, block: hasBlock },
      created_at: ts,
    });
  });
}

function applyStructuredToChildRows(d: DB, willId: string, structured: StructuredWill) {
  d.beneficiaries = d.beneficiaries.filter((b) => b.will_id !== willId);
  d.assets = d.assets.filter((a) => a.will_id !== willId);
  d.executors = d.executors.filter((e) => e.will_id !== willId);

  structured.beneficiaries.forEach((b) =>
    d.beneficiaries.push({ id: uid(), will_id: willId, ...b })
  );
  structured.assets.forEach((a) =>
    d.assets.push({
      id: uid(),
      will_id: willId,
      asset_type: a.type,
      emirate: a.emirate,
      needs_adjd: a.needs_adjd,
      description: a.description,
    })
  );
  if (structured.executor.name) {
    d.executors.push({ id: uid(), will_id: willId, role: "executor", ...structured.executor });
  }
  if (structured.substitute_executor) {
    d.executors.push({
      id: uid(),
      will_id: willId,
      role: "substitute_executor",
      ...structured.substitute_executor,
    });
  }
  if (structured.guardian) {
    d.executors.push({ id: uid(), will_id: willId, role: "guardian", ...structured.guardian });
  }
  if (structured.substitute_guardian) {
    d.executors.push({
      id: uid(),
      will_id: willId,
      role: "substitute_guardian",
      ...structured.substitute_guardian,
    });
  }
}

/**
 * Re-run the rules engine and replace `checks`, but PRESERVE resolution state
 * (resolved_at/resolved_by) for any check whose (check_key + detail) still
 * matches after the edit — otherwise every lawyer edit would silently un-clear
 * everything they'd already cleared. Checks that structurally disappear
 * (e.g. minor_no_trust once held_in_trust flips true) simply don't reappear —
 * no separate "resolve" bookkeeping needed for those.
 */
function replaceChecks(d: DB, willId: string, rules: RuleResult[], ts: string) {
  const previous = d.checks.filter((c) => c.will_id === willId);
  d.checks = d.checks.filter((c) => c.will_id !== willId);
  rules.forEach((r) => {
    const match = previous.find(
      (p) => p.check_key === r.check_key && p.detail === r.detail && p.resolved_at
    );
    d.checks.push({
      id: match?.id ?? uid(),
      will_id: willId,
      check_key: r.check_key,
      severity: r.severity,
      owner: r.owner,
      detail: r.detail,
      created_at: match?.created_at ?? ts,
      resolved_at: match?.resolved_at ?? null,
      resolved_by: match?.resolved_by ?? null,
    });
  });
}

export function recordDocument(willId: string, docType: DocType, patch: Partial<WillDocument>) {
  mutate((d) => {
    const existing = d.documents.find((x) => x.will_id === willId && x.doc_type === docType);
    if (existing) {
      Object.assign(existing, patch);
    } else {
      d.documents.push({
        id: uid(),
        will_id: willId,
        doc_type: docType,
        status: "pending",
        ocr_extracted: null,
        match_result: "n_a",
        ...patch,
      });
    }
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: null,
      event_type: "document_uploaded",
      payload: { doc_type: docType, status: patch.status },
      created_at: nowISO(),
    });
  });
}

/**
 * Submit a content-complete will to the lawyer queue. If required documents
 * are still pending it lands as documents_pending (async on docs, strict on
 * content) but either way becomes visible to the lawyer as in_review.
 */
export function submitWill(willId: string, documentsPending: boolean) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will) return;
    const ts = nowISO();
    will.submitted_at = ts;
    will.status = documentsPending ? "documents_pending" : "submitted";
    will.status = "in_review"; // content is complete; visible to the lawyer either way
    will.updated_at = ts;
    const lead = d.leads.find((l) => l.id === will.lead_id);
    if (lead) {
      lead.current_stage = "in_lawyer_review";
      lead.stage_updated_at = ts;
    }
    d.events.push({
      id: uid(),
      lead_id: will.lead_id,
      will_id: willId,
      event_type: "will_submitted",
      payload: { documents_pending: documentsPending },
      created_at: ts,
    });
  });
}

// ---------- lawyer review state machine ----------

export function startReview(
  willId: string,
  lawyerId: string,
  itemsTotal: number,
  complexity: "standard" | "complex"
): ReviewSession {
  return mutate((d) => {
    let session = d.review_sessions.find((s) => s.will_id === willId && !s.ended_at);
    if (session) return session;
    session = {
      id: uid(),
      will_id: willId,
      lawyer_id: lawyerId,
      started_at: nowISO(),
      ended_at: null,
      active_seconds: null,
      clarification_wait_seconds: 0,
      paused_at: null,
      outcome: null,
      items_total: itemsTotal,
      items_cleared: 0,
      case_complexity: complexity,
    };
    d.review_sessions.push(session);
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: null,
      event_type: "review_started",
      payload: { lawyer_id: lawyerId, items_total: itemsTotal, complexity },
      created_at: nowISO(),
    });
    return session;
  });
}

/** Clear one judgment item: resolve its check + log a review_item. */
export function clearReviewItem(
  willId: string,
  checkId: string,
  lawyerId: string,
  action: ReviewItemAction
) {
  mutate((d) => {
    const session = d.review_sessions.find((s) => s.will_id === willId && !s.ended_at);
    const check = d.checks.find((c) => c.id === checkId);
    if (!check || !session) return;
    const ts = nowISO();
    check.resolved_at = ts;
    check.resolved_by = lawyerId;
    session.items_cleared += 1;
    d.review_items.push({ id: uid(), review_session_id: session.id, check_id: checkId, cleared_at: ts, action });

    // If this item was cleared using an answered clarification's response,
    // mark that clarification resolved too.
    const clarification = d.clarifications.find((c) => c.check_id === checkId && c.status === "answered");
    if (clarification) {
      clarification.status = "resolved";
      clarification.resolved_at = ts;
      d.events.push({
        id: uid(),
        will_id: willId,
        lead_id: null,
        event_type: "clarification_resolved",
        payload: { clarification_id: clarification.id },
        created_at: ts,
      });
    }
  });
}

// ---------- clarifications (§1B-ter) ----------

/**
 * Lawyer-direct, one-click: raises a clarification on a review item instead
 * of clearing it. Pauses the review timer (accumulating into
 * clarification_wait_seconds, not lawyer active_seconds), sets the will to
 * `awaiting_client` (dropping it from the active lawyer queue), and logs the
 * send. No ops handoff in this path — ops only gets read-only visibility.
 */
export function raiseClarification(
  willId: string,
  checkId: string | null,
  lawyerId: string,
  mode: ClarificationMode,
  question: string,
  docType: DocType | null,
  channel: ClarificationChannel,
  messagePreview: string,
  messageFinal: string
): Clarification {
  return mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    const ts = nowISO();
    const clarification: Clarification = {
      id: uid(),
      will_id: willId,
      check_id: checkId,
      raised_by: lawyerId,
      mode,
      question,
      doc_type: docType,
      message_preview: messagePreview,
      message_final: messageFinal,
      channel,
      status: "sent",
      response_text: null,
      response_file_path: null,
      sent_at: ts,
      answered_at: null,
      resolved_at: null,
      ops_followed_up: false,
    };
    d.clarifications.push(clarification);

    if (will) {
      will.status = "awaiting_client";
      will.updated_at = ts;
      const lead = d.leads.find((l) => l.id === will.lead_id);
      if (lead) {
        lead.current_stage = "awaiting_client";
        lead.stage_updated_at = ts;
      }
    }

    const session = d.review_sessions.find((s) => s.will_id === willId && !s.ended_at);
    if (session && !session.paused_at) {
      session.paused_at = ts;
      session.outcome = "raised_clarification";
    }

    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: will?.lead_id ?? null,
      event_type: "clarification_raised",
      payload: { mode, channel, clarification_id: clarification.id },
      created_at: ts,
    });
    return clarification;
  });
}

/**
 * Client responds via the secure link (adaptive: text reply or document
 * re-upload). Returns the case to the lawyer at the same item — resumes the
 * review timer (the paused interval is added to clarification_wait_seconds,
 * not lawyer active_seconds).
 */
export function respondToClarification(
  clarificationId: string,
  response: { text?: string; filePath?: string }
) {
  mutate((d) => {
    const clarification = d.clarifications.find((c) => c.id === clarificationId);
    if (!clarification || clarification.status !== "sent") return;
    const ts = nowISO();
    clarification.status = "answered";
    clarification.answered_at = ts;
    clarification.response_text = response.text ?? null;
    clarification.response_file_path = response.filePath ?? null;

    const will = d.wills.find((w) => w.id === clarification.will_id);
    if (will) {
      will.status = "in_review"; // returns to the lawyer at the same item
      will.updated_at = ts;
      const lead = d.leads.find((l) => l.id === will.lead_id);
      if (lead) {
        lead.current_stage = "in_lawyer_review";
        lead.stage_updated_at = ts;
      }
    }

    const session = d.review_sessions.find((s) => s.will_id === clarification.will_id && !s.ended_at);
    if (session && session.paused_at) {
      const pausedSeconds = Math.round(
        (new Date(ts).getTime() - new Date(session.paused_at).getTime()) / 1000
      );
      session.clarification_wait_seconds += Math.max(0, pausedSeconds);
      session.paused_at = null;
    }

    d.events.push({
      id: uid(),
      will_id: clarification.will_id,
      lead_id: will?.lead_id ?? null,
      event_type: "clarification_answered",
      payload: { clarification_id: clarification.id },
      created_at: ts,
    });
  });
}

/** Optional backstop only — ops nudging a silent client. Never required. */
export function markOpsFollowedUp(clarificationId: string) {
  mutate((d) => {
    const clarification = d.clarifications.find((c) => c.id === clarificationId);
    if (clarification) clarification.ops_followed_up = true;
  });
}

export function markDocReceived(willId: string, docType: DocType, lawyerId: string) {
  mutate((d) => {
    const doc = d.documents.find((x) => x.will_id === willId && x.doc_type === docType);
    const ts = nowISO();
    if (doc) {
      doc.status = "validated";
      doc.uploaded_at = doc.uploaded_at || ts;
      doc.validated_at = ts;
      doc.match_result = "match";
    }
    const session = d.review_sessions.find((s) => s.will_id === willId && !s.ended_at);
    if (session) session.items_cleared += 1;
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: null,
      event_type: "document_uploaded",
      payload: { doc_type: docType, by: "lawyer_marked", lawyer_id: lawyerId },
      created_at: ts,
    });
  });
}

/**
 * Generic lawyer-amend primitive: applies `updater` to a clone of the current
 * structured_json, re-runs the rules engine (preserving prior resolutions —
 * see replaceChecks), and marks `lawyer_made_changes` if the result differs
 * from the pre-lawyer snapshot. Every specific edit action (set trust, adjust
 * a share, change the executor) funnels through this.
 */
export function lawyerUpdateStructuredWill(
  willId: string,
  updater: (w: StructuredWill) => StructuredWill
) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will || !will.structured_json) return;
    const next = updater(clone(will.structured_json));
    will.structured_json = next;
    will.updated_at = nowISO();
    applyStructuredToChildRows(d, willId, next);

    const rules = runRules(next, ruleContextFor(d, will));
    replaceChecks(d, willId, rules, nowISO());

    will.lawyer_made_changes =
      JSON.stringify(next) !== JSON.stringify(will.structured_json_pre_lawyer);
  });
}

export function lawyerSetBeneficiaryTrust(willId: string, name: string, heldInTrust: boolean) {
  lawyerUpdateStructuredWill(willId, (w) => {
    w.beneficiaries = w.beneficiaries.map((b) =>
      b.name === name ? { ...b, held_in_trust: heldInTrust } : b
    );
    return w;
  });
}

export function lawyerSetBeneficiaryField(
  willId: string,
  name: string,
  field: "share_pct" | "substitution" | "relationship",
  value: string | number
) {
  lawyerUpdateStructuredWill(willId, (w) => {
    w.beneficiaries = w.beneficiaries.map((b) =>
      b.name === name ? { ...b, [field]: value } : b
    );
    return w;
  });
}

export function lawyerSetExecutor(willId: string, patch: { name: string; relationship: string }) {
  lawyerUpdateStructuredWill(willId, (w) => ({ ...w, executor: patch }));
}

export function lawyerSetGuardian(
  willId: string,
  patch: { name: string; relationship: string } | null
) {
  lawyerUpdateStructuredWill(willId, (w) => ({ ...w, guardian: patch }));
}

export function approveWill(willId: string, lawyerId: string) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    const session = d.review_sessions.find((s) => s.will_id === willId && !s.ended_at);
    if (!will) return;
    const ts = nowISO();
    will.lawyer_approved_at = ts;
    will.status = "pending_client_approval"; // lawyer_approved is momentary; this is the resting state
    will.updated_at = ts;
    if (session) {
      session.ended_at = ts;
      const totalElapsed = Math.round(
        (new Date(ts).getTime() - new Date(session.started_at).getTime()) / 1000
      );
      // active_seconds excludes clarification waits — that pause is not lawyer work.
      session.active_seconds = Math.max(1, totalElapsed - session.clarification_wait_seconds);
      session.outcome = "approved" as ReviewOutcome;
    }
    const lead = d.leads.find((l) => l.id === will.lead_id);
    if (lead) {
      lead.current_stage = "pending_client_approval";
      lead.stage_updated_at = ts;
    }
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: will.lead_id,
      event_type: "lawyer_approved",
      payload: { lawyer_id: lawyerId, lawyer_made_changes: will.lawyer_made_changes },
      created_at: ts,
    });
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: will.lead_id,
      event_type: "sent_for_client_approval",
      payload: {},
      created_at: ts,
    });
  });
}

// ---------- client final approval (§1B-bis) ----------

export function clientApprove(willId: string) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will) return;
    const ts = nowISO();
    will.status = "client_approved";
    will.client_approved_at = ts;
    will.updated_at = ts;
    const lead = d.leads.find((l) => l.id === will.lead_id);
    if (lead) {
      lead.current_stage = "client_approved";
      lead.stage_updated_at = ts;
    }
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: will.lead_id,
      event_type: "client_approved",
      payload: {},
      created_at: ts,
    });
  });
}

export function clientRequestChange(willId: string, note: string) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will) return;
    const ts = nowISO();
    will.status = "changes_requested";
    will.updated_at = ts;
    const lead = d.leads.find((l) => l.id === will.lead_id);
    if (lead) {
      lead.current_stage = "in_lawyer_review";
      lead.stage_updated_at = ts;
    }
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: will.lead_id,
      event_type: "client_requested_change",
      payload: { note },
      created_at: ts,
    });
  });
}

/** Build (or rebuild) the portal package from the current will/documents state. */
export function generatePortalPackage(willId: string) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will || !will.structured_json || !will.identity) return;
    const ts = nowISO();
    const documents = documentsForWill(d, willId);
    const packageJson = buildPortalPackage(will, will.structured_json, will.identity, documents);
    const packageText = buildPortalPackageText(will, will.structured_json, will.identity, documents);

    const existing = d.portal_submissions.find((p) => p.will_id === willId);
    if (existing) {
      existing.package_json = packageJson;
      existing.package_text = packageText;
    } else {
      d.portal_submissions.push({
        id: uid(),
        will_id: willId,
        package_json: packageJson,
        package_text: packageText,
        method: "manual_ops",
        ops_user_id: null,
        submitted_at: null,
        appointment_at: null,
        payment_status: "pending",
        registration_outcome: "pending",
        rejection_reason: null,
      });
    }

    if (will.status === "client_approved") {
      will.status = "portal_ready";
      will.portal_ready_at = ts;
      const lead = d.leads.find((l) => l.id === will.lead_id);
      if (lead) {
        lead.current_stage = "portal_ready";
        lead.stage_updated_at = ts;
      }
    }
    will.updated_at = ts;
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: will.lead_id,
      event_type: "portal_package_generated",
      payload: {},
      created_at: ts,
    });
  });
}

export function markWillRegistered(willId: string) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will) return;
    const ts = nowISO();
    will.status = "registered";
    will.registered_at = ts;
    will.updated_at = ts;
    const lead = d.leads.find((l) => l.id === will.lead_id);
    if (lead) {
      lead.current_stage = "registered";
      lead.stage_updated_at = ts;
    }
    const sub = d.portal_submissions.find((p) => p.will_id === willId);
    if (sub) {
      sub.registration_outcome = "registered";
      sub.submitted_at = sub.submitted_at ?? ts;
      sub.appointment_at = sub.appointment_at ?? ts;
      sub.payment_status = "paid";
    }
  });
}

// ---------- re-engagement ----------

export function logReminder(
  leadId: string,
  type: ReminderType,
  triggeredBy: "system" | "agent",
  blockingReason: string,
  agentId?: string | null
) {
  mutate((d) => {
    d.reminders.push({
      id: uid(),
      lead_id: leadId,
      type,
      triggered_at: nowISO(),
      triggered_by: triggeredBy,
      agent_id: agentId ?? null,
      outcome: "sent",
      blocking_reason_snapshot: blockingReason,
    });
    d.events.push({
      id: uid(),
      lead_id: leadId,
      will_id: null,
      event_type: "reminder_sent",
      payload: { type, triggered_by: triggeredBy },
      created_at: nowISO(),
    });
  });
}

export function markRecovered(leadId: string) {
  mutate((d) => {
    const lead = d.leads.find((l) => l.id === leadId);
    const rem = [...d.reminders].reverse().find((r) => r.lead_id === leadId);
    if (rem) rem.outcome = "recovered";
    if (lead) {
      lead.recoverability = "high";
      lead.updated_at = nowISO();
    }
    d.events.push({
      id: uid(),
      lead_id: leadId,
      will_id: null,
      event_type: "lead_recovered",
      payload: {},
      created_at: nowISO(),
    });
  });
}

export function assignAgent(leadId: string, agentId: string) {
  mutate((d) => {
    const lead = d.leads.find((l) => l.id === leadId);
    if (lead) {
      lead.assigned_agent_id = agentId;
      lead.updated_at = nowISO();
    }
  });
}

/** Danger: full reset for demos. */
export function resetStore() {
  db = emptyDB();
  const { seedDatabase } = require("./seed") as typeof import("./seed");
  seedDatabase(db);
  db._seeded = true;
  notify();
}
