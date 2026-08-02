"use client";

/**
 * CLIENT FINAL APPROVAL — the consent gate before registration (§1B-bis).
 *
 * Why this exists: at the DIFC registration appointment the testator
 * personally signs the will and an officer reads it back to confirm consent.
 * The lawyer may have amended the draft during review — the client hasn't
 * seen those changes. Sending a lawyer-amended draft straight to registration
 * means the client would sign, at the appointment, a version they never
 * reviewed. This screen closes that gap.
 *
 * Three distinct approvals for three distinct things: the LLM structures, the
 * lawyer approves validity, the client approves intent (including any lawyer
 * changes). Adaptive: if the lawyer made no changes, this is a lightweight
 * "confirm to proceed"; the moment anything changed, it's a substantive
 * re-approval of the specific diffs.
 */
import { useState } from "react";
import {
  clientApprove,
  clientRequestChange,
  generatePortalPackage,
  getDB,
  useDB,
} from "@/lib/store";
import { diffStructuredWill, structuringNotes } from "@/lib/stateMachine";
import { LiveWill } from "@/components/LiveWill";
import { Button, Card, Pill } from "@/components/ui/primitives";

export function ClientFinalApproval({
  willId,
  onDone,
}: {
  willId: string;
  onDone: () => void;
}) {
  useDB(); // subscribe so this re-renders as the store mutates
  const [note, setNote] = useState("");
  const [showRequestChange, setShowRequestChange] = useState(false);
  const [done, setDone] = useState<"approved" | "changes_requested" | null>(null);

  const d = getDB();
  const will = d.wills.find((w) => w.id === willId);
  if (!will || !will.structured_json) return null;

  const changes = diffStructuredWill(will.structured_json_pre_lawyer, will.structured_json);
  const notes = structuringNotes(will.structured_json);
  const noChanges = changes.length === 0;

  if (done === "approved") {
    return (
      <div className="mx-auto max-w-xl px-5 py-10 text-center">
        <div className="text-3xl">✓</div>
        <h2 className="mt-2 font-serif text-2xl text-ink">Thank you — you&apos;re approved</h2>
        <p className="mt-2 text-sm text-slate">
          Your will is now portal-ready. Ops will prepare your DIFC Courts submission;
          you&apos;ll be contacted to book your registration appointment, where you sign
          in front of two witnesses.
        </p>
        <Button className="mt-6" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  if (done === "changes_requested") {
    return (
      <div className="mx-auto max-w-xl px-5 py-10 text-center">
        <div className="text-3xl">↩</div>
        <h2 className="mt-2 font-serif text-2xl text-ink">Sent back to your lawyer</h2>
        <p className="mt-2 text-sm text-slate">
          We&apos;ve flagged your requested change. Your lawyer will review it and send
          an updated draft back to you.
        </p>
        <Button className="mt-6" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-8">
      <div className="mb-2 text-xs font-medium uppercase tracking-widest text-slate">
        Final approval — step before registration
      </div>
      <h2 className="font-serif text-2xl text-ink">
        {noChanges ? "Your lawyer approved your will with no changes" : "Your lawyer made some changes"}
      </h2>
      <p className="mt-2 text-sm text-slate">
        {noChanges
          ? "Nothing changed from what you submitted — please confirm this still reflects your wishes before we proceed to registration."
          : "Review what changed below. Your will only proceeds to registration once you confirm it still reflects your wishes."}
      </p>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_420px]">
        <div className="space-y-4">
          {!noChanges && (
            <Card className="border-amber/30 bg-amber/6 p-4">
              <div className="text-sm font-semibold text-amber">What your lawyer changed</div>
              <ul className="mt-2 space-y-3">
                {changes.map((c, i) => (
                  <li key={i} className="text-sm">
                    <div className="text-ink">{c.explanation}</div>
                    <div className="mt-0.5 text-xs text-slate">
                      {c.field}: <span className="line-through">{c.before}</span> →{" "}
                      <span className="font-medium text-ink">{c.after}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {notes.length > 0 && (
            <Card className="p-4">
              <div className="text-sm font-semibold text-ink">How your will was structured</div>
              <ul className="mt-2 space-y-1.5">
                {notes.map((n, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate">
                    <span className="mt-0.5 text-sage">•</span>
                    {n}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!showRequestChange ? (
            <div className="space-y-2">
              <Button
                className="w-full"
                variant="sage"
                onClick={() => {
                  clientApprove(willId);
                  generatePortalPackage(willId);
                  setDone("approved");
                }}
              >
                This reflects my wishes — proceed to registration
              </Button>
              <Button className="w-full" variant="ghost" onClick={() => setShowRequestChange(true)}>
                Request a change
              </Button>
            </div>
          ) : (
            <Card className="p-4">
              <div className="text-sm font-medium text-ink">What would you like changed?</div>
              <textarea
                className="mt-2 w-full rounded-lg border border-hairline bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate focus:ring-2 focus:ring-slate/20"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Actually I'd like my sister to be the substitute executor, not my brother."
              />
              <div className="mt-2 flex gap-2">
                <Button
                  disabled={!note.trim()}
                  onClick={() => {
                    clientRequestChange(willId, note.trim());
                    setDone("changes_requested");
                  }}
                >
                  Send to lawyer
                </Button>
                <Button variant="ghost" onClick={() => setShowRequestChange(false)}>
                  Cancel
                </Button>
              </div>
            </Card>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-widest text-slate">
              Finalised draft
            </span>
            {will.lawyer_made_changes && <Pill tone="amber">Amended by lawyer</Pill>}
          </div>
          <Card className="p-5">
            <LiveWill structured={will.structured_json} identity={will.identity} compact />
          </Card>
        </div>
      </div>
    </div>
  );
}
