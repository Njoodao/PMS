-- ============================================================================
-- KABi — Supabase Row-Level Security (RLS) policies
-- Run in the Supabase SQL editor AFTER 08_levels_migration.sql.
--
-- This is the SERVER-SIDE enforcement boundary (governance spec, Phase 3): the
-- anon/authenticated API can only read/modify rows the signed-in user is
-- authorized for. The client capability layer is a UX guardrail; THIS is the
-- real boundary — even a raw API call is scoped here.
--
-- Column names below are taken from 06_kabiDb.js:
--   employees(auth_user_id, email, manager_email, is_ceo, is_hc_admin,
--             is_system_account, is_fte, is_former, org_level, employment_type)
--   evaluations(employee_id, evaluator_email, cycle_key, released_to_employee)
--   kpi_submissions(submitter_email) (+ kpi_submission_items via submission_id)
--   initiatives(employee_email, manager_email)
--   notifications(to_email)
--
-- ⚠ BEFORE YOU RUN
--   • Test in a Supabase BRANCH first — a wrong USING clause can lock users out.
--   • The service_role key BYPASSES RLS — use it only from a trusted backend.
--   • Policies target the `authenticated` role; logged-out `anon` gets nothing.
--   • Confirm the kpi_submission_items FK column is `submission_id` (adjust if not).
--   • Roles are derived from booleans (there is no single `role` column):
--       HC Super Admin ≈ is_system_account   ·   HC Admin ≈ is_hc_admin
--       CEO ≈ is_ceo   ·   Manager ≈ appears as someone's manager_email.
-- ============================================================================


-- ─── Helper functions ───────────────────────────────────────────────────────
-- SECURITY DEFINER so they read `employees` WITHOUT triggering RLS — this avoids
-- infinite recursion when an employees policy needs to look the caller up.
-- NOTE: employees.id is TEXT (e.g. 'E1055'), so this returns text.
create or replace function public.kabi_emp_id() returns text
  language sql stable security definer set search_path = public as $$
    select id from public.employees where auth_user_id = auth.uid() limit 1;
$$;

create or replace function public.kabi_email() returns text
  language sql stable security definer set search_path = public as $$
    select lower(email) from public.employees where auth_user_id = auth.uid() limit 1;
$$;

-- Full read+write governance (HC Super Admin / HC Admin).
create or replace function public.kabi_is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
    select coalesce((select (is_hc_admin or is_system_account)
                     from public.employees where auth_user_id = auth.uid() limit 1), false);
$$;

-- Org-wide READ (admins + CEO). CEO gets org visibility but NOT HC write actions.
create or replace function public.kabi_can_view_org() returns boolean
  language sql stable security definer set search_path = public as $$
    select coalesce((select (is_hc_admin or is_system_account or is_ceo)
                     from public.employees where auth_user_id = auth.uid() limit 1), false);
$$;

grant execute on function public.kabi_emp_id(), public.kabi_email(),
                          public.kabi_is_admin(), public.kabi_can_view_org()
  to authenticated;


-- ─── EMPLOYEES ────────────────────────────────────────────────────────────────
alter table public.employees enable row level security;

drop policy if exists emp_read on public.employees;
create policy emp_read on public.employees for select to authenticated
  using (
    auth_user_id = auth.uid()                 -- self
    or lower(manager_email) = public.kabi_email()  -- my direct reports
    or public.kabi_can_view_org()             -- HC / super admin / CEO
  );

-- People & Access is HC-only (managers never edit employee rows directly).
drop policy if exists emp_write on public.employees;
create policy emp_write on public.employees for all to authenticated
  using ( public.kabi_is_admin() ) with check ( public.kabi_is_admin() );


-- ─── EVALUATIONS ──────────────────────────────────────────────────────────────
alter table public.evaluations enable row level security;

