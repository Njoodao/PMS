/* ============================================================================
 * 11_kabiEvalCopilotUI.js — UI glue for the Phase-2 Evaluation Copilot
 * ----------------------------------------------------------------------------
 * Provides a single self-contained entry point used by BOTH the manager
 * evaluation screen (per-employee) and the CEO performance screen (org/dept):
 *
 *   window.kabiRunEvalCopilot(payload)
 *
 * It shows its own modal overlay (works from any page), gates on a real API
 * key (never asks for it — points to AI Engine settings), calls
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
    // High-specificity + !important so the dark modal survives any page theme
    // (e.g. the light login theme) that sets background/color with !important.
    st.textContent = [
      '#' + OVERLAY_ID + '{color:#e8eefc}',
      '#' + OVERLAY_ID + ' #kabi-evalai-card{background:#0a1f52 !important;color:#e8eefc !important;border:1px solid rgba(0,194,224,.25) !important;border-radius:16px !important;max-width:760px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.5)}',
      '#' + OVERLAY_ID + ' #kabi-evalai-card h2{color:#fff !important}',
      '#' + OVERLAY_ID + ' #kabi-evalai-card *{box-sizing:border-box}'
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
    return '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px">'
      + '<div><div style="display:inline-flex;align-items:center;gap:6px;padding:2px 10px;border-radius:20px;font-size:9px;font-weight:800;letter-spacing:.4px;text-transform:uppercase;background:rgba(0,194,224,.12);color:#00c2e0;border:1px solid rgba(0,194,224,.2);margin-bottom:6px"><i class="ti ti-robot"></i> Evidence Copilot · Advisory</div>'
      + '<h2 style="font-size:16px;font-weight:900;color:#fff;margin:0">' + esc(title) + '</h2>'
      + (sub ? '<p style="font-size:10px;color:rgba(232,238,252,.55);margin-top:3px">' + esc(sub) + '</p>' : '')
      + '</div>'
      + '<button onclick="kabiCloseEvalCopilot()" style="padding:5px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.12);background:transparent;color:rgba(232,238,252,.6);font-size:11px;cursor:pointer;font-family:inherit"><i class="ti ti-x"></i></button>'
      + '</div>';
  };

  function spinner(title) {
    openModal(HEADER(title || 'Analyzing evidence…', 'Reading connected systems + files, then reasoning over the evidence.')
      + '<div style="display:flex;flex-direction:column;align-items:center;gap:12px;padding:34px 0">'
      + '<div style="width:34px;height:34px;border:3px solid rgba(0,194,224,.2);border-top-color:#00c2e0;border-radius:50%;animation:kabiSpin .8s linear infinite"></div>'
      + '<div style="font-size:11px;color:rgba(232,238,252,.6)">Gathering evidence and consulting the model…</div></div>'
      + '<style>@keyframes kabiSpin{to{transform:rotate(360deg)}}</style>');
  }

  function noKeyNotice() {
    openModal(HEADER('AI evaluation needs an API key', '')
      + '<div style="padding:16px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.25);border-radius:10px;font-size:12px;line-height:1.6;color:#fde68a">'
      + '<i class="ti ti-key"></i> No AI provider key is connected yet. Add your OpenRouter key in <strong>AI Engine settings</strong> (Super Admin → AI Engine). '
      + 'For security, keys are entered only inside the app — never shared here.</div>'
      + '<div style="margin-top:14px;text-align:right"><button onclick="kabiCloseEvalCopilot()" style="padding:7px 16px;border-radius:8px;border:none;background:#00c2e0;color:#03122e;font-size:11px;font-weight:800;cursor:pointer;font-family:inherit">Got it</button></div>');
  }

  function errNotice(msg) {
    openModal(HEADER('Could not complete the analysis', '')
      + '<div style="padding:16px;background:rgba(248,113,113,.08);border:1px solid rgba(248,113,113,.25);border-radius:10px;font-size:12px;line-height:1.6;color:#fca5a5">'
      + '<i class="ti ti-alert-triangle"></i> ' + esc(msg) + '</div>'
      + '<div style="margin-top:14px;text-align:right"><button onclick="kabiCloseEvalCopilot()" style="padding:7px 16px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:transparent;color:rgba(232,238,252,.7);font-size:11px;cursor:pointer;font-family:inherit">Close</button></div>');
  }

  // ── colour + label helpers for verdict chips ──
  function chip(text, color) {
    return '<span style="display:inline-block;padding:2px 9px;border-radius:12px;font-size:9px;font-weight:800;letter-spacing:.3px;background:' + color + '22;color:' + color + ';border:1px solid ' + color + '55">' + esc(text) + '</span>';
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
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">'
      + chip((r.overall_decision || 'n/a'), decisionColor(r.overall_decision))
      + confBadge(r.overall_evidence_confidence)
      + '<span style="font-size:9px;color:rgba(232,238,252,.5)">sources: ' + esc((r.evidence_sources || []).join(', ') || 'none') + '</span>'
      + '</div>';

    (r.kpi_results || []).forEach(function (k, i) {
      var statusCol = /BEHIND|BELOW|RISK/i.test(k.status || '') ? '#f87171' : /AHEAD|EXCEED|ON.?TRACK|MET/i.test(k.status || '') ? '#4ade80' : '#fbbf24';
      h += '<div style="padding:11px 13px;border:1px solid rgba(255,255,255,.07);border-radius:10px;margin-bottom:8px;background:rgba(255,255,255,.02)">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">'
        + '<div style="font-size:12px;font-weight:700;color:#fff;flex:1">' + esc(k.kpi || ('KPI ' + (i + 1))) + '</div>'
        + (k.status ? chip(k.status, statusCol) : '') + '</div>'
        + '<div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:7px;font-size:10px;color:rgba(232,238,252,.75)">'
        + (k.target != null ? '<span>Target: <strong>' + esc(k.target) + '</strong></span>' : '')
        + (k.actual_or_evidence != null ? '<span>Actual/evidence: <strong>' + esc(k.actual_or_evidence) + '</strong></span>' : '')
        + (k.attainment_percent_or_note != null ? '<span>Attainment: <strong>' + esc(k.attainment_percent_or_note) + '</strong></span>' : '')
        + (k.forecast ? '<span>Forecast: <strong>' + esc(k.forecast) + '</strong></span>' : '')
        + '</div>'
        + (k.rating_logicality ? '<div style="margin-top:7px">' + chip(k.rating_logicality, verdictColor(k.rating_logicality)) + (k.rating_reviewed != null ? '<span style="font-size:9px;color:rgba(232,238,252,.5);margin-left:6px">manager proposed: ' + esc(k.rating_reviewed) + '</span>' : '') + '</div>' : '')
        + (k.reasoning ? '<div style="font-size:10px;color:rgba(232,238,252,.6);margin-top:6px;line-height:1.5">' + esc(k.reasoning) + '</div>' : '')
        + (k.additional_evidence_required && String(k.additional_evidence_required).toLowerCase() !== 'none' ? '<div style="font-size:9px;color:#fbbf24;margin-top:5px"><i class="ti ti-search"></i> Needs: ' + esc(k.additional_evidence_required) + '</div>' : '')
        + '</div>';
    });

    h += listBlock('Manager actions', r.manager_actions_required, '#00c2e0', 'ti-checklist');
    h += listBlock('Data gaps', r.data_gaps, '#fbbf24', 'ti-database-off');
    if (r.portfolio_note) h += noteBlock('Note', r.portfolio_note);
    h += auditFooter(r, payload);
    openModal(h);
  }

  // ── render an ORG / DEPARTMENT result ──
  function renderOrg(r, payload) {
    var h = HEADER((payload.mode === 'MONITOR_DEPARTMENT' ? 'Department monitor · ' + (payload.dept || '') : 'Organization monitor'),
      (r.scope || (payload.mode === 'MONITOR_DEPARTMENT' ? payload.dept : 'Whole organization')) + ' · ' + (r.evaluation_period || ''));
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-bottom:12px">'
      + chip((r.overall_decision || 'n/a'), decisionColor(r.overall_decision))
      + confBadge(r.overall_evidence_confidence)
      + '<span style="font-size:9px;color:rgba(232,238,252,.5)">sources: ' + esc((r.evidence_sources || []).join(', ') || 'none') + '</span>'
      + '</div>';
    if (r.org_summary) h += noteBlock('Overall', r.org_summary);
    (r.department_insights || []).forEach(function (d) {
      var strengthCol = { strong: '#4ade80', partial: '#fbbf24', thin: '#f59e0b', none: '#94a3b8' }[String(d.strength || '').toLowerCase()] || '#94a3b8';
      h += '<div style="padding:11px 13px;border:1px solid rgba(255,255,255,.07);border-radius:10px;margin-bottom:8px;background:rgba(255,255,255,.02)">'
        + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:center">'
        + '<div style="font-size:12px;font-weight:700;color:#fff">' + esc(d.department || '—') + '</div>'
        + chip((d.evidence_available === false ? 'no evidence' : 'evidence: ' + (d.strength || 'n/a')), strengthCol) + '</div>'
        + (d.what_the_data_shows ? '<div style="font-size:10px;color:rgba(232,238,252,.75);margin-top:6px;line-height:1.5">' + esc(d.what_the_data_shows) + '</div>' : '')
        + (d.activity_vs_outcome ? '<div style="font-size:9px;color:rgba(232,238,252,.5);margin-top:5px"><i class="ti ti-arrows-split"></i> ' + esc(d.activity_vs_outcome) + '</div>' : '')
        + (d.data_gaps ? '<div style="font-size:9px;color:#fbbf24;margin-top:5px"><i class="ti ti-database-off"></i> ' + esc(d.data_gaps) + '</div>' : '')
        + (d.suggested_follow_up ? '<div style="font-size:9px;color:#00c2e0;margin-top:5px"><i class="ti ti-arrow-right"></i> ' + esc(d.suggested_follow_up) + '</div>' : '')
        + '</div>';
    });
    h += listBlock('Org data gaps', r.org_data_gaps, '#fbbf24', 'ti-database-off');
    h += listBlock('CEO follow-ups', r.ceo_follow_ups, '#00c2e0', 'ti-checklist');
    h += auditFooter(r, payload);
    openModal(h);
  }

  function listBlock(title, arr, color, icon) {
    if (!arr || !arr.length) return '';
    return '<div style="margin-top:10px"><div style="font-size:10px;font-weight:800;color:' + color + ';text-transform:uppercase;letter-spacing:.3px;margin-bottom:5px"><i class="ti ' + icon + '"></i> ' + esc(title) + '</div>'
      + '<ul style="margin:0;padding-left:18px;font-size:10px;color:rgba(232,238,252,.7);line-height:1.7">'
      + arr.map(function (x) { return '<li>' + esc(typeof x === 'string' ? x : JSON.stringify(x)) + '</li>'; }).join('')
      + '</ul></div>';
  }
  function noteBlock(title, text) {
    return '<div style="margin:8px 0;padding:10px 12px;background:rgba(0,194,224,.05);border-left:3px solid #00c2e0;border-radius:6px;font-size:11px;color:rgba(232,238,252,.8);line-height:1.55"><strong style="color:#00c2e0">' + esc(title) + ':</strong> ' + esc(text) + '</div>';
  }
  function auditFooter(r, payload) {
    var ev = r._evidence || {};
    var lim = (ev.limitations || []);
    return '<div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08);font-size:9px;color:rgba(232,238,252,.45);line-height:1.6">'
      + '<div><i class="ti ti-shield-check"></i> Advisory only — the manager and HR own the final decision. The model used only the connected evidence below; it did not invent data.</div>'
      + (lim.length ? '<div style="margin-top:5px;color:#fbbf24"><i class="ti ti-alert-triangle"></i> Evidence limitations: ' + esc(lim.join(' · ')) + '</div>' : '')
      + '<div style="margin-top:5px">Model: ' + esc(r._model || 'n/a') + ' · evidence sources: ' + esc((ev.sources || []).join(', ') || 'none') + '</div>'
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
      errNotice(String(e && e.message ? e.message : e));
    }
  };

  console.log('[EvalCopilotUI] loaded — window.kabiRunEvalCopilot ready');
})();
