"use client";

/**
 * LAWYER REVIEW — audit-and-approve desk.
 *
 * Queue of intake-complete cases (content-complete; no content blocks reach
 * here), sorted by judgment LOAD, not date. On a case: a green "cleared at
 * intake" strip (client-fixable checks that passed — the lawyer's liability
 * record), priority-ordered judgment items with ENFORCED ordering (each locked
 * until the one above is cleared), and a gated Approve button. The human can
 * never be bypassed.
 */
import { useMemo, useState } from "react";
import {
  approveWill,
  checksForWill,
  documentsForWill,
  markDocReceived,
  clearReviewItem,
  logReminder,
  activeReviewSession,
  startReview,
  useDB,
  willById,
  leadById,
  savePortalSubmission,
  setWillStatus,
} from "@/lib/store";
import {
  caseComplexity,
  clearedAtIntake,
  infoChecks,
  openReviewItems,
} from "@/lib/stateMachine";
import { buildPortalPackage } from "@/lib/portal";
import type {
  Check,
  DocType,
  PortalSubmission,
  Will,
  WillDocument,
} from "@/lib/types";
import { LiveWill } from "@/components/LiveWill";
import {
  Button,
  Card,
  Pill,
  SeverityBadge,
} from "@/components/ui/primitives";
import { PortalPackageView } from "./PortalPackage";

const LAWYER_ID = "user-lawyer-1";

type Item =
  | { kind: "check"; id: string; cleared: boolean; check: Check }
  | { kind: "doc"; id: string; cleared: boolean; doc: WillDocument };

function requiredPendingDocs(docs: WillDocument[]): WillDocument[] {
  // A lawyer cannot approve until required client documents are received.
  return docs.filter(
    (d) =>
      ["emirates_id", "title_deed"].includes(d.doc_type) &&
      d.status !== "validated"
  );
}

