/**
 * Metrics — every number the business case rests on, derived from stored rows
 * (never computed-and-discarded). Mirrors the "Metrics these tables make
 * derivable" block in the brief.
 *
 *  - North star: registered wills / month           -> wills.registered_at
 *  - Lawyer minutes per will (90 -> 15 KPI)          -> review_sessions.active_seconds
 *      (excludes clarification waits; reported standard-case AND fleet average
 *      separately — never conflated)
 *  - Registration rate                               -> registered / submitted
 *  - Funnel drop-off by stage                        -> leads grouped by current_stage
 *  - Started-but-not-submitted (re-engagement queue) -> leads in identity..review
 *  - Cases pending at lawyer                         -> wills.status = in_review
 *  - Cases awaiting client final approval            -> wills.status = pending_client_approval
 *  - Client-approval funnel                          -> client_approved vs changes_requested after lawyer_approved_at
 *  - Lawyer-change rate                              -> lawyer_made_changes = true / lawyer-approved (proxy for LLM draft quality)
 *  - Client-approval turnaround                      -> client_approved_at - lawyer_approved_at
 *  - Clarification rate                              -> clarifications per will (falls as structuring improves)
 *  - Clarification turnaround                        -> answered_at - sent_at, split by mode
 *  - Ops-followup rate                               -> ops_followed_up=true / total (low is good)
 *  - Abandoned-recovery rate                         -> reminders outcome=recovered / total
 *  - Submission error rate                           -> portal_submissions rejected / total
 *  - Turnaround time                                 -> registered_at - content_complete_at
 *  - Acquisition ROI                                 -> group by leads.utm_*
 *  - DIFC-vs-ADJD / standard-vs-complex mix          -> jurisdiction / needs_adjd / complexity
 */
import type { DB } from "./store";
import { STAGE_ORDER } from "./stateMachine";
import type { ClarificationMode, LeadStage } from "./types";

export interface Metrics {
  registeredThisMonth: number;
  avgLawyerMinutesStandard: number | null;
  avgLawyerMinutesFleet: number | null;
  registrationRate: number | null;
  startedNotSubmitted: number;
  pendingAtLawyer: number;
  awaitingClient: number;
  pendingClientApproval: number;
  lawyerChangeRate: number | null;
  clientApprovalRate: number | null;
  avgClientApprovalTurnaroundHours: number | null;
  clarificationRatePerWill: number | null;
  clarificationTurnaroundMinutesByMode: Partial<Record<ClarificationMode, number>>;
  opsFollowupRate: number | null;
  recoveryRate: number | null;
  submissionErrorRate: number | null;
  funnelByStage: Record<LeadStage, number>;
  standardVsComplex: { standard: number; complex: number };
}

const INTAKE_STAGES = new Set<LeadStage>([
  "identity",
  "wishes",
  "confirm",
  "documents",
  "review",
]);

