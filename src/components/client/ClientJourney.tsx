"use client";

/**
 * CLIENT JOURNEY — v2, automation-first.
 *
 * Two-panel layout: input left, the live-assembling DIFC Schedule 1 document
 * right. Five steps:
 *   0. Identity        — passport-first OCR, residency branch (rules, not AI).
 *   1. Your wishes      — ONE free-text box. This triggers the real LLM call.
 *   2. Confirm           — "here's what we understood": plain-language summary
 *                          + editable structured fields + rules-engine flags.
 *   3. Documents         — deferrable, never gatekeeps.
 *   4. Review & submit   — completeness checklist + dual CTAs.
 *
 * Design principle honoured throughout: STRICT on content, ASYNC on documents.
 * Only will-CONTENT that makes the will legally unregistrable ever blocks the
 * client (shares != 100, no UAE asset, missing/expired passport).
 */
import { useEffect, useState } from "react";
import type {
  AssetType,
  Emirate,
  Identity,
  IntakeDraft,
  LeadStage,
  StructuredWill,
  Will,
} from "@/lib/types";
import { fallbackStructure } from "@/lib/structure";
import { compareNames, runRules, type RuleResult } from "@/lib/rules";
import { buildClientPrompts, clientSummaryLine } from "@/lib/clientPrompts";
import type { StructureResult } from "@/lib/llm";
import {
  commitStructuredWill,
  createIntake,
  getDB,
  recordDocument,
  saveDraft,
  setLeadStage,
  submitWill,
  updateLead,
  useDB,
  willsForLead,
  type DB,
} from "@/lib/store";
import { uploadDocumentFile } from "@/lib/storage";
import { LiveWill } from "@/components/LiveWill";
import { ImageCapture } from "@/components/ui/ImageCapture";
import type { EmiratesIdExtract, PassportExtract, TitleDeedExtract } from "@/lib/ocrSchema";
import {
  Button,
  Card,
  Labeled,
  MockLabel,
  Pill,
  Select,
  SeverityBadge,
  TextInput,
} from "@/components/ui/primitives";
import { ClientFinalApproval } from "./ClientFinalApproval";
import { ClarificationResponse } from "./ClarificationResponse";

const STEPS = ["Identity", "Your wishes", "Confirm", "Documents", "Review"] as const;

const STAGE_FOR_STEP: LeadStage[] = ["identity", "wishes", "confirm", "documents", "review"];

/**
 * There's no real login in this prototype, so we track "who this browser is"
 * locally — mirroring how the production RLS policies in supabase/schema.sql
 * scope a client to only their own lead (matched by auth email). Without this,
 * the "welcome back" picker would show every client's pending approvals and
 * lawyer questions to whoever opens the tab, which is a real privacy bug, not
 * just a demo wrinkle.
 */
const CURRENT_LEAD_KEY = "instawill.currentLeadId";

function getStoredLeadId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(CURRENT_LEAD_KEY);
}
function setStoredLeadId(id: string | null) {
  if (typeof window === "undefined") return;
  if (id) window.localStorage.setItem(CURRENT_LEAD_KEY, id);
  else window.localStorage.removeItem(CURRENT_LEAD_KEY);
}

function identityFromDraft(draft: IntakeDraft): Identity {
  return {
    full_name: draft.passport.full_name,
    passport_number: draft.passport.passport_number,
    passport_expiry: draft.passport.passport_expiry,
    passport_expired:
      Boolean(draft.passport.passport_expiry) &&
      new Date(draft.passport.passport_expiry) < new Date(),
    nationality: draft.passport.nationality || null,
    residency_status: draft.residency_status,
    emirates_id_number: draft.emirates_id.number || null,
    emirates_id_address: draft.emirates_id.ocr?.address || null,
  };
}

