"use client";

/**
 * The adaptive "secure link" screen (§1B-ter) — NOT a re-do of intake. One
 * mechanism, two modes: a document re-upload (reuses ImageCapture, same as
 * intake) or a question to answer (short text reply). Responding returns the
 * case to the lawyer at the same item and resumes the review timer.
 */
import { useState } from "react";
import { getDB, recordDocument, respondToClarification, useDB } from "@/lib/store";
import { uploadDocumentFile } from "@/lib/storage";
import { ImageCapture } from "@/components/ui/ImageCapture";
import type { EmiratesIdExtract, PassportExtract, TitleDeedExtract } from "@/lib/ocrSchema";
import { Button, Card, MockLabel } from "@/components/ui/primitives";

export function ClarificationResponse({
  clarificationId,
  onDone,
}: {
  clarificationId: string;
  onDone: () => void;
}) {
  useDB();
  const [responseText, setResponseText] = useState("");
  const [sent, setSent] = useState(false);

  const d = getDB();
  const clarification = d.clarifications.find((c) => c.id === clarificationId);
  if (!clarification) return null;
  const will = d.wills.find((w) => w.id === clarification.will_id);

  if (sent) {
    return (
      <div className="mx-auto max-w-xl px-5 py-10 text-center">
        <div className="text-3xl">✓</div>
        <h2 className="mt-2 font-serif text-2xl text-ink">Sent — thank you</h2>
        <p className="mt-2 text-sm text-slate">
          Your lawyer will pick this up and continue reviewing your will.
        </p>
        <Button className="mt-6" onClick={onDone}>
          Done
        </Button>
      </div>
    );
  }

  const submitText = () => {
    if (!responseText.trim()) return;
    respondToClarification(clarificationId, { text: responseText.trim() });
    setSent(true);
  };

  const handleDocExtracted = async (extracted: unknown, file: File) => {
    if (!will) return;
    const stored = await uploadDocumentFile(will.id, clarification.doc_type!, file);
    recordDocument(will.id, clarification.doc_type!, {
      status: "validated",
      ocr_extracted: extracted as Record<string, unknown>,
      match_result: "match",
      file_path: stored.file_path,
      file_url: stored.file_url,
      expires_at: stored.expires_at,
      uploaded_at: new Date().toISOString(),
      validated_at: new Date().toISOString(),
    });
    respondToClarification(clarificationId, { filePath: stored.file_path });
    setSent(true);
  };

  return (
    <div className="mx-auto max-w-xl px-5 py-10">
      <div className="mb-2 text-xs font-medium uppercase tracking-widest text-slate">
        Your lawyer has a question
      </div>
      <h2 className="font-serif text-2xl text-ink">
        {will?.structured_json?.testator.name || will?.identity?.full_name}
      </h2>

      <Card className="mt-5 p-5">
        <p className="whitespace-pre-line text-sm text-ink">{clarification.message_final}</p>
      </Card>

      <div className="mt-5">
        {clarification.mode === "document_reupload" ? (
          <>
            <p className="mb-2 text-sm text-slate">
              Upload the document below — we&apos;ll read it automatically, same as during intake.
            </p>
            {clarification.doc_type === "passport" && (
              <ImageCapture<PassportExtract>
                docType="passport"
                label="passport"
                onExtracted={({ extracted, file }) => handleDocExtracted(extracted, file)}
              />
            )}
            {clarification.doc_type === "emirates_id" && (
              <ImageCapture<EmiratesIdExtract>
                docType="emirates_id"
                label="Emirates ID"
                onExtracted={({ extracted, file }) => handleDocExtracted(extracted, file)}
              />
            )}
            {clarification.doc_type === "title_deed" && (
              <ImageCapture<TitleDeedExtract>
                docType="title_deed"
                label="title deed"
                onExtracted={({ extracted, file }) => handleDocExtracted(extracted, file)}
              />
            )}
          </>
        ) : (
          <>
            <textarea
              className="w-full rounded-lg border border-hairline bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-slate focus:ring-2 focus:ring-slate/20"
              rows={3}
              placeholder="Type your reply…"
              value={responseText}
              onChange={(e) => setResponseText(e.target.value)}
            />
            <Button className="mt-3 w-full" disabled={!responseText.trim()} onClick={submitText}>
              Send response
            </Button>
          </>
        )}
      </div>

      <p className="mt-4 text-center text-xs text-slate">
        <MockLabel>Secure link</MockLabel> No need to log back into the full form.
      </p>
    </div>
  );
}
