/* ============================================================================
 * 07_kabiKpiKnowledge.js  —  KABi Enriched, Level-Aware KPI Knowledge Packs
 * ----------------------------------------------------------------------------
 * PURPOSE
 *   The three KPI agents (KABi.Agents.kpiArchitect.validate / generate /
 *   checkCoherence) already exist in index.html but are fed only 4 word-lists
 *   per function from KABi.KpiKnowledgeBase. This file EXTENDS that object with
 *   a full, structured, LEVEL-AWARE "Knowledge Pack" per function so the agents
 *   derive from facts instead of guessing, and so EACH ROLE LEVEL
 *   (Officer / Specialist / Lead / Manager) gets its own KPI package while the
 *   function's boundaries stay clear.
 *
 * FLOW THE PACK ENABLES
 *   1. Agent loads the function pack -> understands mandate, scope, competencies.
 *   2. Agent picks the level's KPI package (levels[level].kpiPackage).
 *   3. Agent reads CONNECTED SYSTEMS (Pipedrive / files / reports) for the
 *      real baseline of each metric.
 *   4. Agent sets the target for THAT LEVEL using each KPI's `targetBasis`
 *      (approved_default | baseline_plus_improvement | needs_data ...).
 *   Targets are therefore DERIVED, never hardcoded guesses.
 *
 * LOADING (after index.html, same pattern as 06_kabiDb.js)
 *     <script src="07_kabiKpiKnowledge.js"></script>
 *   Merges (never clobbers) into KABi.KpiKnowledgeBase. Existing vocab fields
 *   (validVerbs/validNouns/conflictWords/unitHints/ar) are preserved so the
 *   rule-based validate() keeps working unchanged.
 *
 * NON-NEGOTIABLE RULE — NO ASSUMPTIONS
 *   Any value not verifiable from code, an approved document, or a connected
 *   system is the sentinel "needs_input" (or null), NEVER a plausible guess.
 *
 * SOURCES USED FOR THE bd-sales PILOT (all verified, no assumptions):
 *   - Role levels ...... "Job Title Dictionary.xlsx" (Business Development:
 *                        Officer / Specialist / Lead / Manager)
 *   - Competencies ..... "Competencies Dictionary (1).xlsx"
 *                        (job family "Opportunities Commanders" -> Business Dev)
 *   - Approved KPIs .... _KPI_DB['bd-sales'] in index.html:6836 (from
 *                        KABi_KPI_Framework v2)
 *   - Data source ...... KABiPipedrive (live) — index.html:32886+
 *
 * STATUS: PILOT = 'bd-sales' only. Prove end-to-end, then replicate template.
 * ==========================================================================*/

