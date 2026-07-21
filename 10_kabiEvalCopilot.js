/* ============================================================================
 * 10_kabiEvalCopilot.js — KABi Performance Evidence & Evaluation Copilot (Phase 2)
 * ----------------------------------------------------------------------------
 * The SECOND agent. The KPI Architect (07/09) decides WHAT to measure; this
 * copilot answers: what is the ACTUAL evidence, is the employee on track, and is
 * the manager's proposed rating supported by the data?
 *
 * It is ADVISORY and NEUTRAL — it never makes the final rating/employment
 * decision, never invents baselines/targets/data, and reads REAL connector
 * evidence via window.kabiGatherEvidence(email, fnKey) (Pipedrive per-employee,
 * Jira + uploaded files/reports at function level).
 *
 * Pilot modes: MONITOR_PERFORMANCE + REVIEW_MANAGER_RATING.
 * Load after index.html + 09:  <script src="10_kabiEvalCopilot.js"></script>
 * ==========================================================================*/
(function () {
  'use strict';
  if (typeof window === 'undefined' || !window.KABi) {
    console.warn('[EvalCopilot] KABi namespace not found — load after index.html');
    return;
  }
  var KABi = window.KABi;

  function buildSystemPrompt(lang) {
    var en = [
      'You are the KABi Performance Evidence & Evaluation Copilot — a NEUTRAL, advisory agent.',
      '',
      'MISSION: bind each approved KPI to REAL evidence, compute actual vs expected performance,',
      'forecast end-of-period attainment, and judge whether a manager\'s proposed rating is',
      'supported by the evidence. You SUPPORT the manager and HC; you do NOT decide.',
      '',
      'NON-NEGOTIABLE RULES:',
      '- NEVER invent actual values, baselines, targets, or data. If evidence is missing, say',
      '  "Not provided — requires confirmation" and lower the confidence.',
      '- Use ONLY the evidence supplied (connector data + files) + the approved KPI definition.',
      '- Distinguish ACTIVITY (calls, tasks) from OUTPUT (accepted deliverable) from OUTCOME',
      '  (revenue, conversion, retention). Score what the KPI actually measures.',
      '- Respect the evaluation period: size expected progress to the cycle (quarterly ≠ annual);',
      '  do not divide an annual target blindly — use the KPI\'s cadence and the period.',
      '- Attribute evidence to the employee only when it is genuinely theirs (e.g. Pipedrive',
      '  ownerEmail). Function-level data (team Jira/files) is CONTEXT, not the individual\'s result.',
      '- Be fair and bias-free: never use tenure, presence, activity volume, or any protected',
      '  attribute as performance. A rating alert means "review needed", not "bias proven".',
      '- You do NOT make the final decision. Manager + HC own the rating.',
      '',
      'RATING LOGICALITY VERDICTS (for REVIEW_MANAGER_RATING):',
      '  SUPPORTED · SUPPORTED_WITH_CAUTION · POSSIBLY_HIGH · POSSIBLY_LOW ·',
      '  INSUFFICIENT_EVIDENCE · KPI_DESIGN_ISSUE',
      'Explain neutrally: "The proposed rating appears higher/lower than the evidence indicates',
      'because ..." — cite the actual number vs target and the evidence confidence.',
      '',
      'OUTPUT: STRICT JSON only, matching the schema in the user message. No prose outside JSON.',
      'BE CONCISE: keep every string field to 1–2 short sentences so the JSON is never truncated. Do not repeat the evidence verbatim.'
    ].join('\n');
    var ar = [
      'أنت مساعد KABi للأدلة والتقييم — وكيل محايد واستشاري.',
      '',
      'المهمة: اربط كل KPI معتمد بأدلة حقيقية، احسب الأداء الفعلي مقابل المتوقع، توقّع نتيجة نهاية الفترة،',
      'واحكم هل تقييم المدير المقترح مدعوم بالأدلة. أنت تدعم المدير وHC، ولا تقرر.',
      '',
      'قواعد غير قابلة للتفاوض:',
      '- لا تخترع أرقامًا فعلية أو خطوط أساس أو أهدافًا. عند غياب الدليل قل "غير متوفر — يحتاج تأكيدًا" واخفض الثقة.',
      '- استخدم الأدلة المزوّدة فقط (بيانات الكونكترز + الملفات) + تعريف الـKPI المعتمد.',
      '- فرّق بين النشاط والمخرَج والنتيجة، وقيّم ما يقيسه الـKPI فعلًا.',
      '- راعِ فترة التقييم: قِس التقدّم المتوقع حسب الدورة (ربعي ≠ سنوي)، ولا تقسم الهدف السنوي بشكل أعمى.',
      '- انسب الدليل للموظف فقط عندما يكون فعلًا له (مثل ownerEmail في Pipedrive). البيانات على مستوى الوظيفة سياق لا نتيجة فردية.',
      '- كن عادلًا بلا تحيّز: لا تستخدم الأقدمية أو الحضور أو حجم النشاط أو أي سمة محمية كأداء. التنبيه يعني "يحتاج مراجعة" لا "ثبت التحيّز".',
      '- لا تتخذ القرار النهائي. المدير وHC يملكانه.',
      '',
      'أحكام منطقية التقييم: SUPPORTED · SUPPORTED_WITH_CAUTION · POSSIBLY_HIGH · POSSIBLY_LOW · INSUFFICIENT_EVIDENCE · KPI_DESIGN_ISSUE.',
      'اشرح بحياد مع ذكر الرقم الفعلي مقابل الهدف ومستوى ثقة الدليل.',
      '',
      'المخرج: JSON صارم فقط مطابق للمخطط في رسالة المستخدم. لا نص خارج JSON.',
      'كن موجزًا: اجعل كل حقل نصي جملة أو جملتين قصيرتين حتى لا يُقتطع JSON. لا تكرّر الأدلة حرفيًا.'
    ].join('\n');
    return lang === 'ar' ? ar : en;
  }

  var OUTPUT_SCHEMA = {
    mode: '', employee_email: '', function: '', level: '', evaluation_period: '',
    evidence_sources: [], overall_evidence_confidence: 'high|medium|low|insufficient',
    kpi_results: [/* { kpi, target, actual_or_evidence, attainment_percent_or_note, status,
                       forecast, evidence_confidence, rating_reviewed, rating_logicality,
                       reasoning, additional_evidence_required } */],
    portfolio_note: '', manager_actions_required: [], data_gaps: [],
    overall_decision: 'EVIDENCE_SUPPORTS | REVIEW_REQUIRED | ADDITIONAL_EVIDENCE_REQUIRED | NOT_ASSESSABLE',
    assumptions: []
  };

  var ORG_OUTPUT_SCHEMA = {
    mode: '', scope: '', evaluation_period: '', evidence_sources: [],
    overall_evidence_confidence: 'high|medium|low|insufficient',
    org_summary: '',
    department_insights: [/* { department, evidence_available:true|false, what_the_data_shows,
                             activity_vs_outcome, strength:'strong|partial|thin|none', data_gaps, suggested_follow_up } */],
    org_data_gaps: [], ceo_follow_ups: [],
    overall_decision: 'HEALTHY_SIGNAL | MIXED_SIGNAL | INSUFFICIENT_EVIDENCE',
    assumptions: []
  };

  var ORG_MODES = ['MONITOR_ORG', 'MONITOR_DEPARTMENT'];

  function buildOrgUserPrompt(payload, lang) {
    var ev = payload.evidence || {};
    var lines = [];
    lines.push('MODE: ' + payload.mode + (payload.mode === 'MONITOR_DEPARTMENT' ? ('  (department: ' + (payload.dept || '?') + ')') : '  (whole organization)'));
    lines.push('Evaluation period: ' + (payload.period || (window.kabiEvalPeriod ? window.kabiEvalPeriod() : 'not set')));
    lines.push('');
    lines.push('SCOPE: ' + (ev.level === 'dept' ? ('Department = ' + ev.dept) : 'Organization-wide') + '.');
    lines.push('You are giving the CEO a NEUTRAL, evidence-based read of performance across');
    lines.push('departments/functions. This is monitoring, NOT an individual evaluation — never');
    lines.push('name or rate a single employee here. Aggregate only.');
    lines.push('');
    lines.push('REAL EVIDENCE (from connected systems + files + submitted evaluations — do NOT invent):');
    lines.push('  sources: ' + (ev.sources && ev.sources.length ? ev.sources.join(', ') : 'none'));
    if (ev.org && ev.org.pipedrive) lines.push('  org sales (Pipedrive): ' + JSON.stringify(ev.org.pipedrive));
    if (ev.org && ev.org.evaluations) lines.push('  submitted evaluations (context): ' + JSON.stringify(ev.org.evaluations));
    if (ev.departments && Object.keys(ev.departments).length) {
      lines.push('  departments (connector rollup):');
      Object.keys(ev.departments).forEach(function (d) {
        var x = ev.departments[d];
        lines.push('    - ' + d + ': functions=' + (x.functions ? x.functions.length : 0) + ', jiraIssues=' + x.jiraIssues + ', jiraDone=' + x.jiraDone + ', files=' + x.files);
      });
    }
    if (ev.functions && ev.functions.length) {
      lines.push('  functions with evidence:');
      ev.functions.forEach(function (f) {
        lines.push('    - ' + f.name + ' [' + f.dept + ']: ' + (f.jira ? ('jira ' + f.jira.done + '/' + f.jira.totalIssues + ' done, ' + f.jira.peopleMatched + ' people') : 'no jira') + (f.files ? (', ' + f.files + ' file(s)') : ''));
      });
    }
    if (ev.limitations && ev.limitations.length) lines.push('  EVIDENCE LIMITATIONS: ' + ev.limitations.join(' | '));
    lines.push('');
    lines.push('TASK: Summarize, per department (and the org overall), what the CONNECTED evidence');
    lines.push('shows about delivery/output/outcomes for this period. Flag departments where evidence');
    lines.push('is strong vs. thin. Where there is NO connected evidence, say so explicitly and mark it');
    lines.push('as a data gap — do NOT infer performance from absence of data. Distinguish activity from');
    lines.push('outcome. Give the CEO neutral observations + suggested follow-ups, NOT verdicts on people.');
    lines.push('Return strict JSON in this shape:');
    lines.push(JSON.stringify(ORG_OUTPUT_SCHEMA));
    return lines.join('\n');
  }

  function buildUserPrompt(payload, lang) {
    if (ORG_MODES.indexOf(payload.mode) >= 0) return buildOrgUserPrompt(payload, lang);
    var ev = payload.evidence || {};
    var lines = [];
    lines.push('MODE: ' + payload.mode);
    lines.push('Evaluation period: ' + (payload.period || (window.kabiEvalPeriod ? window.kabiEvalPeriod() : 'not set')));
    lines.push('');
    lines.push('EMPLOYEE:');
    lines.push('  email: ' + (payload.email || '?') + '  · function: ' + (payload.fnKey || '?') + '  · level: ' + (payload.level || '?'));
    lines.push('');
    lines.push('APPROVED KPIs (assigned to this employee):');
    (payload.kpis || []).forEach(function (k, i) {
      lines.push('  ' + (i + 1) + '. ' + (typeof k === 'string' ? k : (k.text || JSON.stringify(k))) +
        (payload.proposedRatings && payload.proposedRatings[i] != null ? '   [manager proposed rating: ' + payload.proposedRatings[i] + ']' : ''));
    });
    lines.push('');
    lines.push('REAL EVIDENCE (from connected systems + files — do NOT invent beyond this):');
    lines.push('  sources: ' + (ev.sources && ev.sources.length ? ev.sources.join(', ') : 'none'));
    if (ev.employee && ev.employee.pipedrive) lines.push('  employee Pipedrive (per-person, ownerEmail): ' + JSON.stringify(ev.employee.pipedrive));
    if (ev.employee && ev.employee.jira) lines.push('  employee Jira (per-person, assignee): ' + JSON.stringify(ev.employee.jira));
    if (ev.functionLevel && ev.functionLevel.jira) lines.push('  function Jira (context, not individual): ' + JSON.stringify(ev.functionLevel.jira));
    if (ev.files && ev.files.length) {
      lines.push('  files (function-level context):');
      ev.files.forEach(function (f) { lines.push('    --- ' + f.name + ' [' + f.type + '] ---\n' + f.text); });
    }
    if (ev.limitations && ev.limitations.length) lines.push('  EVIDENCE LIMITATIONS: ' + ev.limitations.join(' | '));
    lines.push('');
    if (payload.approvedRatingScale) lines.push('Approved rating scale: ' + JSON.stringify(payload.approvedRatingScale));
    lines.push('');
    lines.push('TASK: For each KPI, bind it to the evidence above, compute actual-vs-target where the');
    lines.push('evidence allows (else state the gap), give status + forecast + evidence confidence.');
    if (payload.mode === 'REVIEW_MANAGER_RATING') {
      lines.push('For each proposed rating, judge logicality (SUPPORTED/POSSIBLY_HIGH/POSSIBLY_LOW/…) and explain neutrally.');
    }
    lines.push('Do NOT decide the final rating. Return strict JSON in this shape:');
    lines.push(JSON.stringify(OUTPUT_SCHEMA));
    return lines.join('\n');
  }

  /* Robust JSON parse for LLM output. Handles: ```json fences, leading/trailing
   * prose, and TRUNCATED responses (the model hit max_tokens mid-string) by
   * closing any open string + unbalanced brackets, then retrying. Returns the
   * parsed object, or throws if nothing usable can be recovered. */
  function _parseModelJson(text) {
    if (!text) throw new Error('empty model response');
    var s = String(text).replace(/```json/gi, '').replace(/```/g, '').trim();
    var start = s.indexOf('{');
    if (start > 0) s = s.slice(start);
    // 1) direct
    try { return JSON.parse(s); } catch (e) { /* continue */ }
    // 2) repair truncation — close open string + unbalanced {} []
    var inStr = false, esc = false, stack = [];
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (esc) { esc = false; continue; }
      if (c === '\\') { esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') stack.push(c === '{' ? '}' : ']');
      else if (c === '}' || c === ']') stack.pop();
    }
    var repaired = s + (inStr ? '"' : '');
    for (var j = stack.length - 1; j >= 0; j--) repaired += stack[j];
    try { return JSON.parse(repaired); } catch (e) { /* continue */ }
    // 3) drop a trailing incomplete property, then re-close
    var cut = s.replace(/,\s*("[^"]*"\s*:?\s*[^,{}\[\]]*)?$/, '');
    var inStr2 = false, esc2 = false, stack2 = [];
    for (var k = 0; k < cut.length; k++) {
      var ch = cut[k];
      if (esc2) { esc2 = false; continue; }
      if (ch === '\\') { esc2 = true; continue; }
      if (ch === '"') { inStr2 = !inStr2; continue; }
      if (inStr2) continue;
      if (ch === '{' || ch === '[') stack2.push(ch === '{' ? '}' : ']');
      else if (ch === '}' || ch === ']') stack2.pop();
    }
    var rep2 = cut + (inStr2 ? '"' : '');
    for (var m = stack2.length - 1; m >= 0; m--) rep2 += stack2[m];
    return JSON.parse(rep2); // final attempt — throws if still bad
  }

  KABi.EvalCopilot = {
    MODES: ['MONITOR_PERFORMANCE', 'REVIEW_MANAGER_RATING', 'MONITOR_ORG', 'MONITOR_DEPARTMENT'],

    gatherEvidence: function (email, fnKey) {
      return (typeof window.kabiGatherEvidence === 'function') ? window.kabiGatherEvidence(email, fnKey) : { sources: [], limitations: ['evidence gatherer unavailable'] };
    },
    gatherOrgEvidence: function (scope) {
      return (typeof window.kabiGatherOrgEvidence === 'function') ? window.kabiGatherOrgEvidence(scope) : { sources: [], limitations: ['org evidence gatherer unavailable'] };
    },

    /* payload:
     *   individual → { mode:'MONITOR_PERFORMANCE'|'REVIEW_MANAGER_RATING', email, fnKey, level, kpis:[], proposedRatings?, period?, approvedRatingScale?, language? }
     *   org/dept   → { mode:'MONITOR_ORG'|'MONITOR_DEPARTMENT', dept?, period?, language? }               */
    run: async function (payload) {
      if (!payload || !payload.mode) throw new Error('EvalCopilot.run: mode is required');
      if (this.MODES.indexOf(payload.mode) < 0) throw new Error('EvalCopilot.run: unknown mode ' + payload.mode);
      if (!window.KABi.LLM) throw new Error('EvalCopilot.run: KABi.LLM not loaded');
      var lang = payload.language || (document.body.classList.contains('rtl') ? 'ar' : 'en');
      if (payload.mode === 'MONITOR_ORG' || payload.mode === 'MONITOR_DEPARTMENT') {
        payload.evidence = this.gatherOrgEvidence({ level: payload.mode === 'MONITOR_DEPARTMENT' ? 'dept' : 'org', dept: payload.dept });
      } else {
        payload.evidence = this.gatherEvidence(payload.email, payload.fnKey);
      }

      var system = buildSystemPrompt(lang);
      var user = buildUserPrompt(payload, lang);
      // Generous token budget so the JSON isn't cut mid-string (the #1 cause of
      // "malformed JSON — unterminated string"). Org needs more (many depts).
      var isOrg = (payload.mode === 'MONITOR_ORG' || payload.mode === 'MONITOR_DEPARTMENT');
      var maxTok = isOrg ? 4096 : 3200;
      var llm, parsed, attempts = 0, lastErr = '';
      while (attempts < 2) {
        attempts++;
        // On a retry after a parse failure, ask for more room + brevity.
        var tok = attempts === 1 ? maxTok : Math.min(maxTok + 1500, 6000);
        try {
          llm = await KABi.LLM.call([{ role: 'user', content: user }], { systemPrompt: system, maxTokens: tok, temperature: 0.3 });
        } catch (e) {
          var m = String(e.message || e);
          if ((m.indexOf('AUTH_ERROR') > -1 || m.indexOf('COST_LIMIT') > -1 || m.indexOf('SESSION_LIMIT') > -1)) {
            try { if (m.indexOf('AUTH_ERROR') > -1 && KABi.LLM.clearApiKey) KABi.LLM.clearApiKey(); } catch (_) {}
            llm = await KABi.LLM.call([{ role: 'user', content: user }], { systemPrompt: system, maxTokens: tok, temperature: 0.3 });
          } else { throw new Error('EvalCopilot: LLM call failed — ' + m); }
        }
        try {
          parsed = (typeof parseLLMJsonResponse === 'function') ? parseLLMJsonResponse(llm.text) : _parseModelJson(llm.text);
          break;
        } catch (e) {
          lastErr = e.message;
          try { parsed = _parseModelJson(llm.text); break; } catch (e2) { lastErr = e2.message; }
          if (attempts >= 2) throw new Error('EvalCopilot: could not parse the model response (it may have been cut off). ' + lastErr);
        }
      }
      parsed._evidence = payload.evidence;   // attach raw evidence for the audit trail
      parsed._model = llm.model;
      return parsed;
    }
  };

  console.log('[EvalCopilot] Phase-2 evaluation copilot loaded (modes: MONITOR_PERFORMANCE, REVIEW_MANAGER_RATING, MONITOR_ORG, MONITOR_DEPARTMENT)');
})();
