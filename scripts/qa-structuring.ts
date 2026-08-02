#!/usr/bin/env tsx
/**
 * ============================================================================
 * QA — free-text → structured field completeness.
 * ============================================================================
 *
 * Two layers:
 *
 *  1. DETERMINISTIC (always runs, no network): builds StructuredWill objects
 *     with specific fields missing and asserts the rules engine flags exactly
 *     the right check at the right severity. This is the regression guarantee
 *     that "a field a lawyer needs is missing" is always caught — every case
 *     the user listed (beneficiary name, relationship, age→minor, property
 *     address, executor details, guardian) plus the rest of the severity model.
 *
 *  2. LIVE (opt-in: `--live <baseUrl>`): sends messy, realistic free-text to a
 *     running /api/structure (e.g. the Vercel deployment, which has the key),
 *     then runs the rules engine on the real LLM output and reports what was
 *     flagged. Verifies the end-to-end pipe surfaces missing info — including
 *     the semantic gaps (unstated ages) the LLM must expose in confidence_notes.
 *
 * Usage:
 *   npm run qa                                   # deterministic only
 *   npm run qa -- --live https://instawill-prypco.vercel.app
 *
 * Exits non-zero if any deterministic assertion (or a hard live case) fails.
 */
import { runRules, type RuleResult } from "../src/lib/rules";
import type { CheckKey, Identity, Severity, StructuredWill } from "../src/lib/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function baseIdentity(): Identity {
  return {
    full_name: "Rohit Nair",
    passport_number: "P1234567",
    passport_expiry: "2032-01-01",
    passport_expired: false,
    nationality: "Indian",
    residency_status: "resident",
    emirates_id_number: "784-1985-1234567-1",
    emirates_id_address: "Dubai Marina, Dubai",
  };
}

