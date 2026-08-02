-- InstaWill — Supabase / Postgres schema (production source of truth).
--
-- The running prototype uses a localStorage store that mirrors these tables 1:1
-- (src/lib/store.ts). This file is the real relational model: enums, FKs,
-- timestamps, and RLS. Every state transition is timestamped because the timing
-- data is the whole business case.
--
-- Apply with: supabase db reset  (or psql -f supabase/schema.sql)

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type preferred_channel as enum ('email', 'whatsapp', 'phone');
create type residency_status  as enum ('resident', 'non_resident', 'unknown');
create type lead_stage as enum (
  'about','family','assets','beneficiaries','safety','documents','review',
  'submitted','in_lawyer_review','approved','registered','abandoned'
);
create type recoverability as enum ('high','medium','low');
create type will_type as enum ('full','property','financial_assets','business','guardianship','digital');
create type jurisdiction as enum ('difc','adjd');
create type will_status as enum (
  'draft','content_complete','documents_pending','submitted','in_review',
  'changes_requested','approved','registered','abandoned'
);
create type asset_type as enum ('property','bank_account','business_shares','other');
create type emirate as enum ('dubai','rak','abu_dhabi','other','n_a');
create type executor_role as enum ('executor','substitute_executor','guardian','substitute_guardian');
create type doc_type as enum ('passport','emirates_id','title_deed','witness_passport','draft_will_pdf');
create type doc_status as enum ('pending','uploaded','validated','rejected');
create type match_result as enum ('match','mismatch','needs_review','n_a');
create type severity as enum ('block','warn','info','ok');
create type check_owner as enum ('client','lawyer','none');
create type user_role as enum ('lawyer','ops_agent','admin');
create type review_outcome as enum ('approved','changes_requested','escalated');
create type case_complexity as enum ('standard','complex');
create type review_item_action as enum ('confirmed','verified','returned_to_client','doc_received');
create type reminder_type as enum ('automated_email','automated_whatsapp','agent_call');
create type reminder_trigger as enum ('system','agent');
create type reminder_outcome as enum ('sent','no_response','recovered','opted_out');
create type portal_method as enum ('manual_ops','rpa_v2');
create type payment_status as enum ('pending','paid');
create type registration_outcome as enum ('pending','registered','rejected');

-- ---------------------------------------------------------------------------
-- Staff
-- ---------------------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role user_role not null,
  email text unique not null
);

-- ---------------------------------------------------------------------------
-- Leads (one row per person who starts intake)
-- ---------------------------------------------------------------------------
create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  full_name text,
  email text,
  phone text,
  preferred_channel preferred_channel not null default 'email',
  utm_source text,
  utm_medium text,
  utm_campaign text,
  gclid text,
  referrer text,
  residency_status residency_status not null default 'unknown',
  current_stage lead_stage not null default 'about',
  stage_updated_at timestamptz not null default now(),
  recoverability recoverability not null default 'high',
  assigned_agent_id uuid references users(id)
);
create index on leads (current_stage);
create index on leads (stage_updated_at);

-- ---------------------------------------------------------------------------
-- Wills (a lead can have >1 — mirror wills, or a DIFC + ADJD split)
-- ---------------------------------------------------------------------------
create table wills (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  will_type will_type not null default 'full',
  jurisdiction jurisdiction not null default 'difc',
  status will_status not null default 'draft',
  structured_json jsonb,
  ai_structured boolean not null default false,
  content_complete_at timestamptz,
  submitted_at timestamptz,
  approved_at timestamptz,
  registered_at timestamptz
);
create index on wills (status);
create index on wills (lead_id);

create table beneficiaries (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references wills(id) on delete cascade,
  name text not null,
  relationship text,
  share_pct numeric(6,2) not null default 0,
  is_minor boolean not null default false,
  held_in_trust boolean not null default false,
  substitution text
);

create table assets (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references wills(id) on delete cascade,
  asset_type asset_type not null,
  emirate emirate not null default 'n_a',
  needs_adjd boolean not null default false,
  description text
);

