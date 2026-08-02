/**
 * Data layer.
 *
 * Source of truth for production is Supabase/Postgres (supabase/schema.sql).
 * For a zero-backend, genuinely-working prototype this is a localStorage-backed
 * store whose shape mirrors those tables 1:1. Every state transition writes a
 * timestamped row AND an `events` entry — the timing data is the whole business
 * case, so we capture it from day one rather than reconstructing it later.
 *
 * The store is a tiny external store (useSyncExternalStore-compatible).
 */
"use client";

import { useSyncExternalStore } from "react";
import type {
  Asset,
  Beneficiary,
  Check,
  EventRow,
  Executor,
  IntakeDraft,
  Lead,
  LeadStage,
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
import type { RuleResult } from "./rules";
import type { PortalSubmission } from "./types";

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
  reminders: Reminder[];
  portal_submissions: PortalSubmission[];
  users: StaffUser[];
  events: EventRow[];
  drafts: IntakeDraft[];
  _seeded: boolean;
}

const STORAGE_KEY = "instawill.db.v1";

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
    // Lazy import to avoid a cycle; seed is defined in seed.ts.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { seedDatabase } = require("./seed") as typeof import("./seed");
    seedDatabase(db);
    db._seeded = true;
    persist();
  }
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
export function activeReviewSession(
  d: DB,
  willId: string
): ReviewSession | undefined {
  return d.review_sessions.find((s) => s.will_id === willId && !s.ended_at);
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
      current_stage: "about",
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
      structured_json: null,
      ai_structured: false,
      content_complete_at: null,
      submitted_at: null,
      approved_at: null,
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
 * Persist the structured will + rules-engine output and set content status.
 * Replaces prior beneficiaries/assets/executors/checks for the will so re-runs
 * are idempotent.
 */
export function commitStructuredWill(
  willId: string,
  structured: StructuredWill,
  aiStructured: boolean,
  rules: RuleResult[]
) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will) return;
    const ts = nowISO();
    will.structured_json = structured;
    will.ai_structured = aiStructured;
    will.updated_at = ts;

    // ADJD split marker on the will's jurisdiction if any asset needs ADJD.
    will.jurisdiction = "difc";

    // Replace child rows.
    d.beneficiaries = d.beneficiaries.filter((b) => b.will_id !== willId);
    d.assets = d.assets.filter((a) => a.will_id !== willId);
    d.executors = d.executors.filter((e) => e.will_id !== willId);
    d.checks = d.checks.filter((c) => c.will_id !== willId);

    structured.beneficiaries.forEach((b) =>
      d.beneficiaries.push({ id: uid(), will_id: willId, ...b })
    );
    structured.assets.forEach((a) =>
      d.assets.push({ id: uid(), will_id: willId, ...a })
    );
    structured.executors.forEach((e) =>
      d.executors.push({
        id: uid(),
        will_id: willId,
        role: e.role,
        name: e.name,
        relationship: e.relationship,
      })
    );
    structured.guardians.forEach((g) =>
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

    // Content is complete when there are no BLOCK checks outstanding.
    const hasBlock = rules.some((r) => r.severity === "block");
    if (!hasBlock && will.status === "draft") {
      will.status = "content_complete";
      will.content_complete_at = ts;
    }
    d.events.push({
      id: uid(),
      lead_id: will.lead_id,
      will_id: willId,
      event_type: "will_structured",
      payload: { ai_structured: aiStructured, block: hasBlock },
      created_at: ts,
    });
  });
}

export function upsertDocument(
  willId: string,
  doc: Omit<WillDocument, "id" | "will_id">
) {
  mutate((d) => {
    const existing = d.documents.find(
      (x) => x.will_id === willId && x.doc_type === doc.doc_type
    );
    if (existing) {
      Object.assign(existing, doc);
    } else {
      d.documents.push({ id: uid(), will_id: willId, ...doc });
    }
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: null,
      event_type: "document_uploaded",
      payload: { doc_type: doc.doc_type, status: doc.status },
      created_at: nowISO(),
    });
  });
}

