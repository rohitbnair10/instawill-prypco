"use client";

/**
 * The Portal-Ready Package (capstone). Shows the 10-step DIFC Courts portal form
 * mapped to already-validated data. Steps 1–8 are data InstaWill holds; steps
 * 9–10 (appointment + payment) stay with the client. Copy for Ops / Download
 * JSON. Today Ops pastes from here; v2 auto-fills the portal — the second
 * bottleneck, deliberately deferred.
 */
import { useState } from "react";
import type { PortalSubmission } from "@/lib/types";
import { Button, Card, MockLabel, Pill } from "@/components/ui/primitives";

const STEP_META: Array<{ key: keyof PortalSubmission["package_json"]; label: string }> = [
  { key: "step_1_service", label: "1. Service selection" },
  { key: "step_2_personal", label: "2. Personal info" },
  { key: "step_3_real_estate", label: "3. Real estate" },
  { key: "step_4_executor", label: "4. Executor" },
  { key: "step_5_beneficiaries", label: "5. Beneficiaries" },
  { key: "step_6_distribution", label: "6. Distribution" },
  { key: "step_7_witnesses", label: "7. Witnesses" },
  { key: "step_8_documents", label: "8. Document uploads" },
  { key: "step_9_appointment", label: "9. Appointment" },
  { key: "step_10_payment", label: "10. Payment" },
];

export function PortalPackageView({
  submission,
  onMarkRegistered,
  registered,
}: {
  submission: PortalSubmission;
  onMarkRegistered: () => void;
  registered: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const pkg = submission.package_json;
  const json = JSON.stringify(pkg, null, 2);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const download = () => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "difc-portal-package.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-serif text-lg text-ink">Portal-Ready Package</h3>
          <p className="text-xs text-slate">
            DIFC Courts 10-step form, pre-mapped from validated data.
          </p>
        </div>
        <MockLabel>Portal submission external</MockLabel>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {STEP_META.map((s, i) => {
          const clientStep = i >= 8;
          return (
            <div
              key={s.key}
              className={`rounded-lg border p-3 text-sm ${
                clientStep
                  ? "border-amber/30 bg-amber/6"
                  : "border-sage/30 bg-sage/6"
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink">{s.label}</span>
                {clientStep ? (
                  <Pill tone="amber">Client</Pill>
                ) : (
                  <Pill tone="sage">Pre-filled</Pill>
                )}
              </div>
              <pre className="mt-1 max-h-24 overflow-auto whitespace-pre-wrap break-words text-[11px] text-slate">
                {JSON.stringify(pkg[s.key], null, 1)}
              </pre>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copied ✓" : "Copy package for Ops"}
        </Button>
        <Button variant="secondary" onClick={download}>
          Download JSON
        </Button>
        {!registered ? (
          <Button variant="sage" onClick={onMarkRegistered}>
            Mark registered (simulate Ops submit)
          </Button>
        ) : (
          <Pill tone="sage">Registered ✓ — counts toward north-star metric</Pill>
        )}
      </div>

      <p className="mt-3 text-xs text-slate">
        Today Ops pastes from here; v2 auto-fills the portal. This is the second
        bottleneck, deliberately deferred.
      </p>
    </Card>
  );
}