create table executors (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references wills(id) on delete cascade,
  role executor_role not null,
  name text not null,
  relationship text
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references wills(id) on delete cascade,
  doc_type doc_type not null,
  status doc_status not null default 'pending',
  ocr_extracted jsonb,
  match_result match_result not null default 'n_a',
  uploaded_at timestamptz,
  validated_at timestamptz
);

-- Audit trail of every rules-engine result fired against a will.
create table checks (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references wills(id) on delete cascade,
  check_key text not null,
  severity severity not null,
  owner check_owner not null,
  detail text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references users(id)
);
create index on checks (will_id);

-- One row per lawyer review of a will — powers the 90 -> 15 KPI.
create table review_sessions (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references wills(id) on delete cascade,
  lawyer_id uuid not null references users(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  duration_seconds integer,
  outcome review_outcome,
  items_total integer not null default 0,
  items_cleared integer not null default 0,
  case_complexity case_complexity not null default 'standard'
);

create table review_items (
  id uuid primary key default gen_random_uuid(),
  review_session_id uuid not null references review_sessions(id) on delete cascade,
  check_id uuid not null references checks(id) on delete cascade,
  cleared_at timestamptz not null default now(),
  action review_item_action not null
);

create table reminders (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  type reminder_type not null,
  triggered_at timestamptz not null default now(),
  triggered_by reminder_trigger not null,
  agent_id uuid references users(id),
  outcome reminder_outcome not null default 'sent',
  blocking_reason_snapshot text
);

create table portal_submissions (
  id uuid primary key default gen_random_uuid(),
  will_id uuid not null references wills(id) on delete cascade,
  package_json jsonb not null,
  method portal_method not null default 'manual_ops',
  ops_user_id uuid references users(id),
  submitted_at timestamptz,
  appointment_at timestamptz,
  payment_status payment_status not null default 'pending',
  registration_outcome registration_outcome not null default 'pending',
  rejection_reason text
);

-- Generic append-only event log — belt-and-suspenders for any funnel/timing
-- metric not anticipated by a dedicated table.
create table events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  will_id uuid references wills(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index on events (event_type);
create index on events (created_at);

-- ---------------------------------------------------------------------------
-- Row-Level Security (sketch)
--   Clients see only their own lead/will; staff (lawyer/ops/admin) see queues.
--   Enable and refine per your auth setup.
-- ---------------------------------------------------------------------------
alter table leads   enable row level security;
alter table wills   enable row level security;
alter table documents enable row level security;

-- A client can read/write only their own lead (matched on auth email).
create policy client_own_lead on leads
  for all using (email = auth.jwt() ->> 'email');

-- Staff can read everything (role stored in a custom claim).
create policy staff_read_leads on leads
  for select using (coalesce(auth.jwt() ->> 'role','') in ('lawyer','ops_agent','admin'));
create policy staff_read_wills on wills
  for select using (coalesce(auth.jwt() ->> 'role','') in ('lawyer','ops_agent','admin'));

-- ---------------------------------------------------------------------------
-- Metric views (every number the business case rests on, derived from rows)
-- ---------------------------------------------------------------------------

-- North star: registered wills per month.
create view v_registered_by_month as
select date_trunc('month', registered_at) as month, count(*) as registered
from wills where registered_at is not null
group by 1 order by 1;

-- Lawyer minutes per will — standard-case AND fleet, reported separately.
create view v_lawyer_minutes as
select case_complexity,
       round(avg(duration_seconds)/60.0, 1) as avg_minutes,
       count(*) as sessions
from review_sessions
where duration_seconds is not null and outcome = 'approved'
group by case_complexity;

-- Funnel drop-off by stage.
create view v_funnel as
select current_stage, count(*) as leads
from leads group by current_stage;

-- Turnaround time per will (content_complete -> registered).
create view v_turnaround as
select id,
       extract(epoch from (registered_at - content_complete_at))/86400 as days
from wills
where registered_at is not null and content_complete_at is not null;
