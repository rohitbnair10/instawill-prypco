"use client";

/**
 * LAWYER REVIEW — audit-and-approve desk, v2.
 *
 * Queue of intake-complete cases (content-complete; no content blocks reach
 * here), sorted by judgment LOAD, not date. On a case: a green "cleared at
 * intake" strip, an "Amend draft" panel (the lawyer's actual edits — the thing
 * the client final-approval screen later diffs against), priority-ordered
 * judgment items with ENFORCED ordering, and a gated Approve button.
 *
 * v2 change: approval does NOT go straight to the portal. It sends the case to
 * `pending_client_approval` — the testator must re-confirm (§1B-bis) before the
 * portal package generates. The human is never bypassed, on either side.
 */
import { useEffect, useMemo, useState } from "react";
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
  markWillRegistered,
  lawyerSetBeneficiaryTrust,
  lawyerSetBeneficiaryField,
  lawyerSetExecutor,
  lawyerSetGuardian,
  clarificationsForWill,
  raiseClarification,
} from "@/lib/store";
import {
  caseComplexity,
  clearedAtIntake,
  infoChecks,
  openReviewItems,
  STAGE_LABELS,
} from "@/lib/stateMachine";
import type {
  Check,
  Clarification,
  ClarificationChannel,
  ClarificationMode,
  DocType,
  Lead,
  StructuredWill,
  Will,
  WillDocument,
} from "@/lib/types";
import { LiveWill } from "@/components/LiveWill";
import { Button, Card, Pill, SeverityBadge, TextInput } from "@/components/ui/primitives";
import { PortalPackageView } from "./PortalPackage";

const LAWYER_ID = "user-lawyer-1";

type Item =
  | { kind: "check"; id: string; cleared: boolean; check: Check }
  | { kind: "doc"; id: string; cleared: boolean; doc: WillDocument };

function requiredPendingDocs(docs: WillDocument[]): WillDocument[] {
  return docs.filter(
    (d) => ["emirates_id", "title_deed"].includes(d.doc_type) && d.status !== "validated"
  );
}

const ACTIVE_STATUSES: Will["status"][] = ["in_review", "changes_requested"];
const POST_LAWYER_STATUSES: Will["status"][] = [
  "pending_client_approval",
  "client_approved",
  "portal_ready",
  "registered",
];