export function computeMetrics(d: DB): Metrics {
  const now = new Date();
  const month = now.getUTCFullYear() * 12 + now.getUTCMonth();

  const registeredThisMonth = d.wills.filter((w) => {
    if (!w.registered_at) return false;
    const r = new Date(w.registered_at);
    return r.getUTCFullYear() * 12 + r.getUTCMonth() === month;
  }).length;

  // Lawyer minutes use active_seconds — clarification waits are excluded,
  // since that pause is the client's time, not lawyer work.
  const completed = d.review_sessions.filter((s) => s.active_seconds && s.outcome === "approved");
  const standard = completed.filter((s) => s.case_complexity === "standard");
  const avg = (arr: typeof completed) =>
    arr.length
      ? Math.round((arr.reduce((sum, s) => sum + (s.active_seconds || 0), 0) / arr.length / 60) * 10) / 10
      : null;

  const submitted = d.wills.filter((w) => w.submitted_at).length;
  const registered = d.wills.filter((w) => w.registered_at).length;

  const funnelByStage = Object.fromEntries([...STAGE_ORDER, "awaiting_client", "abandoned"].map((s) => [s, 0])) as Record<
    LeadStage,
    number
  >;
  d.leads.forEach((l) => {
    funnelByStage[l.current_stage] = (funnelByStage[l.current_stage] || 0) + 1;
  });

  const startedNotSubmitted = d.leads.filter((l) => INTAKE_STAGES.has(l.current_stage)).length;

  const remindedLeads = new Set(d.reminders.map((r) => r.lead_id));
  const recovered = new Set(d.reminders.filter((r) => r.outcome === "recovered").map((r) => r.lead_id));
  const recoveryRate = remindedLeads.size ? Math.round((recovered.size / remindedLeads.size) * 100) / 100 : null;

  const submissions = d.portal_submissions.filter((p) => p.submitted_at);
  const rejected = submissions.filter((p) => p.registration_outcome === "rejected");
  const submissionErrorRate = submissions.length ? Math.round((rejected.length / submissions.length) * 100) / 100 : null;

  let complexCount = 0;
  let standardCount = 0;
  d.wills.forEach((w) => {
    if (!w.structured_json) return;
    const adjd = w.structured_json.assets.some((a) => a.needs_adjd);
    if (adjd) complexCount++;
    else standardCount++;
  });

  // Lawyer-change rate: of wills the lawyer has approved (lawyer_approved_at set),
  // how many needed an amendment — a proxy for LLM draft quality over time.
  const lawyerApproved = d.wills.filter((w) => w.lawyer_approved_at);
  const lawyerChangeRate = lawyerApproved.length
    ? Math.round((lawyerApproved.filter((w) => w.lawyer_made_changes).length / lawyerApproved.length) * 100) / 100
    : null;

  // Client-approval funnel: of lawyer-approved wills, how many the client
  // confirmed vs requested changes on. A high change-request rate signals the
  // LLM or intake is misreading intent.
  const clientDecided = d.wills.filter(
    (w) => w.lawyer_approved_at && (w.client_approved_at || w.status === "changes_requested")
  );
  const clientApprovalRate = clientDecided.length
    ? Math.round((clientDecided.filter((w) => w.client_approved_at).length / clientDecided.length) * 100) / 100
    : null;

  const turnaroundHours = d.wills
    .filter((w) => w.lawyer_approved_at && w.client_approved_at)
    .map(
      (w) =>
        (new Date(w.client_approved_at as string).getTime() - new Date(w.lawyer_approved_at as string).getTime()) /
        3600000
    );
  const avgClientApprovalTurnaroundHours = turnaroundHours.length
    ? Math.round((turnaroundHours.reduce((s, h) => s + h, 0) / turnaroundHours.length) * 10) / 10
    : null;

  // Clarifications (§1B-ter).
  const clarificationRatePerWill = d.wills.length
    ? Math.round((d.clarifications.length / d.wills.length) * 100) / 100
    : null;

  const clarificationTurnaroundMinutesByMode: Partial<Record<ClarificationMode, number>> = {};
  (["question", "document_reupload"] as ClarificationMode[]).forEach((mode) => {
    const answered = d.clarifications.filter((c) => c.mode === mode && c.answered_at);
    if (answered.length) {
      const avgMinutes =
        answered.reduce(
          (sum, c) => sum + (new Date(c.answered_at as string).getTime() - new Date(c.sent_at).getTime()) / 60000,
          0
        ) / answered.length;
      clarificationTurnaroundMinutesByMode[mode] = Math.round(avgMinutes * 10) / 10;
    }
  });

  // Low is good — clients respond to the direct link without needing a chase.
  const opsFollowupRate = d.clarifications.length
    ? Math.round((d.clarifications.filter((c) => c.ops_followed_up).length / d.clarifications.length) * 100) / 100
    : null;

  return {
    registeredThisMonth,
    avgLawyerMinutesStandard: avg(standard),
    avgLawyerMinutesFleet: avg(completed),
    registrationRate: submitted ? Math.round((registered / submitted) * 100) / 100 : null,
    startedNotSubmitted,
    pendingAtLawyer: d.wills.filter((w) => w.status === "in_review" || w.status === "changes_requested").length,
    awaitingClient: d.wills.filter((w) => w.status === "awaiting_client").length,
    pendingClientApproval: d.wills.filter((w) => w.status === "pending_client_approval").length,
    lawyerChangeRate,
    clientApprovalRate,
    avgClientApprovalTurnaroundHours,
    clarificationRatePerWill,
    clarificationTurnaroundMinutesByMode,
    opsFollowupRate,
    recoveryRate,
    submissionErrorRate,
    funnelByStage,
    standardVsComplex: { standard: standardCount, complex: complexCount },
  };
}