export function LawyerDesk() {
  const db = useDB();
  const [selected, setSelected] = useState<string | null>(null);

  const queue = useMemo(() => {
    return db.wills
      .filter((w) => w.status === "in_review")
      .map((w) => {
        const checks = checksForWill(db, w.id);
        const docs = documentsForWill(db, w.id);
        const items =
          openReviewItems(checks).length + requiredPendingDocs(docs).length;
        return { will: w, load: items };
      })
      .sort((a, b) => b.load - a.load);
  }, [db]);

  const activeWill = selected ? willById(db, selected) : queue[0]?.will;
  const activeId = activeWill?.id ?? null;

  return (
    <div className="grid min-h-[calc(100vh-52px)] grid-cols-1 lg:grid-cols-[320px_1fr]">
      {/* dark navy queue rail */}
      <aside className="bg-ink text-paper-parchment px-4 py-5">
        <div className="px-2">
          <h2 className="font-serif text-xl">Review queue</h2>
          <p className="mt-1 text-xs text-paper/60">
            Sorted by judgment load — the genuine calls first.
          </p>
        </div>
        <div className="mt-4 space-y-2">
          {queue.length === 0 && (
            <p className="px-2 text-sm text-paper/60">
              No cases in review. Submit one from the Client tab.
            </p>
          )}
          {queue.map(({ will, load }) => {
            const lead = leadById(db, will.lead_id);
            const isActive = will.id === activeId;
            return (
              <button
                key={will.id}
                onClick={() => setSelected(will.id)}
                className={`w-full rounded-lg px-3 py-3 text-left transition-colors ${
                  isActive
                    ? "bg-paper-parchment text-ink"
                    : "bg-white/5 text-paper-parchment hover:bg-white/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {will.structured_json?.testator.full_name ||
                      lead?.full_name ||
                      "Unnamed"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      load > 0
                        ? "bg-amber/20 text-amber"
                        : "bg-sage/20 text-sage"
                    }`}
                  >
                    {load > 0 ? `${load} to review` : "ready"}
                  </span>
                </div>
                <div
                  className={`mt-1 text-xs ${
                    isActive ? "text-slate" : "text-paper/50"
                  }`}
                >
                  {will.structured_json?.distribution_summary?.slice(0, 60)}
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* case review */}
      <main className="bg-paper px-5 py-6 lg:px-8">
        {activeWill ? (
          <CaseReview key={activeWill.id} will={activeWill} />
        ) : (
          <div className="text-slate">Select a case.</div>
        )}
      </main>
    </div>
  );
}

function CaseReview({ will }: { will: Will }) {
  const db = useDB();
  const checks = checksForWill(db, will.id);
  const docs = documentsForWill(db, will.id);
  const lead = leadById(db, will.lead_id);
  const structured = will.structured_json;

  const cleared = clearedAtIntake(checks);
  const infos = infoChecks(checks);
  const openChecks = openReviewItems(checks);
  const resolvedChecks = checks.filter(
    (c) => c.severity === "warn" && c.resolved_at
  );
  const pendingDocs = requiredPendingDocs(docs);

  const complexity = caseComplexity(structured, checks);

  // Build the ordered item list. Resolved warns first (as cleared), then open
  // warns, then pending docs — a stable order so the gate is deterministic.
  const items: Item[] = [
    ...resolvedChecks.map((c) => ({
      kind: "check" as const,
      id: c.id,
      cleared: true,
      check: c,
    })),
    ...openChecks.map((c) => ({
      kind: "check" as const,
      id: c.id,
      cleared: false,
      check: c,
    })),
    ...docs
      .filter((d) => ["emirates_id", "title_deed"].includes(d.doc_type))
      .map((d) => ({
        kind: "doc" as const,
        id: d.id,
        cleared: d.status === "validated",
        doc: d,
      })),
  ];

  const totalItems = openChecks.length + pendingDocs.length;
  const clearedItems = items.filter((i) => !i.cleared).length === 0;
  const remaining = items.filter((i) => !i.cleared).length;

  // Start/refresh a review session when this case is on screen.
  const session =
    activeReviewSession(db, will.id) ||
    (will.status === "in_review"
      ? startReview(will.id, LAWYER_ID, totalItems, complexity)
      : undefined);

  // First not-cleared index → enforced ordering (locked until above cleared).
  const activeIndex = items.findIndex((i) => !i.cleared);

  const approved = will.status === "approved" || will.status === "registered";

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_460px]">
      <div className="space-y-5">
        {/* case status strip */}
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl text-ink">
                {structured?.testator.full_name || lead?.full_name}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <Pill tone="ink">DIFC Full Will</Pill>
                <Pill tone={complexity === "complex" ? "amber" : "sage"}>
                  {complexity} case
                </Pill>
                {structured?.assets.some((a) => a.needs_adjd) && (
                  <Pill tone="amber">ADJD split</Pill>
                )}
                {will.ai_structured && <Pill tone="amber">AI-structured</Pill>}
              </div>
            </div>
            <div className="text-right text-xs text-slate">
              <div>
                Ball with:{" "}
                <span className="font-semibold text-ink">
                  {remaining > 0 && pendingDocs.length > 0
                    ? "Client (docs) + Lawyer"
                    : approved
                    ? "Registry"
                    : "Lawyer"}
                </span>
              </div>
              {session?.started_at && (
                <div>
                  Review timer running (measures the 90→15 KPI)
                </div>
              )}
            </div>
          </div>
        </Card>

        {/* cleared-at-intake strip */}
        {cleared.length > 0 && (
          <Card className="border-sage/30 bg-sage/6 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-sage">
              ✓ Cleared at intake — no action needed
            </div>
            <p className="mb-2 mt-0.5 text-xs text-slate">
              Client-fixable checks that passed. Shown for your
              professional-liability record.
            </p>
            <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {cleared.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 text-sage">✓</span>
                  <span className="text-slate">{c.detail}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}

        {/* priority-ordered review items */}
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-slate">
              Judgment items — cleared in order
            </h3>
            <span className="text-xs text-slate">
              {items.filter((i) => i.cleared).length}/{items.length} cleared
            </span>
          </div>

          {items.length === 0 && (
            <Card className="p-4 text-sm text-slate">
              No judgment items — a clean standard case. Ready to approve.
            </Card>
          )}

          <div className="space-y-2">
            {items.map((item, i) => {
              const locked = !item.cleared && i !== activeIndex;
              return (
                <ReviewItemRow
                  key={item.id}
                  item={item}
                  locked={locked}
                  willId={will.id}
                  leadId={will.lead_id}
                  onClearCheck={(action) =>
                    clearReviewItem(will.id, item.id, LAWYER_ID, action)
                  }
                />
              );
            })}
          </div>
        </div>

        {/* approval gate */}
        {!approved ? (
          <div className="flex items-center justify-between rounded-xl2 border border-hairline bg-white p-4">
            <div className="text-sm text-slate">
              {clearedItems
                ? "All items cleared. You can approve."
                : `Clear ${remaining} more to approve.`}
            </div>
            <Button
              variant="sage"
              disabled={!clearedItems}
              onClick={() => approveWill(will.id, LAWYER_ID)}
            >
              Approve draft
            </Button>
          </div>
        ) : (
          <PostApproval will={will} />
        )}
      </div>

      {/* live document + info */}
      <div className="space-y-4">
        <Card className="p-5">
          <LiveWill structured={structured} compact />
        </Card>
        {infos.length > 0 && (
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate">
              For awareness
            </div>
            <ul className="mt-2 space-y-2">
              {infos.map((c) => (
                <li key={c.id} className="flex items-start gap-2 text-sm">
                  <SeverityBadge severity="info" />
                  <span className="text-slate">{c.detail}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}

function ReviewItemRow({
  item,
  locked,
  willId,
  leadId,
  onClearCheck,
}: {
  item: Item;
  locked: boolean;
  willId: string;
  leadId: string;
  onClearCheck: (action: "confirmed" | "verified") => void;
}) {
  if (item.kind === "check") {
    const c = item.check;
    const isAI = c.check_key === "ai_distribution";
    return (
      <Card
        className={`p-4 ${
          item.cleared
            ? "border-sage/30 bg-sage/5"
            : locked
            ? "opacity-50"
            : ""
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <SeverityBadge severity={item.cleared ? "ok" : "warn"} />
            <div>
              <div className="text-sm font-medium text-ink">
                {labelForCheck(c.check_key)}
              </div>
              <p className="mt-0.5 text-sm text-slate">{c.detail}</p>
            </div>
          </div>
          {item.cleared ? (
            <span className="whitespace-nowrap text-xs font-semibold text-sage">
              Cleared ✓
            </span>
          ) : locked ? (
            <span className="whitespace-nowrap text-xs text-slate">
              🔒 Locked
            </span>
          ) : (
            <Button
              variant="secondary"
              onClick={() => onClearCheck(isAI ? "verified" : "confirmed")}
            >
              {isAI ? "Verify & mark reviewed" : "Confirm & clear"}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  // client-owned document
  const d = item.doc;
  return (
    <Card
      className={`p-4 ${
        item.cleared ? "border-sage/30 bg-sage/5" : locked ? "opacity-50" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <SeverityBadge severity={item.cleared ? "ok" : "warn"}>
            {item.cleared ? "Received" : "Awaiting client"}
          </SeverityBadge>
          <div>
            <div className="text-sm font-medium text-ink">
              {d.doc_type.replace("_", " ")} outstanding
            </div>
            <p className="mt-0.5 text-sm text-slate">
              Client-owned — you can nudge or mark received, but not self-clear.
            </p>
          </div>
        </div>
        {item.cleared ? (
          <span className="whitespace-nowrap text-xs font-semibold text-sage">
            Received ✓
          </span>
        ) : locked ? (
          <span className="whitespace-nowrap text-xs text-slate">🔒 Locked</span>
        ) : (
          <div className="flex flex-col gap-2">
            <Button
              variant="secondary"
              onClick={() =>
                logReminder(
                  leadId,
                  "automated_email",
                  "system",
                  `${d.doc_type} outstanding`
                )
              }
            >
              Send reminder
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                markDocReceived(willId, d.doc_type as DocType, LAWYER_ID)
              }
            >
              Simulate: client uploaded
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

function PostApproval({ will }: { will: Will }) {
  const db = useDB();
  const [pkg, setPkg] = useState<PortalSubmission | null>(
    db.portal_submissions.find((p) => p.will_id === will.id) ?? null
  );

  const generate = () => {
    if (!will.structured_json) return;
    const sub: PortalSubmission = {
      id: crypto.randomUUID(),
      will_id: will.id,
      package_json: buildPortalPackage(will, will.structured_json),
      method: "manual_ops",
      ops_user_id: null,
      submitted_at: null,
      appointment_at: null,
      payment_status: "pending",
      registration_outcome: "pending",
      rejection_reason: null,
    };
    savePortalSubmission(sub);
    setPkg(sub);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl2 border border-sage/40 bg-sage/8 p-4">
        <div className="text-sm font-semibold text-sage">✓ Draft approved</div>
        <p className="mt-1 text-sm text-slate">
          Every judgment item cleared, in order. The will is ready for the DIFC
          Courts portal handoff.
        </p>
        {!pkg && (
          <Button className="mt-3" onClick={generate}>
            Generate Portal-Ready Package →
          </Button>
        )}
      </div>
      {pkg && (
        <PortalPackageView
          submission={pkg}
          onMarkRegistered={() => setWillStatus(will.id, "registered")}
          registered={will.status === "registered"}
        />
      )}
    </div>
  );
}

function labelForCheck(key: Check["check_key"]): string {
  const map: Partial<Record<Check["check_key"], string>> = {
    name_mismatch: "Passport / will name mismatch",
    minor_no_trust: "Minor inheriting without a trust",
    adjd_routing: "Abu Dhabi property — ADJD split",
    foreign_will_revocation: "Foreign will — revocation clash",
    deed_joint_owner: "Title deed — joint ownership",
    business_shares: "Business shares — transferability",
    ai_distribution: "AI-structured distribution — verify",
    guardian_needed: "Guardian nomination",
  };
  return map[key] || key;
}
