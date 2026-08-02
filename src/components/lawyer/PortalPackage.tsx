"use client";

/**
 * The Portal-Ready Package (capstone). Renders the human-readable, copy-paste
 * text block (§1.5) — never raw JSON — mapped to the DIFC portal's 10 steps.
 * "Copy package for Ops" / "Download as PDF" (the package text, for Ops to
 * paste from), plus "Generate draft will PDF" which calls the real PDF
 * renderer and uploads it to storage so it appears as a clickable document
 * link in Step 8. Today Ops pastes from here; v2 auto-fills the portal.
 */
import { useState } from "react";
import type { Identity, PortalSubmission, StructuredWill } from "@/lib/types";
import { recordDocument, generatePortalPackage } from "@/lib/store";
import { uploadDocumentFile } from "@/lib/storage";
import { Button, Card, MockLabel, Pill } from "@/components/ui/primitives";

export function PortalPackageView({
  submission,
  onMarkRegistered,
  registered,
  structured,
  identity,
}: {
  submission: PortalSubmission;
  onMarkRegistered: () => void;
  registered: boolean;
  structured: StructuredWill | null;
  identity: Identity | null;
}) {
  const [copied, setCopied] = useState(false);
  const [generatingPdf, setGeneratingPdf] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(submission.package_text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const downloadText = () => {
    const blob = new Blob([submission.package_text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "difc-portal-package.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  const generateDraftPdf = async () => {
    if (!structured) return;
    setGeneratingPdf(true);
    try {
      const res = await fetch("/api/will-pdf", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ structured, identity }),
      });
      if (!res.ok) throw new Error(`PDF generation failed (${res.status})`);
      const blob = await res.blob();
      const stored = await uploadDocumentFile(submission.will_id, "draft_will_pdf", blob, "draft-will.pdf");
      recordDocument(submission.will_id, "draft_will_pdf", {
        status: "validated",
        file_path: stored.file_path,
        file_url: stored.file_url,
        expires_at: stored.expires_at,
        uploaded_at: new Date().toISOString(),
        validated_at: new Date().toISOString(),
      });
      generatePortalPackage(submission.will_id); // rebuild the package text with the new link
    } finally {
      setGeneratingPdf(false);
    }
  };

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-serif text-lg text-ink">Portal-Ready Package</h3>
          <p className="text-xs text-slate">DIFC Courts 10-step form, pre-mapped from validated data.</p>
        </div>
        <MockLabel>Portal submission external</MockLabel>
      </div>

      <pre className="mt-4 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-paper-deep/40 p-4 font-mono text-xs text-ink">
        {submission.package_text}
      </pre>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={copy}>
          {copied ? "Copied ✓" : "Copy package for Ops"}
        </Button>
        <Button variant="secondary" onClick={downloadText}>
          Download package (.txt)
        </Button>
        <Button variant="secondary" disabled={generatingPdf} onClick={generateDraftPdf}>
          {generatingPdf ? "Generating…" : "Generate draft will PDF"}
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
