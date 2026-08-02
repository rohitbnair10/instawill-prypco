"use client";

/**
 * The signature moment: the DIFC Schedule 1 will document assembling in real
 * time. Driven purely by the StructuredWill JSON. Unfilled slots render as
 * [bracketed placeholders]; filled slots show the client's data highlighted.
 */
import { buildSchedule1, type Segment } from "@/lib/schedule1";
import type { Identity, StructuredWill } from "@/lib/types";
import { MockLabel } from "./ui/primitives";

function SegmentView({ seg }: { seg: Segment }) {
  if (seg.t === "text") return <span>{seg.v}</span>;
  if (seg.v === null) {
    return <span className="slot-empty">[{seg.placeholder}]</span>;
  }
  return <span className="slot-filled animate-fadein">{seg.v}</span>;
}

function Paragraph({ segments }: { segments: Segment[] }) {
  return (
    <p className="mb-1">
      {segments.map((s, i) => (
        <SegmentView key={i} seg={s} />
      ))}
    </p>
  );
}

export function LiveWill({
  structured,
  identity = null,
  compact = false,
}: {
  structured: StructuredWill | null;
  identity?: Identity | null;
  compact?: boolean;
}) {
  const sched = buildSchedule1(structured, identity);

  return (
    <div className="legal-doc">
      <div className="mb-4 flex items-center justify-between gap-2 border-b border-hairline pb-3">
        <div>
          <div className="font-sans text-[11px] uppercase tracking-widest text-slate">
            DIFC Wills &amp; Probate Registry
          </div>
          <h3 className="text-lg font-semibold">Last Will &amp; Testament</h3>
          <div className="font-sans text-xs text-slate">
            Schedule 1 — Form of Will 1 (Full Will)
          </div>
        </div>
        <MockLabel>Illustrative structure</MockLabel>
      </div>

      <ol className={`space-y-3 ${compact ? "text-sm" : "text-[15px]"}`}>
        {sched.clauses.map((c) => (
          <li key={c.n}>
            <div className="font-sans text-xs font-semibold uppercase tracking-wide text-slate">
              {c.n}. {c.title}
            </div>
            <div className="mt-0.5">
              {c.body.map((para, i) => (
                <Paragraph key={i} segments={para} />
              ))}
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 border-t border-hairline pt-4">
        <div className="font-sans text-xs font-semibold uppercase tracking-wide text-slate">
          Execution
        </div>
        {sched.witnessBlock.map((para, i) => (
          <Paragraph key={i} segments={para} />
        ))}
      </div>

      <p className="mt-4 rounded-lg bg-clay/8 px-3 py-2 font-sans text-xs text-clay">
        {sched.voidCondition}
      </p>
    </div>
  );
}