/** A complete, standard, valid will — every test clones and breaks one thing. */
function baseWill(): StructuredWill {
  return {
    testator: { name: "Rohit Nair", nationality: "Indian", residency: "resident" },
    beneficiaries: [
      {
        name: "Priyanka Nair",
        relationship: "wife",
        share_pct: 100,
        is_minor: false,
        substitution: "to our children in equal shares",
        held_in_trust: false,
      },
    ],
    executor: { name: "Priyanka Nair", relationship: "wife" },
    substitute_executor: null,
    guardian: null,
    substitute_guardian: null,
    assets: [
      { type: "property", emirate: "dubai", needs_adjd: false, description: "Apt 101, Marina Gate 1, Dubai Marina" },
    ],
    foreign_will: false,
    distribution_summary: "100% to wife Priyanka.",
    confidence_notes: "",
  };
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

// ---------------------------------------------------------------------------
// Deterministic test battery
// ---------------------------------------------------------------------------

interface Expect {
  key: CheckKey;
  severity: Severity;
}

interface Case {
  name: string;
  will: StructuredWill;
  identity?: Identity;
  titleDeed?: { uploaded: boolean; owner?: string; joint_owner?: boolean } | null;
  aiStructured?: boolean;
  expectPresent?: Expect[];
  expectAbsent?: CheckKey[];
}

function w(mut: (will: StructuredWill) => void): StructuredWill {
  const will = baseWill();
  mut(will);
  return will;
}

const CASES: Case[] = [
  {
    name: "complete standard will → no blocks, no missing-field flags",
    will: baseWill(),
    expectAbsent: [
      "executor_missing",
      "executor_relationship_missing",
      "beneficiary_incomplete",
      "beneficiary_relationship_missing",
      "property_address_missing",
      "shares_sum",
      "no_uae_asset",
      "guardian_for_minor_missing",
    ],
  },
  {
    name: "missing executor name",
    will: w((x) => (x.executor = { name: "", relationship: "" })),
    expectPresent: [{ key: "executor_missing", severity: "block" }],
  },
  {
    name: "executor named but relationship missing",
    will: w((x) => (x.executor = { name: "James", relationship: "" })),
    expectPresent: [{ key: "executor_relationship_missing", severity: "warn" }],
    expectAbsent: ["executor_missing"],
  },
  {
    name: "beneficiary missing a name",
    will: w((x) => (x.beneficiaries[0].name = "")),
    expectPresent: [{ key: "beneficiary_incomplete", severity: "block" }],
  },
  {
    name: "beneficiary missing a relationship",
    will: w((x) => (x.beneficiaries[0].relationship = "")),
    expectPresent: [{ key: "beneficiary_relationship_missing", severity: "warn" }],
    expectAbsent: ["beneficiary_incomplete"],
  },
  {
    name: "property with no address/description",
    will: w((x) => (x.assets[0].description = "")),
    expectPresent: [{ key: "property_address_missing", severity: "block" }],
  },
  {
    name: "bank account with no description → NOT flagged (movables category)",
    will: w((x) => (x.assets = [{ type: "bank_account", emirate: "n_a", needs_adjd: false, description: "" }])),
    expectAbsent: ["property_address_missing", "no_uae_asset"],
  },
  {
    name: "shares do not total 100%",
    will: w((x) => (x.beneficiaries[0].share_pct = 60)),
    expectPresent: [{ key: "shares_sum", severity: "block" }],
  },
  {
    name: "no UAE asset at all",
    will: w((x) => (x.assets = [])),
    expectPresent: [{ key: "no_uae_asset", severity: "block" }],
  },
  {
    name: "passport expired",
    will: baseWill(),
    identity: { ...baseIdentity(), passport_expired: true, passport_expiry: "2020-01-01" },
    expectPresent: [{ key: "passport_expired", severity: "block" }],
  },
  {
    name: "passport missing",
    will: baseWill(),
    identity: { ...baseIdentity(), passport_number: "" },
    expectPresent: [{ key: "passport_missing", severity: "block" }],
  },
  {
    name: "minor beneficiary with no trust",
    will: w((x) => {
      x.beneficiaries = [
        { name: "Priyanka Nair", relationship: "wife", share_pct: 60, is_minor: false, substitution: "to issue", held_in_trust: false },
        { name: "Alex Nair", relationship: "son", share_pct: 40, is_minor: true, substitution: "to residuary estate", held_in_trust: false },
      ];
    }),
    expectPresent: [{ key: "minor_no_trust", severity: "warn" }],
  },
  {
    name: "minor CHILD inheriting but no guardian named",
    will: w((x) => {
      x.beneficiaries = [
        { name: "Priyanka Nair", relationship: "wife", share_pct: 60, is_minor: false, substitution: "to issue", held_in_trust: false },
        { name: "Alex Nair", relationship: "son", share_pct: 40, is_minor: true, substitution: "to residuary estate", held_in_trust: true },
      ];
      x.guardian = null;
    }),
    expectPresent: [{ key: "guardian_for_minor_missing", severity: "warn" }],
  },
  {
    name: "minor child WITH guardian → no guardian-missing flag",
    will: w((x) => {
      x.beneficiaries = [
        { name: "Priyanka Nair", relationship: "wife", share_pct: 60, is_minor: false, substitution: "to issue", held_in_trust: false },
        { name: "Alex Nair", relationship: "son", share_pct: 40, is_minor: true, substitution: "to residuary estate", held_in_trust: true },
      ];
      x.guardian = { name: "Margaret Nair", relationship: "sister" };
    }),
    expectPresent: [{ key: "guardian_needed", severity: "info" }],
    expectAbsent: ["guardian_for_minor_missing"],
  },
  {
    name: "minor NON-child (niece) inheriting → no guardian-missing flag",
    will: w((x) => {
      x.beneficiaries = [
        { name: "Priyanka Nair", relationship: "wife", share_pct: 60, is_minor: false, substitution: "to issue", held_in_trust: false },
        { name: "Lily", relationship: "niece", share_pct: 40, is_minor: true, substitution: "to residuary estate", held_in_trust: true },
      ];
      x.guardian = null;
    }),
    expectAbsent: ["guardian_for_minor_missing"],
  },
  {
    name: "duplicate beneficiary",
    will: w((x) => {
      x.beneficiaries = [
        { name: "Priyanka Nair", relationship: "wife", share_pct: 50, is_minor: false, substitution: "to issue", held_in_trust: false },
        { name: "Priyanka Nair", relationship: "wife", share_pct: 50, is_minor: false, substitution: "to issue", held_in_trust: false },
      ];
    }),
    expectPresent: [{ key: "duplicate_beneficiary", severity: "warn" }],
  },
  {
    name: "passport / will name mismatch",
    will: w((x) => (x.testator.name = "Rohit Kumar Nair")),
    identity: { ...baseIdentity(), full_name: "R. Nair" },
    expectPresent: [{ key: "name_mismatch", severity: "warn" }],
  },
  {
    name: "Abu Dhabi property → ADJD routing",
    will: w((x) => (x.assets = [{ type: "property", emirate: "abu_dhabi", needs_adjd: true, description: "Villa, Saadiyat" }])),
    expectPresent: [{ key: "adjd_routing", severity: "warn" }],
  },
  {
    name: "foreign will present",
    will: w((x) => (x.foreign_will = true)),
    expectPresent: [{ key: "foreign_will_revocation", severity: "warn" }],
  },
  {
    name: "business shares present",
    will: w((x) => x.assets.push({ type: "business_shares", emirate: "n_a", needs_adjd: false, description: "30% of DMCC co" })),
    expectPresent: [{ key: "business_shares", severity: "warn" }],
  },
  {
    name: "missing substitution instruction",
    will: w((x) => (x.beneficiaries[0].substitution = "")),
    expectPresent: [{ key: "substitution_missing", severity: "warn" }],
  },
  {
    name: "joint-owned title deed",
    will: baseWill(),
    titleDeed: { uploaded: true, owner: "Rohit Nair", joint_owner: true },
    expectPresent: [{ key: "deed_joint_owner", severity: "warn" }],
  },
  {
    name: "non-resident testator",
    will: baseWill(),
    identity: { ...baseIdentity(), residency_status: "non_resident", emirates_id_number: null },
    expectPresent: [{ key: "non_resident_path", severity: "info" }],
  },
];

function has(results: RuleResult[], key: CheckKey, severity?: Severity): boolean {
  return results.some((r) => r.check_key === key && (severity ? r.severity === severity : true));
}

/**
 * A check "fired as a problem" if it appears as block/warn/info. The engine
 * also emits `ok`-severity confirmations for checks that PASSED (these feed the
 * lawyer's green "cleared at intake" strip) — those are not problems, so
 * expectAbsent ignores them.
 */
function firedAsProblem(results: RuleResult[], key: CheckKey): boolean {
  return results.some((r) => r.check_key === key && r.severity !== "ok");
}

function runDeterministic(): boolean {
  let passed = 0;
  let failed = 0;
  console.log("\n=== DETERMINISTIC rules-engine field-completeness battery ===\n");

  for (const c of CASES) {
    const identity = c.identity ?? baseIdentity();
    const results = runRules(c.will, {
      identity,
      title_deed: c.titleDeed ?? null,
      ai_structured: c.aiStructured ?? false,
    });

    const failures: string[] = [];
    for (const e of c.expectPresent ?? []) {
      if (!has(results, e.key, e.severity)) {
        failures.push(`expected ${e.severity}:${e.key} — not found`);
      }
    }
    for (const k of c.expectAbsent ?? []) {
      if (firedAsProblem(results, k)) {
        failures.push(`expected NO ${k} problem — but it fired as block/warn/info`);
      }
    }

    if (failures.length === 0) {
      passed++;
      console.log(`  ✓ ${c.name}`);
    } else {
      failed++;
      console.log(`  ✗ ${c.name}`);
      failures.forEach((f) => console.log(`      - ${f}`));
      const fired = results.map((r) => `${r.severity}:${r.check_key}`).join(", ");
      console.log(`      (fired: ${fired})`);
    }
  }

  console.log(`\n  ${passed} passed, ${failed} failed (of ${CASES.length})`);
  return failed === 0;
}

// ---------------------------------------------------------------------------
// Live LLM mode (opt-in)
// ---------------------------------------------------------------------------

interface LiveCase {
  name: string;
  wishes: string;
  identity: Identity;
  /** Hard assertions (fail the run). */
  mustFlag?: CheckKey[];
  /** Soft: a missing-info case should produce SOME signal (block/warn/notes). */
  expectSomeGap?: boolean;
}

const LIVE_CASES: LiveCase[] = [
  {
    name: "no UAE asset + no executor named",
    wishes: "I want everything to go to my wife Priyanka.",
    identity: baseIdentity(),
    mustFlag: ["no_uae_asset", "executor_missing"],
  },
  {
    name: "property + kids with UNSTATED ages + unnamed executor",
    wishes: "I have an apartment in Dubai Marina. Split it 50-50 between my wife Priyanka and our son.",
    identity: baseIdentity(),
    expectSomeGap: true, // age of son not stated; executor not named
  },
  {
    name: "vague property (no address) + charity with no relationship",
    wishes: "I have a property in Dubai. Give half to my wife and half to charity. My brother is the executor.",
    identity: baseIdentity(),
    expectSomeGap: true, // no address, executor relationship maybe missing
  },
  {
    name: "foreign will + no executor",
    wishes:
      "Everything to my two kids equally if my wife Sarah dies before me, otherwise all to Sarah. We own a villa in Jumeirah. I also have a UK will.",
    identity: baseIdentity(),
    mustFlag: ["executor_missing"],
    expectSomeGap: true,
  },
  {
    name: "complete, well-specified will → should be clean",
    wishes:
      "My villa at Villa 12, Emirates Hills, Dubai goes 100% to my wife Priyanka (she is 45). My brother Rohan (age 50) is my executor. If Priyanka predeceases me, her share passes to our adult children in equal shares.",
    identity: baseIdentity(),
  },
];

async function runLive(baseUrl: string): Promise<boolean> {
  console.log(`\n=== LIVE mode against ${baseUrl}/api/structure ===\n`);
  let hardFailed = 0;

  for (const c of LIVE_CASES) {
    process.stdout.write(`  • ${c.name}\n`);
    let structured: StructuredWill;
    let source = "?";
    let note = "";
    try {
      const res = await fetch(`${baseUrl}/api/structure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identity: c.identity, wishes_text: c.wishes }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { structured: StructuredWill; source: string; note: string };
      structured = data.structured;
      source = data.source;
      note = data.note;
    } catch (err) {
      console.log(`      ✗ request failed: ${err instanceof Error ? err.message : err}`);
      hardFailed++;
      continue;
    }

    if (source !== "llm") {
      console.log(`      ⚠ source=${source} (not a real LLM call) — ${note}`);
      console.log(`        The deployment likely has no ANTHROPIC_API_KEY. Skipping semantic assertions.`);
      continue;
    }

    const results = runRules(structured, { identity: c.identity, title_deed: null, ai_structured: true });
    const blocks = results.filter((r) => r.severity === "block");
    const warns = results.filter((r) => r.severity === "warn");

    console.log(`      distribution: ${structured.distribution_summary}`);
    console.log(`      confidence_notes: ${structured.confidence_notes || "(empty)"}`);
    console.log(`      blocks: ${blocks.map((b) => b.check_key).join(", ") || "none"}`);
    console.log(`      warns:  ${warns.map((b) => b.check_key).join(", ") || "none"}`);

    for (const k of c.mustFlag ?? []) {
      if (!has(results, k)) {
        console.log(`      ✗ expected to flag "${k}" but it did not`);
        hardFailed++;
      }
    }
    if (c.expectSomeGap) {
      const someGap = blocks.length > 0 || warns.length > 0 || Boolean(structured.confidence_notes?.trim());
      if (!someGap) {
        console.log(`      ✗ expected SOME gap signal (block/warn/confidence_notes) but got none`);
        hardFailed++;
      } else {
        console.log(`      ✓ gap surfaced`);
      }
    }
    if (!c.mustFlag && !c.expectSomeGap) {
      console.log(blocks.length === 0 ? `      ✓ clean (no blocks)` : `      ⚠ unexpected blocks on a complete will`);
    }
  }

  console.log(`\n  Live hard failures: ${hardFailed}`);
  return hardFailed === 0;
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

async function main() {
  const argv = process.argv.slice(2);
  const liveIdx = argv.indexOf("--live");
  const liveUrl = liveIdx >= 0 ? argv[liveIdx + 1] : null;

  const detOk = runDeterministic();
  let liveOk = true;
  if (liveUrl) {
    liveOk = await runLive(liveUrl.replace(/\/$/, ""));
  } else {
    console.log("\n(Skipping live LLM tests — pass `--live <baseUrl>` to run them.)");
  }

  if (!detOk || !liveOk) {
    console.log("\n❌ QA FAILED\n");
    process.exit(1);
  }
  console.log("\n✅ QA PASSED\n");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
