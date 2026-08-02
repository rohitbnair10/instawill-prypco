-- InstaWill — minimal Postgres seed.
--
-- The rich demo dataset (four lawyer cases, stalled intakes, history) is seeded
-- automatically by the running app via src/lib/seed.ts, so it is available with
-- zero backend. This file seeds only the staff users so a fresh Supabase project
-- has the roles the RLS policies reference. Extend as needed.

insert into users (id, name, role, email) values
  ('00000000-0000-0000-0000-000000000001', 'Layla Haddad', 'lawyer',    'layla@instawill.ae'),
  ('00000000-0000-0000-0000-000000000002', 'Omar Farooq',  'ops_agent', 'omar@instawill.ae'),
  ('00000000-0000-0000-0000-000000000003', 'Admin',        'admin',     'admin@instawill.ae')
on conflict (email) do nothing;
