"use client";

/**
 * CLIENT JOURNEY — a 7-step intake that assembles the DIFC Schedule 1 will live.
 * Two-panel: questions left, the will document filling in real time on the right.
 *
 * Design principle honoured throughout: STRICT on content, ASYNC on documents.
 * Only will-CONTENT that makes the will legally unregistrable ever blocks the
 * client (shares != 100, no UAE asset, missing/expired passport). Documents
 * never block — the client can always skip and submit.
 */
import { useEffect, useMemo, useState } from "react";
import type {
  AssetType,
  Emirate,
  IntakeDraft,
  LeadStage,
  StructuredWill,
} from "@/lib/types";
import { deterministicStructure } from "@/lib/structure";
import { runRules, type RuleResult } from "@/lib/rules";
import type { StructureResult } from "@/lib/llm";
import {
  commitStructuredWill,
  createIntake,
  getDB,
  saveDraft,
  setLeadStage,
  submitWill,
  updateLead,
  upsertDocument,
} from "@/lib/store";
import { LiveWill } from "@/components/LiveWill";
import {
  Button,
  Card,
  Labeled,
  MockLabel,
  Pill,
  ProgressBar,
  SeverityBadge,
  Select,
  TextInput,
} from "@/components/ui/primitives";

const STEPS = [
  "Identity",
  "Family",
  "Assets",
  "Beneficiaries",
  "Safety",
  "Documents",
  "Review",
] as const;

const STAGE_FOR_STEP: LeadStage[] = [
  "about",
  "family",
  "assets",
  "beneficiaries",
  "safety",
  "documents",
  "review",
];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function futureDate(years: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

export function ClientJourney() {
  const [ids, setIds] = useState<{ leadId: string; willId: string } | null>(
    null
  );
  const [draft, setDraft] = useState<IntakeDraft | null>(null);
  const [step, setStep] = useState(0);
  const [structuring, setStructuring] = useState(false);
  const [result, setResult] = useState<StructureResult | null>(null);
  const [submitted, setSubmitted] = useState(false);

  // Start a fresh intake on mount.
  useEffect(() => {
    const { lead, will, draft } = createIntake({
      utm: { utm_source: "demo", utm_medium: "direct" },
    });
    setIds({ leadId: lead.id, willId: will.id });
    setDraft(draft);
  }, []);

  const update = (patch: Partial<IntakeDraft>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...patch };
      saveDraft(next);
      return next;
    });
  };

  const structured: StructuredWill | null = useMemo(() => {
    if (!draft) return null;
    if (result) return result.structured;
    return deterministicStructure(draft, todayISO());
  }, [draft, result]);

  if (!draft || !ids || !structured) return null;

  const goto = (n: number) => {
    setStep(n);
    const stage = STAGE_FOR_STEP[n];
    setLeadStage(ids.leadId, stage);
    // Keep the lead's headline fields in sync for the ops desk.
    updateLead(ids.leadId, {
      full_name: draft.passport.full_name || draft.passport.ocr?.full_name || "",
      residency_status: draft.residency_status,
    });
  };

  return (
    <div className="grid min-h-[calc(100vh-52px)] grid-cols-1 lg:grid-cols-2">
      {/* LEFT — questions */}
      <div className="border-r border-hairline bg-paper px-5 py-6 lg:px-10 lg:py-8">
        <div className="mx-auto max-w-xl">
          <StepHeader step={step} />
          <div className="mt-6">
            {step === 0 && (
              <IdentityStep draft={draft} update={update} />
            )}
            {step === 1 && <FamilyStep draft={draft} update={update} />}
            {step === 2 && <AssetsStep draft={draft} update={update} />}
            {step === 3 && (
              <BeneficiariesStep draft={draft} update={update} />
            )}
            {step === 4 && <SafetyStep draft={draft} update={update} />}
            {step === 5 && (
              <DocumentsStep
                draft={draft}
                update={update}
                willId={ids.willId}
              />
            )}
            {step === 6 && (
              <ReviewStep
                draft={draft}
                structured={structured}
                structuring={structuring}
                result={result}
                submitted={submitted}
                onStructure={async () => {
                  setStructuring(true);
                  try {
                    const res = await fetch("/api/structure", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ draft }),
                    });
                    const data = (await res.json()) as StructureResult;
                    setResult(data);
                  } catch {
                    // Client-side fallback so the demo never dead-ends.
                    setResult({
                      structured: deterministicStructure(draft, todayISO()),
                      ai_structured: Boolean(draft.distribution_notes.trim()),
                      source: "fallback",
                      note: "Network error — structured locally (offline).",
                    });
                  } finally {
                    setStructuring(false);
                  }
                }}
                onSubmit={(documentsPending) => {
                  const active = result?.structured ?? structured;
                  const ai = result?.ai_structured ?? false;
                  const rules = clientRules(draft, active, ai);
                  commitStructuredWill(ids.willId, active, ai, rules);
                  submitWill(ids.willId, documentsPending);
                  setSubmitted(true);
                }}
              />
            )}
          </div>

          <StepNav
            step={step}
            draft={draft}
            structured={structured}
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
                {result.source === "llm" ? "LLM-structured" : "Auto-structured"}
              </Pill>
            )}
          </div>
          <Card className="p-6">
            <LiveWill structured={structured} />
          </Card>
          <p className="mt-3 text-center text-xs text-slate">
            Nothing is final until a lawyer signs off.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header + progress
