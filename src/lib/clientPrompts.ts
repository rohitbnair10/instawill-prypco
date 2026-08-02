/**
 * Client-facing prompt translator.
 *
 * THE AUDIENCE SPLIT: the model's raw internals — confidence_notes, the
 * "AI-structured from free text" diagnostic, field names, null defaults, the
 * severity model — are LAWYER-facing. They must never render verbatim on a
 * client screen. This module converts the SAME underlying data into warm,
 * plain-language prompts written for the client.
 *
 * Key discipline: every string here is app-authored. We derive prompts ONLY
 * from the deterministic rules engine's CLIENT-answerable results (and the
 * structured fields), never by parsing confidence_notes — so nothing internal
 * can leak. Lawyer-owned checks (name mismatch, minor-no-trust, ADJD,
 * foreign-will, business shares, ai_distribution, ...) are skipped entirely;
 * they go silently to the lawyer. The list is capped so the client sees a
 * short, calm "couple of things to confirm", never "everything the machine
 * found".
 */
import type { RuleResult } from "./rules";
import type { StructuredWill } from "./types";

export interface ClientPrompt {
  id: string;
  /** Warm, one-line question/prompt written for the client. */
  text: string;
  /** true → this gates "continue" (it was a content block). Shown gently. */
  required: boolean;
}

const MAX_PROMPTS = 5;

export function buildClientPrompts(
  rules: RuleResult[],
  will: StructuredWill
): ClientPrompt[] {
  // Only checks the CLIENT can actually answer. Everything else is the lawyer's.
  const firedClient = new Set(
    rules.filter((r) => r.owner === "client" && r.severity !== "ok").map((r) => r.check_key)
  );

  const prompts: ClientPrompt[] = [];
  const seen = new Set<string>();
  const add = (id: string, text: string, required: boolean) => {
    if (seen.has(id)) return;
    seen.add(id);
    prompts.push({ id, text, required });
  };

  const namedBeneficiaries = will.beneficiaries.map((b) => b.name.trim()).filter(Boolean);
  const namesList =
    namedBeneficiaries.length === 0
      ? "your loved ones"
      : namedBeneficiaries.length === 1
      ? namedBeneficiaries[0]
      : namedBeneficiaries.slice(0, -1).join(", ") + " and " + namedBeneficiaries[namedBeneficiaries.length - 1];

  // ---- required (content the will can't be finished without) ----
  if (firedClient.has("no_uae_asset")) {
    add("asset", "What would you like to include in your will — a property, bank accounts, or something else?", true);
  }
  if (firedClient.has("beneficiary_incomplete")) {
    add("bene_name", "Who is receiving this share? Just add their name.", true);
  }
  if (firedClient.has("shares_sum")) {
    add("shares", `How would you like this divided between ${namesList}? (the shares add up to 100%)`, true);
  }
  if (firedClient.has("property_address_missing")) {
    add("property", "What's the address of your property? (building, unit, or community is enough)", true);
  }
  if (firedClient.has("executor_missing")) {
    add("executor", "Who would you like to carry out your wishes (your executor)?", true);
  }

  // ---- gentle confirmations (nice to have; don't block) ----
  if (firedClient.has("executor_relationship_missing")) {
    const ex = will.executor.name.trim();
    add("exec_rel", `And how is ${ex || "your executor"} related to you? (e.g. brother, wife, friend)`, false);
  }
  // Per-beneficiary missing relationship — derived from the will, not from a
  // raw check detail, so we control every word.
  will.beneficiaries
    .filter((b) => b.name.trim() && !b.relationship.trim())
    .forEach((b) => add(`bene_rel_${b.name}`, `How is ${b.name} related to you?`, false));

  if (firedClient.has("guardian_for_minor_missing")) {
    add("guardian", "Who would you like to look after your children (their guardian) if needed?", false);
  }

  // Minor beneficiaries → gently confirm age (this is what drives protecting a
  // young person's share). Phrased as a friendly confirmation, never as
  // "is_minor assumed".
  will.beneficiaries
    .filter((b) => b.is_minor && b.name.trim())
    .forEach((b) => add(`age_${b.name}`, `Just to confirm — is ${b.name} under 21? We'll protect their share if so.`, false));

  // Required first, then gentle confirmations; keep the list short and calm.
  const required = prompts.filter((p) => p.required);
  const optional = prompts.filter((p) => !p.required);
  return [...required, ...optional].slice(0, MAX_PROMPTS);
}

/**
 * The one warm sentence the client sees describing their will. Uses the
 * model's distribution_summary ONLY when it came from a real structuring pass;
 * the fallback's distribution_summary is itself a diagnostic ("Not structured
 * — no ANTHROPIC_API_KEY...") and must never be shown, so we return a neutral,
 * reassuring line instead.
 */
export function clientSummaryLine(
  will: StructuredWill,
  source: "llm" | "fallback"
): string {
  if (source === "llm" && will.distribution_summary.trim()) {
    return will.distribution_summary.trim();
  }
  return "Let's put your will together — just add your details below and we'll take it from there.";
}
