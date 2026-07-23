/* ============================================================================
 * 11_kabiEvalCopilotUI.js — UI glue for the Phase-2 Evaluation Copilot
 * ----------------------------------------------------------------------------
 * Provides a single self-contained entry point used by BOTH the manager
 * evaluation screen (per-employee) and the CEO performance screen (org/dept):
 *
 *   window.kabiRunEvalCopilot(payload)
 *
 * It shows its own modal overlay (works from any page), FOLLOWS the app theme
 * (dark by default, light when <body> has .light-mode), gates on a real API key
 * (never asks for it — points to AI Engine settings), calls
 * KABi.EvalCopilot.run(), and renders the structured, advisory result.
 * Load after 10_kabiEvalCopilot.js.
 * ==========================================================================*/
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  var OVERLAY_ID = 'kabi-evalai-overlay';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function ensureStyle() {
    if (document.getElementById('kabi-evalai-style')) return;
    var st = document.createElement('style');
    st.id = 'kabi-evalai-style';
    // Theme-aware via CSS variables. Dark is the default; when the app is in
    // light mode (<body class="light-mode">) the variables flip to a light card.
    // !important on bg/color/border so it overrides any page-level theme rule
    // while still FOLLOWING the app theme through the variables.
    var S = '#' + OVERLAY_ID;
    var C = S + ' #kabi-evalai-card';
    st.textContent = [
      // dark defaults (scoped to the card)
      C + '{',
      '  --kc-bg:#0a1f52; --kc-fg:#e8eefc; --kc-fg-strong:#ffffff;',
      '  --kc-fg-mid:rgba(232,238,252,.82); --kc-fg-dim:rgba(232,238,252,.6);',
      '  --kc-border:rgba(255,255,255,.12); --kc-panel:rgba(255,255,255,.035);',
      '  --kc-panel-border:rgba(255,255,255,.09);',
      '  background:var(--kc-bg) !important; color:var(--kc-fg) !important;',
      '  border:1px solid rgba(0,194,224,.28) !important; border-radius:16px !important;',
      '  max-width:780px; width:100%; padding:24px; box-shadow:0 24px 64px rgba(0,0,0,.5);',
      '  font-size:14px; line-height:1.55;',
      '}',
      // light overrides
      'body.light-mode ' + C + '{',
      '  --kc-bg:#ffffff; --kc-fg:#1e293b; --kc-fg-strong:#0f172a;',
      '  --kc-fg-mid:rgba(15,23,42,.78); --kc-fg-dim:rgba(15,23,42,.55);',
      '  --kc-border:rgba(15,23,42,.12); --kc-panel:rgba(2,132,199,.05);',
      '  --kc-panel-border:rgba(15,23,42,.1);',
      '  box-shadow:0 24px 64px rgba(0,194,224,.16);',
      '}',
      C + ' h2{color:var(--kc-fg-strong) !important}',
      C + ' *{box-sizing:border-box}',
      S + '{color:var(--kc-fg)}'
    ].join('\n');
    document.head.appendChild(st);
  }

  function ensureOverlay() {
    ensureStyle();
    var ov = document.getElementById(OVERLAY_ID);
    if (ov) return ov;
    ov = document.createElement('div');
    ov.id = OVERLAY_ID;
    ov.style.cssText = 'display:none;position:fixed;inset:0;z-index:99999;background:rgba(4,12,32,.72);backdrop-filter:blur(4px);align-items:flex-start;justify-content:center;overflow-y:auto;padding:32px 16px';
    ov.innerHTML = '<div id="kabi-evalai-card" style="font-family:inherit"></div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) closeModal(); });
    document.body.appendChild(ov);
    return ov;
  }

  function openModal(html) {
    var ov = ensureOverlay();
    document.getElementById('kabi-evalai-card').innerHTML = html;
    ov.style.display = 'flex';
  }
  function closeModal() {
    var ov = document.getElementById(OVERLAY_ID);
    if (ov) ov.style.display = 'none';
  }
  window.kabiCloseEvalCopilot = closeModal;

  var HEADER = function (title, sub) {
    return '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px">'
      + '<div><div style="display:inline-flex;align-items:center;gap:6px;padding:3px 11px;border-radius:20px;font-size:11px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;background:rgba(0,194,224,.12);color:#00c2e0;border:1px solid rgba(0,194,224,.2);margin-bottom:8px"><i class="ti ti-sparkles"></i> Advisor Copilot</div>'
      + '<h2 style="font-size:20px;font-weight:900;margin:0;line-height:1.25">' + esc(title) + '</h2>'
      + (sub ? '<p style="font-size:13px;color:var(--kc-fg-dim);margin-top:5px">' + esc(sub) + '</p>' : '')
      + '</div>'
      + '<button onclick="kabiCloseEvalCopilot()" style="padding:6px 11px;border-radius:7px;border:1px solid var(--kc-border);background:transparent;color:var(--kc-fg-dim);font-size:15px;cursor:pointer;font-family:inherit;flex-shrink:0"><i class="ti ti-x"></i></button>'
      + '</div>';
  };

  function spinner(title) {
    openModal(HEADER(title || 'Analyzing evidence…', 'Reading connected systems + files, then reasoning over the evidence.')
      + '<div style="display:flex;flex-direction:column;align-items:center;gap:14px;padding:38px 0">'
      + '<div style="width:38px;height:38px;border:3px solid rgba(0,194,224,.2);border-top-color:#00c2e0;border-radius:50%;animation:kabiSpin .8s linear infinite"></div>'
      + '<div style="font-size:14px;color:var(--kc-fg-dim)">Gathering evidence and consulting the model…</div></div>'
      + '<style>@keyframes kabiSpin{to{transform:rotate(360deg)}}</style>');
  }

  function noKeyNotice() {
    openModal(HEADER('AI evaluation needs an API key', '')
      + '<div style="padding:18px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);border-radius:10px;font-size:14px;line-height:1.65;color:#b8860b">'
      + '<i class="ti ti-key"></i> No AI provider key is connected yet. Add your OpenRouter key in <strong>AI Engine settings</strong> (Super Admin → AI Engine). '
      + 'For security, keys are entered only inside the app — never shared here.</div>'
      + '<div style="margin-top:16px;text-align:right"><button onclick="kabiCloseEvalCopilot()" style="padding:9px 18px;border-radius:8px;border:none;background:#00c2e0;color:#03122e;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">Got it</button></div>');
  }

  function errNotice(msg, allowSubmitAnyway) {
    openModal(HEADER('Could not complete the analysis', '')
      + '<div style="padding:18px;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:10px;font-size:14px;line-height:1.65;color:#dc2626">'
      + '<i class="ti ti-alert-triangle"></i> ' + esc(msg) + '</div>'
      + '<div style="margin-top:16px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">'
      + '<button onclick="kabiCloseEvalCopilot()" style="padding:9px 18px;border-radius:8px;border:1px solid var(--kc-border);background:transparent;color:var(--kc-fg-mid);font-size:13px;cursor:pointer;font-family:inherit">Close</button>'
      // If this ran as a pre-submit gate and the AI failed, don't hard-block submission.
      + (allowSubmitAnyway ? '<button onclick="var f=window._kabiPreSubmitConfirm;window._kabiPreSubmitConfirm=null;kabiCloseEvalCopilot();if(f)f();" style="padding:9px 18px;border-radius:8px;border:none;background:linear-gradient(135deg,#12a17a,#0d9960);color:#fff;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">Submit anyway</button>' : '')
      + '</div>');
  }

  // ── colour + label helpers for verdict chips (semantic colours work on both themes) ──
  function chip(text, color) {
    return '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:800;letter-spacing:.3px;background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55">' + esc(text) + '</span>';
  }
  function verdictColor(v) {
    v = String(v || '').toUpperCase();
    if (v.indexOf('SUPPORTED') === 0 && v.indexOf('CAUTION') < 0) return '#4ade80';
    if (v.indexOf('POSSIBLY_HIGH') >= 0) return '#f87171';
    if (v.indexOf('POSSIBLY_LOW') >= 0) return '#fbbf24';
    if (v.indexOf('KPI_DESIGN') >= 0) return '#a78bfa';
    if (v.indexOf('CAUTION') >= 0) return '#fbbf24';
    return '#94a3b8';
  }
  function decisionColor(d) {
    d = String(d || '').toUpperCase();
    if (d.indexOf('SUPPORTS') >= 0 || d.indexOf('HEALTHY') >= 0) return '#4ade80';
    if (d.indexOf('REVIEW') >= 0 || d.indexOf('MIXED') >= 0) return '#fbbf24';
    return '#94a3b8';
  }
  function confBadge(c) {
    c = String(c || '').toLowerCase();
    var col = c === 'high' ? '#4ade80' : c === 'medium' ? '#fbbf24' : '#f87171';
    return chip('evidence: ' + (c || 'n/a'), col);
  }

  // ── render an INDIVIDUAL result (MONITOR_PERFORMANCE / REVIEW_MANAGER_RATING) ──
  function renderIndividual(r, payload) {
    var h = HEADER((payload.mode === 'REVIEW_MANAGER_RATING' ? 'Rating review · ' : 'Performance monitor · ') + (payload.empName || payload.email || ''),
      (r['function'] || payload.fnLabel || '') + ' · ' + (r.level || payload.level || '') + ' · ' + (r.evaluation_period || ''));
    // top strip
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px">'
      + chip((r.overall_decision || 'n/a'), decisionColor(r.overall_decision))
      + confBadge(r.overall_evidence_confidence)
      + '<span style="font-size:11px;color:var(--kc-fg-dim)">sources: ' + esc((r.evidence_sources || []).join(', ') || 'none') + '</span>'
      + '</div>';

    (r.kpi_results || []).forEach(function (k, i) {
      var statusCol = /BEHIND|BELOW|RISK/i.test(k.status || '') ? '#f87171' : /AHEAD|EXCEED|ON.?TRACK|MET/i.test(k.status || '') ? '#4ade80' : '#fbbf24';
      h += '<div style="padding:13px 15px;border:1px solid var(--kc-panel-border);border-radius:10px;margin-bottom:9px;background:var(--kc-panel)">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">'
        + '<div style="font-size:15px;font-weight:700;color:var(--kc-fg-strong);flex:1">' + esc(k.kpi || ('KPI ' + (i + 1))) + '</div>'
        + (k.status ? chip(k.status, statusCol) : '') + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:16px;margin-top:9px;font-size:13px;color:var(--kc-fg-mid)">'
        + (k.target != null ? '<span>Target: <strong>' + esc(k.target) + '</strong></span>' : '')
        + (k.actual_or_evidence != null ? '<span>Actual/evidence: <strong>' + esc(k.actual_or_evidence) + '</strong></span>' : '')
        + (k.attainment_percent_or_note != null ? '<span>Attainment: <strong>' + esc(k.attainment_percent_or_note) + '</strong></span>' : '')
        + (k.forecast ? '<span>Forecast: <strong>' + esc(k.forecast) + '</strong></span>' : '')
        + '</div>'
        + (k.rating_logicality ? '<div style="margin-top:9px">' + chip(k.rating_logicality, verdictColor(k.rating_logicality)) + (k.rating_reviewed != null ? '<span style="font-size:11px;color:var(--kc-fg-dim);margin-left:7px">manager proposed: ' + esc(k.rating_reviewed) + '</span>' : '') + '</div>' : '')
        + (k.reasoning ? '<div style="font-size:13px;color:var(--kc-fg-mid);margin-top:8px;line-height:1.55">' + esc(k.reasoning) + '</div>' : '')
        + (k.additional_evidence_required && String(k.additional_evidence_required).toLowerCase() !== 'none' ? '<div style="font-size:12px;color:#d97706;margin-top:6px"><i class="ti ti-search"></i> Needs: ' + esc(k.additional_evidence_required) + '</div>' : '')
        + '</div>';
    });

    h += listBlock('Manager actions', r.manager_actions_required, '#0891b2', 'ti-checklist');
    if (_hcSeesGaps()) h += listBlock('Data gaps', r.data_gaps, '#d97706', 'ti-database-off');
    if (r.portfolio_note) h += noteBlock('Note', r.portfolio_note);
    h += auditFooter(r, payload);
    // Pre-submission gate: the evaluator reviews this advisory BEFORE submitting.
    if (payload.preSubmit) h += preSubmitActions();
    openModal(h);
  }

  // Action row shown when the review runs as a pre-submission step: revise or submit.
  function preSubmitActions() {
    return '<div style="margin-top:18px;padding-top:16px;border-top:1px solid var(--kc-panel-border);display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap">'
      + '<button onclick="kabiCloseEvalCopilot()" style="padding:10px 18px;border-radius:9px;border:1px solid var(--kc-border);background:transparent;color:var(--kc-fg-mid);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit"><i class="ti ti-arrow-left"></i> Back to edit</button>'
      + '<button onclick="var f=window._kabiPreSubmitConfirm;window._kabiPreSubmitConfirm=null;kabiCloseEvalCopilot();if(f)f();" style="padding:10px 20px;border-radius:9px;border:none;background:linear-gradient(135deg,#12a17a,#0d9960);color:#fff;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit"><i class="ti ti-circle-check"></i> Confirm &amp; Submit</button>'
      + '</div>';
  }

  // ── render an ORG / DEPARTMENT result ──
  function renderOrg(r, payload) {
    var h = HEADER((payload.mode === 'MONITOR_DEPARTMENT' ? 'Department monitor · ' + (payload.dept || '') : 'Organization monitor'),
      (r.scope || (payload.mode === 'MONITOR_DEPARTMENT' ? payload.dept : 'Whole organization')) + ' · ' + (r.evaluation_period || ''));
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:14px">'
      + chip((r.overall_decision || 'n/a'), decisionColor(r.overall_decision))
      + confBadge(r.overall_evidence_confidence)
      + '<span style="font-size:11px;color:var(--kc-fg-dim)">sources: ' + esc((r.evidence_sources || []).join(', ') || 'none') + '</span>'
      + '</div>';
    if (r.org_summary) h += noteBlock('Overall', r.org_summary);
    (r.department_insights || []).forEach(function (d) {
      var strengthCol = { strong: '#4ade80', partial: '#fbbf24', thin: '#f59e0b', none: '#94a3b8' }[String(d.strength || '').toLowerCase()] || '#94a3b8';
      h += '<div style="padding:13px 15px;border:1px solid var(--kc-panel-border);border-radius:10px;margin-bottom:9px;background:var(--kc-panel)">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">'
        + '<div style="font-size:15px;font-weight:700;color:var(--kc-fg-strong)">' + esc(d.department || '—') + '</div>'
        + chip((d.evidence_available === false ? 'no evidence' : 'evidence: ' + (d.strength || 'n/a')), strengthCol) + '</div>'
        + (d.what_the_data_shows ? '<div style="font-size:13px;color:var(--kc-fg-mid);margin-top:7px;line-height:1.55">' + esc(d.what_the_data_shows) + '</div>' : '')
        + (d.activity_vs_outcome ? '<div style="font-size:12px;color:var(--kc-fg-dim);margin-top:6px"><i class="ti ti-arrows-split"></i> ' + esc(d.activity_vs_outcome) + '</div>' : '')
        + ((d.data_gaps && _hcSeesGaps()) ? '<div style="font-size:12px;color:#d97706;margin-top:6px"><i class="ti ti-database-off"></i> ' + esc(d.data_gaps) + '</div>' : '')
        + (d.suggested_follow_up ? '<div style="font-size:12px;color:#0891b2;margin-top:6px"><i class="ti ti-arrow-right"></i> ' + esc(d.suggested_follow_up) + '</div>' : '')
        + '</div>';
    });
    if (_hcSeesGaps()) h += listBlock('Org data gaps', r.org_data_gaps, '#d97706', 'ti-database-off');
    h += listBlock('CEO follow-ups', r.ceo_follow_ups, '#0891b2', 'ti-checklist');
    h += auditFooter(r, payload);
    openModal(h);
  }

  // v81: "Data gaps" are HC-only. Connecting data sources is Human Capital's
  // responsibility (Settings → Connectors), so managers, employees and the CEO must
  // never see data-gap notes in the Advisor Copilot — only the super-admin (HC) view.
  function _hcSeesGaps() { try { return !!(window.me && window.me.role === 'pm_super_admin'); } catch (e) { return false; } }

  function listBlock(title, arr, color, icon) {
    if (!arr || !arr.length) return '';
    return '<div style="margin-top:12px"><div style="font-size:12px;font-weight:800;color:' + color + ';text-transform:uppercase;letter-spacing:.3px;margin-bottom:6px"><i class="ti ' + icon + '"></i> ' + esc(title) + '</div>'
      + '<ul style="margin:0;padding-left:20px;font-size:13px;color:var(--kc-fg-mid);line-height:1.75">'
      + arr.map(function (x) { return '<li>' + esc(typeof x === 'string' ? x : JSON.stringify(x)) + '</li>'; }).join('')
      + '</ul></div>';
  }
  function noteBlock(title, text) {
    return '<div style="margin:10px 0;padding:12px 14px;background:rgba(0,194,224,.06);border-left:3px solid #00c2e0;border-radius:6px;font-size:14px;color:var(--kc-fg-mid);line-height:1.6"><strong style="color:#0891b2">' + esc(title) + ':</strong> ' + esc(text) + '</div>';
  }
  function auditFooter(r, payload) {
    var ev = r._evidence || {};
    var lim = (ev.limitations || []);
    return '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--kc-panel-border);font-size:11.5px;color:var(--kc-fg-dim);line-height:1.65">'
      + '<div><i class="ti ti-shield-check"></i> Advisory only — the manager and HR own the final decision. The model used only the connected evidence below; it did not invent data.</div>'
      + (lim.length ? '<div style="margin-top:6px;color:#d97706"><i class="ti ti-alert-triangle"></i> Evidence limitations: ' + esc(lim.join(' · ')) + '</div>' : '')
      + '<div style="margin-top:6px">Model: ' + esc(r._model || 'n/a') + ' · evidence sources: ' + esc((ev.sources || []).join(', ') || 'none') + '</div>'
      + '</div>';
  }

  /* Public entry point.
   * payload: passed straight to KABi.EvalCopilot.run(), plus optional display
   * hints: empName, fnLabel, dept. */
  window.kabiRunEvalCopilot = async function (payload) {
    payload = payload || {};
    if (!window.KABi || !window.KABi.EvalCopilot) { errNotice('Evaluation copilot is not loaded.'); return; }
    // gate on a real API key — never request it here
    var L = window.KABi.LLM;
    var hasKey = L && ((typeof L.hasApiKey === 'function' && L.hasApiKey()) || (typeof L.activeProvider === 'function' && L.activeProvider() === 'real'));
    if (!hasKey) { noKeyNotice(); return; }
    spinner(payload.mode === 'MONITOR_ORG' ? 'Scanning the organization…' : payload.mode === 'MONITOR_DEPARTMENT' ? 'Scanning ' + (payload.dept || 'department') + '…' : 'Analyzing evidence…');
    try {
      var r = await window.KABi.EvalCopilot.run(payload);
      if (payload.mode === 'MONITOR_ORG' || payload.mode === 'MONITOR_DEPARTMENT') renderOrg(r, payload);
      else renderIndividual(r, payload);
    } catch (e) {
      errNotice(String(e && e.message ? e.message : e), !!payload.preSubmit);
    }
  };

  console.log('[EvalCopilotUI] loaded — window.kabiRunEvalCopilot ready (theme-aware)');
})();
