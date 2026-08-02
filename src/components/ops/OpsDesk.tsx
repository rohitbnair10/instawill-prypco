"use client";

/**
 * RE-ENGAGEMENT (OPS) — two tabs.
 *
 * Tab 1 — Stalled intakes: recover started-but-not-submitted intakes, sorted
 * by how long they've been stuck, each with a recoverability rating. Three
 * recovery actions (reminder / assign agent / mark recovered), each logged.
 *
 * Tab 2 — Awaiting client (§1B-ter, read-only): cases where a LAWYER sent a
 * clarification and is waiting on the client. Visibility only, never a work
 * queue — the flow completes without ops touching it. The only action here is
 * an optional backstop: proactively follow up on a silent client.
 */
import { useMemo, useState } from "react";
import {
  allPendingClarifications,
  assignAgent,
  checksForWill,
  documentsForWill,
  logReminder,
  markOpsFollowedUp,
  markRecovered,
  useDB,
  willById,
  willsForLead,
} from "@/lib/store";
import {
  blockingReason,
  daysBetween,
  STAGE_LABELS,
  STAGE_ORDER,
  stageProgress,
} from "@/lib/stateMachine";
import type { Clarification, Lead, LeadStage, ReminderType } from "@/lib/types";
import { Button, Card, Pill, ProgressBar } from "@/components/ui/primitives";
import { MetricsBar } from "./MetricsBar";

const AGENT_ID = "user-agent-1";

const INTAKE_STAGES = new Set<LeadStage>([
  "identity",
  "wishes",
  "confirm",
  "documents",
  "review",
]);

const RECOVER_TONE = { high: "sage", medium: "amber", low: "clay" } as const;

export function OpsDesk() {
  const db = useDB();
  const [tab, setTab] = useState<"stalled" | "awaiting_client">("stalled");
  const pendingClarifications = allPendingClarifications(db);

  return (
    <div className="px-5 py-6 lg:px-8">
      <MetricsBar />

      <div className="mb-5 flex gap-1 rounded-full bg-paper-deep p-1 w-fit">
        <button
          onClick={() => setTab("stalled")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "stalled" ? "bg-ink text-paper-parchment" : "text-slate hover:text-ink"
          }`}
        >
          Stalled intakes
        </button>
        <button
          onClick={() => setTab("awaiting_client")}
          className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
            tab === "awaiting_client" ? "bg-ink text-paper-parchment" : "text-slate hover:text-ink"
          }`}
        >
          Awaiting client
          {pendingClarifications.length > 0 && (
            <span className="ml-1.5 rounded-full bg-amber/20 px-1.5 py-0.5 text-xs text-amber">
              {pendingClarifications.length}
            </span>
          )}
        </button>
      </div>

      {tab === "stalled" ? <StalledIntakesTab /> : <AwaitingClientTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Stalled intakes (unchanged from the original re-engagement desk)
// ---------------------------------------------------------------------------

function StalledIntakesTab() {
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
      // Day-0 leads aren't "stalled" yet — someone mid-session hasn't churned.
      // Re-engagement is for people who've genuinely gone quiet (≥1 day), so
      // we don't chase (or annoy) users who just started today.
      .filter((x) => x.days >= 1)
      .sort((a, b) => b.days - a.days);
  }, [db]);

  const activeLead = selected
    ? db.leads.find((l) => l.id === selected)
    : stalled[0]?.lead;

  return (
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

        {/* contact — so an agent can call/email to convert */}
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {lead.phone ? (
            <a href={`tel:${lead.phone.replace(/\s/g, "")}`} className="flex items-center gap-1.5 text-ink hover:underline">
              <span className="text-slate">📞</span>
              {lead.phone}
            </a>
          ) : (
            <span className="text-slate">No phone on file</span>
          )}
          {lead.email ? (
            <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 text-ink hover:underline">
              <span className="text-slate">✉️</span>
              {lead.email}
            </a>
          ) : (
            <span className="text-slate">No email on file</span>
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

// ---------------------------------------------------------------------------
// Tab 2 — Awaiting client (§1B-ter). Read-only visibility, optional backstop.
// ---------------------------------------------------------------------------

function AwaitingClientTab() {
  const db = useDB();
  const open = allPendingClarifications(db).sort((a, b) => (a.sent_at < b.sent_at ? -1 : 1));

  return (
    <div>
      <div className="mb-4 rounded-xl2 border border-hairline bg-white p-4 text-sm text-slate">
        Read-only visibility into clarifications a <strong>lawyer</strong> sent directly to a
        client (§1B-ter) — not a work queue. The flow completes without ops: the client
        responds via their own secure link and the case returns straight to the lawyer.
        Following up here is an optional backstop for a silent client, never required.
      </div>

      {open.length === 0 ? (
        <Card className="p-4 text-sm text-slate">No clarifications currently awaiting a client response.</Card>
      ) : (
        <div className="space-y-2">
          {open.map((c) => (
            <ClarificationRow key={c.id} clarification={c} />
          ))}
        </div>
      )}
    </div>
  );
}

function waitingLabel(sentAt: string): string {
  const mins = Math.round((Date.now() - new Date(sentAt).getTime()) / 60000);
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function ClarificationRow({ clarification }: { clarification: Clarification }) {
  const db = useDB();
  const will = willById(db, clarification.will_id);
  const lead = will ? db.leads.find((l) => l.id === will.lead_id) : undefined;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">
              {will?.structured_json?.testator.name || will?.identity?.full_name || lead?.full_name}
            </span>
            <Pill tone={clarification.mode === "document_reupload" ? "amber" : "slate"}>
              {clarification.mode === "document_reupload" ? "document re-upload" : "question"}
            </Pill>
            <Pill tone="slate">via {clarification.channel}</Pill>
          </div>
          <p className="mt-1 text-sm text-slate">{clarification.question}</p>
          {lead && (lead.phone || lead.email) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
              {lead.phone && (
                <a href={`tel:${lead.phone.replace(/\s/g, "")}`} className="text-slate hover:text-ink hover:underline">
                  📞 {lead.phone}
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="text-slate hover:text-ink hover:underline">
                  ✉️ {lead.email}
                </a>
              )}
            </div>
          )}
        </div>
        <div className="text-right">
          <div className="text-xs text-slate">Waiting</div>
          <div className="font-serif text-lg text-ink">{waitingLabel(clarification.sent_at)}</div>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        {clarification.ops_followed_up ? (
          <Pill tone="sage">Followed up ✓</Pill>
        ) : (
          <Button variant="secondary" onClick={() => markOpsFollowedUp(clarification.id)}>
            Follow up on this client (optional)
          </Button>
        )}
      </div>
    </Card>
  );
}
