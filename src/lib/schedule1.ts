/**
 * DIFC Schedule 1 (Form of Will 1) template fill — v2.
 *
 * Turns a StructuredWill + Identity into the clause structure of the real DIFC
 * Schedule 1, with bracketed slots that fill from the automation's output.
 * Unfilled slots render as `[placeholders]`; filled slots show the client's
 * data — making "the tool pre-fills the brackets, the lawyer verifies them"
 * literally true.
 *
 * NOTE: the exact legal wording here is ILLUSTRATIVE of the Schedule 1
 * structure, not registration-grade text. The clause skeleton (1–10 + witness
 * block + void condition) matches the real form.
 */
import type { Identity, StructuredWill } from "./types";

export type Segment =
  | { t: "text"; v: string }
  | { t: "slot"; v: string | null; placeholder: string };

export interface Clause {
  n: string;
  title: string;
  /** Each entry is a paragraph made of literal-text and slot segments. */
  body: Segment[][];
}

export interface Schedule1 {
  clauses: Clause[];
  witnessBlock: Segment[][];
  voidCondition: string;
}

function slot(v: string | null | undefined, placeholder: string): Segment {
  const value = v && String(v).trim() ? String(v).trim() : null;
  return { t: "slot", v: value, placeholder };
}
function text(v: string): Segment {
  return { t: "text", v };
}

export function buildSchedule1(
  will: StructuredWill | null,
  identity: Identity | null
): Schedule1 {
  const w = will;
  const id = identity;

  // Specific gifts (an asset assigned to a named person) render in clause 6;
  // residuary-share beneficiaries (share_pct > 0) render in clause 8. A person
  // can appear in both if they get a specific gift AND a residuary share.
  const specificGiftBenes = w ? w.beneficiaries.filter((b) => b.specific_gift?.trim()) : [];
  const residuaryBenes = w ? w.beneficiaries.filter((b) => (b.share_pct || 0) > 0) : [];

  const clauses: Clause[] = [
    {
      n: "1",
      title: "Declaration",
      body: [
        [
          text("I, "),
          slot(id?.full_name || w?.testator.name, "full name"),
          text(", holder of passport number "),
          slot(id?.passport_number, "passport no."),
          text(
            ", declare that I am not a Muslim and that this Will is made under the DIFC Wills and Probate Registry Rules."
          ),
        ],
      ],
    },
    {
      n: "2",
      title: "Scope — my UAE Estate",
      body: [
        [
          text(
            "This Will disposes of my property situated in the United Arab Emirates (“my UAE Estate”), comprising: "
          ),
          slot(
            w && w.assets.length
              ? w.assets.map((a) => describeAsset(a)).join("; ")
              : null,
            "UAE assets"
          ),
          text("."),
        ],
      ],
    },
    {
      n: "3",
      title: "Revocation",
      body: [
        [
          text(
            "I revoke all earlier testamentary dispositions made by me in respect of my UAE Estate only. "
          ),
          w?.foreign_will
            ? text(
                "This revocation is expressly limited to my UAE Estate and does not affect any will governing assets outside the UAE."
              )
            : text("This Will does not affect any assets situated outside the UAE."),
        ],
      ],
    },
    {
      n: "4",
      title: "Appointment of Executor & Trustee",
      body: [
        [
          text("I appoint "),
          slot(w?.executor.name, "executor name"),
          text(" ("),
          slot(w?.executor.relationship, "relationship"),
          text(
            ") to be the executor and trustee of this Will. If they are unable or unwilling to act, I appoint "
          ),
          slot(w?.substitute_executor?.name, "substitute executor"),
          text(" in their place."),
        ],
      ],
    },
    {
      n: "5",
      title: "Guardianship",
      body: [
        [
          text("I appoint "),
          slot(w?.guardian?.name, "guardian name"),
          text(
            " as guardian of my minor children. If they are unable or unwilling to act, I appoint "
          ),
          slot(w?.substitute_guardian?.name, "substitute guardian"),
          text(
            ". The DIFC Courts retain final say on the children’s best interests."
          ),
        ],
      ],
    },
    {
      n: "6",
      title: "Specific Gifts",
      body: specificGiftBenes.length
        ? specificGiftBenes.map((b) => [
            text("I give "),
            slot(b.specific_gift, "gift"),
            text(" to "),
            slot(b.name, "beneficiary"),
            text(" ("),
            slot(b.relationship, "relationship"),
            text(")"),
            b.is_minor && !b.held_in_trust
              ? text(", to be held on trust until they attain 21 years of age")
              : text(""),
            text("."),
          ])
        : [
            [
              text("I make the following specific gifts from my UAE Estate: "),
              slot(
                w && w.assets.length
                  ? w.assets.map((a) => describeAsset(a)).join("; ")
                  : null,
                "specific gifts / assets"
              ),
              text("."),
            ],
          ],
    },
    {
      n: "7",
      title: "Executor's Duties",
      body: [
        [
          text(
            "My executor shall pay my debts, funeral and testamentary expenses from my UAE Estate, and shall hold the residue on the trusts set out below."
          ),
        ],
      ],
    },
    {
      n: "8",
      title: "Residuary Gifts",
      body: residuaryBenes.length
        ? residuaryBenes.map((b) => [
            text("I give "),
            slot(`${b.share_pct}%`, "share"),
            text(" of the residue of my UAE Estate to "),
            slot(b.name, "beneficiary"),
            text(" ("),
            slot(b.relationship, "relationship"),
            text(")"),
            b.is_minor && !b.held_in_trust
              ? text(", to be held on trust until they attain 21 years of age")
              : text(""),
            text(". If they predecease me, their share passes "),
            slot(b.substitution, "substitution"),
            text("."),
          ])
        : specificGiftBenes.length
        ? [
            [
              text(
                "I have disposed of my UAE Estate by the specific gifts above and make no separate residuary gift."
              ),
            ],
          ]
        : [[slot(null, "residuary beneficiaries")]],
    },
    {
      n: "9",
      title: "Governing Law",
      body: [
        [
          text(
            "This Will is governed by DIFC law and the DIFC Wills and Probate Registry Rules."
          ),
        ],
      ],
    },
    {
      n: "10",
      title: "Jurisdiction",
      body: [
        [
          text(
            "The DIFC Courts shall have exclusive jurisdiction over this Will and my UAE Estate."
          ),
        ],
      ],
    },
  ];

  const witnessBlock: Segment[][] = [
    [
      text("Signed by the Testator "),
      slot(id?.full_name || w?.testator.name, "testator"),
      text(" in the presence of two witnesses, neither of whom is a beneficiary:"),
    ],
    [text("Witness 1: "), slot(null, "witness name & signature")],
    [text("Witness 2: "), slot(null, "witness name & signature")],
  ];

  return {
    clauses,
    witnessBlock,
    voidCondition:
      "This Will shall be void if the Testator is a Muslim at any time before death.",
  };
}

