#!/usr/bin/env tsx
/**
 * ============================================================================
 * STANDALONE PIPE DEMO — the automation, with no UI in the loop.
 * ============================================================================
 *
 * This is deliverable #1 per the build brief: proof that a messy paragraph of
 * client wishes goes through a REAL Anthropic API call and comes out the other
 * end as validated will data, a readable DIFC will draft, AND a readable ops
 * portal package — using the exact same modules the web app uses
 * (src/lib/llm.ts, rules.ts, schedule1.ts, portal.ts). No canned output is
 * replayed; if ANTHROPIC_API_KEY is set, this makes a live network call.
 *
 * Usage:
 *   npm run demo:pipe
 *   npm run demo:pipe -- "I'm British, married to Sarah, we live in Dubai
 *     Marina. I want everything to go to Sarah, but if she dies before me,
 *     split it equally between our two kids..."
 *   npm run demo:pipe -- --name "Priya Anand" --nationality Indian "<wishes>"
 *
 * Flags (all optional — sensible demo defaults are used otherwise):
 *   --name <full name>       --nationality <nationality>
 *   --residency resident|non_resident
 *   --passport <number>      --expiry <YYYY-MM-DD>
 *
 * Writes readable output to ./out/ in addition to the console, and always
 * prints which path ran (real LLM vs. honest fallback) — nothing is hidden.
 */
import "dotenv/config";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { structureWishes } from "../src/lib/llm";
import { runRules } from "../src/lib/rules";
import { buildSchedule1, renderSchedule1Text } from "../src/lib/schedule1";
import { buildPortalPackageText } from "../src/lib/portal";
import type { Identity, Will, WillDocument } from "../src/lib/types";

const EXAMPLE_WISHES = `I'm British, married to Sarah, we live in Dubai Marina. I want everything to
go to Sarah, but if she dies before me, split it equally between our two
kids — the youngest, Alex, is 9. We own the Marina apartment and have savings
in Emirates NBD. My brother James should be the executor. I also have an old
will in the UK.`;

function parseArgs(argv: string[]) {
  const flags: Record<string, string> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      flags[a.slice(2)] = argv[i + 1];
      i++;
    } else {
      positional.push(a);
    }
  }
  return { flags, positional };
}

