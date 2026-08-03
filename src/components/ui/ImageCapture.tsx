"use client";

/**
 * Real document capture: file upload or device camera, sent to /api/ocr for
 * extraction. Works on mobile (rear camera via `capture="environment"`) and
 * desktop (file picker). Shows a thumbnail preview and the extraction source
 * (Claude vision vs. simulated fallback) honestly.
 */
import { useRef, useState } from "react";
import type { OcrDocType } from "@/lib/ocrSchema";
import { Button, MockLabel, Pill } from "./primitives";

export interface OcrResponse<T> {
  extracted: T;
  source: "vision" | "fallback";
  note: string;
  /** The raw file that was captured — pass to storage.ts to also persist it. */
  file: File;
}

function fileToBase64(file: File): Promise<{ base64: string; mediaType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string; // "data:image/jpeg;base64,...."
      const [header, base64] = result.split(",");
      const mediaType = header.match(/data:(.*);base64/)?.[1] || "image/jpeg";
      resolve({ base64, mediaType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function ImageCapture<T>({
  docType,
  label,
  onExtracted,
}: {
  docType: OcrDocType;
  label: string;
  onExtracted: (result: OcrResponse<T>) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<OcrResponse<T> | null>(null);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setLoading(true);
    setPreview(URL.createObjectURL(file));
    try {
      const { base64, mediaType } = await fileToBase64(file);
      const res = await fetch("/api/ocr", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          doc_type: docType,
          image_base64: base64,
          media_type: mediaType,
        }),
      });
      if (!res.ok) throw new Error(`OCR failed (${res.status})`);
      const data = { ...((await res.json()) as Omit<OcrResponse<T>, "file">), file };
      setLastResult(data);
      onExtracted(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => cameraInputRef.current?.click()}
        >
          📷 Take photo
        </Button>
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => fileInputRef.current?.click()}
        >
          Upload {label.toLowerCase()}
        </Button>
        {loading && <span className="text-xs text-slate">Reading document…</span>}
      </div>

      {/* Rear-camera capture on mobile; falls back to file picker on desktop. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />

      {preview && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt={`${label} preview`}
          className="h-32 w-full max-w-xs rounded-lg border border-hairline object-cover"
        />
      )}

      {error && (
        <p className="text-xs text-clay">{error} — try a clearer photo.</p>
      )}

      {lastResult && (
        // Badge only — the raw `note` (which can read "No ANTHROPIC_API_KEY
        // set — simulated extraction") is an internal diagnostic and must
        // never surface on a client screen. A short reassuring line instead.
        <div className="flex items-center gap-2 text-xs">
          {lastResult.source === "vision" ? (
            <Pill tone="sage">Auto-read</Pill>
          ) : (
            <MockLabel>Simulated read</MockLabel>
          )}
          <span className="text-slate">We&apos;ve captured the details from your document.</span>
        </div>
      )}
    </div>
  );
}