export function ClientJourney() {
  const db = useDB();
  const [approvalWillId, setApprovalWillId] = useState<string | null>(null);
  const [respondingClarificationId, setRespondingClarificationId] = useState<string | null>(null);
  const [manualIntake, setManualIntake] = useState(false);
  const [currentLeadId, setCurrentLeadId] = useState<string | null>(null);

  // Read "who this browser is" after mount (localStorage isn't available
  // during SSR). Matches getServerSnapshot's SSR pass, which also has none —
  // no hydration mismatch, just a brief moment before the login-like chooser
  // resolves to a specific identity if one was already picked.
  useEffect(() => {
    setCurrentLeadId(getStoredLeadId());
  }, []);

  const chooseIdentity = (leadId: string) => {
    setStoredLeadId(leadId);
    setCurrentLeadId(leadId);
  };
  const switchIdentity = () => {
    setStoredLeadId(null);
    setCurrentLeadId(null);
    setManualIntake(false);
  };

  if (approvalWillId) {
    return <ClientFinalApproval willId={approvalWillId} onDone={() => setApprovalWillId(null)} />;
  }

  if (respondingClarificationId) {
    return (
      <ClarificationResponse
        clarificationId={respondingClarificationId}
        onDone={() => setRespondingClarificationId(null)}
      />
    );
  }

  // Every "who has something pending" list below is scoped to currentLeadId —
  // a client only ever sees their own lead's items, never anyone else's.
  const pendingApproval = currentLeadId
    ? db.wills.filter((w) => w.status === "pending_client_approval" && w.lead_id === currentLeadId)
    : [];
  const pendingClarifications = currentLeadId
    ? db.clarifications.filter((c) => {
        if (c.status !== "sent") return false;
        const w = db.wills.find((x) => x.id === c.will_id);
        return w?.lead_id === currentLeadId;
      })
    : [];

  // No identity chosen yet: this prototype has no real login, so — unlike a
  // production app scoping by an authenticated session — we ask which demo
  // client this browser is, rather than defaulting to showing anyone's data.
  if (!currentLeadId && !manualIntake) {
    return <IdentityChooser db={db} onChoose={chooseIdentity} onStartNew={() => setManualIntake(true)} />;
  }

  // Derived directly from live store state on every render (not a one-time
  // effect) — the store seeds asynchronously on first mount, so deciding this
  // once at mount time would race the seed and could permanently skip the
  // picker on a fresh page load even when a will is genuinely pending.
  if ((pendingApproval.length > 0 || pendingClarifications.length > 0) && !manualIntake) {
    return (
      <div className="mx-auto max-w-xl px-5 py-10">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-2xl text-ink">Welcome back</h2>
          <button className="text-xs text-slate underline" onClick={switchIdentity}>
            Not you? Switch
          </button>
        </div>

        {pendingClarifications.length > 0 && (
          <>
            <p className="mt-2 text-sm text-slate">
              Your lawyer has {pendingClarifications.length} question
              {pendingClarifications.length === 1 ? "" : "s"} before they can continue reviewing
              your will.
            </p>
            <div className="mt-4 space-y-2">
              {pendingClarifications.map((c) => {
                const w = db.wills.find((x) => x.id === c.will_id);
                return (
                  <Card key={c.id} className="flex items-center justify-between border-amber/30 bg-amber/6 p-4">
                    <div>
                      <div className="font-medium text-ink">
                        {w?.structured_json?.testator.name || w?.identity?.full_name}
                      </div>
                      <div className="text-xs text-slate">
                        {c.mode === "document_reupload" ? "Document re-upload requested" : "A quick question"}
                      </div>
                    </div>
                    <Button onClick={() => setRespondingClarificationId(c.id)}>Respond</Button>
                  </Card>
                );
              })}
            </div>
          </>
        )}

        {pendingApproval.length > 0 && (
          <>
            <p className="mt-6 text-sm text-slate">
              You have {pendingApproval.length} will{pendingApproval.length === 1 ? "" : "s"}{" "}
              awaiting your final approval before it can go to registration.
            </p>
            <div className="mt-4 space-y-2">
              {pendingApproval.map((w) => (
                <Card key={w.id} className="flex items-center justify-between p-4">
                  <div>
                    <div className="font-medium text-ink">
                      {w.structured_json?.testator.name || w.identity?.full_name}
                    </div>
                    <div className="text-xs text-slate">
                      {w.lawyer_made_changes
                        ? "Your lawyer made changes — review before proceeding"
                        : "Your lawyer approved with no changes"}
                    </div>
                  </div>
                  <Button onClick={() => setApprovalWillId(w.id)}>Review &amp; approve</Button>
                </Card>
              ))}
            </div>
          </>
        )}

        <Button className="mt-6" variant="secondary" onClick={() => setManualIntake(true)}>
          Start a new will instead →
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="border-b border-hairline bg-paper px-5 py-2 text-right lg:px-10">
        <button className="text-xs text-slate underline" onClick={switchIdentity}>
          ← See pending items / switch client
        </button>
      </div>
      <IntakeWizard />
    </div>
  );
}

/**
 * There's no real login in this prototype. Rather than default to showing
 * whoever's data happens to be pending (the bug this replaces), we ask which
 * client this browser is — the same scoping a real login would give for
 * free. Only lists identities that currently have something pending; picking
 * one is the only way to see that lead's items.
 */
function IdentityChooser({
  db,
  onChoose,
  onStartNew,
}: {
  db: DB;
  onChoose: (leadId: string) => void;
  onStartNew: () => void;
}) {
  const leadIdsWithClarifications = new Set(
    db.clarifications
      .filter((c) => c.status === "sent")
      .map((c) => db.wills.find((w) => w.id === c.will_id)?.lead_id)
      .filter((id): id is string => Boolean(id))
  );
  const leadIdsWithApproval = new Set(
    db.wills.filter((w) => w.status === "pending_client_approval").map((w) => w.lead_id)
  );
  const candidateLeadIds = new Set([...leadIdsWithClarifications, ...leadIdsWithApproval]);
  const candidates = db.leads.filter((l) => candidateLeadIds.has(l.id));

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <h2 className="font-serif text-2xl text-ink">Who are you?</h2>
      <p className="mt-2 text-sm text-slate">
        <MockLabel>Demo — no real login</MockLabel> Pick a client to see only their own
        pending items. This mirrors how a real login would scope you to just your own will.
      </p>
      {candidates.length > 0 && (
        <div className="mt-4 space-y-2">
          {candidates.map((l) => {
            const hasClarification = leadIdsWithClarifications.has(l.id);
            const hasApproval = leadIdsWithApproval.has(l.id);
            return (
              <Card key={l.id} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium text-ink">{l.full_name}</div>
                  <div className="text-xs text-slate">
                    {[
                      hasClarification && "lawyer has a question",
                      hasApproval && "awaiting your final approval",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </div>
                </div>
                <Button onClick={() => onChoose(l.id)}>Continue as {l.full_name.split(" ")[0]}</Button>
              </Card>
            );
          })}
        </div>
      )}
      <Button className="mt-6" variant="secondary" onClick={onStartNew}>
        I&apos;m a new client — start a will →
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The 5-step wizard
// ---------------------------------------------------------------------------

function IntakeWizard() {
  const [ids, setIds] = useState<{ leadId: string; willId: string } | null>(null);
  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  const [step, setStep] = useState(0);
  const [structuring, setStructuring] = useState(false);
  const [result, setResult] = useState<StructureResult | null>(null);
  const [editable, setEditable] = useState<StructuredWill | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const { lead, will, draft } = createIntake({ utm: { utm_source: "demo", utm_medium: "direct" } });
    setIds({ leadId: lead.id, willId: will.id });
    setDraft(draft);
    // This browser is now "this" client going forward — so if this will
    // later needs their final approval or a lawyer's clarification, the
    // welcome-back picker resolves to them, not to whoever else's data.
    setStoredLeadId(lead.id);
  }, []);

  const update = (patch: Partial<IntakeDraft>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveDraft(next);
      return next;
    });
  };

  if (!draft || !ids) return null;

  const identity = identityFromDraft(draft);
  const previewStructured: StructuredWill = editable ?? fallbackStructure(identity, draft.wishes_text);

  const goto = (n: number) => {
    setStep(n);
    setLeadStage(ids.leadId, STAGE_FOR_STEP[n]);
    updateLead(ids.leadId, { full_name: identity.full_name, residency_status: identity.residency_status });
  };

  return (
    <div className="grid min-h-[calc(100vh-52px)] grid-cols-1 lg:grid-cols-2">
      {/* LEFT — questions */}
      <div className="border-r border-hairline bg-paper px-5 py-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-xl">
          <StepHeader step={step} />
          <div className="mt-6">
            {step === 0 && <IdentityStep draft={draft} update={update} willId={ids.willId} />}
            {step === 1 && (
              <WishesStep
                draft={draft}
                update={update}
                structuring={structuring}
                onStructure={async () => {
                  setStructuring(true);
                  try {
                    const res = await fetch("/api/structure", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ identity, wishes_text: draft.wishes_text }),
                    });
                    const data = (await res.json()) as StructureResult;
                    setResult(data);
                    setEditable(data.structured);
                  } catch {
                    const fb = fallbackStructure(identity, draft.wishes_text);
                    setResult({
                      structured: fb,
                      ai_structured: true,
                      source: "fallback",
                      note: "Network error reaching /api/structure — used the honest fallback.",
                    });
                    setEditable(fb);
                  } finally {
                    setStructuring(false);
                    goto(2);
                  }
                }}
              />
            )}
            {step === 2 && editable && result && (
              <ConfirmStep
                identity={identity}
                structured={editable}
                setStructured={setEditable}
                result={result}
                confirmed={confirmed}
                onConfirm={() => {
                  const rules = runRules(editable, {
                    identity,
                    title_deed: draft.title_deed.uploaded
                      ? { uploaded: true, owner: draft.title_deed.ocr?.owner, joint_owner: draft.title_deed.ocr?.joint_owner }
                      : null,
                    ai_structured: result.ai_structured,
                  });
                  commitStructuredWill(ids.willId, identity, draft.wishes_text, editable, result.ai_structured, rules);
                  setConfirmed(true);
                  goto(3);
                }}
              />
            )}
            {step === 3 && (
              <DocumentsStep draft={draft} update={update} willId={ids.willId} identity={identity} />
            )}
            {step === 4 && (
              <ReviewStep
                draft={draft}
                identity={identity}
                structured={editable}
                aiStructured={result?.ai_structured ?? false}
                submitted={submitted}
                onSubmit={(documentsPending, booking) => {
                  submitWill(ids.willId, documentsPending, booking);
                  setSubmitted(true);
                }}
              />
            )}
          </div>

          <StepNav
            step={step}
            draft={draft}
            confirmed={confirmed}
            structuring={structuring}
            submitted={submitted}
            onBack={() => goto(step - 1)}
            onNext={() => goto(step + 1)}
          />
        </div>
      </div>

      {/* RIGHT — the live-assembling will */}
      <div className="bg-paper-deep/40 px-5 py-6 lg:px-8 lg:py-8">
        <div className="mx-auto max-w-xl">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-widest text-slate">
              Your will — assembling live
            </span>
            {result && (
              <Pill tone={result.source === "llm" ? "sage" : "amber"}>
                {result.source === "llm" ? "LLM-structured" : "Fallback"}
              </Pill>
            )}
          </div>
          <Card className="p-6">
            <LiveWill structured={step >= 1 ? previewStructured : null} identity={identity} />
          </Card>
          <p className="mt-3 text-center text-xs text-slate">
            Nothing is final until a lawyer signs off — and then, until you do too.
          </p>
        </div>
      </div>
    </div>
  );
}

