"use client";

/**
 * RE-ENGAGEMENT (OPS) — recover started-but-not-submitted intakes.
 *
 * Lists stalled intakes sorted by how long they've been stuck, each with a
 * recoverability rating. On selection: a funnel progress bar, a "what's blocking
 * them" panel with the specific reason, and their preferred channel. Three
 * recovery actions (reminder / assign agent / mark recovered), each logged.
 */
import { useMemo, useState } from "react";
import {
  assignAgent,
  checksForWill,
  documentsForWill,
  logReminder,
  markRecovered,
  useDB,
  willsForLead,
} from "@/lib/store";
import {
  blockingReason,
  daysBetween,
  STAGE_LABELS,
  STAGE_ORDER,
  stageProgress,
} from "@/lib/stateMachine";
import type { Lead, ReminderType } from "@/lib/types";
import { Button, Card, Pill, ProgressBar } from "@/components/ui/primitives";
import { MetricsBar } from "./MetricsBar";

const AGENT_ID = "user-agent-1";

const INTAKE_STAGES = new Set([
  "about",
  "family",
  "assets",
  "beneficiaries",
  "safety",
  "documents",
  "review",
]);

const RECOVER_TONE = { high: "sage", medium: "amber", low: "clay" } as const;

export function OpsDesk() {
  const db = useDB();
  const [selected, setSelected] = useState<string | null>(null);

  const stalled = useMemo(() => {
    const recovered = new Set(
      db.reminders.filter((r) => r.outcome === "recovered").map((r) => r.lead_id)
    );
    return db.leads
      .filter(
        (l) => INTAKE_STAGES.has(l.current_stage) && !recovered.has(l.id)
      )
      .map((l) => ({ lead: l, days: daysBetween(l.stage_updated_at) }))
      .sort((a, b) => b.days - a.days);
  }, [db]);

  const activeLead = selected
    ? db.leads.find((l) => l.id === selected)
    : stalled[0]?.lead;

  return (
    <div className="px-5 py-6 lg:px-8">
      <MetricsBar />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_1fr]">
        <aside className="rounded-xl2 bg-ink px-3 py-4 text-paper-parchment">
          <div className="px-2">
            <h2 className="font-serif text-xl">Stalled intakes</h2>
            <p className="mt-1 text-xs text-paper/60">
              Started the form, not yet submitted — longest-stuck first.
            </p>
          </div>
          <div className="mt-3 space-y-2">
            {stalled.length === 0 && (
              <p className="px-2 text-sm text-paper/60">Queue clear 🎉</p>
            )}
            {stalled.map(({ lead, days }) => {
              const isActive = lead.id === activeLead?.id;
              return (
                <button
                  key={lead.id}
                  onClick={() => setSelected(lead.id)}
                  className={`w-full rounded-lg px-3 py-3 text-left ${
                    isActive
                      ? "bg-paper-parchment text-ink"
                      : "bg-white/5 hover:bg-white/10"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{lead.full_name}</span>
                    <Pill tone={RECOVER_TONE[lead.recoverability]}>
                      {lead.recoverability}
                    </Pill>
                  </div>
                  <div
                    className={`mt-1 text-xs ${
                      isActive ? "text-slate" : "text-paper/50"
                    }`}
                  >
                    Stuck {days}d · {STAGE_LABELS[lead.current_stage]}
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        <main>
          {activeLead ? (
            <LeadDetail key={activeLead.id} lead={activeLead} />
          ) : (
            <div className="text-slate">No stalled intakes to recover.</div>
          )}
        </main>
      </div>
    </div>
  );
}

function LeadDetail({ lead }: { lead: Lead }) {
  const db = useDB();
  const will = willsForLead(db, lead.id)[0];
  const draft = db.drafts.find((d) => d.will_id === will?.id);
  const checks = will ? checksForWill(db, will.id) : [];
  const docs = will ? documentsForWill(db, will.id) : [];
  const reason = blockingReason(will, draft, checks, docs);
  const days = daysBetween(lead.stage_updated_at);
  const progress = stageProgress(lead.current_stage);
  const reminders = db.reminders
    .filter((r) => r.lead_id === lead.id)
    .sort((a, b) => (a.triggered_at < b.triggered_at ? 1 : -1));

  const channelType: ReminderType =
    lead.preferred_channel === "whatsapp"
      ? "automated_whatsapp"
      : lead.preferred_channel === "phone"
      ? "agent_call"
      : "automated_email";

  const suggestAgent = lead.recoverability === "high" || days >= 14;

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-ink">{lead.full_name}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
              <Pill tone={RECOVER_TONE[lead.recoverability]}>
                {lead.recoverability} recoverability
              </Pill>
              <Pill tone="slate">Stuck {days} days</Pill>
              <Pill tone="ink">Prefers {lead.preferred_channel}</Pill>
              {lead.utm_source && (
                <Pill tone="slate">via {lead.utm_source}</Pill>
              )}
            </div>
          </div>
          {lead.assigned_agent_id && (
            <Pill tone="sage">Agent assigned</Pill>
          )}
        </div>

        {/* funnel bar */}
        <div className="mt-5">
          <div className="mb-1 flex items-center justify-between text-xs text-slate">
            <span>Funnel progress</span>
            <span>{STAGE_LABELS[lead.current_stage]}</span>
          </div>
          <ProgressBar value={progress} />
          <div className="mt-1 flex justify-between text-[10px] text-slate">
            {STAGE_ORDER.slice(0, 7).map((s) => (
              <span
                key={s}
                className={
                  STAGE_ORDER.indexOf(s) <=
                  STAGE_ORDER.indexOf(lead.current_stage)
                    ? "text-sage"
                    : ""
                }
              >
                ●
              </span>
            ))}
          </div>
        </div>
      </Card>

      {/* blocking reason */}
      <Card className="border-amber/30 bg-amber/6 p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-amber">
          What&apos;s blocking them
        </div>
        <p className="mt-1 text-sm text-ink">{reason}</p>
      </Card>

      {/* recovery actions */}
      <Card className="p-4">
        <div className="text-sm font-semibold text-ink">Recovery actions</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            onClick={() =>
              logReminder(lead.id, channelType, "system", reason)
            }
          >
            Send automated reminder
            <span className="text-xs opacity-70">
              ({lead.preferred_channel})
            </span>
          </Button>
          <Button
            variant={suggestAgent ? "sage" : "secondary"}
            onClick={() => {
              assignAgent(lead.id, AGENT_ID);
              logReminder(lead.id, "agent_call", "agent", reason, AGENT_ID);
            }}
          >
            Assign agent to call
            {suggestAgent && (
              <span className="text-xs opacity-80">suggested</span>
            )}
          </Button>
          <Button variant="secondary" onClick={() => markRecovered(lead.id)}>
            Mark recovered
          </Button>
        </div>
        <p className="mt-2 text-xs text-slate">
          Reminders are personalised to what&apos;s missing. Agent-call is
          auto-suggested for high-value or long-stalled cases. Every action logs
          against the case.
        </p>
      </Card>

      {/* activity log */}
      {reminders.length > 0 && (
        <Card className="p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate">
            Activity log
          </div>
          <ul className="mt-2 space-y-1.5">
            {reminders.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-ink">
                  {r.type.replace("_", " ")}{" "}
                  <span className="text-slate">— {r.blocking_reason_snapshot}</span>
                </span>
                <Pill tone={r.outcome === "recovered" ? "sage" : "slate"}>
                  {r.outcome}
                </Pill>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