export function LawyerDesk() {
  const db = useDB();
  const [selected, setSelected] = useState<string | null>(null);

  const queue = useMemo(() => {
    return db.wills
      .filter((w) => ACTIVE_STATUSES.includes(w.status))
      .map((w) => {
        const checks = checksForWill(db, w.id);
        const docs = documentsForWill(db, w.id);
        const items = openReviewItems(checks).length + requiredPendingDocs(docs).length;
        return { will: w, load: items };
      })
      .sort((a, b) => b.load - a.load);
  }, [db]);

  const awaitingClarification = useMemo(
    () => db.wills.filter((w) => w.status === "awaiting_client"),
    [db]
  );

  const sentToClient = useMemo(
    () => db.wills.filter((w) => POST_LAWYER_STATUSES.includes(w.status)),
    [db]
  );

  // Pin the active case as soon as one exists. Without this, `activeWill` falls
  // back to queue[0], and the queue is sorted by judgment load — so clearing
  // the LAST item on a case drops its load to 0, re-sorts it away from the top,
  // and yanks the lawyer to a different client mid-approval. Pinning keeps them
  // on the same case; the Approve CTA simply unlocks in place.
  useEffect(() => {
    if (!selected && queue.length > 0) setSelected(queue[0].will.id);
  }, [selected, queue]);

  const activeWill = selected ? willById(db, selected) : queue[0]?.will;

  return (
    <div className="grid min-h-[calc(100vh-52px)] grid-cols-1 lg:grid-cols-[320px_1fr]">
      <aside className="bg-ink px-4 py-5 text-paper-parchment">
        <div className="px-2">
          <h2 className="font-serif text-xl">Review queue</h2>
          <p className="mt-1 text-xs text-paper/60">Sorted by judgment load — the genuine calls first.</p>
        </div>
        <div className="mt-4 space-y-2">
          {queue.length === 0 && (
            <p className="px-2 text-sm text-paper/60">No cases in review. Submit one from the Client tab.</p>
          )}
          {queue.map(({ will, load }) => {
            const lead = leadById(db, will.lead_id);
            const isActive = will.id === activeWill?.id;
            return (
              <button
                key={will.id}
                onClick={() => setSelected(will.id)}
                className={`w-full rounded-lg px-3 py-3 text-left transition-colors ${
                  isActive ? "bg-paper-parchment text-ink" : "bg-white/5 text-paper-parchment hover:bg-white/10"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">
                    {will.structured_json?.testator.name || lead?.full_name || "Unnamed"}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      load > 0 ? "bg-amber/20 text-amber" : "bg-sage/20 text-sage"
                    }`}
                  >
                    {load > 0 ? `${load} to review` : "ready"}
                  </span>
                </div>
                <div className={`mt-1 text-xs ${isActive ? "text-slate" : "text-paper/50"}`}>
                  {will.status === "changes_requested" ? "Client requested a change" : will.structured_json?.distribution_summary?.slice(0, 60)}
                </div>
              </button>
            );
          })}

          {awaitingClarification.length > 0 && (
            <>
              <div className="mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-paper/40">
                Awaiting client (clarification)
              </div>
              {awaitingClarification.map((w) => {
                const isActive = w.id === activeWill?.id;
                return (
                  <button
                    key={w.id}
                    onClick={() => setSelected(w.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      isActive ? "bg-paper-parchment text-ink" : "bg-white/5 text-paper-parchment hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span>{w.structured_json?.testator.name}</span>
                      <Pill tone="amber">timer paused</Pill>
                    </div>
                  </button>
                );
              })}
            </>
          )}

          {sentToClient.length > 0 && (
            <>
              <div className="mt-5 px-2 text-xs font-semibold uppercase tracking-wide text-paper/40">
                Sent to client / beyond
              </div>
              {sentToClient.map((w) => {
                const isActive = w.id === activeWill?.id;
                return (
                  <button
                    key={w.id}
                    onClick={() => setSelected(w.id)}
                    className={`w-full rounded-lg px-3 py-2 text-left transition-colors ${
                      isActive ? "bg-paper-parchment text-ink" : "bg-white/5 text-paper-parchment hover:bg-white/10"
                    }`}
                  >
                    <div className="flex items-center justify-between text-sm">
                      <span>{w.structured_json?.testator.name}</span>
                      <Pill tone="slate">{STAGE_LABELS[stageForStatus(w.status)]}</Pill>
                    </div>
                  </button>
                );
              })}
            </>
          )}
        </div>
      </aside>

      <main className="bg-paper px-5 py-6 lg:px-8">
        {activeWill ? <CaseReview key={activeWill.id} will={activeWill} /> : <div className="text-slate">Select a case.</div>}
      </main>
    </div>
  );
}

function stageForStatus(status: Will["status"]) {
  const map: Partial<Record<Will["status"], keyof typeof STAGE_LABELS>> = {
    pending_client_approval: "pending_client_approval",
    client_approved: "client_approved",
    portal_ready: "portal_ready",
    registered: "registered",
  };
  return (map[status] ?? "in_lawyer_review") as keyof typeof STAGE_LABELS;
}

function CaseReview({ will }: { will: Will }) {
  const db = useDB();
  const checks = checksForWill(db, will.id);
  const docs = documentsForWill(db, will.id);
  const lead = leadById(db, will.lead_id);
  const clarifications = clarificationsForWill(db, will.id);
  const structured = will.structured_json;

  if (!structured) return <div className="text-slate">No structured content yet.</div>;

  const isActive = ACTIVE_STATUSES.includes(will.status);
  const isAwaitingClarification = will.status === "awaiting_client";
  const cleared = clearedAtIntake(checks);
  const infos = infoChecks(checks);
  const openChecks = openReviewItems(checks);
  const resolvedChecks = checks.filter((c) => c.severity === "warn" && c.resolved_at);
  const pendingDocs = requiredPendingDocs(docs);
  const complexity = caseComplexity(structured, checks);

  const items: Item[] = [
    ...resolvedChecks.map((c) => ({ kind: "check" as const, id: c.id, cleared: true, check: c })),
    ...openChecks.map((c) => ({ kind: "check" as const, id: c.id, cleared: false, check: c })),
    ...docs
      .filter((d) => ["emirates_id", "title_deed"].includes(d.doc_type))
      .map((d) => ({ kind: "doc" as const, id: d.id, cleared: d.status === "validated", doc: d })),
  ];

  const totalItems = openChecks.length + pendingDocs.length;
  const remaining = items.filter((i) => !i.cleared).length;
  const allCleared = remaining === 0;

  const session =
    activeReviewSession(db, will.id) ||
    (isActive ? startReview(will.id, LAWYER_ID, totalItems, complexity) : undefined);

  const activeIndex = items.findIndex((i) => !i.cleared);

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_460px]">
      <div className="space-y-5">
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl text-ink">{structured.testator.name}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <Pill tone="ink">DIFC Full Will</Pill>
                <Pill tone={complexity === "complex" ? "amber" : "sage"}>{complexity} case</Pill>
                {structured.assets.some((a) => a.needs_adjd) && <Pill tone="amber">ADJD split</Pill>}
                {will.ai_structured && <Pill tone="amber">AI-structured</Pill>}
                {will.lawyer_made_changes && <Pill tone="slate">Lawyer amended</Pill>}
              </div>
            </div>
            <div className="text-right text-xs text-slate">
              <div>
                Ball with:{" "}
                <span className="font-semibold text-ink">
                  {isAwaitingClarification
                    ? "Client (clarification)"
                    : !isActive
                    ? will.status === "registered"
                      ? "Registry"
                      : "Client"
                    : remaining > 0 && pendingDocs.length > 0
                    ? "Client (docs) + Lawyer"
                    : "Lawyer"}
                </span>
              </div>
              {isActive && session?.started_at && <div>Review timer running (measures the 90→15 KPI)</div>}
              {isAwaitingClarification && <div>Review timer paused — clarification sent</div>}
            </div>
          </div>
        </Card>

        {isAwaitingClarification && <AwaitingClarificationBanner clarifications={clarifications} />}
        {!isActive && !isAwaitingClarification && <CaseStatusBanner will={will} />}

        {cleared.length > 0 && (
          <Card className="border-sage/30 bg-sage/6 p-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-sage">✓ Cleared at intake — no action needed</div>
            <p className="mb-2 mt-0.5 text-xs text-slate">
              Client-fixable checks that passed. Shown for your professional-liability record.
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

        {isActive && <AmendDraftPanel willId={will.id} structured={structured} />}

        {!isAwaitingClarification && (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-slate">Judgment items — cleared in order</h3>
              <span className="text-xs text-slate">
                {items.filter((i) => i.cleared).length}/{items.length} cleared
              </span>
            </div>

            {items.length === 0 && (
              <Card className="p-4 text-sm text-slate">No judgment items — a clean standard case. Ready to approve.</Card>
            )}

            <div className="space-y-2">
              {items.map((item, i) => {
                const locked = isActive && !item.cleared && i !== activeIndex;
                const linkedClarification =
                  item.kind === "check"
                    ? clarifications.find((c) => c.check_id === item.check.id && c.status === "answered")
                    : undefined;
                return (
                  <ReviewItemRow
                    key={item.id}
                    item={item}
                    locked={locked}
                    willId={will.id}
                    leadId={will.lead_id}
                    lead={lead}
                    structured={structured}
                    answeredClarification={linkedClarification}
                    onClearCheck={(action) => clearReviewItem(will.id, item.id, LAWYER_ID, action)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {isAwaitingClarification ? null : isActive ? (
          <div className="flex items-center justify-between rounded-xl2 border border-hairline bg-white p-4">
            <div className="text-sm text-slate">
              {allCleared ? "All items cleared. You can approve." : `Clear ${remaining} more to approve.`}
            </div>
            <Button variant="sage" disabled={!allCleared} onClick={() => approveWill(will.id, LAWYER_ID)}>
              Approve draft → send to client
            </Button>
          </div>
        ) : (
          <PostApproval will={will} />
        )}
      </div>

      <div className="space-y-4">
        <Card className="p-5">
          <LiveWill structured={structured} identity={will.identity} compact />
        </Card>
        <DocumentsOnFile docs={docs} />
        {infos.length > 0 && (
          <Card className="p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate">For awareness</div>
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

function CaseStatusBanner({ will }: { will: Will }) {
  const label = {
    pending_client_approval: {
      tone: "amber" as const,
      text: "Sent to the client for final approval — they must re-confirm before this proceeds to registration.",
    },
    client_approved: { tone: "sage" as const, text: "Client approved. Generating the portal-ready package." },
    portal_ready: { tone: "sage" as const, text: "Client approved and the portal package is ready for Ops." },
    registered: { tone: "sage" as const, text: "Registered with the DIFC Courts." },
  }[will.status as "pending_client_approval" | "client_approved" | "portal_ready" | "registered"];

  if (!label) return null;
  return (
    <Card className={`p-4 ${label.tone === "sage" ? "border-sage/30 bg-sage/6" : "border-amber/30 bg-amber/6"}`}>
      <p className={`text-sm ${label.tone === "sage" ? "text-sage" : "text-amber"}`}>{label.text}</p>
    </Card>
  );
}

/**
 * Shown while a case is `awaiting_client` (§1B-ter). Lawyer-direct, no ops
 * handoff — this just reflects the sent clarification and reminds the lawyer
 * the case drops out of the active queue until the client responds.
 */
function AwaitingClarificationBanner({ clarifications }: { clarifications: Clarification[] }) {
  const open = clarifications.find((c) => c.status === "sent");
  if (!open) return null;
  return (
    <Card className="border-amber/30 bg-amber/6 p-4">
      <div className="text-sm font-semibold text-amber">
        Awaiting client response — {open.mode === "document_reupload" ? "document re-upload requested" : "question sent"}
      </div>
      <p className="mt-1 text-sm text-ink">{open.message_final}</p>
      <p className="mt-2 text-xs text-slate">
        Sent via {open.channel} · This case is off your active queue until they respond, then it
        returns here at the same item.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Documents on file — lets the lawyer open what the client uploaded to verify
// against the structured data (passport name, title-deed owner, Emirates ID).
// ---------------------------------------------------------------------------

const DOC_ON_FILE_LABEL: Record<string, string> = {
  passport: "Passport",
  emirates_id: "Emirates ID",
  title_deed: "Title deed",
  witness_passport: "Witness passport",
  draft_will_pdf: "Draft will (PDF)",
};

function ocrSummary(ocr: Record<string, unknown> | null): string | null {
  if (!ocr) return null;
  const parts: string[] = [];
  const pick = (k: string, label: string) => {
    const v = ocr[k];
    if (v !== undefined && v !== null && v !== "") parts.push(`${label}: ${String(v)}`);
  };
  pick("full_name", "Name");
  pick("owner_name", "Owner");
  pick("owner", "Owner");
  pick("passport_number", "Passport #");
  pick("address", "Address");
  if (ocr["joint_owner"]) parts.push("Joint-owned");
  return parts.length ? parts.join(" · ") : null;
}

function DocumentsOnFile({ docs }: { docs: WillDocument[] }) {
  const visible = docs.filter((d) => d.doc_type !== "draft_will_pdf");
  if (visible.length === 0) {
    return (
      <Card className="p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate">Documents on file</div>
        <p className="mt-2 text-sm text-slate">No documents uploaded yet.</p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate">Documents on file</div>
      <p className="mt-0.5 text-xs text-slate">Open to verify against the will content.</p>
      <ul className="mt-2 space-y-2">
        {visible.map((d) => {
          const summary = ocrSummary(d.ocr_extracted);
          const uploaded = d.status !== "pending";
          return (
            <li key={d.id} className="rounded-lg border border-hairline bg-white px-3 py-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-ink">
                  {DOC_ON_FILE_LABEL[d.doc_type] ?? d.doc_type.replace("_", " ")}
                </span>
                {uploaded ? (
                  <Pill tone={d.status === "validated" ? "sage" : "slate"}>
                    {d.status === "validated" ? "Verified" : "Uploaded"}
                  </Pill>
                ) : (
                  <Pill tone="amber">Awaiting client</Pill>
                )}
              </div>
              {summary && <p className="mt-1 text-xs text-slate">{summary}</p>}
              {uploaded && (
                d.file_url ? (
                  <a
                    href={d.file_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-xs font-medium text-slate underline hover:text-ink"
                  >
                    View document →
                  </a>
                ) : (
                  <p className="mt-1 text-xs text-slate/70">Preview unavailable (stored securely).</p>
                )
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Amend draft — the lawyer's own edits (diffed later on the client's screen)
// ---------------------------------------------------------------------------

function AmendDraftPanel({ willId, structured }: { willId: string; structured: StructuredWill }) {
  const [open, setOpen] = useState(false);

  return (
    <Card className="p-4">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setOpen((o) => !o)}>
        <span className="text-sm font-semibold text-ink">Amend draft</span>
        <span className="text-xs text-slate">{open ? "Hide" : "Edit beneficiaries, executor, guardian"}</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          {structured.beneficiaries.map((b) => (
            <div key={b.name} className="rounded-lg border border-hairline p-3">
              <div className="flex items-center justify-between text-sm font-medium text-ink">
                <span>
                  {b.name} <span className="text-slate">({b.relationship})</span>
                </span>
                {b.is_minor && <Pill tone={b.held_in_trust ? "sage" : "clay"}>minor</Pill>}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                <BlurCommitInput
                  label="Share %"
                  defaultValue={String(b.share_pct)}
                  onCommit={(v) => lawyerSetBeneficiaryField(willId, b.name, "share_pct", Number(v) || 0)}
                />
                <BlurCommitInput
                  label="Substitution"
                  defaultValue={b.substitution}
                  onCommit={(v) => lawyerSetBeneficiaryField(willId, b.name, "substitution", v)}
                />
                {b.is_minor && (
                  <label className="flex items-center gap-2 pt-5 text-xs text-slate">
                    <input
                      type="checkbox"
                      checked={b.held_in_trust}
                      onChange={(e) => lawyerSetBeneficiaryTrust(willId, b.name, e.target.checked)}
                    />
                    Hold in trust until 21
                  </label>
                )}
              </div>
            </div>
          ))}

          <div className="rounded-lg border border-hairline p-3">
            <div className="text-sm font-medium text-ink">Executor</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <BlurCommitInput
                label="Name"
                defaultValue={structured.executor.name}
                onCommit={(v) => lawyerSetExecutor(willId, { ...structured.executor, name: v })}
              />
              <BlurCommitInput
                label="Relationship"
                defaultValue={structured.executor.relationship}
                onCommit={(v) => lawyerSetExecutor(willId, { ...structured.executor, relationship: v })}
              />
            </div>
          </div>

          {(structured.guardian || structured.beneficiaries.some((b) => b.is_minor)) && (
            <div className="rounded-lg border border-hairline p-3">
              <div className="text-sm font-medium text-ink">Guardian</div>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <BlurCommitInput
                  label="Name"
                  defaultValue={structured.guardian?.name ?? ""}
                  onCommit={(v) =>
                    lawyerSetGuardian(willId, v ? { name: v, relationship: structured.guardian?.relationship ?? "" } : null)
                  }
                />
                <BlurCommitInput
                  label="Relationship"
                  defaultValue={structured.guardian?.relationship ?? ""}
                  onCommit={(v) =>
                    lawyerSetGuardian(willId, structured.guardian ? { ...structured.guardian, relationship: v } : { name: "", relationship: v })
                  }
                />
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function BlurCommitInput({
  label,
  defaultValue,
  onCommit,
}: {
  label: string;
  defaultValue: string;
  onCommit: (v: string) => void;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] text-slate">{label}</span>
      <TextInput value={value} onChange={(e) => setValue(e.target.value)} onBlur={() => onCommit(value)} />
    </label>
  );
}

// ---------------------------------------------------------------------------
// Review item row
// ---------------------------------------------------------------------------

function ReviewItemRow({
  item,
  locked,
  willId,
  leadId,
  lead,
  structured,
  answeredClarification,
  onClearCheck,
}: {
  item: Item;
  locked: boolean;
  willId: string;
  leadId: string;
  lead: Lead | undefined;
  structured: StructuredWill;
  answeredClarification?: Clarification;
  onClearCheck: (action: "confirmed" | "verified") => void;
}) {
  const [clarifyOpen, setClarifyOpen] = useState(false);

  if (item.kind === "check") {
    const c = item.check;
    const isAI = c.check_key === "ai_distribution";
    const isMinorTrust = c.check_key === "minor_no_trust";
    const minorBeneficiary = isMinorTrust
      ? structured.beneficiaries.find((b) => c.detail.startsWith(b.name))
      : null;

    return (
      <Card className={`p-4 ${item.cleared ? "border-sage/30 bg-sage/5" : locked ? "opacity-50" : ""}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-2">
            <SeverityBadge severity={item.cleared ? "ok" : "warn"} />
            <div>
              <div className="text-sm font-medium text-ink">{labelForCheck(c.check_key)}</div>
              <p className="mt-0.5 text-sm text-slate">{c.detail}</p>
              {answeredClarification && (
                <div className="mt-2 rounded-lg bg-sage/8 px-3 py-2 text-sm">
                  <span className="font-semibold text-sage">Client responded: </span>
                  <span className="text-ink">
                    {answeredClarification.response_text ||
                      (answeredClarification.response_file_path ? "Document re-uploaded." : "(no text response)")}
                  </span>
                </div>
              )}
            </div>
          </div>
          {item.cleared ? (
            <span className="whitespace-nowrap text-xs font-semibold text-sage">Cleared ✓</span>
          ) : locked ? (
            <span className="whitespace-nowrap text-xs text-slate">🔒 Locked</span>
          ) : (
            <div className="flex flex-col items-end gap-2">
              {isMinorTrust && minorBeneficiary ? (
                <Button variant="secondary" onClick={() => lawyerSetBeneficiaryTrust(willId, minorBeneficiary.name, true)}>
                  Hold in trust &amp; clear
                </Button>
              ) : (
                <Button variant="secondary" onClick={() => onClearCheck(isAI ? "verified" : "confirmed")}>
                  {isAI ? "Verify & mark reviewed" : "Confirm & clear"}
                </Button>
              )}
              {!answeredClarification && (
                <button className="text-xs text-slate underline" onClick={() => setClarifyOpen((o) => !o)}>
                  {clarifyOpen ? "Cancel" : "Ask the client"}
                </button>
              )}
            </div>
          )}
        </div>
        {clarifyOpen && !item.cleared && !locked && (
          <ClarifyPanel
            willId={willId}
            checkId={c.id}
            checkKey={c.check_key}
            checkDetail={c.detail}
            lead={lead}
            onSent={() => setClarifyOpen(false)}
          />
        )}
      </Card>
    );
  }

  const d = item.doc;
  return (
    <Card className={`p-4 ${item.cleared ? "border-sage/30 bg-sage/5" : locked ? "opacity-50" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <SeverityBadge severity={item.cleared ? "ok" : "warn"}>{item.cleared ? "Received" : "Awaiting client"}</SeverityBadge>
          <div>
            <div className="text-sm font-medium text-ink">{d.doc_type.replace("_", " ")} outstanding</div>
            <p className="mt-0.5 text-sm text-slate">Client-owned — you can nudge or mark received, but not self-clear.</p>
          </div>
        </div>
        {item.cleared ? (
          <span className="whitespace-nowrap text-xs font-semibold text-sage">Received ✓</span>
        ) : locked ? (
          <span className="whitespace-nowrap text-xs text-slate">🔒 Locked</span>
        ) : (
          <div className="flex flex-col gap-2">
            <Button variant="secondary" onClick={() => logReminder(leadId, "automated_email", "system", `${d.doc_type} outstanding`)}>
              Send reminder
            </Button>
            <Button variant="ghost" onClick={() => markDocReceived(willId, d.doc_type as DocType, LAWYER_ID)}>
              Simulate: client uploaded
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Ask the client (§1B-ter) — lawyer-direct, one click, LLM-drafted preview.
// ---------------------------------------------------------------------------

const REUPLOAD_DOC_BY_CHECK: Partial<Record<Check["check_key"], DocType>> = {
  name_mismatch: "passport",
  deed_joint_owner: "title_deed",
};

function ClarifyPanel({
  willId,
  checkId,
  checkKey,
  checkDetail,
  lead,
  onSent,
}: {
  willId: string;
  checkId: string;
  checkKey: Check["check_key"];
  checkDetail: string;
  lead: Lead | undefined;
  onSent: () => void;
}) {
  // Document-reupload is only meaningful for a couple of checks; everything
  // else is a plain question. We pick the right default and don't make the
  // lawyer choose unless it's genuinely a re-upload situation.
  const reuploadDoc = REUPLOAD_DOC_BY_CHECK[checkKey];
  const mode: ClarificationMode = reuploadDoc ? "document_reupload" : "question";
  const question = `Can you confirm: ${checkDetail}`;
  // Channel is chosen silently from the client's own preference — no picker.
  const channel: ClarificationChannel =
    lead?.preferred_channel === "whatsapp" ? "whatsapp" : "email";

  const [message, setMessage] = useState<string>("");
  const [drafting, setDrafting] = useState(true);
  const [sending, setSending] = useState(false);

  // Auto-draft the message as soon as the panel opens — the lawyer just edits
  // and sends. No "draft" button, no channel/mode ceremony.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setDrafting(true);
      try {
        const res = await fetch("/api/clarification-draft", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            clientName: lead?.full_name || "there",
            mode,
            question,
            docType: mode === "document_reupload" ? reuploadDoc : undefined,
          }),
        });
        const data = (await res.json()) as { text: string };
        if (!cancelled) setMessage(data.text);
      } catch {
        if (!cancelled) setMessage(`Hi — quick one from your InstaWill lawyer: ${question}`);
      } finally {
        if (!cancelled) setDrafting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = () => {
    if (!message.trim() || !lead) return;
    setSending(true);
    raiseClarification(
      willId,
      checkId,
      LAWYER_ID,
      mode,
      question,
      mode === "document_reupload" ? reuploadDoc ?? null : null,
      channel,
      message,
      message
    );
    // Mirror into Postgres so the n8n clarification workflow can pick it up
    // and email the client. Fire-and-forget: a Supabase/network hiccup must
    // never block the local demo flow (which already moved forward above).
    fetch("/api/clarifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        leadName: lead.full_name,
        leadEmail: lead.email,
        leadPhone: lead.phone,
        preferredChannel: lead.preferred_channel,
        mode,
        question,
        docType: mode === "document_reupload" ? reuploadDoc ?? null : null,
        channel,
        messagePreview: message,
        messageFinal: message,
      }),
    }).catch((err) => console.error("clarification mirror failed:", err));
    onSent();
  };

  return (
    <div className="mt-3 rounded-lg border border-hairline bg-paper-deep/30 p-3">
      <div className="text-xs font-medium text-slate">
        {mode === "document_reupload"
          ? `Auto-drafted request to re-upload their ${(reuploadDoc ?? "document").replace("_", " ")} — edit if needed, then send:`
          : "Auto-drafted question for the client — edit if needed, then send:"}
      </div>
      {drafting ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-hairline bg-white px-3 py-3 text-sm text-slate">
          <span className="h-3 w-3 animate-pulse rounded-full bg-slate/40" />
          Drafting a message…
        </div>
      ) : (
        <textarea
          className="mt-2 w-full rounded-lg border border-hairline bg-white px-3 py-2 text-sm text-ink outline-none focus:border-slate focus:ring-2 focus:ring-slate/20"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      )}
      <div className="mt-2 flex items-center justify-between">
        <span className="text-xs text-slate">
          Sends via {channel} to the client&apos;s secure link.
        </span>
        <Button variant="sage" disabled={drafting || sending || !message.trim() || !lead} onClick={send}>
          Send
        </Button>
      </div>
    </div>
  );
}

function PostApproval({ will }: { will: Will }) {
  const db = useDB();
  const submission = db.portal_submissions.find((p) => p.will_id === will.id);

  if (will.status === "pending_client_approval") {
    return (
      <Card className="p-4 text-sm text-slate">
        Waiting on the client. Switch to the <strong>Client journey</strong> tab — they&apos;ll see this
        case in their &quot;awaiting your final approval&quot; list.
      </Card>
    );
  }

  if (!submission) {
    return <Card className="p-4 text-sm text-slate">Client approved — generating the portal package…</Card>;
  }

  return (
    <PortalPackageView
      submission={submission}
      onMarkRegistered={() => markWillRegistered(will.id)}
      registered={will.status === "registered"}
      structured={will.structured_json}
      identity={will.identity}
    />
  );
}

function labelForCheck(key: Check["check_key"]): string {
  const map: Partial<Record<Check["check_key"], string>> = {
    executor_missing: "No executor named",
    executor_relationship_missing: "Executor relationship not stated",
    beneficiary_incomplete: "Beneficiary missing a name",
    beneficiary_relationship_missing: "Beneficiary relationship not stated",
    property_address_missing: "Property missing an address",
    guardian_for_minor_missing: "No guardian for a minor child",
    name_mismatch: "Passport / will name mismatch",
    minor_no_trust: "Minor inheriting without a trust",
    duplicate_beneficiary: "Duplicate beneficiary",
    adjd_routing: "Abu Dhabi property — ADJD split",
    foreign_will_revocation: "Foreign will — revocation clash",
    deed_joint_owner: "Title deed — joint ownership",
    business_shares: "Business shares — transferability",
    substitution_missing: "Missing substitution instruction",
    ai_distribution: "AI-structured distribution — verify",
    guardian_needed: "Guardian nomination",
  };
  return map[key] || key;
}
