/**
 * Fallback structurer — used ONLY when no ANTHROPIC_API_KEY is set, or the
 * real call fails. This is deliberately NOT a fake NLP parser: structuring a
 * free-text paragraph into beneficiaries/assets/executor is exactly the job
 * that requires a real LLM call — pretending a regex/heuristic can do that
 * reliably would misrepresent the automation. So the fallback is honest about
 * its limits: it preserves the identity fields (which are already structured,
 * not AI-derived) and returns an empty content structure with confidence_notes
 * explaining that the wishes text still needs a human (or a configured key) to
 * structure it. This still flows through the same rules engine, which will
 * correctly fire `no_uae_asset` / `shares_sum` blocks — nothing is silently
 * treated as valid.
 */
import type { Identity, StructuredWill } from "./types";

export function fallbackStructure(
  identity: Identity,
  wishesText: string
): StructuredWill {
  const hasText = Boolean(wishesText?.trim());
  return {
    testator: {
      name: identity.full_name,
      nationality: identity.nationality || "",
      residency: identity.residency_status,
    },
    beneficiaries: [],
    executor: { name: "", relationship: "" },
    substitute_executor: null,
    guardian: null,
    substitute_guardian: null,
    assets: [],
    foreign_will: false,
    distribution_summary: hasText
      ? "Not structured — automated drafting isn't configured in this environment. The raw wishes text below needs manual entry."
      : "No wishes provided yet.",
    confidence_notes: hasText
      ? `Automated structuring isn't configured in this environment. Raw wishes text (verbatim, for manual entry): "${wishesText.trim()}"`
      : "No wishes text was provided.",
  };
}
