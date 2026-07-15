-- ============================================================================
-- KABi — Supabase migration: 3 job levels  →  5-level framework
-- ----------------------------------------------------------------------------
-- Old org_level enum: top_management | management | staff_level
-- New 5 levels:       executive | advanced | first_level_management
--                     | intermediate | entry
--
-- Run in the Supabase SQL editor. Do the STEPS IN ORDER, and run STEP 1 on its
-- own first (Postgres will not let a brand-new enum value be used in the same
-- transaction that added it).
--
-- Mirrors the client-side migration in index.html (_peMigrateLevels + the
-- verified email→level map). Keyed by email (reliable).
-- ============================================================================

-- ─── STEP 0 (optional) — confirm the enum type name behind employees.org_level ──
-- Expected: something like 'org_level'. If different, replace the name in STEP 1.
SELECT t.typname AS org_level_enum_type
FROM   pg_attribute a
JOIN   pg_type  t ON a.atttypid = t.oid
JOIN   pg_class c ON a.attrelid = c.oid
WHERE  c.relname = 'employees' AND a.attname = 'org_level';


-- ─── STEP 1 — add the 5 new values to the enum.  RUN THIS ALONE, THEN CONTINUE. ──
-- (If STEP 0 returned a different type name, swap "org_level" below for it.)
ALTER TYPE org_level ADD VALUE IF NOT EXISTS 'entry';
ALTER TYPE org_level ADD VALUE IF NOT EXISTS 'intermediate';
ALTER TYPE org_level ADD VALUE IF NOT EXISTS 'first_level_management';
ALTER TYPE org_level ADD VALUE IF NOT EXISTS 'advanced';
ALTER TYPE org_level ADD VALUE IF NOT EXISTS 'executive';


-- ─── STEP 2 — reclassify employees by email (verified HR-roster classification) ──

-- Executive (CEO / COO / Deputy CEO / Chief HC)
UPDATE employees SET org_level = 'executive' WHERE lower(email) IN (
  'kaloraij@kabi.ai','ialzimami@kabi.ai','akhamis@kabi.ai','malkadi@kabi.ai'
);

-- Advanced (Directors)
UPDATE employees SET org_level = 'advanced' WHERE lower(email) IN (
  'amcluntun@kabi.ai','sassi@kabi.ai'
);

-- First-level management (Lead / Manager / Technical Lead)
UPDATE employees SET org_level = 'first_level_management' WHERE lower(email) IN (
  'ahamed@kabi.ai','aalzaid@kabi.ai','abarradah@kabi.ai','aobeid@kabi.ai','bamer@kabi.ai',
  'faljudhei@kabi.ai','ihajji@kabi.ai','kalmohammadi@kabi.ai','lalkhadheir@kabi.ai',
  'mmodallal@kabi.ai','mkarman@kabi.ai','nalsadhan@kabi.ai','salotaibi@kabi.ai',
  'salsaheel@kabi.ai','aalkhawaja@kabi.ai'
);

-- Entry (Officer / Junior / Associate)
UPDATE employees SET org_level = 'entry' WHERE lower(email) IN (
  'aalqurashi@kabi.ai','lramadan@kabi.ai','malogayel@kabi.ai','naloraij@kabi.ai',
  'salamoudi@kabi.ai','salbasri@kabi.ai','talqsairi@kabi.ai','nalfayez@kabi.ai'
);

-- Intermediate (Specialist / Engineer / Consultant / Developer / Designer / Analyst)
UPDATE employees SET org_level = 'intermediate' WHERE lower(email) IN (
  'aabolhouf@kabi.ai','aelian@kabi.ai','aabozainih@kabi.ai','aaltwijery@kabi.ai','abanyali@kabi.ai',
  'ayousef@kabi.ai','ashayeb@kabi.ai','azahmad@kabi.ai','babuhani@kabi.ai','destaiteh@kabi.ai',
  'fsaleem@kabi.ai','fabufares@kabi.ai','halkharouf@kabi.ai','kjarrad@kabi.ai','malatawi@kabi.ai',
  'malnajdi@kabi.ai','mabdulqader@kabi.ai','msumrein@kabi.ai','mamer@kabi.ai','malkhudair@kabi.ai',
  'nabdoullah@kabi.ai','nazab@kabi.ai','oabukhader@kabi.ai','oabualhija@kabi.ai','oaljohani@kabi.ai',
  'oabualjamieh@kabi.ai','rabdullah@kabi.ai','rodeh@kabi.ai','ralowais@kabi.ai','rtubasi@kabi.ai',
  'smohamad@kabi.ai','sjoban@kabi.ai','salkhunain@kabi.ai','ssaleh@kabi.ai','yaljamal@kabi.ai',
  'yhawash@kabi.ai','zhannoun@kabi.ai','dalenazi@kabi.ai','yjaziah@kabi.ai'
);

-- Catch-all for any employee NOT in the roster above (still on a legacy code):
-- map by the old tier. staff_level→intermediate, management→first_level_management,
-- top_management→advanced. (Adjust individually afterwards if any need it.)
UPDATE employees SET org_level = 'intermediate'           WHERE org_level = 'staff_level';
UPDATE employees SET org_level = 'first_level_management'  WHERE org_level = 'management';
UPDATE employees SET org_level = 'advanced'               WHERE org_level = 'top_management';


-- ─── STEP 3 — non-FTE contractors excluded from the evaluation cycle ─────────────
-- Only runs if these rows exist. Column name assumed 'employment_type' (confirm).
-- (Abdulaziz Aloraij = IT Advisor contract; Manal Qatab = contractor.)
UPDATE employees SET employment_type = 'non-fte'
WHERE  lower(email) IN ('aaloraij@kabi.ai','mqatab@kabi.ai');


-- ─── STEP 4 — verify ────────────────────────────────────────────────────────────
SELECT org_level, count(*) FROM employees GROUP BY org_level ORDER BY org_level;
-- Expected (current 68 mapped roster; totals vary with the 14 others):
--   executive 4 · advanced 2 · first_level_management ~16 · intermediate ~41 · entry ~19
SELECT email, org_level, employment_type FROM employees
WHERE lower(email) IN ('kaloraij@kabi.ai','malkadi@kabi.ai','aaloraij@kabi.ai','mqatab@kabi.ai');


-- ============================================================================
-- OPTIONAL LATER — other tables that also key on org_level (config / library):
--   kpi_library.org_level, pe_extra_weights_matrix.org_level,
--   initiative_targets.org_level, kpi_submissions.org_level
-- These are handled when the new KPI library (Phase 1) is loaded. Their legacy
-- rows keep working because index.html expands the config maps to 5 levels and
-- 06_kabiDb.js maps legacy codes → new labels on read.
-- ============================================================================