drop policy if exists eval_read on public.evaluations;
create policy eval_read on public.evaluations for select to authenticated
  using (
    (employee_id = public.kabi_emp_id() and released_to_employee = true)  -- self: released only
    or employee_id in (select id from public.employees
                        where lower(manager_email) = public.kabi_email()) -- my reports
    or public.kabi_can_view_org()
  );

drop policy if exists eval_write on public.evaluations;
create policy eval_write on public.evaluations for all to authenticated
  using ( lower(evaluator_email) = public.kabi_email() or public.kabi_is_admin() )
  with check ( lower(evaluator_email) = public.kabi_email() or public.kabi_is_admin() );
-- NOTE: releasing results (released_to_employee = true) must stay HC-only. RLS can't
-- do column-level checks, so enforce release via a SECURITY DEFINER RPC run by HC
-- (the app already routes it through submit_evaluation / a release call), or add a
-- BEFORE UPDATE trigger that rejects non-admins flipping released_to_employee to true.


-- ─── KPI SUBMISSIONS (+ items) ─────────────────────────────────────────────────
alter table public.kpi_submissions enable row level security;

drop policy if exists sub_read on public.kpi_submissions;
create policy sub_read on public.kpi_submissions for select to authenticated
  using ( lower(submitter_email) = public.kabi_email() or public.kabi_can_view_org() );

drop policy if exists sub_write on public.kpi_submissions;
create policy sub_write on public.kpi_submissions for all to authenticated
  using ( lower(submitter_email) = public.kabi_email() or public.kabi_is_admin() )
  with check ( lower(submitter_email) = public.kabi_email() or public.kabi_is_admin() );

alter table public.kpi_submission_items enable row level security;
drop policy if exists sub_items_all on public.kpi_submission_items;
create policy sub_items_all on public.kpi_submission_items for all to authenticated
  using ( exists (select 1 from public.kpi_submissions s
                  where s.id = kpi_submission_items.submission_id
                    and (lower(s.submitter_email) = public.kabi_email() or public.kabi_can_view_org())) )
  with check ( exists (select 1 from public.kpi_submissions s
                  where s.id = kpi_submission_items.submission_id
                    and (lower(s.submitter_email) = public.kabi_email() or public.kabi_is_admin())) );


-- ─── INITIATIVES ───────────────────────────────────────────────────────────────
alter table public.initiatives enable row level security;

drop policy if exists init_read on public.initiatives;
create policy init_read on public.initiatives for select to authenticated
  using ( lower(employee_email) = public.kabi_email()
          or lower(manager_email) = public.kabi_email()
          or public.kabi_can_view_org() );

drop policy if exists init_insert on public.initiatives;
create policy init_insert on public.initiatives for insert to authenticated
  with check ( lower(employee_email) = public.kabi_email() );  -- submit your own

drop policy if exists init_update on public.initiatives;
create policy init_update on public.initiatives for update to authenticated
  using ( lower(employee_email) = public.kabi_email()
          or lower(manager_email) = public.kabi_email()
          or public.kabi_is_admin() )
  with check ( lower(employee_email) = public.kabi_email()
          or lower(manager_email) = public.kabi_email()
          or public.kabi_is_admin() );


-- ─── NOTIFICATIONS ──────────────────────────────────────────────────────────────
alter table public.notifications enable row level security;

drop policy if exists notif_read on public.notifications;
create policy notif_read on public.notifications for select to authenticated
  using ( lower(to_email) = public.kabi_email() or public.kabi_can_view_org() );

-- Any authenticated user (manager/HC) can send; reads stay scoped to the recipient.
drop policy if exists notif_insert on public.notifications;
create policy notif_insert on public.notifications for insert to authenticated
  with check ( true );

drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated
  using ( lower(to_email) = public.kabi_email() )         -- mark my own as read
  with check ( lower(to_email) = public.kabi_email() );


