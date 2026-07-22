-- ═══════════════════════════════════════════════════════════════════════════
-- app_settings — deployment-wide key/value store (used for SHARED BRANDING).
-- Run this in the Supabase SQL editor so branding set by the Super Admin reaches
-- EVERY user on EVERY device (the browser reads/writes it directly — no server
-- needed, works from static GitHub Pages hosting).
-- ═══════════════════════════════════════════════════════════════════════════

create table if not exists public.app_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.app_settings enable row level security;

-- Branding is NOT secret → anyone may READ it (so every visitor's app loads it).
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings
  for select to anon, authenticated
  using (true);

-- POC: allow WRITE (the Super-Admin restriction is enforced in the app UI).
-- ⚠ For production, tighten this to authenticated Super Admins only, e.g.
--   using (auth.jwt() ->> 'role' = 'pm_super_admin')
drop policy if exists app_settings_write on public.app_settings;
create policy app_settings_write on public.app_settings
  for all to anon, authenticated
  using (true)
  with check (true);
