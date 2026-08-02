/**
 * State-machine + funnel helpers shared by all three surfaces — v2.
 *
 * Encodes the lead funnel ordering, case complexity, the "what's blocking
 * them" logic for re-engagement, and the pre/post-lawyer diff that powers the
 * client final-approval screen (§1B-bis) — one source of truth for case state.
 */
import type {
  ChangeSummaryItem,
  Check,
  Identity,
  IntakeDraft,
  LeadStage,
  StructuredWill,
  Will,
  WillDocument,
} from "./types";

export const STAGE_ORDER: LeadStage[] = [
  "identity",
  "wishes",
  "confirm",
  "documents",
  "review",
  "submitted",
  "in_lawyer_review",
  "lawyer_approved",
  "pending_client_approval",
  "client_approved",
  "portal_ready",
  "registered",
];

/** 0..1 progress through the intake+registration funnel. */
export function stageProgress(stage: LeadStage): number {
  if (stage === "abandoned") return 0;
  // A detour, not forward progress — anchor it to where it branched from.
  if (stage === "awaiting_client") return stageProgress("in_lawyer_review");
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0) return 0;
  return i / (STAGE_ORDER.length - 1);
}

export const STAGE_LABELS: Record<LeadStage, string> = {
  identity: "Identity",
  wishes: "Your wishes",
  confirm: "Confirming interpretation",
  documents: "Documents",
  review: "Review & submit",
  submitted: "Submitted",
  in_lawyer_review: "In lawyer review",
  awaiting_client: "Awaiting client (clarification)",
  lawyer_approved: "Lawyer approved",
  pending_client_approval: "Awaiting client final approval",
  client_approved: "Client approved",
  portal_ready: "Portal-ready",
  registered: "Registered",
  abandoned: "Abandoned",
};

/** Standard = clean DIFC Full Will. Complex = ADJD split / business / minor-trust / cross-border. */
export function caseComplexity(
  structured: StructuredWill | null,
  checks: Check[]
): "standard" | "complex" {
  if (!structured) return "standard";
  const complexKeys = new Set([
    "adjd_routing",
    "business_shares",
    "deed_joint_owner",
    "minor_no_trust",
    "foreign_will_revocation",
  ]);
  const anyComplex = checks.some(
    (c) => complexKeys.has(c.check_key) && c.severity === "warn"
  );
  return anyComplex ? "complex" : "standard";
}

/** The lawyer's review items: unresolved warn checks, lawyer-owned first. */
export function openReviewItems(checks: Check[]): Check[] {
  return checks
    .filter((c) => c.severity === "warn" && !c.resolved_at)
    .sort((a, b) => severityRank(a) - severityRank(b));
}

/** Cleared-at-intake confirmations shown as green strip (client-fixable oks). */
export function clearedAtIntake(checks: Check[]): Check[] {
  return checks.filter((c) => c.severity === "ok");
}

export function infoChecks(checks: Check[]): Check[] {
  return checks.filter((c) => c.severity === "info");
}

function severityRank(c: Check): number {
  return c.owner === "lawyer" ? 0 : 1;
}

/**
 * Plain-English "what's blocking them" for a stalled intake. Reads structured
 * checks first (most precise), then falls back to the draft's progress.
 */
export function blockingReason(
  will: Will | undefined,
  draft: IntakeDraft | undefined,
  checks: Check[],
  documents: WillDocument[]
): string {
  const block = checks.find((c) => c.severity === "block" && !c.resolved_at);
  if (block) {
    if (block.check_key === "shares_sum") return `Left mid-distribution — ${block.detail}`;
    if (block.check_key === "no_uae_asset")
      return "No UAE asset named yet — will is not registrable until one is added.";
    if (block.check_key === "passport_expired")
      return "Passport on file is expired — needs a valid passport.";
    if (block.check_key === "passport_missing")
      return "No passport uploaded — identity step incomplete.";
    return block.detail;
  }

  if (checks.some((c) => c.check_key === "adjd_routing" && !c.resolved_at)) {
    if (will && will.status === "draft")
      return "Bounced after the ADJD (Abu Dhabi property) flag — likely confused about the split.";
  }

  const pendingDoc = documents.find((d) => d.status === "pending");
  if (will && (will.status === "content_complete" || will.status === "documents_pending")) {
    if (pendingDoc)
      return `Content complete — hasn't uploaded ${pendingDoc.doc_type.replace(
        "_",
        " "
      )} yet.`;
    return "Content complete — hasn't hit submit yet.";
  }

  if (draft) {
    if (!draft.passport.uploaded) return "Started intake — hasn't finished the identity step.";
    if (!draft.wishes_text?.trim()) return "Left before writing their wishes.";
  }
  return "Started the form but hasn't submitted.";
}

