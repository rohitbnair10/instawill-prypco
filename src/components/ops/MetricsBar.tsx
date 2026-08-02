"use client";

/** Compact metrics strip — every number derived from stored rows. */
import { computeMetrics } from "@/lib/metrics";
import { useDB } from "@/lib/store";
import { Card } from "@/components/ui/primitives";

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="min-w-[120px] flex-1 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate">{label}</div>
      <div className="font-serif text-xl text-ink">{value}</div>
      {sub && <div className="text-[11px] text-slate">{sub}</div>}
    </div>
  );
}

export function MetricsBar() {
  const db = useDB();
  const m = computeMetrics(db);
  return (
    <Card className="mb-5 flex flex-wrap divide-x divide-hairline p-1">
      <Stat
        label="Registered / month"
        value={String(m.registeredThisMonth)}
        sub="north star"
      />
      <Stat
        label="Lawyer min — standard"
        value={m.avgLawyerMinutesStandard != null ? `${m.avgLawyerMinutesStandard}m` : "—"}
        sub={
          m.avgLawyerMinutesFleet != null
            ? `fleet avg ${m.avgLawyerMinutesFleet}m`
            : "standard-case KPI"
        }
      />
      <Stat label="Pending at lawyer" value={String(m.pendingAtLawyer)} />
      <Stat label="Awaiting client (clarification)" value={String(m.awaitingClient)} />
      <Stat label="Awaiting client approval" value={String(m.pendingClientApproval)} />
      <Stat label="Started, not submitted" value={String(m.startedNotSubmitted)} />
      <Stat
        label="Clarifications / will"
        value={m.clarificationRatePerWill != null ? String(m.clarificationRatePerWill) : "—"}
      />
      <Stat
        label="Ops-followup rate"
        value={m.opsFollowupRate != null ? `${Math.round(m.opsFollowupRate * 100)}%` : "—"}
        sub="low is good"
      />
      <Stat
        label="Registration rate"
        value={m.registrationRate != null ? `${Math.round(m.registrationRate * 100)}%` : "—"}
      />
      <Stat
        label="Lawyer-change rate"
        value={m.lawyerChangeRate != null ? `${Math.round(m.lawyerChangeRate * 100)}%` : "—"}
        sub="drafts needing amendment"
      />
      <Stat
        label="Client-approval rate"
        value={m.clientApprovalRate != null ? `${Math.round(m.clientApprovalRate * 100)}%` : "—"}
      />
      <Stat
        label="Recovery rate"
        value={m.recoveryRate != null ? `${Math.round(m.recoveryRate * 100)}%` : "—"}
      />
    </Card>
  );
}