// ---------------------------------------------------------------------------

function StepHeader({ step }: { step: number }) {
  return (
    <div>
      <div className="mb-3 flex items-center gap-1.5">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i <= step ? "bg-sage" : "bg-paper-deep"
            }`}
          />
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
// Step 0 — Identity (passport-first OCR)
// ---------------------------------------------------------------------------

function IdentityStep({
  draft,
  update,
}: {
  draft: IntakeDraft;
  update: (p: Partial<IntakeDraft>) => void;
}) {
  const scan = (expired: boolean) => {
    const expiry = expired ? "2023-04-01" : futureDate(6);
    const ocr = {
      full_name: "Sarah Anne Whitfield",
      passport_number: "561234789",
      passport_expiry: expiry,
    };
    update({
      passport: {
        uploaded: true,
        ocr,
        full_name: ocr.full_name,
        passport_number: ocr.passport_number,
        passport_expiry: expiry,
      },
    });
  };

  const expired =
    draft.passport.uploaded &&
    new Date(draft.passport.passport_expiry) < new Date();

  return (
    <div className="space-y-5">
      <p className="text-sm text-slate">
        We start with your passport. Scan it and we&apos;ll read your details —
        you just review and correct. Passport is mandatory; Emirates ID is asked
        only if you&apos;re a UAE resident.
      </p>

      {!draft.passport.uploaded ? (
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-medium text-ink">Scan your passport</div>
              <div className="text-xs text-slate">
                <MockLabel>OCR simulated</MockLabel> returns structured fields.
              </div>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => scan(false)}>Scan passport</Button>
            <Button variant="secondary" onClick={() => scan(true)}>
              Scan expired passport (demo)
            </Button>
          </div>
        </Card>
      ) : (
        <>
          {expired && (
            <div className="rounded-lg border border-clay/40 bg-clay/8 p-3 text-sm text-clay">
              <SeverityBadge severity="block" /> This passport is expired. DIFC
              won&apos;t accept it — please provide a valid passport before
              submitting.
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Labeled label="Full name">
              <TextInput
                value={draft.passport.full_name}
                onChange={(e) =>
                  update({
                    passport: { ...draft.passport, full_name: e.target.value },
                  })
                }
              />
            </Labeled>
            <Labeled label="Passport number">
              <TextInput
                value={draft.passport.passport_number}
                onChange={(e) =>
                  update({
                    passport: {
                      ...draft.passport,
                      passport_number: e.target.value,
                    },
                  })
                }
              />
            </Labeled>
            <Labeled label="Passport expiry">
              <TextInput
                type="date"
                value={draft.passport.passport_expiry}
                onChange={(e) =>
                  update({
                    passport: {
                      ...draft.passport,
                      passport_expiry: e.target.value,
                    },
                  })
                }
              />
            </Labeled>
          </div>
          <button
            className="text-xs text-slate underline"
            onClick={() =>
              update({
                passport: {
                  uploaded: false,
                  ocr: null,
                  full_name: "",
                  passport_number: "",
                  passport_expiry: "",
                },
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
            variant={
              draft.residency_status === "non_resident" ? "sage" : "secondary"
            }
            onClick={() => update({ residency_status: "non_resident" })}
          >
            No, non-resident
          </Button>
        </div>
      </Labeled>

      {draft.residency_status === "non_resident" && (
        <div className="rounded-lg border border-slate/30 bg-slate/8 p-3 text-sm text-slate">
          <SeverityBadge severity="info" /> No Emirates ID needed. You&apos;ll
          register via the supervised remote video path, witnessed by a
          home-country notary/solicitor.
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 1 — Family
// ---------------------------------------------------------------------------

function FamilyStep({
  draft,
  update,
}: {
  draft: IntakeDraft;
  update: (p: Partial<IntakeDraft>) => void;
}) {
  const hasChildren = draft.has_children_under_21;

  return (
    <div className="space-y-5">
      <Labeled label="Any children under 21 residing in Dubai or Ras Al Khaimah?">
        <div className="flex gap-2">
          <Button
            variant={hasChildren ? "sage" : "secondary"}
            onClick={() =>
              update({
                has_children_under_21: true,
                children:
                  draft.children.length > 0
                    ? draft.children
                    : [
                        {
                          name: "",
                          under_21: true,
                          resides_in_dubai_or_rak: true,
                        },
                      ],
              })
            }
          >
            Yes
          </Button>
          <Button
            variant={!hasChildren ? "sage" : "secondary"}
            onClick={() =>
              update({
                has_children_under_21: false,
                children: [],
                guardians: [],
              })
            }
          >
            No
          </Button>
        </div>
      </Labeled>

      {hasChildren && (
        <>
          {draft.children.map((c, i) => (
            <div key={i} className="flex gap-2">
              <TextInput
                placeholder="Child's name"
                value={c.name}
                onChange={(e) => {
                  const children = [...draft.children];
                  children[i] = { ...c, name: e.target.value };
                  update({ children });
                }}
              />
              <Button
                variant="ghost"
                onClick={() =>
                  update({
                    children: draft.children.filter((_, x) => x !== i),
                  })
                }
              >
                Remove
              </Button>
            </div>
          ))}
          <Button
            variant="secondary"
            onClick={() =>
              update({
                children: [
                  ...draft.children,
                  { name: "", under_21: true, resides_in_dubai_or_rak: true },
                ],
              })
            }
          >
            + Add child
          </Button>

          <div className="rounded-lg border border-amber/30 bg-amber/8 p-3 text-sm">
            <div className="font-medium text-amber">Guardian nomination required</div>
            <p className="mt-1 text-slate">
              You nominate a guardian; the court retains final say on the
              child&apos;s best interests — registration nominates, it
              doesn&apos;t guarantee.
            </p>
          </div>

          <Labeled label="Guardian">
            <TextInput
              placeholder="Guardian name"
              value={draft.guardians.find((g) => g.role === "guardian")?.name ?? ""}
              onChange={(e) => {
                const others = draft.guardians.filter(
                  (g) => g.role !== "guardian"
                );
                update({
                  guardians: [
                    {
                      name: e.target.value,
                      relationship: "",
                      role: "guardian",
                    },
                    ...others,
                  ],
                });
              }}
            />
          </Labeled>
          <Labeled
            label="Substitute guardian"
            hint="If the first guardian can't act (predecease/substitution)."
          >
            <TextInput
              placeholder="Substitute guardian name"
              value={
                draft.guardians.find((g) => g.role === "substitute_guardian")
                  ?.name ?? ""
              }
              onChange={(e) => {
                const others = draft.guardians.filter(
                  (g) => g.role !== "substitute_guardian"
                );
                update({
                  guardians: [
                    ...others,
                    {
                      name: e.target.value,
                      relationship: "",
                      role: "substitute_guardian",
                    },
                  ],
                });
              }}
            />
          </Labeled>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 2 — Assets
// ---------------------------------------------------------------------------

function AssetsStep({
  draft,
  update,
}: {
  draft: IntakeDraft;
  update: (p: Partial<IntakeDraft>) => void;
}) {
  const addAsset = (asset_type: AssetType) =>
    update({
      assets: [
        ...draft.assets,
        {
          asset_type,
          emirate: asset_type === "property" ? "dubai" : "n_a",
          description: "",
        },
      ],
    });

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate">
        Which UAE assets does this will cover? A DIFC will must cover at least
        one UAE-situated asset.
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => addAsset("property")}>
          + Property
        </Button>
        <Button variant="secondary" onClick={() => addAsset("bank_account")}>
          + Bank account
        </Button>
        <Button variant="secondary" onClick={() => addAsset("business_shares")}>
          + Business shares
        </Button>
      </div>

      <div className="rounded-lg border border-slate/25 bg-slate/6 p-3 text-xs text-slate">
        Bank accounts don&apos;t need to be individually listed or validated for a
        Full Will — it covers all movable property as a category. (Only a
        Financial Assets Will enumerates accounts, and that&apos;s out of scope.)
      </div>

      {draft.assets.map((a, i) => (
        <Card key={i} className="p-4">
          <div className="flex items-center justify-between">
            <Pill tone="ink">
              {a.asset_type.replace("_", " ")}
            </Pill>
            <button
              className="text-xs text-slate underline"
              onClick={() =>
                update({ assets: draft.assets.filter((_, x) => x !== i) })
              }
            >
              Remove
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3">
            <TextInput
              placeholder="Description (e.g. Villa 12, Emirates Hills)"
              value={a.description}
              onChange={(e) => {
                const assets = [...draft.assets];
                assets[i] = { ...a, description: e.target.value };
                update({ assets });
              }}
            />
            {a.asset_type === "property" && (
              <>
                <Labeled label="Which emirate?">
                  <Select
                    value={a.emirate}
                    onChange={(e) => {
                      const assets = [...draft.assets];
                      assets[i] = {
                        ...a,
                        emirate: e.target.value as Emirate,
                      };
                      update({ assets });
                    }}
                  >
                    <option value="dubai">Dubai</option>
                    <option value="rak">Ras Al Khaimah</option>
                    <option value="abu_dhabi">Abu Dhabi</option>
                    <option value="other">Other emirate</option>
                  </Select>
                </Labeled>
                {(a.emirate === "abu_dhabi" || a.emirate === "other") && (
                  <div className="rounded-lg border border-amber/40 bg-amber/8 p-3 text-sm">
                    <SeverityBadge severity="warn" />{" "}
                    <span className="text-slate">
                      DIFC covers Dubai/RAK reliably. This property registers
                      with the ADJD (Abu Dhabi Judicial Department) — jurisdiction
                      follows the asset. Your DIFC will covers everything else; a
                      lawyer scopes the two so they don&apos;t revoke each other.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 3 — Beneficiaries & executor
// ---------------------------------------------------------------------------

function BeneficiariesStep({
  draft,
  update,
}: {
  draft: IntakeDraft;
  update: (p: Partial<IntakeDraft>) => void;
}) {
  const total = draft.beneficiaries.reduce((s, b) => s + (b.share_pct || 0), 0);
  const exact = Math.round(total * 100) / 100 === 100;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-ink">Beneficiaries</span>
        <span
          className={`rounded-full px-3 py-1 text-sm font-semibold ${
            exact ? "bg-sage/15 text-sage" : "bg-amber/15 text-amber"
          }`}
        >
          {total}% allocated {exact ? "✓" : "/ 100%"}
        </span>
      </div>

      {draft.beneficiaries.map((b, i) => (
        <Card key={i} className="p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <TextInput
              placeholder="Name"
              value={b.name}
              onChange={(e) => {
                const bs = [...draft.beneficiaries];
                bs[i] = { ...b, name: e.target.value };
                update({ beneficiaries: bs });
              }}
            />
            <TextInput
              placeholder="Relationship"
              value={b.relationship}
              onChange={(e) => {
                const bs = [...draft.beneficiaries];
                bs[i] = { ...b, relationship: e.target.value };
                update({ beneficiaries: bs });
              }}
            />
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate">Share</span>
              <TextInput
                type="number"
                className="w-24"
                value={String(b.share_pct)}
                onChange={(e) => {
                  const bs = [...draft.beneficiaries];
                  bs[i] = { ...b, share_pct: Number(e.target.value) || 0 };
                  update({ beneficiaries: bs });
                }}
              />
              <span className="text-sm text-slate">%</span>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate">
              <input
                type="checkbox"
                checked={b.is_minor}
                onChange={(e) => {
                  const bs = [...draft.beneficiaries];
                  bs[i] = { ...b, is_minor: e.target.checked };
                  update({ beneficiaries: bs });
                }}
              />
              Under 21
            </label>
            <button
              className="ml-auto text-xs text-slate underline"
              onClick={() =>
                update({
                  beneficiaries: draft.beneficiaries.filter((_, x) => x !== i),
                })
              }
            >
              Remove
            </button>
          </div>
          {b.is_minor && (
            <div className="mt-2 rounded bg-amber/8 px-2 py-1.5 text-xs text-amber">
              A minor can&apos;t inherit outright — this share needs a
              trust/holding structure (a lawyer will confirm).
            </div>
          )}
        </Card>
      ))}

      <Button
        variant="secondary"
        onClick={() =>
          update({
            beneficiaries: [
              ...draft.beneficiaries,
              {
                name: "",
                relationship: "",
                share_pct: 0,
                is_minor: false,
                held_in_trust: false,
                substitution: "",
              },
            ],
          })
        }
      >
        + Add beneficiary
      </Button>

      <Labeled
        label="Describe the split in your own words (optional)"
        hint="Our AI structures this into the will; a lawyer verifies it. e.g. “split evenly, but the rest to my kids if my wife has passed.”"
      >
        <textarea
          className="w-full rounded-lg border border-hairline bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate focus:ring-2 focus:ring-slate/20"
          rows={3}
          value={draft.distribution_notes}
          onChange={(e) => update({ distribution_notes: e.target.value })}
        />
      </Labeled>

      <hr className="border-hairline" />

      <Labeled label="Executor">
        <TextInput
          placeholder="Executor name"
          value={draft.executors.find((e) => e.role === "executor")?.name ?? ""}
          onChange={(e) => {
            const others = draft.executors.filter((x) => x.role !== "executor");
            update({
              executors: [
                { name: e.target.value, relationship: "", role: "executor" },
                ...others,
              ],
            });
          }}
        />
      </Labeled>
      <Labeled label="Substitute executor (optional)">
        <TextInput
          placeholder="Substitute executor name"
          value={
            draft.executors.find((e) => e.role === "substitute_executor")
              ?.name ?? ""
          }
          onChange={(e) => {
            const others = draft.executors.filter(
              (x) => x.role !== "substitute_executor"
            );
            update({
              executors: [
                ...others,
                {
                  name: e.target.value,
                  relationship: "",
                  role: "substitute_executor",
                },
              ],
            });
          }}
        />
      </Labeled>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 4 — Safety questions
// ---------------------------------------------------------------------------

function SafetyStep({
  draft,
  update,
}: {
  draft: IntakeDraft;
  update: (p: Partial<IntakeDraft>) => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm text-slate">Two things people forget.</p>

      <Card className="p-4">
        <Labeled label="Do you have a will in another country (a foreign will)?">
          <div className="flex gap-2">
            <Button
              variant={draft.has_foreign_will ? "sage" : "secondary"}
              onClick={() => update({ has_foreign_will: true })}
            >
              Yes
            </Button>
            <Button
              variant={!draft.has_foreign_will ? "sage" : "secondary"}
              onClick={() =>
                update({ has_foreign_will: false, foreign_will_detail: "" })
              }
            >
              No
            </Button>
          </div>
        </Labeled>
        {draft.has_foreign_will && (
          <div className="mt-3 space-y-2">
            <TextInput
              placeholder="Which country / what does it cover?"
              value={draft.foreign_will_detail}
              onChange={(e) =>
                update({ foreign_will_detail: e.target.value })
              }
            />
            <div className="rounded bg-amber/8 px-3 py-2 text-xs text-amber">
              <SeverityBadge severity="warn" /> Revocation-clause risk. Your DIFC
              will&apos;s revocation clause must be scoped to UAE assets only, or
              it could void your foreign will. A lawyer will confirm.
            </div>
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="text-sm font-medium text-ink">
          If a beneficiary passes before you, where does their share go?
        </div>
        <p className="mt-1 text-xs text-slate">
          Substitution — set per beneficiary.
        </p>
        <div className="mt-3 space-y-3">
          {draft.beneficiaries.length === 0 && (
            <p className="text-sm text-slate">
              Add beneficiaries in the previous step first.
            </p>
          )}
          {draft.beneficiaries.map((b, i) => (
            <div key={i} className="flex items-center gap-3">
              <span className="w-32 shrink-0 truncate text-sm text-ink">
                {b.name || `Beneficiary ${i + 1}`}
              </span>
              <Select
                value={b.substitution}
                onChange={(e) => {
                  const bs = [...draft.beneficiaries];
                  bs[i] = { ...b, substitution: e.target.value };
                  update({ beneficiaries: bs });
                }}
              >
                <option value="">Choose…</option>
                <option value="to their children/issue in equal shares">
                  To their children / issue
                </option>
                <option value="to my other beneficiaries proportionally">
                  To my other beneficiaries
                </option>
                <option value="to the residuary estate">
                  To the residuary estate
                </option>
              </Select>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Step 5 — Documents (deferrable — never gatekeeps)
// ---------------------------------------------------------------------------

function DocumentsStep({
  draft,
  update,
  willId,
}: {
  draft: IntakeDraft;
  update: (p: Partial<IntakeDraft>) => void;
  willId: string;
}) {
  const hasProperty = draft.assets.some((a) => a.asset_type === "property");
  const isResident = draft.residency_status === "resident";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-sage/30 bg-sage/8 p-3 text-sm text-sage">
        Nothing here blocks you — skip for now and we&apos;ll email a secure
        link. Your will&apos;s content is already locked in and reviewable. (A
        lawyer simply can&apos;t approve until documents are in.)
      </div>

      {isResident && (
        <DocRow
          title="Emirates ID"
          subtitle="Reads your address and cross-checks the name against your passport."
          uploaded={draft.emirates_id.uploaded}
          onUpload={() => {
            update({
              emirates_id: {
                uploaded: true,
                ocr: {
                  full_name: draft.passport.full_name,
                  address: "Villa 12, Emirates Hills, Dubai",
                },
                number: "784-1988-1234567-1",
              },
            });
            upsertDocument(willId, {
              doc_type: "emirates_id",
              status: "validated",
              ocr_extracted: { address: "Villa 12, Emirates Hills, Dubai" },
              match_result: "match",
              uploaded_at: new Date().toISOString(),
              validated_at: new Date().toISOString(),
            });
          }}
        />
      )}

      {hasProperty && (
        <DocRow
          title="Title deed"
          subtitle="Reads the owner and flags joint ownership (the gift may not pass the whole asset)."
          uploaded={draft.title_deed.uploaded}
          onUpload={() => {
            update({
              title_deed: {
                uploaded: true,
                ocr: { owner: draft.passport.full_name, joint_owner: false },
              },
            });
            upsertDocument(willId, {
              doc_type: "title_deed",
              status: "validated",
              ocr_extracted: { owner: draft.passport.full_name, joint: false },
              match_result: "match",
              uploaded_at: new Date().toISOString(),
              validated_at: new Date().toISOString(),
            });
          }}
        />
      )}

      {!isResident && !hasProperty && (
        <p className="text-sm text-slate">
          No supporting documents required at this step for your case. You can
          continue.
        </p>
      )}
    </div>
  );
}

function DocRow({
  title,
  subtitle,
  uploaded,
  onUpload,
}: {
  title: string;
  subtitle: string;
  uploaded: boolean;
  onUpload: () => void;
}) {
  return (
    <Card className="flex items-center justify-between gap-3 p-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{title}</span>
          {uploaded ? (
            <Pill tone="sage">Uploaded</Pill>
          ) : (
            <Pill tone="amber">Upload later ok</Pill>
          )}
          <MockLabel>OCR simulated</MockLabel>
        </div>
        <p className="mt-1 text-xs text-slate">{subtitle}</p>
      </div>
      {!uploaded && (
        <Button variant="secondary" onClick={onUpload}>
          Upload
        </Button>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Step 6 — Review & submit
// ---------------------------------------------------------------------------

function clientRules(
  draft: IntakeDraft,
  structured: StructuredWill,
  ai: boolean
): RuleResult[] {
  return runRules(structured, {
    passport_ocr_name: draft.passport.ocr?.full_name ?? draft.passport.full_name,
    passport_uploaded: draft.passport.uploaded,
    title_deed: draft.title_deed.uploaded
      ? {
          uploaded: true,
          owner: draft.title_deed.ocr?.owner,
          joint_owner: draft.title_deed.ocr?.joint_owner,
        }
      : null,
    ai_structured: ai,
  });
}

function ReviewStep({
  draft,
  structured,
  structuring,
  result,
  submitted,
  onStructure,
  onSubmit,
}: {
  draft: IntakeDraft;
  structured: StructuredWill;
  structuring: boolean;
  result: StructureResult | null;
  submitted: boolean;
  onStructure: () => void;
  onSubmit: (documentsPending: boolean) => void;
}) {
  const rules = clientRules(draft, structured, result?.ai_structured ?? false);
  const blocks = rules.filter((r) => r.severity === "block");
  const warns = rules.filter((r) => r.severity === "warn");

  const isResident = draft.residency_status === "resident";
  const hasProperty = draft.assets.some((a) => a.asset_type === "property");
  const hasChildren = draft.children.length > 0;
  const docsPending =
    (isResident && !draft.emirates_id.uploaded) ||
    (hasProperty && !draft.title_deed.uploaded);

  const checklist: Array<{
    label: string;
    status: "done" | "optional" | "later" | "fix";
  }> = [
    {
      label: "Identity — valid passport",
      status:
        draft.passport.uploaded &&
        new Date(draft.passport.passport_expiry) > new Date()
          ? "done"
          : "fix",
    },
    {
      label: "At least one UAE asset",
      status: draft.assets.length ? "done" : "fix",
    },
    {
      label: "Beneficiary shares total 100%",
      status:
        Math.round(
          draft.beneficiaries.reduce((s, b) => s + (b.share_pct || 0), 0) * 100
        ) /
          100 ===
        100
          ? "done"
          : "fix",
    },
    {
      label: "Executor appointed",
      status: draft.executors.some((e) => e.role === "executor")
        ? "done"
        : "fix",
    },
    ...(hasChildren
      ? [
          {
            label: "Guardian nominated",
            status: draft.guardians.some((g) => g.role === "guardian")
              ? ("done" as const)
              : ("fix" as const),
          },
        ]
      : []),
    ...(isResident
      ? [
          {
            label: "Emirates ID",
            status: draft.emirates_id.uploaded
              ? ("done" as const)
              : ("later" as const),
          },
        ]
      : []),
    ...(hasProperty
      ? [
          {
            label: "Title deed",
            status: draft.title_deed.uploaded
              ? ("done" as const)
              : ("later" as const),
          },
        ]
      : []),
  ];

  if (submitted) {
    return (
      <div className="rounded-xl2 border border-sage/40 bg-sage/8 p-6 text-center">
        <div className="text-3xl">✓</div>
        <h3 className="mt-2 font-serif text-xl text-ink">
          Submitted to the lawyer queue
        </h3>
        <p className="mt-1 text-sm text-slate">
          {docsPending
            ? "Your will's content is locked in. We'll email a secure link for the outstanding documents — the lawyer can review the content now."
            : "Your will is complete and queued for lawyer review."}
        </p>
        <p className="mt-3 text-xs text-slate">
          Switch to the <strong>Lawyer review</strong> tab to see it arrive.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-medium text-ink">
          Everything a submittable will needs
        </h3>
        <ul className="mt-2 space-y-1.5">
          {checklist.map((c) => (
            <li
              key={c.label}
              className="flex items-center justify-between rounded-lg bg-white px-3 py-2 text-sm"
            >
              <span className="text-ink">{c.label}</span>
              {c.status === "done" && <Pill tone="sage">Done ✓</Pill>}
              {c.status === "optional" && <Pill tone="slate">Optional</Pill>}
              {c.status === "later" && (
                <Pill tone="amber">Upload later — ok</Pill>
              )}
              {c.status === "fix" && <Pill tone="clay">Needs fixing</Pill>}
            </li>
          ))}
        </ul>
      </div>

      {blocks.length > 0 && (
        <div className="rounded-lg border border-clay/40 bg-clay/8 p-3 text-sm text-clay">
          <div className="font-medium">Fix before submitting</div>
          <ul className="mt-1 list-disc pl-5">
            {blocks.map((b, i) => (
              <li key={i}>{b.detail}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-lg border border-hairline bg-white p-4">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium text-ink">
            AI structuring &amp; what the lawyer will weigh in on
          </div>
          <Button
            variant="secondary"
            onClick={onStructure}
            disabled={structuring}
          >
            {structuring
              ? "Structuring…"
              : result
              ? "Re-run structuring"
              : "Run AI structuring"}
          </Button>
        </div>
        {result && (
          <div className="mt-2 rounded bg-paper-deep/50 px-3 py-2 text-xs text-slate">
            <span className="font-semibold">
              {result.source === "llm" ? "LLM" : "Deterministic"} structuring:
            </span>{" "}
            {result.note}
          </div>
        )}
        {warns.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {warns.map((w, i) => (
              <li key={i} className="flex items-start gap-2 text-sm">
                <SeverityBadge severity="warn" />
                <span className="text-slate">{w.detail}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-slate">
            No judgment items flagged yet — a clean standard case.
          </p>
        )}
      </div>

      <div className="space-y-2">
        {docsPending ? (
          <>
            <Button
              className="w-full"
              disabled={blocks.length > 0}
              onClick={() => onSubmit(true)}
            >
              Submit now, finish documents later →
            </Button>
            <p className="text-center text-xs text-slate">
              Sends to the lawyer queue in a <em>documents-pending</em> state.
              Documents never block submission.
            </p>
          </>
        ) : (
          <Button
            className="w-full"
            variant="sage"
            disabled={blocks.length > 0}
            onClick={() => onSubmit(false)}
          >
            Submit for lawyer review →
          </Button>
        )}
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
  structured,
  submitted,
  onBack,
  onNext,
}: {
  step: number;
  draft: IntakeDraft;
  structured: StructuredWill;
  submitted: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  // Content-only gating (never documents).
  let blockReason: string | null = null;
  if (step === 0) {
    if (!draft.passport.uploaded) blockReason = "Scan your passport to continue.";
    else if (new Date(draft.passport.passport_expiry) < new Date())
      blockReason = "Passport is expired — provide a valid one.";
    else if (draft.residency_status === "unknown")
      blockReason = "Tell us your residency status.";
  }
  if (step === 2 && draft.assets.length === 0)
    blockReason = "Add at least one UAE asset.";
  if (step === 3) {
    const total = draft.beneficiaries.reduce((s, b) => s + (b.share_pct || 0), 0);
    if (Math.round(total * 100) / 100 !== 100)
      blockReason = "Beneficiary shares must total 100%.";
    else if (!draft.executors.some((e) => e.role === "executor"))
      blockReason = "Appoint an executor.";
  }

  if (submitted) return null;

  return (
    <div className="mt-8 flex items-center justify-between border-t border-hairline pt-5">
      <Button variant="ghost" onClick={onBack} disabled={step === 0}>
        ← Back
      </Button>
      {step < STEPS.length - 1 ? (
        <div className="flex flex-col items-end gap-1">
          <Button onClick={onNext} disabled={!!blockReason}>
            Continue →
          </Button>
          {blockReason && (
            <span className="text-xs text-clay">{blockReason}</span>
          )}
        </div>
      ) : null}
    </div>
  );
}
