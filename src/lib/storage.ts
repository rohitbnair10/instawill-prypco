"use client";

/**
 * Document storage — real Supabase Storage with signed URLs when a project is
 * configured; an honest local fallback otherwise (§1.6 in the brief).
 *
 * The automation this powers: on upload, the file lands in a per-will bucket
 * path (`wills/{will_id}/{doc_type}.{ext}`), a time-limited signed URL is
 * generated, and that URL is what the portal package (§1.5) renders as a
 * clickable "ready to attach" link — so ops never hunts for a file. Only the
 * final click into DIFC's own portal stays manual.
 *
 * Without a configured Supabase project, uploads still work end-to-end in the
 * browser via an object URL — clearly labelled as local-only (not shareable
 * outside this session) rather than silently pretending to be a real signed
 * link.
 */
import { getSupabaseClient, SUPABASE_CONFIGURED } from "./supabaseClient";
import type { DocType } from "./types";

const BUCKET = "wills";
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days, per the brief

export interface StoredFile {
  file_path: string;
  file_url: string;
  expires_at: string | null;
  source: "supabase" | "local";
  note: string;
}

function extOf(file: File): string {
  const fromName = file.name.split(".").pop();
  if (fromName && fromName.length <= 5) return fromName;
  if (file.type.includes("pdf")) return "pdf";
  return "jpg";
}

export async function uploadDocumentFile(
  willId: string,
  docType: DocType,
  file: File | Blob,
  filename?: string
): Promise<StoredFile> {
  const path = `${willId}/${docType}-${Date.now()}.${
    file instanceof File ? extOf(file) : filename?.split(".").pop() || "pdf"
  }`;

  if (SUPABASE_CONFIGURED) {
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { error: uploadError } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { upsert: true });
        if (uploadError) throw uploadError;

        const { data: signed, error: signError } = await supabase.storage
          .from(BUCKET)
          .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
        if (signError || !signed?.signedUrl) throw signError || new Error("no signed URL returned");

        return {
          file_path: path,
          file_url: signed.signedUrl,
          expires_at: new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString(),
          source: "supabase",
          note: `Uploaded to Supabase Storage (${BUCKET}/${path}); signed URL expires in 7 days.`,
        };
      } catch (err) {
        // Fall through to local storage rather than failing the upload outright.
        return localFallback(path, file, err);
      }
    }
  }

  return localFallback(path, file);
}

function localFallback(path: string, file: File | Blob, err?: unknown): StoredFile {
  const url = URL.createObjectURL(file);
  return {
    file_path: `local/${path}`,
    file_url: url,
    expires_at: null,
    source: "local",
    note: err
      ? `Supabase Storage unavailable (${
          err instanceof Error ? err.message : "unknown error"
        }) — used local browser storage instead (not shareable outside this session).`
      : "No Supabase project configured — used local browser storage (not shareable outside this session; set NEXT_PUBLIC_SUPABASE_URL/ANON_KEY for real signed links).",
  };
}