/** Plain-text rendering of a Schedule1 (for console/CLI output and PDF text). */
export function renderSchedule1Text(sched: Schedule1): string {
  const lines: string[] = [];
  lines.push("DIFC WILLS & PROBATE REGISTRY");
  lines.push("Last Will & Testament — Schedule 1, Form of Will 1 (Full Will)");
  lines.push("(Illustrative structure — not registration-grade legal text)");
  lines.push("");
  sched.clauses.forEach((c) => {
    lines.push(`${c.n}. ${c.title.toUpperCase()}`);
    c.body.forEach((para) => {
      lines.push("   " + renderSegments(para));
    });
    lines.push("");
  });
  lines.push("EXECUTION");
  sched.witnessBlock.forEach((para) => lines.push("   " + renderSegments(para)));
  lines.push("");
  lines.push(sched.voidCondition);
  return lines.join("\n");
}

function renderSegments(segments: Segment[]): string {
  return segments
    .map((s) => (s.t === "text" ? s.v : s.v === null ? `[${s.placeholder}]` : s.v))
    .join("");
}

function describeAsset(a: {
  type: string;
  emirate: string;
  description: string;
}): string {
  const kind =
    a.type === "property"
      ? "Real property"
      : a.type === "bank_account"
      ? "Bank account(s)"
      : a.type === "business_shares"
      ? "Business shares"
      : "Other movable property";
  const where =
    a.emirate && a.emirate !== "n_a" ? ` (${a.emirate.replace("_", " ")})` : "";
  return `${kind}${where}${a.description ? ` — ${a.description}` : ""}`;
}