function StepHeader({ step }: { step: number }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5">
        {STEPS.map((_, i) => (
          <div key={i} className={`h-1.5 flex-1 rounded-full ${i <= step ? "bg-sage" : "bg-paper-deep"}`} />
        ))}
      </div>
      <div className="text-xs font-medium uppercase tracking-widest text-slate">
        Step {step + 1} of {STEPS.length}
      </div>
      <h2 className="mt-1 font-serif text-2xl text-ink">{STEPS[step]}</h2>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 0 — Identity
// ---------------------------------------------------------------------------

function IdentityStep({
  draft,
  update,
  willId,
}: {
  draft: IntakeDraft;
  update: (p: Partial<IntakeDraft>) => void;
  willId: string;
}) {
  const applyExtraction = (extracted: PassportExtract, file?: File) => {
    update({
      passport: {
        uploaded: true,
        ocr: {
          full_name: extracted.full_name,
          passport_number: extracted.passport_number,
          passport_expiry: extracted.passport_expiry,
          nationality: extracted.nationality ?? null,
        },
        full_name: extracted.full_name,
        passport_number: extracted.passport_number,
        passport_expiry: extracted.passport_expiry,
        nationality: extracted.nationality || "",
      },
    });
    if (file) {
      uploadDocumentFile(willId, "passport", file).then((stored) =>
        recordDocument(willId, "passport", {
          status: "validated",
          ocr_extracted: { ...extracted },
          match_result: "match",
          file_path: stored.file_path,
          file_url: stored.file_url,
          expires_at: stored.expires_at,
          uploaded_at: new Date().toISOString(),
          validated_at: new Date().toISOString(),
        })
      );
    }
  };

  const scanDemo = () => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + 6);
    applyExtraction({
      full_name: "Sarah Anne Whitfield",
      passport_number: "561234789",
      passport_expiry: d.toISOString().slice(0, 10),
      nationality: "British",
      legible: true,
    });
  };

  const expired =
    draft.passport.uploaded && new Date(draft.passport.passport_expiry) < new Date();

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate">
        We start with your passport. Scan it and we&apos;ll read your details — you just
        review and correct. Passport is mandatory; Emirates ID is asked only if
        you&apos;re a UAE resident.
      </p>

      {!draft.passport.uploaded ? (
        <Card className="p-5">
          <div className="font-medium text-ink">Scan your passport</div>
          <p className="mt-1 text-xs text-slate">
            Photo page only. Read by Claude vision, then you review and correct.
          </p>
          <div className="mt-4">
            <ImageCapture<PassportExtract>
              docType="passport"
              label="passport"
              onExtracted={({ extracted, file }) => applyExtraction(extracted, file)}
            />
          </div>
          <button className="mt-3 text-xs text-slate underline" onClick={scanDemo}>
            No document handy? Use a demo passport
          </button>
        </Card>
      ) : (
        <>
          {expired && (
            <div className="rounded-lg border border-clay/40 bg-clay/8 p-3 text-sm text-clay">
              <SeverityBadge severity="block" /> This passport is expired. DIFC won&apos;t
              accept it — please provide a valid passport before submitting.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label="Full name">
              <TextInput
                value={draft.passport.full_name}
                onChange={(e) => update({ passport: { ...draft.passport, full_name: e.target.value } })}
              />
            </Labeled>
            <Labeled label="Nationality">
              <TextInput
                value={draft.passport.nationality}
                onChange={(e) => update({ passport: { ...draft.passport, nationality: e.target.value } })}
              />
            </Labeled>
            <Labeled label="Passport number">
              <TextInput
                value={draft.passport.passport_number}
                onChange={(e) => update({ passport: { ...draft.passport, passport_number: e.target.value } })}
              />
            </Labeled>
            <Labeled label="Passport expiry">
              <TextInput
                type="date"
                value={draft.passport.passport_expiry}
                onChange={(e) => update({ passport: { ...draft.passport, passport_expiry: e.target.value } })}
              />
            </Labeled>
          </div>
          <button
            className="text-xs text-slate underline"
            onClick={() =>
              update({
                passport: { uploaded: false, ocr: null, full_name: "", passport_number: "", passport_expiry: "", nationality: "" },
              })
            }
          >
            Re-scan
          </button>
        </>
      )}

      <Labeled label="Are you a UAE resident (hold an Emirates ID)?">
        <div className="flex gap-2">
          <Button
            variant={draft.residency_status === "resident" ? "sage" : "secondary"}
            onClick={() => update({ residency_status: "resident" })}
          >
            Yes, resident
          </Button>
          <Button
            variant={draft.residency_status === "non_resident" ? "sage" : "secondary"}
            onClick={() => update({ residency_status: "non_resident" })}
          >
            No, non-resident
          </Button>
        </div>
      </Labeled>

      {draft.residency_status === "non_resident" && (
        <div className="rounded-lg border border-slate/30 bg-slate/8 p-3 text-sm text-slate">
          <SeverityBadge severity="info" /> No Emirates ID needed. You&apos;ll register via
          the supervised remote video path, witnessed by a home-country notary/solicitor.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Your wishes (the automation's input)
// ---------------------------------------------------------------------------

const EXAMPLE_WISHES = `I'm British, married to Sarah, we live in Dubai Marina. I want everything to go to Sarah, but if she dies before me, split it equally between our two kids — the youngest, Alex, is 9. We own the Marina apartment and have savings in Emirates NBD. My brother James should be the executor. I also have an old will in the UK.`;

function WishesStep({
  draft,
  update,
  structuring,
  onStructure,
}: {
  draft: IntakeDraft;
  update: (p: Partial<IntakeDraft>) => void;
  structuring: boolean;
  onStructure: () => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate">
        Tell us about your family, your assets in the UAE, and how you want things
        divided — in your own words. No forms to fill in: a real AI call reads this
        and structures it into your will.
      </p>
      <textarea
        className="w-full rounded-lg border border-hairline bg-white px-3 py-3 text-sm text-ink outline-none focus:border-slate focus:ring-2 focus:ring-slate/20"
        rows={10}
        placeholder={EXAMPLE_WISHES}
        value={draft.wishes_text}
        onChange={(e) => update({ wishes_text: e.target.value })}
      />
      <div className="flex items-center gap-2">
        <button
          className="text-xs text-slate underline"
          onClick={() => update({ wishes_text: EXAMPLE_WISHES })}
        >
          Use example wishes
        </button>
      </div>
      <Button
        className="w-full"
        disabled={!draft.wishes_text.trim() || structuring}
        onClick={onStructure}
      >
        {structuring ? "Structuring your wishes…" : "Structure my wishes →"}
      </Button>
      <p className="text-center text-xs text-slate">
        This calls a real Anthropic model to turn your paragraph into a structured
        will — the next screen shows exactly what it understood, for you to correct.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Confirm ("here's what we understood")
// ---------------------------------------------------------------------------

function ConfirmStep({
  identity,
  structured,
  setStructured,
  result,
  confirmed,
  onConfirm,
}: {
  identity: Identity;
  structured: StructuredWill;
  setStructured: (w: StructuredWill) => void;
  result: StructureResult;
  confirmed: boolean;
  onConfirm: () => void;
}) {
  const rules = runRules(structured, { identity, title_deed: null, ai_structured: result.ai_structured });
  const blocks = rules.filter((r) => r.severity === "block");

  const setBeneficiary = (i: number, patch: Partial<StructuredWill["beneficiaries"][number]>) => {
    const next = { ...structured, beneficiaries: [...structured.beneficiaries] };
    next.beneficiaries[i] = { ...next.beneficiaries[i], ...patch };
    setStructured(next);
  };

  const prompts = buildClientPrompts(rules, structured);

  return (
    <div className="space-y-5">
      {/* Warm, plain-language summary — the ONLY model text a client sees here.
          confidence_notes, the source note, and lawyer diagnostics are never
          rendered client-side (they're for the lawyer desk). */}
      <Card className="border-sage/30 bg-sage/6 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-sage">
          Here&apos;s what we understood
        </div>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink">
          {clientSummaryLine(structured, result.source)}
        </p>
      </Card>

      {/* Ambiguities become a short, calm "couple of things to confirm" — warm
          questions the client can answer right here, not a list of errors. */}
      {prompts.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-medium text-ink">A couple of things to confirm</div>
          <p className="mt-0.5 text-xs text-slate">
            We&apos;ve done the hard part — just help us finish these below.
          </p>
          <ul className="mt-3 space-y-2">
            {prompts.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sage" />
                <span className="text-ink">
                  {p.text}
                  {p.required && <span className="text-slate"> · needed to continue</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div>
        <h3 className="text-sm font-semibold text-ink">Beneficiaries</h3>
        <div className="mt-2 space-y-2">
          {structured.beneficiaries.length === 0 && (
            <p className="text-sm text-clay">
              No beneficiaries were structured — add at least one below.
            </p>
          )}
          {structured.beneficiaries.map((b, i) => (
            <Card key={i} className="p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <TextInput
                  placeholder="Name"
                  value={b.name}
                  onChange={(e) => setBeneficiary(i, { name: e.target.value })}
                />
                <TextInput
                  placeholder="Relationship"
                  value={b.relationship}
                  onChange={(e) => setBeneficiary(i, { relationship: e.target.value })}
                />
                <TextInput
                  type="number"
                  placeholder="%"
                  value={String(b.share_pct)}
                  onChange={(e) => setBeneficiary(i, { share_pct: Number(e.target.value) || 0 })}
                />
                <label className="flex items-center gap-1.5 text-xs text-slate">
                  <input
                    type="checkbox"
                    checked={b.is_minor}
                    onChange={(e) => setBeneficiary(i, { is_minor: e.target.checked })}
                  />
                  Minor
                </label>
              </div>
              <TextInput
                className="mt-2"
                placeholder="If they predecease me, their share goes to…"
                value={b.substitution}
                onChange={(e) => setBeneficiary(i, { substitution: e.target.value })}
              />
            </Card>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              setStructured({
                ...structured,
                beneficiaries: [
                  ...structured.beneficiaries,
                  { name: "", relationship: "", share_pct: 0, is_minor: false, substitution: "", held_in_trust: false },
                ],
              })
            }
          >
            + Add beneficiary
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Labeled label="Executor">
          <TextInput
            placeholder="Name"
            value={structured.executor.name}
            onChange={(e) => setStructured({ ...structured, executor: { ...structured.executor, name: e.target.value } })}
          />
        </Labeled>
        <Labeled label="Executor relationship">
          <TextInput
            value={structured.executor.relationship}
            onChange={(e) =>
              setStructured({ ...structured, executor: { ...structured.executor, relationship: e.target.value } })
            }
          />
        </Labeled>
      </div>

      <div>
        <h3 className="text-sm font-semibold text-ink">UAE assets</h3>
        <div className="mt-2 space-y-2">
          {structured.assets.length === 0 && (
            <p className="text-sm text-clay">No UAE assets were structured — add at least one.</p>
          )}
          {structured.assets.map((a, i) => (
            <Card key={i} className="flex items-center gap-2 p-3">
              <Select
                value={a.type}
                onChange={(e) => {
                  const assets = [...structured.assets];
                  assets[i] = { ...a, type: e.target.value as AssetType };
                  setStructured({ ...structured, assets });
                }}
              >
                <option value="property">Property</option>
                <option value="bank_account">Bank account</option>
                <option value="business_shares">Business shares</option>
                <option value="other">Other</option>
              </Select>
              {a.type === "property" && (
                <Select
                  value={a.emirate}
                  onChange={(e) => {
                    const assets = [...structured.assets];
                    const emirate = e.target.value as Emirate;
                    assets[i] = {
                      ...a,
                      emirate,
                      needs_adjd: emirate === "abu_dhabi" || emirate === "other",
                    };
                    setStructured({ ...structured, assets });
                  }}
                >
                  <option value="dubai">Dubai</option>
                  <option value="rak">Ras Al Khaimah</option>
                  <option value="abu_dhabi">Abu Dhabi</option>
                  <option value="other">Other emirate</option>
                </Select>
              )}
              <TextInput
                placeholder="Description"
                value={a.description}
                onChange={(e) => {
                  const assets = [...structured.assets];
                  assets[i] = { ...a, description: e.target.value };
                  setStructured({ ...structured, assets });
                }}
              />
            </Card>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              setStructured({
                ...structured,
                assets: [...structured.assets, { type: "property", emirate: "dubai", needs_adjd: false, description: "" }],
              })
            }
          >
            + Add asset
          </Button>
        </div>
      </div>

      {/* No raw warns/blocks dump here — client-answerable gaps are the warm
          prompts above; lawyer-only items stay with the lawyer. A single
          reassuring line about the review to come. */}
      <p className="text-center text-xs text-slate">
        A qualified lawyer will review your will before anything is final.
      </p>

      <div className="space-y-1">
        <Button className="w-full" disabled={blocks.length > 0 || confirmed} onClick={onConfirm}>
          {confirmed ? "Confirmed ✓" : "This looks right — continue →"}
        </Button>
        {blocks.length > 0 && (
          <p className="text-center text-xs text-slate">
            Just add the details marked <em>needed to continue</em> above and you&apos;re set.
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Documents (deferrable — never gatekeeps)
// ---------------------------------------------------------------------------

function DocumentsStep({
  draft,
  update,
  willId,
  identity,
}: {
  draft: IntakeDraft;
  update: (p: Partial<IntakeDraft>) => void;
  willId: string;
  identity: Identity;
}) {
  const db = getDB();
  const will = db.wills.find((w) => w.id === willId);
  const hasProperty = (will?.structured_json?.assets ?? []).some((a) => a.type === "property");
  const isResident = draft.residency_status === "resident";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sage/30 bg-sage/8 p-3 text-sm text-sage">
        Nothing here blocks you — skip for now and we&apos;ll email a secure link. Your
        will&apos;s content is already locked in and reviewable. (A lawyer simply
        can&apos;t approve until documents are in.)
      </div>

      {isResident && (
        <DocCaptureRow title="Emirates ID" subtitle="Reads your address and cross-checks the name against your passport." uploaded={draft.emirates_id.uploaded}>
          <ImageCapture<EmiratesIdExtract>
            docType="emirates_id"
            label="Emirates ID"
            onExtracted={async ({ extracted, file }) => {
              update({
                emirates_id: {
                  uploaded: true,
                  ocr: { full_name: extracted.full_name, address: extracted.address || "" },
                  number: extracted.id_number,
                },
              });
              const match = compareNames(extracted.full_name, identity.full_name) === "match" ? "match" : "needs_review";
              const stored = await uploadDocumentFile(willId, "emirates_id", file);
              recordDocument(willId, "emirates_id", {
                status: "validated",
                ocr_extracted: { ...extracted },
                match_result: match,
                file_path: stored.file_path,
                file_url: stored.file_url,
                expires_at: stored.expires_at,
                uploaded_at: new Date().toISOString(),
                validated_at: new Date().toISOString(),
              });
            }}
          />
        </DocCaptureRow>
      )}

      {hasProperty && (
        <DocCaptureRow title="Title deed" subtitle="Reads the owner and flags joint ownership (the gift may not pass the whole asset)." uploaded={draft.title_deed.uploaded}>
          <ImageCapture<TitleDeedExtract>
            docType="title_deed"
            label="title deed"
            onExtracted={async ({ extracted, file }) => {
              update({
                title_deed: { uploaded: true, ocr: { owner: extracted.owner_name, joint_owner: extracted.joint_owner } },
              });
              const stored = await uploadDocumentFile(willId, "title_deed", file);
              recordDocument(willId, "title_deed", {
                status: "validated",
                ocr_extracted: { ...extracted },
                match_result: extracted.joint_owner ? "needs_review" : "match",
                file_path: stored.file_path,
                file_url: stored.file_url,
                expires_at: stored.expires_at,
                uploaded_at: new Date().toISOString(),
                validated_at: new Date().toISOString(),
              });
            }}
          />
        </DocCaptureRow>
      )}

      {!isResident && !hasProperty && (
        <p className="text-sm text-slate">
          No supporting documents required at this step for your case. You can continue.
        </p>
      )}
    </div>
  );
}

function DocCaptureRow({
  title,
  subtitle,
  uploaded,
  children,
}: {
  title: string;
  subtitle: string;
  uploaded: boolean;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">{title}</span>
        {uploaded ? <Pill tone="sage">Uploaded</Pill> : <Pill tone="amber">Upload later ok</Pill>}
      </div>
      <p className="mt-1 text-xs text-slate">{subtitle}</p>
      {!uploaded && <div className="mt-3">{children}</div>}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Review & submit
// ---------------------------------------------------------------------------

/** The InstaWill drafting + DIFC registration fee shown at checkout (demo). */
const SERVICE_FEE_AED = 1500;

/**
 * We do NOT have real-time DIFC WPR slot availability, so we can't let the
 * client book a concrete time. Instead we capture a *preferred* slot; the
 * actual appointment is confirmed once the lawyer has approved the draft.
 */
const SLOT_PREFERENCES = [
  "Weekday mornings",
  "Weekday afternoons",
  "Weekends",
  "As soon as possible",
] as const;

function ReviewStep({
  draft,
  identity,
  structured,
  aiStructured,
  submitted,
  onSubmit,
}: {
  draft: IntakeDraft;
  identity: Identity;
  structured: StructuredWill | null;
  aiStructured: boolean;
  submitted: boolean;
  onSubmit: (documentsPending: boolean, booking: { appointmentPreference: string }) => void;
}) {
  const [slotPreference, setSlotPreference] = useState<string | null>(null);
  const [paid, setPaid] = useState(false);

  if (!structured) return null;

  const rules = runRules(structured, {
    identity,
    title_deed: draft.title_deed.uploaded
      ? { uploaded: true, owner: draft.title_deed.ocr?.owner, joint_owner: draft.title_deed.ocr?.joint_owner }
      : null,
    ai_structured: aiStructured,
  });
  const blocks = rules.filter((r) => r.severity === "block");
  const prompts = buildClientPrompts(rules, structured);

  const isResident = identity.residency_status === "resident";
  const hasProperty = structured.assets.some((a) => a.type === "property");
  const docsPending = (isResident && !draft.emirates_id.uploaded) || (hasProperty && !draft.title_deed.uploaded);

  const checklist: Array<{ label: string; status: "done" | "later" | "fix" }> = [
    { label: "Identity — valid passport", status: draft.passport.uploaded && !identity.passport_expired ? "done" : "fix" },
    { label: "At least one UAE asset", status: structured.assets.length ? "done" : "fix" },
    {
      label: "Beneficiary shares total 100%",
      status:
        Math.round(structured.beneficiaries.reduce((s, b) => s + (b.share_pct || 0), 0) * 100) / 100 === 100
          ? "done"
          : "fix",
    },
    { label: "Executor appointed", status: structured.executor.name ? "done" : "fix" },
  ];
  if (structured.guardian !== null || structured.beneficiaries.some((b) => b.is_minor)) {
    checklist.push({ label: "Guardian nominated (if children)", status: structured.guardian ? "done" : "later" });
  }
  if (isResident) {
    checklist.push({ label: "Emirates ID", status: draft.emirates_id.uploaded ? "done" : "later" });
  }
  if (hasProperty) {
    checklist.push({ label: "Title deed", status: draft.title_deed.uploaded ? "done" : "later" });
  }

  if (submitted) {
    return (
      <div className="rounded-xl2 border border-sage/40 bg-sage/8 p-6 text-center">
        <div className="text-3xl">✓</div>
        <h3 className="mt-2 font-serif text-xl text-ink">Submitted to the lawyer queue</h3>
        <p className="mt-1 text-sm text-slate">
          {docsPending
            ? "Your will's content is locked in. We'll email a secure link for the outstanding documents — the lawyer can review the content now."
            : "Your will is complete and queued for lawyer review."}
        </p>
        {paid && (
          <p className="mt-2 text-sm text-sage">
            Payment received! We&apos;ll confirm your registration slot once a lawyer approves the draft.
          </p>
        )}
        <p className="mt-3 text-xs text-slate">
          Switch to the <strong>Lawyer review</strong> tab to see it arrive. After the
          lawyer approves, you&apos;ll return here for final approval before registration.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium text-ink">Everything a submittable will needs</h3>
        <ul className="mt-2 space-y-1.5">
          {checklist.map((c) => (
            <li key={c.label} className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm">
              <span className="text-ink">{c.label}</span>
              {c.status === "done" && <Pill tone="sage">Done ✓</Pill>}
              {c.status === "later" && <Pill tone="amber">Upload later — ok</Pill>}
              {c.status === "fix" && <Pill tone="clay">Needs fixing</Pill>}
            </li>
          ))}
        </ul>
      </div>

      {prompts.length > 0 && (
        <Card className="p-4">
          <div className="text-sm font-medium text-ink">A couple of things to confirm first</div>
          <p className="mt-0.5 text-xs text-slate">
            Pop back a step to add these — we&apos;ve done the rest.
          </p>
          <ul className="mt-3 space-y-2">
            {prompts.map((p) => (
              <li key={p.id} className="flex items-start gap-2 text-sm">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-sage" />
                <span className="text-ink">
                  {p.text}
                  {p.required && <span className="text-slate"> · needed to submit</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Preferred appointment — we don't have live DIFC WPR availability, so we
          capture a preference now and confirm the actual slot after approval. */}
      <Card className="p-4">
        <div className="text-sm font-medium text-ink">Preferred registration appointment</div>
        <p className="mt-0.5 text-xs text-slate">
          When suits you best for your DIFC Wills Registry appointment? We&apos;ll confirm the
          exact slot once your draft is approved.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {SLOT_PREFERENCES.map((s) => {
            const active = s === slotPreference;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSlotPreference(s)}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  active
                    ? "border-sage bg-sage/10 font-medium text-ink"
                    : "border-hairline bg-white text-slate hover:border-slate"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      </Card>

      {/* Payment — simulated checkout. Real integration would use a PSP. */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-ink">Payment</div>
            <p className="mt-0.5 text-xs text-slate">
              InstaWill drafting + DIFC registration
            </p>
          </div>
          <div className="text-right">
            <div className="font-serif text-lg text-ink">AED {SERVICE_FEE_AED.toLocaleString()}</div>
          </div>
        </div>
        {paid ? (
          <div className="mt-3 rounded-lg border border-sage/30 bg-sage/8 p-3 text-sm text-sage">
            Payment received! We&apos;ll confirm the registration slot once a lawyer approves the draft.
          </div>
        ) : (
          <Button
            className="mt-3 w-full"
            variant="secondary"
            disabled={!slotPreference}
            onClick={() => setPaid(true)}
          >
            {slotPreference ? `Pay AED ${SERVICE_FEE_AED.toLocaleString()} (demo)` : "Choose a preferred time first"}
          </Button>
        )}
      </Card>

      {/* No raw lawyer items dumped here — one reassuring line instead. */}
      <div className="rounded-lg border border-hairline bg-white p-4 text-center text-sm text-slate">
        A qualified lawyer will personally review your will before anything is final.
      </div>

      <div className="space-y-2">
        {(() => {
          const ready = blocks.length === 0 && Boolean(slotPreference) && paid;
          const gateText = blocks.length > 0
            ? null
            : !slotPreference
            ? "Choose a preferred appointment time above to continue."
            : !paid
            ? "Complete payment above to continue."
            : null;
          return (
            <>
              {docsPending ? (
                <Button
                  className="w-full"
                  disabled={!ready}
                  onClick={() => onSubmit(true, { appointmentPreference: slotPreference! })}
                >
                  Submit now, finish documents later →
                </Button>
              ) : (
                <Button
                  className="w-full"
                  variant="sage"
                  disabled={!ready}
                  onClick={() => onSubmit(false, { appointmentPreference: slotPreference! })}
                >
                  Confirm &amp; submit for lawyer review →
                </Button>
              )}
              {gateText && <p className="text-center text-xs text-slate">{gateText}</p>}
              {docsPending && ready && (
                <p className="text-center text-xs text-slate">
                  Sends to the lawyer queue in a <em>documents-pending</em> state. Documents
                  never block submission.
                </p>
              )}
            </>
          );
        })()}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Nav
// ---------------------------------------------------------------------------

function StepNav({
  step,
  draft,
  confirmed,
  structuring,
  submitted,
  onBack,
  onNext,
}: {
  step: number;
  draft: IntakeDraft;
  confirmed: boolean;
  structuring: boolean;
  submitted: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  let blockReason: string | null = null;
  if (step === 0) {
    if (!draft.passport.uploaded) blockReason = "Scan your passport to continue.";
    else if (new Date(draft.passport.passport_expiry) < new Date())
      blockReason = "Passport is expired — provide a valid one.";
    else if (draft.residency_status === "unknown") blockReason = "Tell us your residency status.";
  }
  // Step 1 (wishes) advances automatically once structuring completes.
  // Step 2 (confirm) advances via its own "continue" button.

  if (submitted) return null;
  const hideNext = step === 1 || step === 2 || structuring;

  return (
    <div className="mt-8 flex items-center justify-between border-t border-hairline pt-5">
      <Button variant="ghost" onClick={onBack} disabled={step === 0}>
        ← Back
      </Button>
      {!hideNext && step < STEPS.length - 1 && (
        <div className="flex flex-col items-end gap-1">
          <Button onClick={onNext} disabled={!!blockReason || (step === 2 && !confirmed)}>
            Continue →
          </Button>
          {blockReason && <span className="text-xs text-clay">{blockReason}</span>}
        </div>
      )}
    </div>
  );
}
