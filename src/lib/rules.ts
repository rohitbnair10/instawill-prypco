/**
 * Rules engine — runs the severity checks against a StructuredWill + Identity.
 *
 * Severity model (used everywhere):
 *   block — legally fatal, client-fixable, caught at intake (never lawyer work).
 *   warn  — needs a human judgment call (routes to the lawyer desk).
 *   info  — awareness only.
 *   ok    — passed; shown to the lawyer as a green "cleared at intake" record.
 *
 * The engine is pure: it takes structured data + identity + document context
 * and returns RuleResult[]. Persisting these as `checks` rows is the store's job.
 *
 * Routing principle: objective, client-fixable errors are caught at intake and
 * never reach the lawyer as work (they show up as passed confirmations only).
 * Only genuine judgment calls — the machine can detect them but only a human
 * can resolve them — surface as items the lawyer must actively clear.
 */
import type {
  CheckKey,
  CheckOwner,
  Identity,
  Severity,
  StructuredWill,
} from "./types";

export interface RuleResult {
  check_key: CheckKey;
  severity: Severity;
  owner: CheckOwner;
  detail: string;
}

export interface RuleContext {
  identity: Identity;
  /** Title-deed OCR result when a property is named. */
  title_deed?: { uploaded: boolean; owner?: string; joint_owner?: boolean } | null;
  /** Whether the LLM flagged ambiguity (confidence_notes non-empty) or failed. */
  ai_structured: boolean;
}

const SEVERITY_RANK: Record<Severity, number> = {
  block: 0,
  warn: 1,
  info: 2,
  ok: 3,
};

/** Sort most-urgent first (blocks, then warns, then info, then ok). */
export function sortBySeverity(results: RuleResult[]): RuleResult[] {
  return [...results].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  );
}