(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.KABi) {
    console.warn('[KPI Knowledge] KABi namespace not found — load after index.html');
    return;
  }
  var KABi = window.KABi;
  KABi.KpiKnowledgeBase = KABi.KpiKnowledgeBase || {};

  /* ──────────────────────────────────────────────────────────────────────
   * KNOWLEDGE PACK SCHEMA (v2 — level-aware)
   * ----------------------------------------------------------------------
   * Sentinels:  "needs_input" = must be supplied & verified before go-live
   *             null          = intentionally empty / not applicable
   *
   * {
   *   pillar, dept, functionName,          // identity (from FNS / code)
   *   mandate,                             // one sentence: why this function exists
   *   scopeIn:  [ "..." ],                 // outcomes the function OWNS
   *   scopeOut: [ "..." ],                 // explicitly NOT this function
   *   competencies: [ "..." ],             // from Competencies Dictionary
   *   ownerLevels: [ "officer","specialist","lead","manager" ],
   *
   *   validVerbs, validNouns, conflictWords, unitHints, ar,   // vocab (kept)
   *
   *   library: [ { text, metricId } ],     // approved KPIs (source = _KPI_DB)
   *
   *   metrics: [ {                         // METRIC DICTIONARY
   *     metricId, name, definition, formula, numerator, denominator,
   *     unit, direction, min, max, cannotExceed, aggregation,
   *     inclusion, exclusion, dataSourceId, controllability,
   *     goodExample, badExample
   *   } ],
   *
   *   dataSources: [ {                     // connected systems / evidence
   *     id, system, status, availableFields:[...], employeeMatching,
   *     coverage, allowedUses:[...], prohibitedUses:[...]
   *   } ],
   *
   *   // ── LEVEL-AWARE KPI PACKAGES ──────────────────────────────────────
   *   levels: {
   *     <level>: {
   *       titleEn, titleAr, band, focus,   // who this level is
   *       accountability,                  // "individual" | "team"
   *       kpiPackage: [ {
   *         metricId, category,            // outcome|process|quality|risk_control
   *         text,                          // the KPI wording (target left to agent)
   *         targetBasis,                   // how the agent sets the target:
   *                                        //   "approved_default" (value in defaultTarget)
   *                                        //   "baseline_plus_improvement"
   *                                        //   "needs_data" (source not connected yet)
   *         defaultTarget,                 // approved org standard (or null)
   *         dataSourceId,                  // where the baseline comes from
   *         guardrail                      // true if it protects against gaming another KPI
   *       } ]
   *     }
   *   },
   *
   *   coverageProfile,                     // required 4-KPI mix per set
   *   conflictRules: [ {metricA,metricB,relationship,risk,requiredControl} ],
   *   strategicPriorities,                 // OKRs (needs_input until supplied)
   *   antiPatterns: [ {text,category,why} ],   // built later (test assets)
   *   goldStandard: [ {text,verdict,why} ]     // built later (test assets)
   * }
   * ────────────────────────────────────────────────────────────────────── */

  var PACKS = {

    /* ═══════════════════════════════════════════════════════════════════
     * PILOT — bd-sales  (Business Development · SELL · Commercial)
     * ═════════════════════════════════════════════════════════════════ */
    'bd-sales': {
      /* identity */
      pillar: 'SELL',
      dept: 'Commercial Department',
      functionName: 'Business Development',
      mandate: 'needs_input',   // [NEED] confirm one sentence: e.g. "Grow revenue by generating, qualifying and closing new-business opportunities for KABi products."

      // scopeIn derived from the BD competency set (verified) — confirm/trim
      scopeIn: [
        'Generating and qualifying new-business opportunities',
        'Conducting demos and issuing proposals to prospects',
        'Negotiating contracts and closing deals (closed-won)',
        'Building and maintaining the sales pipeline in CRM',
        'Market research: identifying prospects, trends, competitors',
        'Upselling / cross-selling to expand account value'
      ],
      // scopeOut — outcomes owned by OTHER functions (blocks misfit KPIs). Confirm.
      scopeOut: [
        'Product delivery / implementation (owned by delivery/PMO)',
        'Client onboarding & go-live (owned by Client Success)',
        'Invoice collection / cash receipts (owned by Finance)',
        'Marketing-qualified lead volume (owned by Lead Generation)',
        'Long-term account health & renewals (owned by Account Management)'
      ],
      // competencies verbatim from Competencies Dictionary (job family: Opportunities Commanders)
      competencies: [
        'Market Research', 'Value Proposition', 'Sales Forecasting',
        'Market Penetration and Expansion', 'Contract Negotiation and Deal Closing',
        'Online Platform Utilization', 'Sales Pipeline Management', 'Product Knowledge',
        'Upselling and Cross-selling', 'Brand Awareness', 'Account Growth Execution',
        'Client Performance Analytics'
      ],
      ownerLevels: ['officer', 'specialist', 'lead', 'manager'],  // verified from Job Title Dictionary

      /* vocab — kept as-is from index.html:31849 */
      validVerbs: ['close', 'win', 'achieve', 'increase', 'expand', 'qualify', 'forecast', 'deliver'],
      validNouns: ['deal', 'pipeline', 'win rate', 'deal size', 'sales cycle', 'closed-won', 'quota attainment', 'ARR', 'new logo', 'expansion revenue', 'sales velocity', 'opportunity stage', 'market research', 'winning proposal', 'partnership deal', 'client relationship', 'business growth', 'contract negotiation'],
      conflictWords: ['code coverage', 'p95 latency', 'WCAG', 'incident MTTR', 'training hours'],
      unitHints: ['SAR', 'deals', '%', 'days'],
      ar: {
        validNouns: ['صفقات', 'إغلاق صفقات', 'خط الأنابيب', 'معدل الفوز', 'هدف المبيعات', 'أبحاث السوق', 'عرض مقنع', 'شراكة', 'علاقات العملاء'],
        conflictWords: ['تغطية الكود', 'زمن الاستجابة', 'تدريب']
      },

      /* approved library — verbatim from _KPI_DB:6836 (these are Officer-level activity KPIs) */
      library: [
        { text: '# of follow-ups completed per week (target: ≥ 75/week)', metricId: 'followups-per-week' },
        { text: '# of demos conducted per week (target: ≥ 10/week)',      metricId: 'demos-per-week' },
        { text: 'CRM same-day logging compliance rate (target: 100%)',    metricId: 'crm-logging-compliance' },
        { text: '# of proposals issued per week (target: ≥ 1 per rep)',   metricId: 'proposals-per-week' },
        { text: 'Demo-to-opportunity conversion rate (%)',                metricId: 'demo-to-opp-rate' },
        { text: 'Prospect follow-up sequence completion rate (%)',        metricId: 'followup-sequence-rate' }
      ],

      /* METRIC DICTIONARY — activity metrics from library + outcome metrics
         Pipedrive can supply (verified fields: status, value, ownerEmail, cycleDays). */
      metrics: [
        { metricId: 'followups-per-week', name: 'Follow-ups per Week', definition: 'Count of prospect follow-up activities logged per week', formula: 'count(followup activities) / weeks', numerator: 'follow-up activities', denominator: 'weeks', unit: 'count', direction: 'higher_is_better', min: 0, max: null, cannotExceed: null, aggregation: 'average', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'needs_input', controllability: 'high', goodExample: '≥ 75 follow-ups per week', badExample: null },
        { metricId: 'demos-per-week', name: 'Demos per Week', definition: 'Count of product demos conducted per week', formula: 'count(demos) / weeks', numerator: 'demos', denominator: 'weeks', unit: 'count', direction: 'higher_is_better', min: 0, max: null, cannotExceed: null, aggregation: 'average', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'needs_input', controllability: 'high', goodExample: '≥ 10 demos per week', badExample: null },
        { metricId: 'crm-logging-compliance', name: 'CRM Same-day Logging Compliance', definition: 'Share of activities logged in CRM on the same day', formula: 'same-day logged activities / total activities * 100', numerator: 'same-day logged', denominator: 'total activities', unit: '%', direction: 'higher_is_better', min: 0, max: 100, cannotExceed: 100, aggregation: 'point_in_time', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'needs_input', controllability: 'high', goodExample: '100% same-day logging', badExample: '120% compliance (impossible)' },
        { metricId: 'proposals-per-week', name: 'Proposals Issued per Week', definition: 'Count of proposals issued to prospects per week', formula: 'count(proposals) / weeks', numerator: 'proposals', denominator: 'weeks', unit: 'count', direction: 'higher_is_better', min: 0, max: null, cannotExceed: null, aggregation: 'average', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'needs_input', controllability: 'high', goodExample: '≥ 1 proposal per week', badExample: null },
        { metricId: 'demo-to-opp-rate', name: 'Demo-to-Opportunity Conversion Rate', definition: 'Share of demos advancing to a qualified opportunity', formula: 'opportunities from demos / demos conducted * 100', numerator: 'opportunities from demos', denominator: 'demos conducted', unit: '%', direction: 'higher_is_better', min: 0, max: 100, cannotExceed: 100, aggregation: 'point_in_time', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'needs_input', controllability: 'high', goodExample: null, badExample: null },
        { metricId: 'followup-sequence-rate', name: 'Follow-up Sequence Completion Rate', definition: 'Share of prospects taken fully through the defined follow-up sequence', formula: 'sequences completed / sequences started * 100', numerator: 'sequences completed', denominator: 'sequences started', unit: '%', direction: 'higher_is_better', min: 0, max: 100, cannotExceed: 100, aggregation: 'point_in_time', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'needs_input', controllability: 'high', goodExample: null, badExample: null },
        { metricId: 'qualified-pipeline', name: 'Qualified Pipeline Generated', definition: 'Value of qualified open opportunities the rep sourced', formula: 'sum(value of open deals sourced by rep)', numerator: 'open deal value (sourced)', denominator: null, unit: 'SAR', direction: 'higher_is_better', min: 0, max: null, cannotExceed: null, aggregation: 'cumulative', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'pipedrive', controllability: 'high', goodExample: null, badExample: null },
        { metricId: 'win-rate', name: 'Win Rate', definition: 'Share of decided deals that were won', formula: 'won / (won + lost) * 100', numerator: 'won deals', denominator: 'won + lost deals', unit: '%', direction: 'higher_is_better', min: 0, max: 100, cannotExceed: 100, aggregation: 'point_in_time', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'pipedrive', controllability: 'high', goodExample: 'Increase win rate from 22% to 30% by Q4 2026', badExample: 'Achieve 120% win rate (impossible)' },
        { metricId: 'new-logos', name: 'New Logos Closed', definition: 'Count of new customers won (first-time logos)', formula: 'count(closed-won new-customer deals)', numerator: 'closed-won new logos', denominator: null, unit: 'count', direction: 'higher_is_better', min: 0, max: null, cannotExceed: null, aggregation: 'cumulative', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'pipedrive', controllability: 'high', goodExample: null, badExample: null },
        { metricId: 'avg-deal-size', name: 'Average Deal Size', definition: 'Average value of won deals', formula: 'total won revenue / count(won)', numerator: 'won revenue', denominator: 'won deals', unit: 'SAR', direction: 'higher_is_better', min: 0, max: null, cannotExceed: null, aggregation: 'average', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'pipedrive', controllability: 'medium', goodExample: null, badExample: null },
        { metricId: 'sales-cycle', name: 'Sales Cycle Length', definition: 'Average days from qualified opportunity to closed-won', formula: 'sum(cycleDays of won) / count(won)', numerator: 'cycle days', denominator: 'won deals', unit: 'days', direction: 'lower_is_better', min: 0, max: null, cannotExceed: null, aggregation: 'average', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'pipedrive', controllability: 'medium', goodExample: null, badExample: null },
        { metricId: 'quota-attainment', name: 'Quota Attainment', definition: 'Achieved revenue vs assigned quota', formula: 'closed-won revenue / assigned quota * 100', numerator: 'closed-won revenue', denominator: 'assigned quota', unit: '%', direction: 'higher_is_better', min: 0, max: null, cannotExceed: null, aggregation: 'cumulative', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'needs_input', controllability: 'high', goodExample: null, badExample: null },
        { metricId: 'forecast-accuracy', name: 'Sales Forecast Accuracy', definition: 'How close forecast was to actual closed revenue', formula: '100 - abs(forecast - actual) / actual * 100', numerator: null, denominator: null, unit: '%', direction: 'higher_is_better', min: 0, max: 100, cannotExceed: 100, aggregation: 'point_in_time', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'needs_input', controllability: 'medium', goodExample: '± 5% forecast accuracy', badExample: null },
        { metricId: 'pipeline-coverage', name: 'Pipeline Coverage Ratio', definition: 'Open pipeline value relative to the period target', formula: 'open pipeline value / period target', numerator: 'open pipeline value', denominator: 'period target', unit: 'ratio', direction: 'higher_is_better', min: 0, max: null, cannotExceed: null, aggregation: 'point_in_time', inclusion: 'needs_input', exclusion: 'needs_input', dataSourceId: 'pipedrive', controllability: 'medium', goodExample: '3x coverage', badExample: null }
      ],

      /* connected systems */
      dataSources: [
        { id: 'pipedrive', system: 'Pipedrive', status: 'connected', availableFields: ['status', 'value', 'ownerEmail', 'cycleDays'], employeeMatching: 'ownerEmail', coverage: 'needs_input', allowedUses: ['evidence', 'baseline', 'target_setting'], prohibitedUses: ['automatic_performance_rating'] }
        /* [NEED] Are follow-ups / demos / proposals / CRM-logging tracked anywhere?
           If NOT connected, every activity metric's dataSourceId stays needs_input
           and those KPIs are NOT measurable (agent must flag, not invent). */
      ],

      /* ── LEVEL-AWARE KPI PACKAGES ──────────────────────────────────────
         Officer = execution/activity (high control). Manager = team outcomes.
         Targets are DERIVED by the agent from dataSources at runtime, except
         approved org-standard activity defaults carried from the framework. */
      levels: {
        officer: {
          titleEn: 'Business Development Officer', titleAr: 'مسؤول تطوير الأعمال',
          band: 'Entry Level', accountability: 'individual',
          focus: 'Consistent, high-quality sales activity and CRM discipline',
          kpiPackage: [
            { metricId: 'followups-per-week',    category: 'process', text: '# of follow-ups completed per week',            targetBasis: 'approved_default', defaultTarget: '≥ 75/week', dataSourceId: 'needs_input', guardrail: false },
            { metricId: 'demos-per-week',        category: 'process', text: '# of demos conducted per week',                 targetBasis: 'approved_default', defaultTarget: '≥ 10/week', dataSourceId: 'needs_input', guardrail: false },
            { metricId: 'crm-logging-compliance',category: 'quality', text: 'CRM same-day logging compliance rate',          targetBasis: 'approved_default', defaultTarget: '100%',      dataSourceId: 'needs_input', guardrail: true },
            { metricId: 'proposals-per-week',    category: 'process', text: '# of proposals issued per week',                targetBasis: 'approved_default', defaultTarget: '≥ 1/week',  dataSourceId: 'needs_input', guardrail: false }
          ]
        },
        specialist: {
          titleEn: 'Business Development Specialist', titleAr: 'أخصائي تطوير الأعمال',
          band: 'Intermediate', accountability: 'individual',
          focus: 'Converting activity into qualified pipeline and opportunities',
          kpiPackage: [
            { metricId: 'demo-to-opp-rate',   category: 'outcome', text: 'Demo-to-opportunity conversion rate',   targetBasis: 'baseline_plus_improvement', defaultTarget: null, dataSourceId: 'needs_input', guardrail: false },
            { metricId: 'qualified-pipeline', category: 'outcome', text: 'Qualified pipeline generated (SAR)',      targetBasis: 'baseline_plus_improvement', defaultTarget: null, dataSourceId: 'pipedrive', guardrail: false },
            { metricId: 'followup-sequence-rate', category: 'quality', text: 'Prospect follow-up sequence completion rate', targetBasis: 'baseline_plus_improvement', defaultTarget: null, dataSourceId: 'needs_input', guardrail: true },
            { metricId: 'demos-per-week',     category: 'process', text: '# of demos conducted per week',           targetBasis: 'approved_default', defaultTarget: '≥ 10/week', dataSourceId: 'needs_input', guardrail: false }
          ]
        },
        lead: {
          titleEn: 'Business Development Lead', titleAr: 'قائد تطوير الأعمال',
          band: 'Advanced', accountability: 'individual',
          focus: 'Owning revenue outcomes: closing, win rate, deal value',
          kpiPackage: [
            { metricId: 'win-rate',     category: 'outcome', text: 'Win rate on decided deals',       targetBasis: 'baseline_plus_improvement', defaultTarget: null, dataSourceId: 'pipedrive', guardrail: false },
            { metricId: 'new-logos',    category: 'outcome', text: '# of new logos closed',            targetBasis: 'baseline_plus_improvement', defaultTarget: null, dataSourceId: 'pipedrive', guardrail: false },
            { metricId: 'avg-deal-size',category: 'outcome', text: 'Average deal size (SAR)',          targetBasis: 'baseline_plus_improvement', defaultTarget: null, dataSourceId: 'pipedrive', guardrail: false },
            { metricId: 'sales-cycle',  category: 'process', text: 'Sales cycle length (days)',        targetBasis: 'baseline_plus_improvement', defaultTarget: null, dataSourceId: 'pipedrive', guardrail: true }
          ]
        },
        manager: {
          titleEn: 'Business Development Manager', titleAr: 'مدير تطوير الأعمال',
          band: 'First-level management', accountability: 'team',
          focus: 'Team results, forecast reliability and healthy pipeline',
          kpiPackage: [
            { metricId: 'quota-attainment',  category: 'outcome',      text: 'Team quota attainment',        targetBasis: 'needs_data',                defaultTarget: null, dataSourceId: 'needs_input', guardrail: false },
            { metricId: 'forecast-accuracy', category: 'quality',      text: 'Sales forecast accuracy',      targetBasis: 'needs_data',                defaultTarget: '± 5%', dataSourceId: 'needs_input', guardrail: false },
            { metricId: 'win-rate',          category: 'outcome',      text: 'Team win rate',                targetBasis: 'baseline_plus_improvement', defaultTarget: null, dataSourceId: 'pipedrive', guardrail: false },
            { metricId: 'pipeline-coverage', category: 'risk_control', text: 'Pipeline coverage ratio',      targetBasis: 'baseline_plus_improvement', defaultTarget: '≥ 3x', dataSourceId: 'pipedrive', guardrail: true }
          ]
        }
      },

      /* set-level design */
      coverageProfile: {   // default proposal — confirm
        outcome: { min: 1, max: 2 }, process: { min: 1, max: 2 },
        quality: { min: 0, max: 1 }, risk_control: { min: 0, max: 1 }, capability: { min: 0, max: 0 }
      },
      conflictRules: [
        { metricA: 'demos-per-week', metricB: 'demo-to-opp-rate', relationship: 'trade_off', risk: 'Chasing demo volume can lower demo quality/conversion', requiredControl: 'Pair volume with a conversion/quality guardrail' },
        { metricA: 'sales-cycle', metricB: 'avg-deal-size', relationship: 'trade_off', risk: 'Pushing faster cycles can shrink deal size via discounting', requiredControl: 'Do not set both aggressively without a revenue guardrail' },
        { metricA: 'followups-per-week', metricB: 'crm-logging-compliance', relationship: 'same_denominator', risk: 'Both count activities — avoid double-weighting activity', requiredControl: 'Keep at most one pure-activity KPI heavily weighted' }
      ],

      strategicPriorities: 'needs_input',  // [NEED] BD OKRs for 2026 + source document

      /* ── TEST ASSETS (Step 3) — ground truth for measuring agent accuracy ──
         verdict = the CORRECT outcome a perfect validator/coherence should give. */
      goldStandard: [
        { text: 'Increase win rate from 22% to 30% by Q4 2026', verdict: 'pass', why: 'Outcome, numeric target, direction correct, time-bound, within 0–100' },
        { text: 'Reduce average sales cycle from 60 to 45 days by end of 2026', verdict: 'pass', why: 'Measurable, lower-is-better honored, deadline present' },
        { text: 'Generate SAR 2,000,000 in qualified pipeline by Q3 2026', verdict: 'pass', why: 'Owned outcome, unit + target + deadline' },
        { text: 'Achieve 100% CRM same-day logging compliance every month in 2026', verdict: 'pass', why: 'Valid capped % at boundary, time-bound, controllable' }
      ],
      antiPatterns: [
        { text: 'Achieve 120% win rate by Q4 2026', verdict: 'fail', category: 'impossible_percentage', why: 'Win rate cannotExceed 100 (metric dictionary)' },
        { text: 'Improve sales pipeline management', verdict: 'fail', category: 'vague_no_target_no_deadline', why: 'No metric, no number, no deadline' },
        { text: 'Close 50 new deals', verdict: 'fail', category: 'no_deadline', why: 'Numeric target but no time frame' },
        { text: 'Reduce invoice collection days to 30 by Q4 2026', verdict: 'fail', category: 'wrong_function', why: 'Collections is scopeOut — owned by Finance' },
        { text: 'Improve product uptime to 99.9% by 2026', verdict: 'fail', category: 'wrong_function', why: 'Uptime is owned by Technology/DevOps, not BD' },
        { text: 'Increase win rate, reduce sales cycle, and improve CRM logging by Q4 2026', verdict: 'fail', category: 'compound', why: 'Three unrelated primary outcomes in one KPI' },
        { text: 'Conduct 200 demos per week', verdict: 'fail', category: 'gaming_unrealistic', why: 'Pure volume, unrealistic vs capacity, gameable without a quality guardrail' }
      ]
    }

  };

  /* ──────────────────────────────────────────────────────────────────────
   * KABi.KpiKnowledge — prompt-context helpers consumed by index.html
   * ----------------------------------------------------------------------
   * index.html calls these IF present; when a function has no enriched pack
   * the helpers return '' / [] so the existing 28 functions are unaffected.
   * ────────────────────────────────────────────────────────────────────── */
  function _isReal(v) {
    return v !== null && v !== undefined && v !== 'needs_input' &&
           !(Array.isArray(v) && v.length === 0);
  }
  function _hasPack(pack) {
    return !!(pack && (pack.mandate || pack.levels || pack.library || pack.metrics));
  }

  KABi.KpiKnowledge = {

    /* Returns the approved KPI library strings for a function (for coherence). */
    getLibrary: function (fnKey) {
      // v69: prefer the Enterprise KPI Library (distinct metrics + coverage tags).
      if (typeof window !== 'undefined' && window.KABi && KABi.KpiLibrary && KABi.KpiLibrary.has(fnKey)) {
        var seen = {}, out = [];
        KABi.KpiLibrary.get(fnKey, 'Entry').forEach(function (k) {
          if (!seen[k.name]) { seen[k.name] = 1; out.push(k.name + ' [' + k.cat + '/' + k.rec + ']'); }
        });
        if (out.length) return out;
      }
      var pack = KABi.KpiKnowledgeBase[fnKey];
      if (pack && Array.isArray(pack.library) && pack.library.length) {
        return pack.library.map(function (k) { return k.text; });
      }
      return [];   // index.html falls back to _KPI_DB when this is empty
    },

    /* DETERMINISTIC checks that use the metric dictionary + approved defaults.
       Runs AFTER the rule-based validate() and returns extra issues plus SMART
       flag overrides. Conservative — designed NOT to fire on valid KPIs.
       Returns { issues:[{code,severity,message}], smartOverrides:{S?,M?,A?,R?,T?} } */
    deterministicChecks: function (text, fnKey) {
      var res = { issues: [], smartOverrides: {} };
      var pack = KABi.KpiKnowledgeBase[fnKey];
      if (!_hasPack(pack) || !text) return res;
      var t = String(text).toLowerCase();
      var metrics = pack.metrics || [];

      // Which dictionary metrics does this KPI reference? (name or metricId words)
      function refs(m) {
        var nm = (m.name || '').toLowerCase();
        var idw = (m.metricId || '').replace(/-/g, ' ');
        return (nm && t.indexOf(nm) !== -1) || (idw && t.indexOf(idw) !== -1);
      }
      var matched = metrics.filter(refs);

      // Check 1 — impossible percentage on a capped metric (cannotExceed: 100)
      var pcts = (t.match(/(\d+(?:\.\d+)?)\s*%/g) || []).map(parseFloat);
      var maxPct = pcts.length ? Math.max.apply(null, pcts) : null;
      var cappedHit = matched.some(function (m) { return m.cannotExceed === 100; });
      if (maxPct !== null && maxPct > 100 && cappedHit) {
        res.issues.push({ code: 'impossible_percentage', severity: 'critical',
          message: 'Target ' + maxPct + '% exceeds the 100% ceiling of a capped metric — mathematically impossible.' });
        res.smartOverrides.A = false;
      }

      // Check 2 — compound KPI: two or more distinct primary metrics in one line
      if (matched.length >= 2) {
        res.issues.push({ code: 'compound_kpi', severity: 'critical',
          message: 'This KPI combines ' + matched.length + ' distinct metrics (' +
            matched.map(function (m) { return m.name; }).join(', ') + ') — split into separate KPIs.' });
        res.smartOverrides.S = false;
      }

      // Check 3 — unrealistic vs the approved default for the metric
      var defaults = {};
      Object.keys(pack.levels || {}).forEach(function (lk) {
        (pack.levels[lk].kpiPackage || []).forEach(function (k) {
          if (k.targetBasis === 'approved_default' && k.defaultTarget) {
            var n = parseFloat(String(k.defaultTarget).replace(/[^0-9.]/g, ''));
            if (!isNaN(n)) defaults[k.metricId] = n;
          }
        });
      });
      matched.forEach(function (m) {
        var def = defaults[m.metricId];
        if (def == null || m.direction !== 'higher_is_better') return;
        var nums = (t.replace(/\b(19|20)\d{2}\b/g, ' ').match(/\d+(?:\.\d+)?/g) || []).map(parseFloat).filter(function (n) { return n > 0; });
        if (!nums.length) return;
        var big = Math.max.apply(null, nums);
        if (big <= def * 3) return;
        var critical = big >= def * 5;
        res.issues.push({ code: 'unrealistic_vs_baseline', severity: critical ? 'critical' : 'warning',
          message: 'Target (' + big + ') is far above the approved norm (' + def + ') for ' + m.name + ' — verify feasibility vs capacity.' });
        if (critical) res.smartOverrides.A = false;
      });

      return res;
    },

    /* Provider-INDEPENDENT scope guard for a single generated/inline suggestion.
       Reuses validate()'s function-fit (domain classifier). Returns a warning
       string when the suggestion is out of the function's scope, else ''. */
    scopeWarning: function (text, fnKey) {
      if (!text) return '';
      var A = KABi.Agents && KABi.Agents.kpiArchitect;
      if (!A || typeof A.validate !== 'function') return '';
      try {
        var r = A.validate(String(text), fnKey, []);
        if (r && r.functionFit && r.functionFit.ok === false) {
          return '⚠ Out of scope for this function — belongs to another function; review before using.';
        }
      } catch (_) {}
      return '';
    },

    /* Provider-INDEPENDENT pre-submit gate over the whole 4-KPI set.
       Catches near-duplicates and out-of-scope KPIs even when the LLM/mock
       coherence check misses them. Returns an array of issue objects
       {code, severity, message} to merge into the coherence result. */
    presubmitChecks: function (kpis, fnKey) {
      var out = [];
      var A = KABi.Agents && KABi.Agents.kpiArchitect;
      if (!A || typeof A.validate !== 'function' || !Array.isArray(kpis)) return out;
      var texts = kpis.map(function (k) { return typeof k === 'string' ? k : (k && k.text) || ''; });

      // Duplicates — explicit PAIRWISE comparison so the KPI indices are exact
      // (validate()'s matchedKpiIndex is relative to the siblings array passed in,
      //  so we compare one pair at a time to keep the mapping correct).
      for (var i = 0; i < texts.length; i++) {
        if (!texts[i] || !texts[i].trim()) continue;
        for (var j = i + 1; j < texts.length; j++) {
          if (!texts[j] || !texts[j].trim()) continue;
          var rp;
          try { rp = A.validate(texts[i], fnKey, [texts[j]]); } catch (_) { continue; }
          if (rp.duplicate && (rp.duplicate.severity === 'high' || rp.duplicate.similarity >= 0.85)) {
            out.push({ code: 'set_duplicate', severity: 'critical',
              title: 'Near-duplicate KPI',
              description: 'KPI ' + (i + 1) + ' and KPI ' + (j + 1) + ' measure the same thing (~' +
                Math.round((rp.duplicate.similarity || 0.9) * 100) + '% similar).',
              suggestion: 'Remove one, or re-angle it (e.g. swap an activity KPI for an outcome KPI).',
              kpisInvolved: [i, j] });
          }
        }
      }

      // Out-of-scope — one pass per KPI
      texts.forEach(function (t, i) {
        if (!t || !t.trim()) return;
        var rs;
        try { rs = A.validate(t, fnKey, []); } catch (_) { return; }
        if (rs.functionFit && rs.functionFit.ok === false) {
          out.push({ code: 'out_of_scope', severity: 'critical',
            title: 'Out of function scope',
            description: 'KPI ' + (i + 1) + ' falls outside this function’s scope — it belongs to another function.',
            suggestion: 'Replace it with a KPI this role actually owns.',
            kpisInvolved: [i] });
        }
      });
      return out;
    },

    /* Builds an enriched context block injected into a prompt.
       mode: 'generate' | 'coherence'
       opts may carry { level: 'officer'|'specialist'|'lead'|'manager' } */
    buildPromptContext: function (fnKey, opts, lang, mode) {
      opts = opts || {}; mode = mode || 'generate';
      var pack = KABi.KpiKnowledgeBase[fnKey];
      if (!_hasPack(pack)) return '';
      var ar = (lang === 'ar');
      var L = [];
      var H = function (en, arr) { L.push(''); L.push('── ' + (ar ? arr : en) + ' ──'); };

      // Mandate + boundaries (both modes)
      if (_isReal(pack.mandate)) { H('FUNCTION MANDATE', 'مهمة الوظيفة'); L.push(pack.mandate); }
      if (_isReal(pack.scopeIn))  { H('IN SCOPE (this role owns)', 'ضمن النطاق (يملكها هذا الدور)'); pack.scopeIn.forEach(function (s) { L.push('• ' + s); }); }
      if (_isReal(pack.scopeOut)) { H('OUT OF SCOPE (belongs to other functions — reject KPIs here)', 'خارج النطاق (لوظائف أخرى — ارفض مؤشرات هنا)'); pack.scopeOut.forEach(function (s) { L.push('• ' + s); }); }

      // Approved library (both modes). Prefer the v69 Enterprise KPI Library
      // (rich, level-specific: SMART template + formula + coverage category) keyed
      // to the target tier. Fall back to the older thin pack.library if absent.
      var _tier = opts.level || (typeof window !== 'undefined' && window._kpiSelectedLevel && window._kpiSelectedLevel[fnKey]) || '';
      if (typeof window !== 'undefined' && window.KABi && KABi.KpiLibrary && KABi.KpiLibrary.has(fnKey)) {
        var _libKpis = KABi.KpiLibrary.get(fnKey, _tier || 'Entry');
        if (_libKpis && _libKpis.length) {
          H('APPROVED KPI LIBRARY' + (_tier ? ' — level: ' + _tier : '') + ' (AUTHORITATIVE — build the 4 KPIs from these metrics; keep {TARGET}/{PERIOD} placeholders for the manager)',
            'مكتبة المؤشرات المعتمدة' + (_tier ? ' — المستوى: ' + _tier : '') + ' (المصدر الأساسي — ابنِ المؤشرات الأربعة من هذه المقاييس؛ أبقِ {TARGET}/{PERIOD} للمدير)');
          _libKpis.forEach(function (k, i) {
            L.push((i + 1) + '. [' + k.cat + ' / ' + k.rec + '] ' + k.name);
            L.push('   ' + k.smart);
            L.push('   formula: ' + k.formula + '  ·  unit ' + k.unit + '  ·  ' + k.dir + '  ·  ' + k.cadence + '  ·  source: ' + k.source);
          });
        }
      } else if (_isReal(pack.library)) {
        H('APPROVED KPI LIBRARY (reference for wording — NOT a template to copy wholesale)',
          'مكتبة المؤشرات المعتمدة (مرجع للصياغة فقط — ليست قالبًا يُنسخ كما هو)');
        pack.library.forEach(function (k, i) { L.push((i + 1) + '. ' + k.text); });
      }

      if (mode === 'generate') {
        // v69: evaluation cycle + target phasing — make targets/deadlines period-appropriate.
        if (typeof window !== 'undefined' && window.kabiEvalPeriod) {
          var _period = window.kabiEvalPeriod();
          var _freq = window.kabiEvalFreq ? window.kabiEvalFreq() : '';
          H('EVALUATION CYCLE — target phasing', 'دورة التقييم — مواءمة الأهداف');
          L.push((ar ? 'الفترة الحالية: ' : 'Current period: ') + _period + (_freq ? ' (' + _freq + ')' : ''));
          L.push(ar
            ? 'إلزامي: اجعل كل {PERIOD} = هذه الفترة، والموعد النهائي = نهايتها. واءم حجم الهدف مع الفترة — المقاييس التراكمية (إيراد، عدد صفقات، قيمة pipeline) تُحسب لهذه الفترة فقط (هدف ربعي ≠ سنوي)؛ مقاييس النِّسب/المعدلات (%، ratio، دقة، معدل) يبقى حدّها كما هو مهما كان طول الفترة. لا تضع رقمًا سنويًا على دورة ربعية.'
            : 'MANDATORY: set every {PERIOD} to THIS period and the deadline to its end. Size the target to the period — cumulative metrics (revenue, deal count, pipeline value) count ONLY within this period (a quarterly target ≠ an annual one); rate/ratio metrics (%, ratio, accuracy) keep the same threshold regardless of period length. Never put an annual number on a quarterly cycle.');
        }
        // Metric dictionary (compact — only metrics with a real formula)
        if (_isReal(pack.metrics)) {
          H('METRIC DICTIONARY (respect these formulas & bounds)', 'قاموس المقاييس (التزم بالصيغ والحدود)');
          pack.metrics.forEach(function (m) {
            if (!_isReal(m.formula)) return;
            var b = [];
            if (m.cannotExceed != null) b.push('cannot exceed ' + m.cannotExceed);
            if (m.unit) b.push('unit ' + m.unit);
            if (m.direction) b.push(m.direction);
            L.push('• ' + m.name + ' = ' + m.formula + (b.length ? '  [' + b.join(', ') + ']' : ''));
          });
        }
        // Level package(s)
        if (_isReal(pack.levels)) {
          var lvKeys = opts.level && pack.levels[opts.level] ? [opts.level] : Object.keys(pack.levels);
          H('LEVEL-SPECIFIC KPI PACKAGE (assign the right KPIs to the right level)',
            'حزمة المؤشرات حسب المستوى (اربط كل مؤشر بالمستوى الصحيح)');
          lvKeys.forEach(function (lk) {
            var lv = pack.levels[lk];
            L.push((ar ? '» المستوى: ' : '» Level: ') + (ar ? lv.titleAr : lv.titleEn) + ' — ' + lv.focus);
            (lv.kpiPackage || []).forEach(function (k) {
              var tgt = k.targetBasis === 'approved_default' && _isReal(k.defaultTarget)
                ? (ar ? 'هدف معتمد: ' : 'approved target: ') + k.defaultTarget
                : k.targetBasis === 'needs_data'
                  ? (ar ? 'الهدف يحتاج بيانات غير مربوطة' : 'target needs data not yet connected')
                  : (ar ? 'اشتق الهدف من الأساس الحقيقي' : 'derive target from the real baseline');
              L.push('   - ' + k.text + '  (' + tgt + ')');
            });
          });
        }
        // Coverage balance — the #1 reason a generated set gets rejected by the
        // governance/coherence layer. The approved library is activity-heavy, so
        // force at least one real OUTCOME KPI and cap pure-activity KPIs.
        if (_isReal(pack.coverageProfile)) {
          H('REQUIRED COVERAGE BALANCE (an independent governance layer WILL REJECT an unbalanced, activity-only set)',
            'التوازن المطلوب (طبقة حوكمة مستقلة سترفض حزمة غير متوازنة كلها نشاط)');
          Object.keys(pack.coverageProfile).forEach(function (cat) {
            var r = pack.coverageProfile[cat];
            L.push('• ' + cat + ': ' + r.min + '–' + r.max);
          });
          L.push(ar
            ? 'إلزامي: ضمِّن مؤشر نتيجة واحدًا على الأقل (إيراد جديد / قيمة pipeline / معدل فوز / معدل تحويل) من قاموس المقاييس. لا تُنتج 4 مؤشرات نشاط (متابعات، عروض، تسجيل CRM، مقترحات) — النشاط يُحتسب "process" وله حد أقصى. النتائج (outcome) تتفوّق دائمًا على النشاط.'
            : 'MANDATORY: include at least ONE outcome KPI (new revenue / pipeline value / win rate / conversion rate) drawn from the metric dictionary. Do NOT return 4 activity KPIs (follow-ups, demos, CRM logging, proposals) — activity counts as "process" and is capped by the mix above. Outcomes always beat activity counts.');
        }
        // Data sources + the golden rule
        if (_isReal(pack.dataSources)) {
          H('CONNECTED DATA SOURCES', 'مصادر البيانات المربوطة');
          pack.dataSources.forEach(function (d) { L.push('• ' + d.system + ' [' + d.status + '] fields: ' + (d.availableFields || []).join(', ')); });
        }
        L.push('');
        L.push(ar
          ? 'قاعدة صارمة: إذا لم يكن للمؤشر مصدر بيانات مربوط، لا تخترع هدفاً — علّمه غير قابل للقياس. اشتق كل الأهداف من الأساس الحقيقي، لا من التخمين.'
          : 'STRICT RULE: if a KPI has no connected data source, do NOT invent a target — mark it unmeasurable. Derive every target from the real baseline, never from a guess.');
      }

      if (mode === 'coherence') {
        if (_isReal(pack.conflictRules)) {
          H('KNOWN CONFLICT / TRADE-OFF RULES', 'قواعد التعارض والمفاضلة المعروفة');
          pack.conflictRules.forEach(function (c) {
            L.push('• ' + c.metricA + ' vs ' + c.metricB + ' [' + c.relationship + '] — ' + c.risk + ' → ' + c.requiredControl);
          });
        }
        if (_isReal(pack.coverageProfile)) {
          H('REQUIRED COVERAGE MIX (judge the 4-KPI set against this)', 'التغطية المطلوبة (احكم على الحزمة وفقها)');
          Object.keys(pack.coverageProfile).forEach(function (cat) {
            var r = pack.coverageProfile[cat];
            L.push('• ' + cat + ': ' + r.min + '–' + r.max);
          });
        }
      }

      return L.join('\n');
    }
  };

  /* Merge PACKS into KpiKnowledgeBase without clobbering existing fields.
     NOTE: index.html assigns `KABi.KpiKnowledgeBase = {...}` during parse
     (index.html:31695). This file may load before that runs, so we DEFER the
     merge until the DOM is ready, and re-assert it if KpiKnowledgeBase is
     replaced. Idempotent — safe to run more than once. */
  function applyPacks() {
    KABi.KpiKnowledgeBase = KABi.KpiKnowledgeBase || {};
    Object.keys(PACKS).forEach(function (fnKey) {
      var existing = KABi.KpiKnowledgeBase[fnKey] || {};
      var pack = PACKS[fnKey];
      Object.keys(pack).forEach(function (field) { existing[field] = pack[field]; });
      KABi.KpiKnowledgeBase[fnKey] = existing;
    });
    console.log('[KPI Knowledge] Enriched level-aware packs merged for:', Object.keys(PACKS).join(', '));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyPacks);
  } else {
    applyPacks();
  }
  // Re-assert shortly after load in case another script rebuilt the base later.
  window.addEventListener('load', function () { setTimeout(applyPacks, 0); });

  // Expose for manual re-merge / testing from the console.
  KABi.KpiKnowledge.applyPacks = applyPacks;
})();