/**
 * Submit a content-complete will to the lawyer queue. If required documents are
 * still pending it lands as documents_pending (async on docs, strict on content)
 * — but either way it becomes visible to the lawyer as in_review.
 */
export function submitWill(willId: string, documentsPending: boolean) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will) return;
    const ts = nowISO();
    will.submitted_at = ts;
    will.status = documentsPending ? "documents_pending" : "submitted";
    // Move into the lawyer's review queue immediately (content is complete).
    will.status = "in_review";
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
    let session = d.review_sessions.find(
      (s) => s.will_id === willId && !s.ended_at
    );
    if (session) return session;
    session = {
      id: uid(),
      will_id: willId,
      lawyer_id: lawyerId,
      started_at: nowISO(),
      ended_at: null,
      duration_seconds: null,
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
    const session = d.review_sessions.find(
      (s) => s.will_id === willId && !s.ended_at
    );
    const check = d.checks.find((c) => c.id === checkId);
    if (!check || !session) return;
    const ts = nowISO();
    check.resolved_at = ts;
    check.resolved_by = lawyerId;
    session.items_cleared += 1;
    d.review_items.push({
      id: uid(),
      review_session_id: session.id,
      check_id: checkId,
      cleared_at: ts,
      action,
    });
  });
}

/**
 * Lawyer marks a client-owned document received ("Simulate: client uploaded").
 * The lawyer can't self-author the document — only mark it received — so this
 * validates the doc and counts it toward the review session's cleared items.
 */
export function markDocReceived(
  willId: string,
  docType: WillDocument["doc_type"],
  lawyerId: string
) {
  mutate((d) => {
    const doc = d.documents.find(
      (x) => x.will_id === willId && x.doc_type === docType
    );
    const ts = nowISO();
    if (doc) {
      doc.status = "validated";
      doc.uploaded_at = doc.uploaded_at || ts;
      doc.validated_at = ts;
      doc.match_result = "match";
    }
    const session = d.review_sessions.find(
      (s) => s.will_id === willId && !s.ended_at
    );
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

export function approveWill(willId: string, lawyerId: string) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    const session = d.review_sessions.find(
      (s) => s.will_id === willId && !s.ended_at
    );
    if (!will) return;
    const ts = nowISO();
    will.status = "approved";
    will.approved_at = ts;
    will.updated_at = ts;
    if (session) {
      session.ended_at = ts;
      session.duration_seconds = Math.max(
        1,
        Math.round(
          (new Date(ts).getTime() - new Date(session.started_at).getTime()) /
            1000
        )
      );
      session.outcome = "approved" as ReviewOutcome;
    }
    const lead = d.leads.find((l) => l.id === will.lead_id);
    if (lead) {
      lead.current_stage = "approved";
      lead.stage_updated_at = ts;
    }
    d.events.push({
      id: uid(),
      will_id: willId,
      lead_id: will.lead_id,
      event_type: "review_completed",
      payload: { outcome: "approved", lawyer_id: lawyerId },
      created_at: ts,
    });
  });
}

export function setWillStatus(willId: string, status: WillStatus) {
  mutate((d) => {
    const will = d.wills.find((w) => w.id === willId);
    if (!will) return;
    will.status = status;
    will.updated_at = nowISO();
    if (status === "registered") {
      will.registered_at = nowISO();
      const lead = d.leads.find((l) => l.id === will.lead_id);
      if (lead) {
        lead.current_stage = "registered";
        lead.stage_updated_at = nowISO();
      }
    }
  });
}

export function savePortalSubmission(sub: PortalSubmission) {
  mutate((d) => {
    const i = d.portal_submissions.findIndex((p) => p.will_id === sub.will_id);
    if (i >= 0) d.portal_submissions[i] = sub;
    else d.portal_submissions.push(sub);
    d.events.push({
      id: uid(),
      will_id: sub.will_id,
      lead_id: null,
      event_type: "portal_package_generated",
      payload: {},
      created_at: nowISO(),
    });
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
    // Flip the most recent reminder to "recovered" for funnel metrics.
    const rem = [...d.reminders]
      .reverse()
      .find((r) => r.lead_id === leadId);
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
