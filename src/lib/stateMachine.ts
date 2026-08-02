/**
 * State-machine + funnel helpers shared by all three surfaces.
 *
 * Encodes the lead funnel ordering, case complexity, and the "what's blocking
 * them" logic that both the client review checklist and the ops re-engagement
 * desk read from — one source of truth for case state.
 */
import type {
  Check,
  IntakeDraft,
  LeadStage,
  StructuredWill,
  Will,
  WillDocument,
} from "./types";

export const STAGE_ORDER: LeadStage[] = [
  "about",
  "family",
  "assets",
  "beneficiaries",
  "safety",
  "documents",
  "review",
  "submitted",
  "in_lawyer_review",
  "approved",
  "registered",
];

/** 0..1 progress through the intake+registration funnel. */
export function stageProgress(stage: LeadStage): number {
  if (stage === "abandoned") return 0;
  const i = STAGE_ORDER.indexOf(stage);
  if (i < 0) return 0;
  return i / (STAGE_ORDER.length - 1);
}

export const STAGE_LABELS: Record<LeadStage, string> = {
  about: "Identity",
  family: "Family",
  assets: "Assets",
  beneficiaries: "Beneficiaries & executor",
  safety: "Safety questions",
  documents: "Documents",
  review: "Review & submit",
  submitted: "Submitted",
  in_lawyer_review: "In lawyer review",
  approved: "Approved",
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

/** The lawyer's review items: unresolved warn checks, most-urgent first. */
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
  // Within warns, order client-owned (doc) items after true judgment calls.
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
  // Content-level blocks (unresolved) are the strongest signal.
  const block = checks.find((c) => c.severity === "block" && !c.resolved_at);
  if (block) {
    if (block.check_key === "shares_sum") {
      const total =
        draft?.beneficiaries.reduce((s, b) => s + (b.share_pct || 0), 0) ?? 0;
      return `Left mid-distribution — shares only ${total}% allocated (needs 100%).`;
    }
    if (block.check_key === "no_uae_asset")
      return "No UAE asset named yet — will is not registrable until one is added.";
    if (block.check_key === "passport_expired")
      return "Passport on file is expired — needs a valid passport.";
    if (block.check_key === "passport_missing")
      return "No passport uploaded — identity step incomplete.";
    return block.detail;
  }

  // ADJD confusion is a common bounce point.
  if (checks.some((c) => c.check_key === "adjd_routing" && !c.resolved_at)) {
    if (will && will.status === "draft")
      return "Bounced after the ADJD (Abu Dhabi property) flag — likely confused about the split.";
  }

  // Content complete but a required document is missing.
  const pendingDoc = documents.find((d) => d.status === "pending");
  if (will && (will.status === "content_complete" || will.status === "documents_pending")) {
    if (pendingDoc)
      return `Content complete — hasn't uploaded ${pendingDoc.doc_type.replace(
        "_",
        " "
      )} yet.`;
    return "Content complete — hasn't hit submit yet.";
  }

  // Otherwise: how far did they get?
  if (draft) {
    if (!draft.passport.uploaded) return "Started intake — hasn't finished the identity step.";
    if (!draft.assets.length) return "Left before naming any UAE assets.";
    if (!draft.beneficiaries.length) return "Left before adding beneficiaries.";
    if (!draft.executors.length) return "Left before appointing an executor.";
  }
  return "Started the form but hasn't submitted.";
}

/** Recoverability heuristic for the ops queue. */
export function recoverabilityFor(
  progress: number,
  daysStuck: number
): "high" | "medium" | "low" {
  // Far along + recently stuck = high. Early + long-stuck = low.
  if (progress >= 0.5 && daysStuck <= 7) return "high";
  if (progress >= 0.3 && daysStuck <= 21) return "medium";
  return "low";
}

export function daysBetween(fromISO: string, to: Date = new Date()): number {
  const from = new Date(fromISO).getTime();
  return Math.max(0, Math.floor((to.getTime() - from) / 86400000));
}