/** Recoverability heuristic for the ops queue. */
export function recoverabilityFor(
  progress: number,
  daysStuck: number
): "high" | "medium" | "low" {
  if (progress >= 0.5 && daysStuck <= 7) return "high";
  if (progress >= 0.3 && daysStuck <= 21) return "medium";
  return "low";
}

export function daysBetween(fromISO: string, to: Date = new Date()): number {
  const from = new Date(fromISO).getTime();
  return Math.max(0, Math.floor((to.getTime() - from) / 86400000));
}

// ---------------------------------------------------------------------------
// Pre/post-lawyer diff — powers the client final-approval screen (§1B-bis).
// ---------------------------------------------------------------------------

function personLabel(p: { name: string; relationship: string } | null | undefined): string {
  if (!p || !p.name) return "(none named)";
  return `${p.name} (${p.relationship || "—"})`;
}

/**
 * Diffs the structured data BEFORE vs AFTER lawyer edits into plain-language
 * change items the client can actually read — e.g. "Your lawyer set Alex's
 * 40% share to be held in trust until age 21, because a minor can't inherit
 * outright." Returns [] if the lawyer made no changes.
 */
export function diffStructuredWill(
  pre: StructuredWill | null,
  post: StructuredWill | null
): ChangeSummaryItem[] {
  if (!pre || !post) return [];
  const changes: ChangeSummaryItem[] = [];

  // Beneficiary-level diffs (match by name).
  post.beneficiaries.forEach((b) => {
    const before = pre.beneficiaries.find(
      (p) => p.name.toLowerCase() === b.name.toLowerCase()
    );
    if (!before) return;
    if (before.held_in_trust !== b.held_in_trust && b.held_in_trust) {
      changes.push({
        field: `${b.name}'s share`,
        before: "held outright",
        after: "held in trust until age 21",
        explanation: b.is_minor
          ? `Your lawyer set ${b.name}'s ${b.share_pct}% share to be held in trust until age 21, because a minor can't inherit outright.`
          : `Your lawyer set ${b.name}'s share to be held in trust, per their review.`,
      });
    }
    if (before.share_pct !== b.share_pct) {
      changes.push({
        field: `${b.name}'s share`,
        before: `${before.share_pct}%`,
        after: `${b.share_pct}%`,
        explanation: `Your lawyer adjusted ${b.name}'s share from ${before.share_pct}% to ${b.share_pct}%.`,
      });
    }
    if (before.substitution !== b.substitution && b.substitution) {
      changes.push({
        field: `${b.name}'s substitution`,
        before: before.substitution || "(not specified)",
        after: b.substitution,
        explanation: `Your lawyer clarified what happens to ${b.name}'s share if they predecease you: ${b.substitution}.`,
      });
    }
  });

  if (personLabel(pre.executor) !== personLabel(post.executor)) {
    changes.push({
      field: "Executor",
      before: personLabel(pre.executor),
      after: personLabel(post.executor),
      explanation: `Your lawyer changed the named executor to ${personLabel(post.executor)}.`,
    });
  }
  if (personLabel(pre.guardian) !== personLabel(post.guardian)) {
    changes.push({
      field: "Guardian",
      before: personLabel(pre.guardian),
      after: personLabel(post.guardian),
      explanation: `Your lawyer updated the nominated guardian to ${personLabel(post.guardian)}.`,
    });
  }

  return changes;
}

/**
 * Standing legal notes (not diffs — explanations of automatic structuring
 * decisions) shown alongside the diff on the client final-approval screen.
 */
export function structuringNotes(post: StructuredWill | null): string[] {
  if (!post) return [];
  const notes: string[] = [];
  if (post.foreign_will) {
    notes.push(
      "The revocation clause was scoped to your UAE assets only, so your foreign will stays valid."
    );
  }
  if (post.assets.some((a) => a.needs_adjd)) {
    notes.push(
      "Your Abu Dhabi / other-emirate property is routed to a separate ADJD will, scoped so it doesn't revoke this DIFC will."
    );
  }
  if (post.beneficiaries.some((b) => b.is_minor && b.held_in_trust)) {
    notes.push(
      "Any share going to a minor is held in trust until they turn 21 — DIFC rules don't allow a minor to inherit outright."
    );
  }
  return notes;
}