function normaliseName(n: string): string {
  return n.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Name match: exact -> ok; same first name but different remainder -> needs
 * review (the "Sarah A." vs "Sarah Anne" case); otherwise a mismatch.
 */
export function compareNames(
  nameA: string,
  nameB: string
): "match" | "needs_review" | "mismatch" {
  const a = normaliseName(nameA);
  const b = normaliseName(nameB);
  if (!a || !b) return "needs_review";
  if (a === b) return "match";
  const aFirst = a.split(" ")[0];
  const bFirst = b.split(" ")[0];
  if (aFirst === bFirst) {
    // Abbreviation vs full (e.g. "sarah a" vs "sarah anne").
    if (b.startsWith(aFirst) || a.startsWith(aFirst)) return "needs_review";
  }
  return "mismatch";
}

export function runRules(will: StructuredWill, ctx: RuleContext): RuleResult[] {
  const out: RuleResult[] = [];
  const identity = ctx.identity;

  // ---- BLOCK checks (client-fixable, caught at intake) ----

  // Passport present.
  if (!identity.passport_number) {
    out.push({
      check_key: "passport_missing",
      severity: "block",
      owner: "client",
      detail: "No valid passport on file. DIFC requires a valid passport.",
    });
  } else if (identity.passport_expired) {
    out.push({
      check_key: "passport_expired",
      severity: "block",
      owner: "client",
      detail: `Passport expired (${identity.passport_expiry}). DIFC will not accept an expired passport.`,
    });
  } else {
    out.push({
      check_key: "passport_expired",
      severity: "ok",
      owner: "client",
      detail: `Passport valid (expires ${identity.passport_expiry}).`,
    });
  }

  // At least one UAE asset.
  if (!will.assets.length) {
    out.push({
      check_key: "no_uae_asset",
      severity: "block",
      owner: "client",
      detail: "No UAE asset named. A DIFC will must cover at least one UAE-situated asset.",
    });
  } else {
    out.push({
      check_key: "no_uae_asset",
      severity: "ok",
      owner: "client",
      detail: `${will.assets.length} UAE asset(s) named.`,
    });
  }

  // Property needs an identifying address/description — a gift of "[blank]"
  // isn't registrable. Bank accounts and movables don't need enumeration (a
  // Full Will covers movables as a category), so this only targets property.
  const namelessProperty = will.assets.filter(
    (a) => a.type === "property" && !a.description?.trim()
  );
  if (namelessProperty.length) {
    out.push({
      check_key: "property_address_missing",
      severity: "block",
      owner: "client",
      detail: `${namelessProperty.length} property asset(s) have no address/description — a property gift must identify the property (address, unit, or title-deed reference).`,
    });
  }

  // Shares total 100%.
  const total = will.beneficiaries.reduce((s, b) => s + (b.share_pct || 0), 0);
  if (Math.round(total * 100) / 100 !== 100) {
    out.push({
      check_key: "shares_sum",
      severity: "block",
      owner: "client",
      detail: `Beneficiary shares total ${total}% (must equal 100%).`,
    });
  } else {
    out.push({
      check_key: "shares_sum",
      severity: "ok",
      owner: "client",
      detail: "Beneficiary shares total exactly 100%.",
    });
  }

  // Executor named. A DIFC will MUST appoint an executor (Schedule 1 clause 4).
  // The model is instructed to leave this empty rather than invent a name when
  // the client's free text didn't mention one — so an empty executor here means
  // the client genuinely didn't provide a mandatory field, and must add one
  // before the will can go to a lawyer. Client-fixable, so caught at intake.
  if (!will.executor.name?.trim()) {
    out.push({
      check_key: "executor_missing",
      severity: "block",
      owner: "client",
      detail:
        "No executor named. A DIFC will must appoint an executor to administer your estate — add one before submitting.",
    });
  } else {
    out.push({
      check_key: "executor_missing",
      severity: "ok",
      owner: "client",
      detail: `Executor appointed (${will.executor.name}).`,
    });
    // Relationship to the executor is a portal field (Step 4) a lawyer needs.
    // Flagged, not blocked — the name identifies the person; missing
    // relationship is a completeness gap the client can fill at intake.
    if (!will.executor.relationship?.trim()) {
      out.push({
        check_key: "executor_relationship_missing",
        severity: "warn",
        owner: "client",
        detail: `No relationship stated for executor ${will.executor.name} — confirm how they relate to you (e.g. brother, wife, friend).`,
      });
    }
  }

  // Every beneficiary needs a name — a share with no named recipient is not a
  // registrable gift. Guards against a partial LLM extraction (or a client
  // deleting a name on the confirm screen) reaching the lawyer.
  const nameless = will.beneficiaries.filter((b) => !b.name?.trim());
  if (nameless.length) {
    out.push({
      check_key: "beneficiary_incomplete",
      severity: "block",
      owner: "client",
      detail: `${nameless.length} beneficiary(ies) have a share but no name — name every beneficiary before submitting.`,
    });
  }

  // Beneficiary relationship is a portal field (Step 5) and helps identify the
  // person. Flagged (not blocked) for each named beneficiary missing it.
  const missingRelationship = will.beneficiaries.filter(
    (b) => b.name?.trim() && !b.relationship?.trim()
  );
  if (missingRelationship.length) {
    missingRelationship.forEach((b) =>
      out.push({
        check_key: "beneficiary_relationship_missing",
        severity: "warn",
        owner: "client",
        detail: `No relationship stated for beneficiary ${b.name} — confirm how they relate to you (e.g. wife, son, friend, charity).`,
      })
    );
  }

  // Minor beneficiary with no trust/holding structure. This is a hard
  // registration blocker (a minor cannot inherit outright) — but only a
  // LAWYER can pick the mechanism (bare trust vs. will trust), so it is
  // classified `warn`/`owner: lawyer` rather than a client-fixable `block`:
  // it never stops the client from submitting, but it gates lawyer approval.
  const minorsUnresolved = will.beneficiaries.filter(
    (b) => b.is_minor && !b.held_in_trust
  );
  if (minorsUnresolved.length) {
    minorsUnresolved.forEach((b) =>
      out.push({
        check_key: "minor_no_trust",
        severity: "warn",
        owner: "lawyer",
        detail: `${b.name} (${b.share_pct}%) is under 21 and cannot inherit outright — this is a hard registration blocker until a lawyer sets a trust/holding mechanism.`,
      })
    );
  }

  // Duplicate beneficiary (same person listed twice).
  const seen = new Map<string, number>();
  will.beneficiaries.forEach((b) => {
    const key = normaliseName(b.name);
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  const dupes = [...seen.entries()].filter(([, count]) => count > 1);
  if (dupes.length) {
    dupes.forEach(([name]) =>
      out.push({
        check_key: "duplicate_beneficiary",
        severity: "warn",
        owner: "lawyer",
        detail: `"${name}" appears more than once in the beneficiary list — confirm this is intentional (e.g. separate gifts) and not a structuring duplicate.`,
      })
    );
  }

  // Witness-is-beneficiary — witnesses are collected at registration; confirm
  // the rule holds for the lawyer's record. (No witness collected at intake.)
  out.push({
    check_key: "witness_is_beneficiary",
    severity: "ok",
    owner: "client",
    detail: "No witness is named as a beneficiary.",
  });

  // ---- WARN checks (lawyer judgment calls) ----

  // Name mismatch between passport and structured testator name.
  if (identity.full_name && will.testator.name) {
    const cmp = compareNames(identity.full_name, will.testator.name);
    if (cmp === "match") {
      out.push({
        check_key: "name_mismatch",
        severity: "ok",
        owner: "client",
        detail: `Passport name matches the will ("${will.testator.name}").`,
      });
    } else {
      out.push({
        check_key: "name_mismatch",
        severity: "warn",
        owner: "lawyer",
        detail: `Passport reads "${identity.full_name}" but the will names "${will.testator.name}". Confirm same person to avoid registration rejection.`,
      });
    }
  }

  // ADJD routing for AD / other-emirate property.
  if (will.assets.some((a) => a.needs_adjd)) {
    out.push({
      check_key: "adjd_routing",
      severity: "warn",
      owner: "lawyer",
      detail:
        "Property outside Dubai/RAK detected. This asset routes to a separate ADJD will; scope the two so they do not revoke each other.",
    });
  }

  // Foreign-will revocation clash (clause 3 must be scoped to UAE assets only).
  if (will.foreign_will) {
    out.push({
      check_key: "foreign_will_revocation",
      severity: "warn",
      owner: "lawyer",
      detail:
        "Client has a foreign will. Scope clause 3 to the UAE estate only so it does not void the foreign will.",
    });
  }

  // Joint-owned title deed — gift may not pass the whole asset.
  if (ctx.title_deed?.uploaded && ctx.title_deed.joint_owner) {
    out.push({
      check_key: "deed_joint_owner",
      severity: "warn",
      owner: "lawyer",
      detail: `Title deed shows joint ownership${
        ctx.title_deed.owner ? ` (${ctx.title_deed.owner})` : ""
      }. The gift may not pass the whole asset — confirm the transferable share.`,
    });
  }

  // Business shares — a shareholder agreement may override the will.
  if (will.assets.some((a) => a.type === "business_shares")) {
    out.push({
      check_key: "business_shares",
      severity: "warn",
      owner: "lawyer",
      detail:
        "Business shares named. A shareholder / free-zone agreement may override the will's transfer — confirm testamentary transfer is permitted.",
    });
  }

  // Missing substitution for a beneficiary.
  const missingSubstitution = will.beneficiaries.filter(
    (b) => !b.substitution?.trim()
  );
  if (missingSubstitution.length) {
    missingSubstitution.forEach((b) =>
      out.push({
        check_key: "substitution_missing",
        severity: "warn",
        owner: "lawyer",
        detail: `No predecease/substitution instruction for ${b.name} — confirm where their share goes if they predecease the testator.`,
      })
    );
  }

  // AI-structured / ambiguous distribution — verify against client intent.
  if (ctx.ai_structured || will.confidence_notes?.trim()) {
    out.push({
      check_key: "ai_distribution",
      severity: "warn",
      owner: "lawyer",
      detail: `Auto-structured from free text ("${will.distribution_summary}"). System notes: ${
        will.confidence_notes?.trim() || "(none)"
      }. Verify this matches the client's intent before approval.`,
    });
  }

  // Minor CHILD inheriting but no guardian nominated. Limited to the testator's
  // own children (son/daughter/child/kids) — a minor niece/grandchild doesn't
  // imply the testator is the guardian-nominator. Flagged so the client can
  // add a guardian at intake; the court retains final say either way.
  const CHILD_REL = /\b(son|sons|daughter|daughters|child|children|kid|kids)\b/i;
  const minorChildren = will.beneficiaries.filter(
    (b) => b.is_minor && CHILD_REL.test(b.relationship || "")
  );
  if (minorChildren.length && !will.guardian) {
    out.push({
      check_key: "guardian_for_minor_missing",
      severity: "warn",
      owner: "client",
      detail: `A minor child (${minorChildren
        .map((b) => b.name)
        .join(", ")}) is inheriting but no guardian is named — nominate a guardian for your minor children.`,
    });
  }

  // ---- INFO / awareness ----

  // Guardianship.
  if (will.guardian) {
    out.push({
      check_key: "guardian_needed",
      severity: "info",
      owner: "none",
      detail:
        "Guardian nominated for a minor child. The court retains final say on the child's best interests — registration nominates, it does not guarantee.",
    });
  }

  // Non-resident remote registration path.
  if (identity.residency_status === "non_resident") {
    out.push({
      check_key: "non_resident_path",
      severity: "info",
      owner: "none",
      detail:
        "Non-resident: no Emirates ID. Registration uses the supervised remote video path with a home-country notary/solicitor witnessing.",
    });
  }

  return sortBySeverity(out);
}
