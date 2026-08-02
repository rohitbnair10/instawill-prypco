/**
 * DIFC Schedule 1 (Form of Will 1) template fill.
 *
 * Turns a StructuredWill into the clause structure of the real DIFC Schedule 1,
 * with bracketed slots that fill from intake. Unfilled slots render as
 * `[placeholders]`; filled slots show the client's data — making "the tool
 * pre-fills the brackets, the lawyer verifies them" literally true.
 *
 * NOTE: the exact legal wording here is ILLUSTRATIVE of the Schedule 1
 * structure, not registration-grade text. The clause skeleton (1–10 + witness
 * block + void condition) matches the real form.
 */
import type { StructuredWill } from "./types";

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

export function buildSchedule1(will: StructuredWill | null): Schedule1 {
  const w = will;

  const executor = w?.executors.find((e) => e.role === "executor") || null;
  const substituteExecutor =
    w?.executors.find((e) => e.role === "substitute_executor") || null;
  const guardian = w?.guardians.find((g) => g.role === "guardian") || null;
  const substituteGuardian =
    w?.guardians.find((g) => g.role === "substitute_guardian") || null;

  const clauses: Clause[] = [
    {
      n: "1",
      title: "Declaration",
      body: [
        [
          text("I, "),
          slot(w?.testator.full_name, "full name"),
          text(", holder of passport number "),
          slot(w?.testator.passport_number, "passport no."),
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
              ? w.assets
                  .map((a) => describeAsset(a))
                  .join("; ")
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
          w?.has_foreign_will
            ? text(
                "This revocation is expressly limited to my UAE Estate and does not affect any will governing assets outside the UAE."
              )
            : text(
                "This Will does not affect any assets situated outside the UAE."
              ),
        ],
      ],
    },
    {
      n: "4",
      title: "Appointment of Executor & Trustee",
      body: [
        [
          text("I appoint "),
          slot(executor?.name, "executor name"),
          text(" ("),
          slot(executor?.relationship, "relationship"),
          text(
            ") to be the executor and trustee of this Will. If they are unable or unwilling to act, I appoint "
          ),
          slot(substituteExecutor?.name, "substitute executor"),
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
          slot(guardian?.name, "guardian name"),
          text(
            " as guardian of my minor children. If they are unable or unwilling to act, I appoint "
          ),
          slot(substituteGuardian?.name, "substitute guardian"),
          text(
            ". The DIFC Courts retain final say on the children’s best interests."
          ),
        ],
      ],
    },
    {
      n: "6",
      title: "Specific Gifts",
      body: [
        [
          text(
            "I make the following specific gifts from my UAE Estate: "
          ),
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
      body:
        w && w.beneficiaries.length
          ? w.beneficiaries.map((b) => [
              text("I give "),
              slot(`${b.share_pct}%`, "share"),
              text(" of the residue of my UAE Estate to "),
              slot(b.name, "beneficiary"),
              text(" ("),
              slot(b.relationship, "relationship"),
              text(")"),
              b.is_minor && !b.held_in_trust
                ? text(
                    ", to be held on trust until they attain 21 years of age"
                  )
                : text(""),
              text(". If they predecease me, their share passes "),
              slot(b.substitution, "substitution"),
              text("."),
            ])
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
      slot(w?.testator.full_name, "testator"),
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

function describeAsset(a: {
  asset_type: string;
  emirate: string;
  description: string;
}): string {
  const kind =
    a.asset_type === "property"
      ? "Real property"
      : a.asset_type === "bank_account"
      ? "Bank account(s)"
      : a.asset_type === "business_shares"
      ? "Business shares"
      : "Other movable property";
  const where =
    a.emirate && a.emirate !== "n_a"
      ? ` (${a.emirate.replace("_", " ")})`
      : "";
  return `${kind}${where}${a.description ? ` — ${a.description}` : ""}`;
}