function line(char = "─", n = 78) {
  return char.repeat(n);
}
function heading(title: string) {
  console.log("\n" + line("═"));
  console.log(title);
  console.log(line("═"));
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const wishesText = positional.join(" ").trim() || EXAMPLE_WISHES;

  const futureDate = (years: number) => {
    const d = new Date();
    d.setFullYear(d.getFullYear() + years);
    return d.toISOString().slice(0, 10);
  };

  const expiry = flags.expiry || futureDate(5);
  const identity: Identity = {
    full_name: flags.name || "Thomas Reed",
    passport_number: flags.passport || "TR1234567",
    passport_expiry: expiry,
    passport_expired: new Date(expiry) < new Date(),
    nationality: flags.nationality || "British",
    residency_status: (flags.residency as Identity["residency_status"]) || "resident",
    emirates_id_number: flags.residency === "non_resident" ? null : "784-1985-1234567-1",
    emirates_id_address: null,
    email: "demo@instawill.ae",
    phone: "+971 50 000 0000",
  };

  heading("STEP 0 · RAW INPUT (identity + free-text wishes)");
  console.log("Identity:", JSON.stringify(identity, null, 2));
  console.log("\nWishes (verbatim, client's own words):\n");
  console.log(wishesText);

  heading("STEP 1 · REAL ANTHROPIC CALL → STRUCTURED JSON");
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(
      "⚠ ANTHROPIC_API_KEY not set — this run will use the HONEST FALLBACK\n" +
        "  (no content structured; the automation genuinely requires a key to\n" +
        "  do the free-text → structured-JSON step). Set the key to see the\n" +
        "  real call execute.\n"
    );
  } else {
    console.log(`Calling Anthropic (${process.env.ANTHROPIC_MODEL || "claude-sonnet-5"})…\n`);
  }

  const t0 = Date.now();
  const result = await structureWishes(identity, wishesText);
  const ms = Date.now() - t0;

  console.log(`Source: ${result.source.toUpperCase()}  (${ms}ms)`);
  console.log(`Note:   ${result.note}\n`);
  console.log(JSON.stringify(result.structured, null, 2));

  heading("STEP 2 · RULES ENGINE (severity: block / warn / info / ok)");
  const checks = runRules(result.structured, {
    identity,
    title_deed: result.structured.assets.some((a) => a.type === "property")
      ? { uploaded: true, owner: identity.full_name, joint_owner: false }
      : null,
    ai_structured: result.ai_structured,
  });
  const bySeverity = { block: 0, warn: 0, info: 0, ok: 0 };
  checks.forEach((c) => {
    bySeverity[c.severity]++;
    const icon = { block: "✗", warn: "⚠", info: "ℹ", ok: "✓" }[c.severity];
    console.log(`  ${icon} [${c.severity.toUpperCase().padEnd(5)}] ${c.check_key}: ${c.detail}`);
  });
  console.log(
    `\n  ${bySeverity.block} block · ${bySeverity.warn} warn · ${bySeverity.info} info · ${bySeverity.ok} ok`
  );
  if (bySeverity.block > 0) {
    console.log(
      "\n  ⚠ This will has BLOCKING issues — it could not be submitted by a real client\n" +
        "    until these are fixed (that's the point: client-fixable errors never reach\n" +
        "    the lawyer as work)."
    );
  }

  heading("STEP 3 · OUTPUT 1 — DIFC WILL DRAFT (human-readable)");
  const schedule = buildSchedule1(result.structured, identity);
  const draftText = renderSchedule1Text(schedule);
  console.log(draftText);

  heading("STEP 4 · OUTPUT 2 — OPS / PORTAL-READY PACKAGE (human-readable)");
  const fakeWill: Will = {
    id: "demo-will",
    lead_id: "demo-lead",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    will_type: "full",
    jurisdiction: result.structured.assets.some((a) => a.needs_adjd) ? "adjd" : "difc",
    status: "content_complete",
    identity,
    structured_json: result.structured,
    structured_json_pre_lawyer: result.structured,
    raw_input_text: wishesText,
    ai_structured: result.ai_structured,
    ai_confidence_notes: result.structured.confidence_notes,
    lawyer_made_changes: false,
    content_complete_at: new Date().toISOString(),
  };
  const demoDocuments: WillDocument[] = [
    {
      id: "doc-passport",
      will_id: fakeWill.id,
      doc_type: "passport",
      status: "validated",
      file_url: "(no document uploaded in this CLI run — see the web app for real uploads)",
      ocr_extracted: null,
      match_result: "match",
    },
  ];
  const packageText = buildPortalPackageText(fakeWill, result.structured, identity, demoDocuments);
  console.log(packageText);

  // Persist outputs so they can be inspected outside the console too.
  const outDir = join(process.cwd(), "out");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "structured.json"), JSON.stringify(result.structured, null, 2));
  writeFileSync(join(outDir, "will-draft.txt"), draftText);
  writeFileSync(join(outDir, "portal-package.txt"), packageText);

  heading("DONE");
  console.log(`Wrote: ${join("out", "structured.json")}, will-draft.txt, portal-package.txt`);
  console.log(
    result.source === "llm"
      ? "✓ This ran a REAL Anthropic call end-to-end: text → structured JSON → draft + package."
      : "This ran the HONEST FALLBACK path (no key). Set ANTHROPIC_API_KEY and re-run for the real automation."
  );
}

main().catch((err) => {
  console.error("Pipe demo failed:", err);
  process.exit(1);
});