-- ─── SHARED CONFIG / REFERENCE ────────────────────────────────────────────────
-- Read for all authenticated users; write for HC only.
do $$
declare t text;
begin
  foreach t in array array['functions','kpi_library','pe_config',
                           'pe_extra_weights_matrix','initiative_targets','cycles']
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format('drop policy if exists %I_read on public.%I;', t, t);
    execute format('create policy %I_read on public.%I for select to authenticated using (true);', t, t);
    execute format('drop policy if exists %I_write on public.%I;', t, t);
    execute format('create policy %I_write on public.%I for all to authenticated using (public.kabi_is_admin()) with check (public.kabi_is_admin());', t, t);
  end loop;
end $$;


-- ============================================================================
-- OPTIONAL — new tables for features added in the app this cycle
-- (well-being check-ins · Copilot audit · INVIEWS links). Skip if unused.
-- ============================================================================

-- Well-being mood pulse (currently localStorage in the app).
create table if not exists public.wellbeing_checkins (
  id bigint generated always as identity primary key,
  employee_id text references public.employees(id) on delete cascade,  -- employees.id is TEXT
  mood  text check (mood in ('Great','Good','Okay','Low','Stressed')),
  score int  check (score between 1 and 5),
  created_at timestamptz default now()
);
grant select, insert, update, delete on public.wellbeing_checkins to authenticated;
alter table public.wellbeing_checkins enable row level security;
drop policy if exists wb_self on public.wellbeing_checkins;
create policy wb_self on public.wellbeing_checkins for all to authenticated
  using ( employee_id = public.kabi_emp_id() )
  with check ( employee_id = public.kabi_emp_id() );
-- Managers should see only a TREND, never raw rows — expose that via a
-- SECURITY DEFINER RPC (e.g. kabi_team_wellbeing_trend(mgr)), not a table policy.

-- Copilot audit trail (mirror of the proxy's audit, at the DB).
create table if not exists public.copilot_audit (
  id bigint generated always as identity primary key,
  actor_email text, action text, entity text, capability text, decision text,
  created_at timestamptz default now()
);
grant select, insert on public.copilot_audit to authenticated;
alter table public.copilot_audit enable row level security;
drop policy if exists audit_insert on public.copilot_audit;
create policy audit_insert on public.copilot_audit for insert to authenticated with check ( true );
drop policy if exists audit_read on public.copilot_audit;
create policy audit_read on public.copilot_audit for select to authenticated using ( public.kabi_can_view_org() );

-- INVIEWS assessment links (5 technical levels + a 'behavioral' row).
create table if not exists public.inviews_links (
  org_level text primary key,   -- 'entry','intermediate','first_level_management','advanced','executive','behavioral'
  url text
);
grant select, insert, update, delete on public.inviews_links to authenticated;
alter table public.inviews_links enable row level security;
drop policy if exists inv_read on public.inviews_links;
create policy inv_read on public.inviews_links for select to authenticated using ( true );
drop policy if exists inv_write on public.inviews_links;
create policy inv_write on public.inviews_links for all to authenticated
  using ( public.kabi_is_admin() ) with check ( public.kabi_is_admin() );

-- Seed the INVIEWS links (5 canonical levels + unified behavioural) — edit URLs as needed.
insert into public.inviews_links (org_level, url) values
  ('entry',                  'https://inviews.kabi.ai/tech/entry'),
  ('intermediate',           'https://inviews.kabi.ai/tech/intermediate'),
  ('first_level_management', 'https://inviews.kabi.ai/tech/first-level'),
  ('advanced',               'https://inviews.kabi.ai/tech/advanced'),
  ('executive',              'https://inviews.kabi.ai/tech/executive'),
  ('behavioral',             'https://inviews.kabi.ai/behavioral')
on conflict (org_level) do nothing;


-- ─── VERIFY ─────────────────────────────────────────────────────────────────
-- RLS should be ON for every table:
select relname, relrowsecurity as rls_enabled
from pg_class
where relnamespace = 'public'::regnamespace and relkind = 'r'
order by relname;

-- List every policy:
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
