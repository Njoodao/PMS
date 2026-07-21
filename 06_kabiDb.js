/**
 * KABi Portal — Client Integration Layer (kabiDb.js)
 * ===================================================
 * Bridge between the existing UI (which reads in-memory globals like
 * PE_EMPLOYEES, subs, PE_EVALS, INITIATIVES) and Supabase.
 *
 * Strategy:
 *   1. On login, preload the small reference tables into in-memory mirrors
 *      that the UI can read synchronously (matches current patterns).
 *   2. Mutations are async — return Promises. Update the mirror on success.
 *   3. Realtime subscriptions keep mirrors fresh across sessions.
 *
 * Usage:
 *   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
 *   <script src="06_kabiDb.js"></script>
 *   <script>
 *     kabiDb.init({
 *       url: 'https://xxxx.supabase.co',
 *       anonKey: 'eyJhbGci...',
 *     });
 *     await kabiDb.ready;
 *     await kabiDb.signIn(email, password);
 *     await kabiDb.loadMirror();      // pre-populates window.PE_EMPLOYEES etc.
 *     // — now the existing UI code runs unchanged —
 *   </script>
 */

(function () {
  'use strict';

  const { createClient } = window.supabase || {};
  if (!createClient) {
    console.error('[kabiDb] Supabase JS SDK not loaded. Include @supabase/supabase-js@2 first.');
    return;
  }

  const state = {
    supabase: null,
    session:  null,
    ready:    null,        // Promise resolved after init
    myEmp:    null,        // current employee row
    channels: [],          // Realtime subscriptions
    mirror: {              // synchronous mirrors used by the UI
      PE_EMPLOYEES:         [],
      FUNCTIONS:            {},
      KPI_LIBRARY:          {},   // { fnKey: { levelLabel: [ {sectionIndex, sectionTitle, kpi} ] } }
      subs:                 [],
      PE_EVALS:             {},
      INITIATIVES:          [],
      NOTIFICATIONS:        {},
      PE_CONFIG:            {},
      PE_EXTRA_MATRIX:      {},
      PE_INITIATIVE_TARGETS:{},
      CYCLES:               [],
      OPEN_CYCLE:           null,
    },
  };

  // ─── Level label mapping (DB enum ↔ JS label) ─────────────────────
  // v69: 5-level framework. New codes map to new labels; legacy 3-level codes are
  // still read (mapped to the nearest new label) so un-migrated Supabase rows load
  // cleanly during the transition — the in-app _peMigrateLevels() then finalizes by email.
  const levelDbToLabel = {
    entry:                  'Entry',
    intermediate:           'Intermediate',
    first_level_management: 'First-level management',
    advanced:               'Advanced',
    executive:              'Executive',
    // legacy → nearest new label (transition only)
    staff_level:    'Intermediate',
    management:     'First-level management',
    top_management: 'Advanced',
  };
  const levelLabelToDb = {
    'Entry':                  'entry',
    'Intermediate':           'intermediate',
    'First-level management': 'first_level_management',
    'Advanced':               'advanced',
    'Executive':              'executive',
  };

  // ─── Public API root ──────────────────────────────────────────────
  const kabiDb = {
    ready: null,

    /** Initialize the client. Call once on page load. */
    init({ url, anonKey }) {
      state.supabase = createClient(url, anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      state.ready = state.supabase.auth.getSession().then(({ data }) => {
        state.session = data.session;
        return state.session;
      });
      kabiDb.ready = state.ready;
      return state.ready;
    },

    /** Sign in with email + password. */
    async signIn(email, password) {
      const { data, error } = await state.supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      state.session = data.session;
      await kabiDb.loadMirror();

      // First-login check: force password change if flagged
      if (data.user?.user_metadata?.must_change_password === true) {
        await kabiDb._showFirstLoginModal();
      }

      // Onboarding tour — shown once per user AND only when the KABi
      // workspace is visible (not on the login page)
      if (data.user?.user_metadata?.tour_completed !== true) {
        kabiDb._waitForWorkspaceThenTour();
      }
      return data.session;
    },

    /** Return the tour steps for the current user's role. Each step
     *  includes a tabKey to navigate to and a description of what's there. */
    _getTourSteps() {
      // Use Supabase-loaded employee, or fall back to KABi's window.me
      // (allows tour to work whether or not user is signed in to Supabase)
      const kabiMe = (typeof window.me === 'object' && window.me) ? window.me : null;
      let sessEmail = null;
      try { sessEmail = sessionStorage.getItem('kabi_session_v66'); } catch (e) {}
      const supabaseEmail = state.session?.user?.email;
      const effectiveEmail = kabiMe?.email || sessEmail || supabaseEmail || state.myEmp?.email;

      // Lookup employee from KABi's localStorage
      let peLookup = null;
      if (effectiveEmail) {
        try {
          const raw = localStorage.getItem('kabi_pe_employees_v6715');
          if (raw) {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) {
              peLookup = arr.find(e => e.email?.toLowerCase() === effectiveEmail.toLowerCase());
            }
          }
        } catch (e) {}
      }

      // Lookup USER role from KABi's users localStorage (source of truth for role)
      // PE_EMPLOYEES does NOT store role — that's only in USERS.
      let userRole = null;
      if (effectiveEmail) {
        try {
          const rawU = localStorage.getItem('kabi_users_v2');
          if (rawU) {
            const arrU = JSON.parse(rawU);
            if (Array.isArray(arrU)) {
              const userRec = arrU.find(u => u.email?.toLowerCase() === effectiveEmail.toLowerCase());
              if (userRec) userRole = userRec.role;
            }
          }
        } catch (e) {}
      }

      // Determine role. Priority: active DOM page > userRole from USERS > kabiMe > peLookup
      // ACTIVE PAGE is the most reliable indicator of what tour to show.
      const pgHcActive = document.getElementById('pg-hc')?.classList.contains('active') === true;

      // Combine role sources — userRole is authoritative for HC/CEO
      const roleIsHC  = userRole === 'pm_super_admin' || userRole === 'hc_admin' || pgHcActive;
      const roleIsCEO = userRole === 'ceo' || userRole === 'ceo_exec';

      // Best name available
      const bestName = (state.myEmp?.name)
                    || (kabiMe?.name)
                    || (peLookup?.name)
                    || (state.session?.user?.user_metadata?.name)
                    || (effectiveEmail ? effectiveEmail.split('@')[0] : 'there');

      const emp = (state.myEmp || peLookup || kabiMe) ? {
        name: bestName,
        email: effectiveEmail,
        isHCAdmin: roleIsHC,
        isCEO: roleIsCEO,
        hasManagerPortal: (kabiMe?.role === 'manager') || (peLookup?.hasManagerPortal === true) || (userRole && !['employee', 'pm_super_admin', 'hc_admin', 'ceo', 'ceo_exec'].includes(userRole))
      } : effectiveEmail ? {
        name: bestName,
        email: effectiveEmail,
        isHCAdmin: roleIsHC,
        isCEO: roleIsCEO,
        hasManagerPortal: false
      } : null;
      const isHC       = emp?.isHCAdmin === true;
      const isCEO      = emp?.isCEO === true;
      // Only look for tabs INSIDE the currently active page — hidden pages
      // still have DOM but we shouldn't count their buttons.
      const activeSidebar = document.querySelector('.page.active .hc-side-nav') || document.body;
      const hasTeamTab = !!activeSidebar.querySelector(`button[onclick="empSwitchTab('team')"]`);
      const hasKpiTab  = !!activeSidebar.querySelector(`button[onclick="empSwitchTab('kpi')"]`);
      // Manager = has direct reports (from peLookup) — most authoritative signal.
      // Also require NOT-HC and NOT-CEO to prevent role collision.
      let mgrHasReports = false;
      if (peLookup && peLookup.email) {
        try {
          const rawE = localStorage.getItem('kabi_pe_employees_v6715');
          if (rawE) {
            const arrE = JSON.parse(rawE);
            mgrHasReports = arrE.some(e =>
              e.mgr?.toLowerCase() === peLookup.email.toLowerCase() && !e.isFormer
            );
          }
        } catch (e) {}
      }
      const isManager = !isHC && !isCEO && (mgrHasReports || (hasTeamTab && emp?.hasManagerPortal));

      const firstName = emp?.name?.split(' ')[0] || 'there';

      // ─── Employee tour (Staff with no sidebar) ───
      // Employees see only the dashboard content — no sidebar tabs to navigate.
      // For them we show a series of centered popups explaining sections.
      if (!isManager && !isCEO && !isHC) {
        // Employee tour — navigates section by section on the dashboard.
        // Conditional steps only appear when the section is actually rendered
        // (Well-being requires HC toggle; Initiatives requires target > 0).
        const findByText = (txt) => {
          const nodes = document.querySelectorAll('#emp-side-body h3, #emp-side-body h4, #emp-side-body h2');
          for (const n of nodes) {
            if (n.textContent && n.textContent.trim().toLowerCase().includes(txt.toLowerCase())) {
              return n.closest('div[style*="border-radius"], div[style*="background"]') || n.parentElement;
            }
          }
          return null;
        };

        const steps = [
          { targetSelector: null, icon: 'ti-mood-happy',
            title: `Welcome, ${firstName}!`,
            body: `Let me walk you through your KABi Employee Workspace — one section at a time.` },
          { targetSelector: '#emp-side-body > div:first-child', icon: 'ti-user',
            title: 'Your Profile Card',
            body: `At the top of your dashboard is your personal card — your name, role, department, function, and level. It also shows your Final Score once HC releases it. This is how KABi identifies you.` }
        ];

        // Well-being step — only if the section is visible on the page
        if (findByText('Well-being Check-in')) {
          steps.push({ targetSelector: 'wellbeing', icon: 'ti-heart',
            title: 'Well-being Check-in',
            body: `KABi's AI companion sends check-in messages, wellness tips, and gentle reminders throughout your workday. Everything here is designed to support your well-being.` });
        }

        // My KPI Framework — always shown
        steps.push({ targetSelector: 'kpi-framework', icon: 'ti-target',
          title: 'My KPI Framework',
          body: `Once your manager submits KPIs for your function and HC approves them, they'll appear here. This is what you'll be evaluated on for the current cycle.` });

        // Initiatives — only if section is visible
        if (findByText('Initiatives') || document.querySelector('button[onclick*="empShowInitiativeForm"]')) {
          steps.push({ targetSelector: 'initiatives', icon: 'ti-bulb',
            title: 'Submit Initiatives',
            body: `Have an idea to improve KABi, or completed a course/certification? Submit it as an initiative — academic or general. Your manager reviews first, then HC gives final approval.` });
        }

        steps.push({ targetSelector: null, icon: 'ti-confetti',
          title: `You're all set!`,
          body: `That's your dashboard tour. Explore freely — everything you need is on this page.` });

        return steps;
      }

      // ─── Manager tour (has sidebar) ───
      if (isManager) {
        const steps = [
          { tabKey: null, icon: 'ti-mood-happy', title: `Welcome, ${firstName}!`,
            body: `Let's take a quick tour of your Workspace. I'll walk you through each section of the sidebar.` },
          { tabKey: 'dashboard', icon: 'ti-home', title: 'Dashboard',
            body: `Your personal home. See your own profile at the top, your own KPIs, evaluation status, and any pending items. You'll also see a brief AI Insight — Your Team card here summarizing your team's key patterns at a glance.` },
          { tabKey: 'team', icon: 'ti-users', title: 'My Team',
            body: `Your direct reports live here. Send notes, schedule 1:1 meetings, and (during evaluation cycles) start their performance reviews. Team Initiatives (if applicable) from your reports also appear here for your approval.` }
        ];
        if (hasKpiTab) {
          steps.push({ tabKey: 'kpi', icon: 'ti-chart-bar', title: 'KPI Framework',
            body: `Propose up to 4 KPIs per level for each function you manage. HC reviews and approves them; the approved KPIs become the official measurement basis for the current cycle.` });
        }
        steps.push({ tabKey: 'eval', icon: 'ti-clipboard-list', title: 'Evaluate Team',
          body: `When evaluation cycle opens, score each direct report across KPIs, digital adoption, and initiatives. The AI Coach assists you, but the final call is yours.` });
        // AI Insights tab — labelled "AI Insight - Your Team" or "Dept & Team" for managers
        const insightsBtn = document.querySelector(`button[onclick="empSwitchTab('ai_insights')"]`);
        if (insightsBtn) {
          const label = insightsBtn.querySelector('.hc-side-label')?.textContent || 'AI Insight - Your Team';
          steps.push({ tabKey: 'ai_insights', icon: 'ti-bulb', title: label,
            body: `AI-generated insights about your direct-report team — performance patterns, KPI trends, coaching opportunities, and areas that may need your attention. All insights are grounded in real evaluation data, never mock or hallucinated.` });
        }
        steps.push({ tabKey: 'inviews', icon: 'ti-brain', title: 'Team INVIEWS',
          body: `When the INVIEWS assessment cycle is open, monitor your direct reports here — Technical and Behavioral tracks per person. See who has completed each track and open individual reports (with scores) once submitted. This tab only appears active when a cycle is running.` });
        steps.push({ tabKey: 'sent', icon: 'ti-mail', title: 'Sent Notifications',
          body: `A log of every note, appreciation message, and meeting invite you've sent. Perfect for tracking your team engagement history.` });
        steps.push({ tabKey: null, icon: 'ti-confetti', title: `You're all set!`,
          body: `You've seen the main features. Feel free to explore — you can always return to any tab from the sidebar. Have a productive cycle!` });
        return steps;
      }

      // ─── HC Admin tour — points to the 4 dashboard box cards ───
      // HC has NO direct reports and does NOT evaluate anyone. Their role is
      // oversight, approvals, configuration, and governance.
      if (isHC) {
        return [
          { targetSelector: null, icon: 'ti-mood-happy', title: `Welcome, ${firstName}!`,
            body: `You're signed in as HC Admin. Let me walk you through your PM Dashboard — you'll see each of your main areas as we go.` },
          { targetSelector: `.dash-box[onclick*="hcOpenSection('pe')"]`, icon: 'ti-clipboard-list',
            title: 'Performance Evaluation',
            body: `Configure evaluation cycles, weights, and scoring logic. Track manager progress, handle edit-request approvals, and release final scores to employees. HC sets up how evaluations run — but managers do the actual scoring.` },
          { targetSelector: `.dash-box[onclick*="hcOpenSection('kpi')"]`, icon: 'ti-target',
            title: 'KPI Framework',
            body: `Review KPI submissions from managers, approve or reject them. Manage the KPI library across all functions. Also where you manage users and their access permissions.` },
          { targetSelector: `.dash-box[onclick*="hcOpenSection('people')"]`, icon: 'ti-users',
            title: 'People & Access',
            body: `Manage employee records, add or remove accounts, configure access permissions, and reset passwords. Handles the entire employee lifecycle in one place.` },
          { targetSelector: `.dash-box[onclick*="hcOpenSection('ai_nudge')"]`, icon: 'ti-sparkles',
            title: 'AI Nudges',
            body: `Configure the AI well-being check-in templates and automated frequency. AI-generated coaching prompts help managers and employees stay engaged — all grounded in real data, never mock.` },
          { targetSelector: null, icon: 'ti-confetti', title: `You're all set!`,
            body: `You've seen your HC Admin toolkit. Tap into any box to explore its tools — a mini-guide will greet you inside each section. Welcome to your command center.` }
        ];
      }

      // ─── CEO tour — expanded with tab-by-tab navigation ───
      return [
        { tabKey: null, icon: 'ti-mood-happy', title: `Welcome, ${firstName}!`,
          body: `Let's take a quick tour of your Executive View at KABi.` },
        { tabKey: 'dashboard', icon: 'ti-home', title: 'CEO Dashboard',
          body: `Your executive home. See your own profile, high-level organization stats, and quick shortcuts to the executive KPI and Performance dashboards.` },
        { tabKey: 'kpi', icon: 'ti-target', title: 'KPI Framework',
          body: `View all KPIs across every department and function — you have full read access to the whole organization. Browse any function\'s KPIs, review the curated 173-KPI library, and add comments on any KPI to share your perspective with HC and function owners.` },
        { tabKey: 'exec_kpi_dashboard', icon: 'ti-chart-bar', title: 'KPI Dashboard',
          body: `Live view of KPI progress across the whole organization — filter by department, function, or level. See which KPIs are on track, at risk, or behind, cycle over cycle.` },
        { tabKey: 'exec_performance', icon: 'ti-trending-up', title: 'Performance Dashboard',
          body: `Organization-wide evaluation results — scores by department, level, location, and cycle. Trend lines show how the company evolves over time. Sourced from a live materialized view for instant loading.` },
        { tabKey: 'ai_insights', icon: 'ti-bulb', title: 'AI Insights',
          body: `Company-wide insights across ALL departments — not just direct reports. Patterns in performance, KPI health, retention risk, and coaching opportunities. Everything grounded in real evaluation data.` },
        { tabKey: null, icon: 'ti-confetti', title: `You're all set!`,
          body: `Welcome to the executive suite. Explore freely.` }
      ];
    },

        /** Wait until the KABi workspace (pg-employee or pg-home) is
     *  active (user navigated in), then show the tour. Prevents the tour
     *  from appearing on top of the login page. */
    _waitForWorkspaceThenTour() {
      let tries = 0;
      const maxTries = 60; // ~30 seconds
      const interval = setInterval(() => {
        tries++;
        const empPage = document.getElementById('pg-employee');
        const hcPage  = document.getElementById('pg-hc');
        const ceoPage = document.getElementById('pg-ceo');
        const anyActive =
             (empPage && empPage.classList.contains('active'))
          || (hcPage  && hcPage.classList.contains('active'))
          || (ceoPage && ceoPage.classList.contains('active'));
        if (anyActive) {
          clearInterval(interval);
          // Small extra delay so the sidebar has fully rendered
          setTimeout(() => kabiDb._showOnboardingTour(), 600);
        } else if (tries >= maxTries) {
          clearInterval(interval);
          console.info('[kabiDb] Tour skipped — user did not enter workspace within 30s');
        }
      }, 500);
    },

    /** Show the sequential onboarding tour. Called once per user. */
    _showOnboardingTour() {
      const steps = kabiDb._getTourSteps();
      if (!steps || steps.length === 0) return;

      // Track if we already added our stylesheet
      if (!document.getElementById('kabi-tour-styles')) {
        const style = document.createElement('style');
        style.id = 'kabi-tour-styles';
        style.textContent = `
          @keyframes kabi-tour-fade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes kabi-tour-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(0,194,224,0.7), 0 10px 28px rgba(0,194,224,0.35); } 50% { box-shadow: 0 0 0 12px rgba(0,194,224,0), 0 10px 28px rgba(0,194,224,0.5); } }
          .kabi-tour-highlight {
            position: relative;
            z-index: 999998 !important;
            animation: kabi-tour-pulse 1.8s ease-in-out infinite;
            outline: 3px solid rgba(0,194,224,0.7);
            outline-offset: 2px;
            border-radius: 8px;
          }
          #kabi-tour-bubble {
            position: fixed;
            background: #ffffff;
            color: #0f172a;
            border-radius: 16px;
            padding: 18px 20px 16px;
            max-width: min(340px, calc(100vw - 24px));
            width: max-content;
            min-width: min(280px, calc(100vw - 24px));
            max-height: calc(100vh - 24px);
            overflow-y: auto;
            box-sizing: border-box;
            box-shadow: 0 24px 48px rgba(19,56,176,0.18), 0 4px 12px rgba(0,0,0,0.06);
            border: 1px solid rgba(0,194,224,0.15);
            z-index: 999999;
            font-family: 'FSAlbert','Segoe UI',Calibri,Arial,sans-serif;
            animation: kabi-tour-fade 0.28s ease-out;
          }
          #kabi-tour-bubble.side::before {
            content: '';
            position: absolute;
            left: -9px;
            top: 24px;
            width: 0; height: 0;
            border-top: 9px solid transparent;
            border-bottom: 9px solid transparent;
            border-right: 10px solid #ffffff;
            filter: drop-shadow(-2px 0 2px rgba(19,56,176,0.05));
          }
          #kabi-tour-backdrop {
            position: fixed; inset: 0;
            background: rgba(15,25,55,0.10);
            backdrop-filter: none;
            z-index: 999997;
            animation: kabi-tour-fade 0.25s ease-out;
          }
        `;
        document.head.appendChild(style);
      }

      // Backdrop
      const backdrop = document.createElement('div');
      backdrop.id = 'kabi-tour-backdrop';
      document.body.appendChild(backdrop);

      // Bubble
      const bubble = document.createElement('div');
      bubble.id = 'kabi-tour-bubble';
      document.body.appendChild(bubble);

      let idx = 0;
      let highlightedEl = null;

      function positionBubble(tabEl) {
        if (tabEl) {
          const rect = tabEl.getBoundingClientRect();
          bubble.classList.add('side');
          // Position to the right of the sidebar tab
          const bubbleTop = Math.max(20, rect.top - 4);
          const bubbleLeft = rect.right + 18;
          bubble.style.top = bubbleTop + 'px';
          bubble.style.left = bubbleLeft + 'px';
          bubble.style.right = '';
          bubble.style.transform = '';
          // If it would go off-screen, position below the tab instead
          if (bubbleLeft + 340 > window.innerWidth) {
            bubble.classList.remove('side');
            bubble.style.top = (rect.bottom + 12) + 'px';
            bubble.style.left = Math.max(20, rect.left) + 'px';
          }
        } else {
          bubble.classList.remove('side');
          bubble.style.top = '50%';
          bubble.style.left = '50%';
          bubble.style.right = '';
          bubble.style.transform = 'translate(-50%, -50%)';
        }
      }

      function highlightTab(tabEl) {
        if (highlightedEl) highlightedEl.classList.remove('kabi-tour-highlight');
        if (tabEl) {
          tabEl.classList.add('kabi-tour-highlight');
          highlightedEl = tabEl;
        } else {
          highlightedEl = null;
        }
      }

      function render() {
        const step = steps[idx];

        // Navigate: tabKey triggers sidebar switch OR hcTab. targetSelector-only
        // steps don't trigger navigation (they just scroll to a section).
        if (step.tabKey) {
          if (step.tabKey.startsWith('hc-') && typeof window.hcTab === 'function') {
            try { window.hcTab(step.tabKey.substring(3)); } catch (e) {}
          } else if (typeof window.empSwitchTab === 'function') {
            try { window.empSwitchTab(step.tabKey); } catch (e) {}
          }
        }

        // Small delay to let DOM update
        setTimeout(() => {
          let tabEl = null;
          // v11: Support arbitrary DOM targets via targetSelector (Employee/HC section-based tour)
          if (step.targetSelector) {
            const sel = step.targetSelector;
            if (sel === 'wellbeing' || sel === 'kpi-framework' || sel === 'initiatives') {
              // Text-based fuzzy match for Employee sections
              const kw = sel === 'wellbeing' ? 'Well-being Check-in'
                       : sel === 'kpi-framework' ? 'My KPI Framework'
                       : 'Initiatives';
              const headings = document.querySelectorAll('#emp-side-body h1, #emp-side-body h2, #emp-side-body h3, #emp-side-body h4');
              for (const h of headings) {
                if (h.textContent && h.textContent.toLowerCase().includes(kw.toLowerCase())) {
                  tabEl = h.closest('div[style*="border-radius"]') || h.parentElement;
                  break;
                }
              }
            } else {
              tabEl = document.querySelector(sel);
            }
            // Scroll target into view
            if (tabEl && typeof tabEl.scrollIntoView === 'function') {
              try { tabEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
            }
          } else if (step.tabKey) {
            if (step.tabKey.startsWith('hc-')) {
              tabEl = document.getElementById('hc-tab-' + step.tabKey.substring(3));
            } else {
              tabEl = document.querySelector(`button[onclick="empSwitchTab('${step.tabKey}')"]`);
            }
          }

          highlightTab(tabEl);
          positionBubble(tabEl);

          // Render content
          const isFirst = idx === 0;
          const isLast = idx === steps.length - 1;
          const dots = steps.map((_, i) => {
            const active = i === idx;
            const past = i < idx;
            const color = active ? '#00c2e0' : (past ? 'rgba(0,194,224,0.5)' : '#e2e8f0');
            const size = active ? '9px' : '6px';
            return `<span style="display:inline-block;width:${size};height:${size};border-radius:50%;background:${color};transition:all 0.2s;"></span>`;
          }).join('');

          bubble.innerHTML = `
            <button id="kabi-tour-close" title="Skip tour" style="position:absolute;top:10px;right:10px;background:transparent;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1;font-family:inherit;">✕</button>
            <div style="font-size:34px;line-height:1;margin-bottom:10px;color:#00c2e0;"><i class="ti ${step.icon || 'ti-sparkles'}"></i></div>
            <h3 style="margin:0 0 6px;font-size:16px;font-weight:800;color:#0a1f52;letter-spacing:-0.01em;line-height:1.3;">${step.title || ''}</h3>
            <p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#475569;">${step.body || ''}</p>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
              <div style="display:flex;gap:4px;align-items:center;">${dots}</div>
              <div style="display:flex;gap:6px;">
                ${isFirst ? '' : `<button id="kabi-tour-back" style="padding:7px 12px;background:transparent;color:#64748b;border:1px solid #e2e8f0;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Back</button>`}
                <button id="kabi-tour-next" style="padding:7px 16px;background:linear-gradient(135deg,#00c2e0,#1338b0);color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.2px;box-shadow:0 3px 10px rgba(0,194,224,0.3);">${isLast ? 'Finish ✓' : 'Next →'}</button>
              </div>
            </div>
          `;

          // Bind handlers
          document.getElementById('kabi-tour-close').onclick = finish;
          document.getElementById('kabi-tour-next').onclick = () => {
            if (idx < steps.length - 1) { idx++; render(); } else finish();
          };
          const backBtn = document.getElementById('kabi-tour-back');
          if (backBtn) backBtn.onclick = () => { if (idx > 0) { idx--; render(); } };
          try { requestAnimationFrame(_clampTourBubble); } catch (e) {}
        }, step.tabKey ? 250 : 60);
      }

      async function finish() {
        highlightTab(null);
        backdrop.remove();
        bubble.remove();

        // Save to localStorage (works with or without Supabase auth)
        let email = window.me?.email || state.myEmp?.email || state.session?.user?.email;
        if (!email) {
          try { email = sessionStorage.getItem('kabi_session_v66'); } catch (e) {}
        }
        if (email) {
          localStorage.setItem('kabi_tour_completed_' + email.toLowerCase(), '1');
        }

        // Also sync to Supabase metadata if user is signed in via Supabase
        if (state.supabase && state.session) {
          try {
            await state.supabase.auth.updateUser({
              data: { tour_completed: true }
            });
            console.info('[kabiDb] Tour completed — flag saved to Supabase + localStorage');
          } catch (e) {
            console.info('[kabiDb] Tour completed — saved to localStorage only:', e.message);
          }
        } else {
          console.info('[kabiDb] Tour completed — saved to localStorage (Supabase not connected)');
        }
      }

      // Escape key = skip
      const onKey = (e) => { if (e.key === 'Escape') finish(); };
      document.addEventListener('keydown', onKey);
      const origFinish = finish;
      finish = async function() {
        document.removeEventListener('keydown', onKey);
        return origFinish();
      };

      render();
    },

        /** Check + prompt for password change if session says must_change_password */
    async checkFirstLogin() {
      const { data: { user } } = await state.supabase.auth.getUser();
      if (user?.user_metadata?.must_change_password === true) {
        await kabiDb._showFirstLoginModal();
      }
    },

    /** Renders a full-screen modal that forces a password change */
    _showFirstLoginModal() {
      return new Promise((resolve) => {
        // Guard: don't stack modals
        if (document.getElementById('kabi-first-login-modal')) return resolve();

        const modal = document.createElement('div');
        modal.id = 'kabi-first-login-modal';
        modal.innerHTML = `
          <div style="position:fixed;inset:0;background:rgba(240,243,250,0.85);backdrop-filter:blur(6px);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:'FSAlbert','Segoe UI',Calibri,Arial,sans-serif;">
            <div style="background:#ffffff;padding:32px 36px;border-radius:20px;max-width:440px;width:90%;color:#0f172a;box-shadow:0 30px 70px rgba(19,56,176,0.18),0 4px 12px rgba(0,0,0,0.06);border:1px solid rgba(0,194,224,0.12);">
              <div style="font-size:44px;margin-bottom:10px;line-height:1;color:#00c2e0;"><i class="ti ti-shield-check"></i></div>
              <h2 style="margin:0 0 6px;font-size:22px;font-weight:800;color:#0a1f52;letter-spacing:-0.01em;">Welcome to KABi</h2>
              <p style="margin:0 0 22px;font-size:13.5px;line-height:1.6;color:#475569;">This is your first login. Please set a new secure password to continue — required only once.</p>
              <label style="display:block;margin:0 0 6px;font-size:12.5px;font-weight:700;color:#334155;">New password</label>
              <input id="kabi-fl-pw1" type="password" placeholder="At least 8 characters" autocomplete="new-password" style="width:100%;padding:11px 14px;margin:0 0 14px;border-radius:10px;border:1.5px solid #e2e8f0;background:#f8fafc;color:#0f172a;font-size:14px;box-sizing:border-box;outline:none;transition:all 0.15s;font-family:inherit;" />
              <label style="display:block;margin:0 0 6px;font-size:12.5px;font-weight:700;color:#334155;">Confirm password</label>
              <input id="kabi-fl-pw2" type="password" placeholder="Repeat the same password" autocomplete="new-password" style="width:100%;padding:11px 14px;margin:0 0 12px;border-radius:10px;border:1.5px solid #e2e8f0;background:#f8fafc;color:#0f172a;font-size:14px;box-sizing:border-box;outline:none;transition:all 0.15s;font-family:inherit;" />
              <div id="kabi-fl-err" style="color:#dc2626;font-size:12.5px;margin:0 0 14px;min-height:18px;font-weight:600;"></div>
              <button id="kabi-fl-submit" style="width:100%;padding:13px;background:linear-gradient(135deg,#00c2e0,#1338b0);color:#fff;border:none;border-radius:10px;font-size:13.5px;font-weight:800;cursor:pointer;letter-spacing:0.3px;font-family:inherit;box-shadow:0 4px 14px rgba(0,194,224,0.35);transition:transform 0.1s;">Set password & continue</button>
              <div style="margin-top:14px;padding:9px 12px;background:linear-gradient(135deg,rgba(0,194,224,0.06),rgba(19,56,176,0.04));border:1px solid rgba(0,194,224,0.2);border-radius:8px;font-size:11.5px;color:#475569;line-height:1.55;"><i class="ti ti-info-circle" style="color:#00c2e0;margin-right:3px;"></i><strong style="color:#0a1f52">Tip:</strong> use a mix of letters, numbers and symbols. Store it somewhere safe.</div>
            </div>
          </div>`;

        document.body.appendChild(modal);
        const pw1 = document.getElementById('kabi-fl-pw1');
        const pw2 = document.getElementById('kabi-fl-pw2');
        const err = document.getElementById('kabi-fl-err');
        const btn = document.getElementById('kabi-fl-submit');
        pw1.focus();

        [pw1, pw2].forEach(el => {
          el.addEventListener('focus', () => { el.style.borderColor = '#00c2e0'; el.style.background = '#ffffff'; });
          el.addEventListener('blur',  () => { el.style.borderColor = '#e2e8f0'; el.style.background = '#f8fafc'; });
        });

        const submit = async () => {
          err.textContent = '';
          const p1 = pw1.value, p2 = pw2.value;
          if (p1.length < 8) { err.textContent = '⚠️ Password must be at least 8 characters'; pw1.focus(); return; }
          if (p1 !== p2)     { err.textContent = '⚠️ Passwords do not match'; pw2.focus(); return; }
          if (p1 === 'KabiWelcome2026!') { err.textContent = '⚠️ Please choose a different password from the temporary one'; pw1.focus(); return; }

          btn.disabled = true;
          btn.textContent = 'Saving…';
          btn.style.opacity = '0.7';

          try {
            const { error: updErr } = await state.supabase.auth.updateUser({
              password: p1,
              data: { must_change_password: false }
            });
            if (updErr) throw updErr;

            btn.textContent = '✓ Password updated';
            btn.style.background = 'linear-gradient(135deg,#10b981,#059669)';
            setTimeout(() => { modal.remove(); resolve(); }, 900);
          } catch (e) {
            err.textContent = '❌ ' + (e.message || 'Failed to update password');
            btn.disabled = false;
            btn.textContent = 'Set password & continue';
            btn.style.opacity = '1';
          }
        };

        btn.onclick = submit;
        pw2.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
        pw1.addEventListener('keydown', (e) => { if (e.key === 'Enter') pw2.focus(); });
      });
    },

    async signOut() {
      state.channels.forEach((ch) => state.supabase.removeChannel(ch));
      state.channels = [];
      await state.supabase.auth.signOut();
      state.session = null;
      state.myEmp = null;
    },

    /** Full mirror load — called after sign-in. Populates window globals. */
    async loadMirror() {
      const sb = state.supabase;

      // 1. Employees (RLS returns only what caller can see: self + reports + more)
      const { data: emps, error: empErr } = await sb
        .from('employees')
        .select('*');
      if (empErr) throw empErr;
      state.mirror.PE_EMPLOYEES = (emps || []).map(dbEmpToJs);
      window.PE_EMPLOYEES = state.mirror.PE_EMPLOYEES;

      // Identify self
      const { data: { user } } = await sb.auth.getUser();
      if (user) {
        state.myEmp = state.mirror.PE_EMPLOYEES.find((e) => e.auth_user_id === user.id) || null;
      }

      // 2. Functions
      const { data: fns } = await sb.from('functions').select('*');
      (fns || []).forEach((f) => { state.mirror.FUNCTIONS[f.key] = f; });
      window.FUNCTIONS = state.mirror.FUNCTIONS;

      // 3. KPI Library
      const { data: kpiLib } = await sb
        .from('kpi_library')
        .select('function_key, org_level, section_index, section_title, kpi_index, kpi_text')
        .order('section_index').order('kpi_index');
      const lib = {};
      (kpiLib || []).forEach((k) => {
        const level = levelDbToLabel[k.org_level];
        if (!lib[k.function_key]) lib[k.function_key] = {};
        if (!lib[k.function_key][level]) lib[k.function_key][level] = [];
        lib[k.function_key][level].push({
          sectionIndex: k.section_index,
          sectionTitle: k.section_title,
          kpi: k.kpi_text,
        });
      });
      state.mirror.KPI_LIBRARY = lib;
      window.KPI_LIBRARY = lib;

      // 4. Submissions (RLS scopes)
      const { data: subs } = await sb.from('kpi_submissions').select('*, kpi_submission_items(*)');
      state.mirror.subs = (subs || []).map(dbSubToJs);
      window.subs = state.mirror.subs;

      // 5. Evaluations
      const { data: evals } = await sb.from('evaluations').select('*');
      state.mirror.PE_EVALS = {};
      (evals || []).forEach((e) => {
        state.mirror.PE_EVALS[`${e.employee_id}_${e.cycle_key}`] = dbEvalToJs(e);
      });
      window.PE_EVALS = state.mirror.PE_EVALS;

      // 6. Initiatives
      const { data: inits } = await sb.from('initiatives').select('*');
      state.mirror.INITIATIVES = (inits || []).map(dbInitToJs);
      window.INITIATIVES = state.mirror.INITIATIVES;

      // 7. Notifications (for me only — RLS scopes)
      const { data: notifs } = await sb
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false });
      state.mirror.NOTIFICATIONS = {};
      (notifs || []).forEach((n) => {
        if (!state.mirror.NOTIFICATIONS[n.to_email]) state.mirror.NOTIFICATIONS[n.to_email] = [];
        state.mirror.NOTIFICATIONS[n.to_email].push(dbNotifToJs(n));
      });
      window.NOTIFICATIONS = state.mirror.NOTIFICATIONS;

      // 8. Config + extras
      const { data: cfgRows } = await sb.from('pe_config').select('*').eq('id', 1).limit(1);
      const cfg = (cfgRows && cfgRows[0]) || {};
      state.mirror.PE_CONFIG = {
        justMode: cfg.just_mode || 'per-item',
        resultsVisible: cfg.results_visible === true,
        wellbeingVisible: cfg.wellbeing_visible || {},
      };
      window.PE_CONFIG = state.mirror.PE_CONFIG;

      const { data: matrix } = await sb.from('pe_extra_weights_matrix').select('*');
      const m = {};
      (matrix || []).forEach((r) => {
        if (!m[r.department]) m[r.department] = {};
        m[r.department][levelDbToLabel[r.org_level]] = {
          digitalAdoption: r.digital_adoption,
          initiatives:     r.initiatives,
        };
      });
      state.mirror.PE_EXTRA_MATRIX = m;
      window.PE_EXTRA_WEIGHTS_MATRIX = m;

      const { data: targets } = await sb.from('initiative_targets').select('*');
      const t = {};
      (targets || []).forEach((r) => {
        if (!t[r.department]) t[r.department] = {};
        t[r.department][levelDbToLabel[r.org_level]] = r.annual_target;
      });
      state.mirror.PE_INITIATIVE_TARGETS = t;
      window.PE_INITIATIVE_TARGETS = t;

      // 9. Cycles
      const { data: cycles } = await sb.from('cycles').select('*').order('starts_on');
      state.mirror.CYCLES = cycles || [];
      state.mirror.OPEN_CYCLE = (cycles || []).find((c) => c.is_open) || null;
      window.CYCLES = state.mirror.CYCLES;
      window.OPEN_CYCLE = state.mirror.OPEN_CYCLE;

      // Realtime subscriptions
      kabiDb._subscribeRealtime();

      // First-login check for restored sessions (page refresh)
      const { data: { user: currentUser } } = await sb.auth.getUser();
      if (currentUser?.user_metadata?.must_change_password === true) {
        setTimeout(() => kabiDb._showFirstLoginModal(), 300);
      } else if (currentUser && currentUser.user_metadata?.tour_completed !== true) {
        // Tour only shows for users who have completed password change but haven't seen the tour
        kabiDb._waitForWorkspaceThenTour();
      }

      console.info('[kabiDb] mirror loaded — employees=' + state.mirror.PE_EMPLOYEES.length +
                   ', subs=' + state.mirror.subs.length +
                   ', evals=' + Object.keys(state.mirror.PE_EVALS).length);
    },

    _subscribeRealtime() {
      const sb = state.supabase;
      // Notifications for me
      const ch1 = sb.channel('notifs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' },
          (payload) => {
            if (payload.eventType === 'INSERT') {
              const n = payload.new;
              const key = n.to_email;
              if (!state.mirror.NOTIFICATIONS[key]) state.mirror.NOTIFICATIONS[key] = [];
              state.mirror.NOTIFICATIONS[key].unshift(dbNotifToJs(n));
            }
            if (typeof window.empRenderNotifs === 'function') {
              try { window.empRenderNotifs(); } catch (_) {}
            }
          }).subscribe();
      state.channels.push(ch1);

      // Initiatives
      const ch2 = sb.channel('inits')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'initiatives' },
          async () => {
            const { data } = await sb.from('initiatives').select('*');
            state.mirror.INITIATIVES = (data || []).map(dbInitToJs);
            window.INITIATIVES = state.mirror.INITIATIVES;
            if (typeof window.renderHome === 'function') { try { window.renderHome(); } catch (_) {} }
          }).subscribe();
      state.channels.push(ch2);

      // KPI submissions
      const ch3 = sb.channel('subs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'kpi_submissions' },
          async () => {
            const { data } = await sb.from('kpi_submissions').select('*, kpi_submission_items(*)');
            state.mirror.subs = (data || []).map(dbSubToJs);
            window.subs = state.mirror.subs;
          }).subscribe();
      state.channels.push(ch3);
    },

    /** Debug: dump current mirror state. */
    /** Expose internal state read-only for diagnostics. */
    _state: state,

    /** Manually trigger the tour again — useful for testing */
    async _restartTour() {
      // Clear localStorage flag for current user
      let email = window.me?.email || state.myEmp?.email || state.session?.user?.email;
      if (!email) {
        try { email = sessionStorage.getItem('kabi_session_v66'); } catch (e) {}
      }
      if (email) {
        localStorage.removeItem('kabi_tour_completed_' + email.toLowerCase());
      }
      // Try Supabase reset too
      if (state.supabase && state.session) {
        try {
          await state.supabase.auth.updateUser({ data: { tour_completed: false } });
        } catch (e) { /* silent */ }
      }
      console.info('[kabiDb] Tour flag reset. Reloading in 500ms...');
      setTimeout(() => location.reload(), 500);
    },

    debug: {
      dump() {
        return JSON.parse(JSON.stringify({
          myEmp: state.myEmp,
          counts: {
            employees:     state.mirror.PE_EMPLOYEES.length,
            functions:     Object.keys(state.mirror.FUNCTIONS).length,
            kpi_library:   Object.keys(state.mirror.KPI_LIBRARY).length,
            subs:          state.mirror.subs.length,
            evaluations:   Object.keys(state.mirror.PE_EVALS).length,
            initiatives:   state.mirror.INITIATIVES.length,
            notifications: Object.values(state.mirror.NOTIFICATIONS).reduce((a, arr) => a + arr.length, 0),
          },
          openCycle: state.mirror.OPEN_CYCLE?.key,
        }));
      },
    },

    // ─── Domain mutations ──────────────────────────────────────────

    submissions: {
      async submit(sub) {
        // sub in JS shape: { email, fnKey, fnName, dept, level, selKPIs, ... }
        const parent = {
          submitter_email: sub.email.toLowerCase(),
          submitter_name:  sub.name,
          function_key:    sub.fnKey,
          function_name:   sub.fnName,
          department:      sub.dept,
          org_level:       levelLabelToDb[sub.level],
          cycle_key:       state.mirror.OPEN_CYCLE?.key || 'H1-2026',
          status:          sub.isDraft ? 'draft' : 'pending',
          is_draft:        !!sub.isDraft,
          ai_overrides:    sub.aiOverrides || [],
        };
        const { data, error } = await state.supabase
          .from('kpi_submissions')
          .insert(parent).select().single();
        if (error) throw error;

        const items = (sub.selKPIs || []).map((k, i) => ({
          submission_id: data.id,
          position:      i,
          section_index: k.sectionIndex ?? 0,
          section_title: k.sectionTitle || 'Section',
          original_text: k.original ?? null,
          edited_text:   k.edited ?? k.final ?? '',
          final_text:    k.final  ?? k.edited ?? '',
        }));
        if (items.length) {
          await state.supabase.from('kpi_submission_items').insert(items);
        }
        return data;
      },

      async approve(subId) {
        const { data, error } = await state.supabase
          .rpc('approve_kpi_submission', { sub_id: subId });
        if (error) throw error;
        return data;
      },

      async reject(subId, reason) {
        const { error } = await state.supabase
          .from('kpi_submissions')
          .update({
            status: 'rejected',
            decision_reason: reason,
            decided_at: new Date().toISOString(),
          }).eq('id', subId);
        if (error) throw error;
      },
    },

    evaluations: {
      async saveDraft(empId, cycleKey, patch) {
        const key = { employee_id: empId, cycle_key: cycleKey };
        const row = {
          ...key,
          evaluator_email: state.myEmp?.email,
          evaluator_name:  state.myEmp?.name,
          is_draft: true,
          ...jsEvalToDb(patch),
        };
        const { error } = await state.supabase
          .from('evaluations').upsert(row, { onConflict: 'employee_id,cycle_key' });
        if (error) throw error;
      },

      async submit(evalId) {
        const { data, error } = await state.supabase
          .rpc('submit_evaluation', { eval_id: evalId });
        if (error) throw error;
        return data;
      },

      async release(evalId) {
        const { error } = await state.supabase
          .from('evaluations')
          .update({ released_to_employee: true })
          .eq('id', evalId);
        if (error) throw error;
      },
    },

    initiatives: {
      async submit(init) {
        const row = {
          id:              init.id || ('INIT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8)),
          employee_id:     init.empId,
          employee_email:  init.empEmail.toLowerCase(),
          employee_name:   init.empName,
          title:           init.title,
          description:     init.desc,
          initiative_type: init.type || 'general',
          manager_email:   init.managerEmail.toLowerCase(),
          status:          'pending_manager',
        };
        const { data, error } = await state.supabase
          .from('initiatives').insert(row).select().single();
        if (error) throw error;
        return data;
      },

      async managerDecide(initId, decision, note) {
        const patch = {
          manager_decision: decision,
          manager_decision_at: new Date().toISOString(),
          manager_note: note || null,
          status: decision === 'approved' ? 'pending_hc' : 'rejected',
          hc_reviewed_at: decision === 'approved' ? new Date().toISOString() : null,
        };
        const { error } = await state.supabase
          .from('initiatives').update(patch).eq('id', initId);
        if (error) throw error;
      },

      async hcDecide(initId, decision, note) {
        const patch = {
          hc_decision: decision,
          hc_decision_at: new Date().toISOString(),
          hc_note: note || null,
          status: decision === 'approved' ? 'approved' : 'rejected',
        };
        const { error } = await state.supabase
          .from('initiatives').update(patch).eq('id', initId);
        if (error) throw error;
      },
    },

    notifications: {
      async send(toEmail, notif) {
        // v67.40: always plain text — strip any HTML
        const stripTags = (s) => (s || '').replace(/<[^>]*>/g, '').trim();
        const row = {
          to_email:   toEmail.toLowerCase(),
          notif_type: notif.type || 'note',
          from_email: state.myEmp?.email,
          from_name:  state.myEmp?.name,
          title:      stripTags(notif.title),
          body:       stripTags(notif.body),
          meta:       notif.meta || null,
        };
        const { error } = await state.supabase.from('notifications').insert(row);
        if (error) throw error;
      },

      async markRead(id) {
        const { error } = await state.supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
      },

      async markAllRead() {
        const { error } = await state.supabase
          .from('notifications')
          .update({ read_at: new Date().toISOString() })
          .is('read_at', null)
          .eq('to_email', state.myEmp?.email);
        if (error) throw error;
      },
    },

    config: {
      async setJustMode(mode) {
        const { error } = await state.supabase.from('pe_config').update({
          just_mode: mode,
          updated_by_email: state.myEmp?.email,
        }).eq('id', 1);
        if (error) throw error;
        state.mirror.PE_CONFIG.justMode = mode;
      },

      async setResultsVisible(v) {
        const { error } = await state.supabase.from('pe_config').update({
          results_visible: v,
          updated_by_email: state.myEmp?.email,
        }).eq('id', 1);
        if (error) throw error;
        state.mirror.PE_CONFIG.resultsVisible = v;
      },

      async setMatrixCell(dept, level, key, val) {
        const patch = { [key === 'digitalAdoption' ? 'digital_adoption' : 'initiatives']: val };
        const { error } = await state.supabase
          .from('pe_extra_weights_matrix')
          .update(patch)
          .eq('department', dept)
          .eq('org_level', levelLabelToDb[level]);
        if (error) throw error;
      },
    },

    query: {
      async getApprovedKPIs(fnKey, level, cycleKey) {
        const { data, error } = await state.supabase.rpc('get_approved_kpis', {
          fn_key: fnKey,
          level_: levelLabelToDb[level],
          cycle_: cycleKey || state.mirror.OPEN_CYCLE?.key,
        });
        if (error) throw error;
        return (data || []).map((r) => r.final_text);
      },

      async getPendingManagerInitiatives(mgrEmail) {
        const { data, error } = await state.supabase
          .rpc('get_pending_manager_initiatives', { mgr_email: mgrEmail.toLowerCase() });
        if (error) throw error;
        return (data || []).map(dbInitToJs);
      },

      async detectCelebrations(empId) {
        const { data, error } = await state.supabase
          .rpc('detect_celebrations', { emp_id: empId });
        if (error) throw error;
        return data;
      },
    },
  };

  // ─── Row shape converters ─────────────────────────────────────────
  function dbEmpToJs(e) {
    return {
      id:      e.id,
      email:   e.email,
      name:    e.name,
      arabicName: e.arabic_name,
      title:   e.title,
      fn:      e.function_key,
      dept:    e.department,
      level:   levelDbToLabel[e.org_level],
      mgr:     e.manager_email,
      loc:     e.location,
      gender:  e.gender,
      isFTE:   e.is_fte,
      isFormer:e.is_former,
      isSystem:e.is_system_account,
      isCEO:   e.is_ceo,
      hasManagerPortal: e.has_manager_portal,
      isHCAdmin: e.is_hc_admin,
      birthDate: e.birth_date,
      hireDate:  e.hire_date,
      photo:     e.photo_url,
      auth_user_id: e.auth_user_id,
    };
  }

  function dbSubToJs(s) {
    return {
      id:       s.id,
      email:    s.submitter_email,
      name:     s.submitter_name,
      fnKey:    s.function_key,
      fnName:   s.function_name,
      dept:     s.department,
      level:    levelDbToLabel[s.org_level],
      ts:       s.submitted_at,
      status:   s.status,
      isDraft:  s.is_draft,
      reason:   s.decision_reason,
      aiOverrides: s.ai_overrides || [],
      selKPIs:  ((s.kpi_submission_items || [])
        .sort((a, b) => a.position - b.position))
        .map((i) => ({
          sectionIndex: i.section_index,
          sectionTitle: i.section_title,
          original: i.original_text,
          edited:   i.edited_text,
          final:    i.final_text,
        })),
    };
  }

  function dbEvalToJs(e) {
    return {
      id:        e.id,
      empId:     e.employee_id,
      quarter:   e.cycle_key,
      evaluator: e.evaluator_name,
      evaluatorEmail: e.evaluator_email,
      timestamp: e.submitted_at,
      isDraft:   e.is_draft,
      totalScore:e.total_score,
      totalPct:  e.total_pct,
      ratingLabel: e.rating_label,
      kpiScores: e.kpi_scores || [],
      inviewsScore: e.inviews_score,
      digitalAdapt: e.digital_adoption,
      initiativesScore: e.initiatives_score,
      justs:     e.justifications || {},
      weights:   e.weights_snapshot || {},
      releasedToEmployee: e.released_to_employee,
    };
  }

  function jsEvalToDb(v) {
    return {
      total_score:  v.totalScore ?? null,
      total_pct:    v.totalPct ?? null,
      rating_label: v.ratingLabel || null,
      kpi_scores:   v.kpiScores || [],
      inviews_score: v.inviewsScore ?? null,
      digital_adoption: v.digitalAdapt ?? null,
      initiatives_score: v.initiativesScore ?? null,
      justifications: v.justs || {},
      weights_snapshot: v.weights || {},
    };
  }

  function dbInitToJs(i) {
    return {
      id:            i.id,
      empId:         i.employee_id,
      empEmail:      i.employee_email,
      empName:       i.employee_name,
      title:         i.title,
      desc:          i.description,
      type:          i.initiative_type,
      attachment:    i.attachment_url ? { url: i.attachment_url, name: i.attachment_name, size: i.attachment_size } : null,
      submittedAt:   i.submitted_at,
      status:        i.status,
      managerEmail:  i.manager_email,
      managerDecision: i.manager_decision,
      managerDecisionAt: i.manager_decision_at,
      managerNote:   i.manager_note,
      hcDecision:    i.hc_decision,
      hcDecisionAt:  i.hc_decision_at,
      hcReviewedAt:  i.hc_reviewed_at,
      hcNote:        i.hc_note,
    };
  }

  function dbNotifToJs(n) {
    return {
      id:        String(n.id),
      type:      n.notif_type,
      fromEmail: n.from_email,
      fromName:  n.from_name,
      title:     n.title,
      body:      n.body,
      meta:      n.meta,
      read:      !!n.read_at,
      readAt:    n.read_at,
      timestamp: n.created_at,
    };
  }

  // Expose
  window.kabiDb = kabiDb;

  // Auto-init if credentials are present on window
  setTimeout(() => {
    if (!state.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY
        && !window.SUPABASE_URL.includes('YOUR-PROJECT')) {
      const useFlag = localStorage.getItem('kabi_db_backend') === '1';
      if (useFlag) {
        kabiDb.init({ url: window.SUPABASE_URL, anonKey: window.SUPABASE_ANON_KEY });
        console.info('%c[KABi] Auto-init triggered', 'color:#00c2e0;font-weight:bold');
      }
    }
  }, 100);

  // ─── Universal tour trigger — watches for ANY KABi login ───
  // Fires when a workspace page (pg-employee/pg-hc/pg-ceo) becomes active,
  // regardless of whether the user signed in via Supabase or KABi's demo cards.
  // Uses localStorage per-email as the source of truth for tour completion.
  // ─── Responsive: keep the tour bubble fully inside the viewport ───
  function _clampTourBubble() {
    var b = document.getElementById('kabi-tour-bubble');
    if (!b) return;
    var tf = b.style.transform || '';
    if (tf.indexOf('translate(-50%') !== -1) return; // centered bubbles self-center
    var m = 12;
    var r = b.getBoundingClientRect();
    var vw = window.innerWidth, vh = window.innerHeight;
    var top = r.top, left = r.left;
    if (r.height > vh - 2 * m) { top = m; }
    else if (r.bottom > vh - m) { top = vh - r.height - m; }
    if (top < m) top = m;
    if (r.width > vw - 2 * m) { left = m; }
    else if (r.right > vw - m) { left = vw - r.width - m; }
    if (left < m) left = m;
    b.style.top = top + 'px';
    b.style.left = left + 'px';
  }
  window.addEventListener('resize', _clampTourBubble);

  let _tourCheckPending = false;

  const _checkAndShowTour = () => {
    if (_tourCheckPending) return;
    if (document.getElementById('kabi-tour-bubble')) return; // already showing

    const empActive = document.getElementById('pg-employee')?.classList.contains('active');
    const hcActive  = document.getElementById('pg-hc')?.classList.contains('active');
    const ceoActive = document.getElementById('pg-ceo')?.classList.contains('active');
    if (!(empActive || hcActive || ceoActive)) return;

    // Determine current user's email via multiple fallback sources
    const findEmail = () => {
      // 1. Supabase-loaded employee mirror
      if (state.myEmp?.email) return state.myEmp.email;
      // 2. KABi's window.me if exposed
      if (window.me?.email) return window.me.email;
      // 3. Supabase auth session
      if (state.session?.user?.email) return state.session.user.email;
      // 4. KABi's session storage (kabi_session_v66 holds the email lowercase)
      try {
        const kabiSess = sessionStorage.getItem('kabi_session_v66');
        if (kabiSess && kabiSess.includes('@')) return kabiSess;
      } catch (e) {}
      // 5. DOM scraping — find first @kabi.ai email in the visible workspace
      const activePage = document.querySelector('.page.active');
      if (activePage) {
        const match = activePage.textContent.match(/[a-z0-9._-]+@kabi\.ai/i);
        if (match) return match[0];
      }
      return null;
    };

    const email = findEmail();
    if (!email) {
      // Retry once after a delay in case KABi is still rendering
      setTimeout(() => {
        const retryEmail = findEmail();
        if (retryEmail) {
          const rKey = 'kabi_tour_completed_' + retryEmail.toLowerCase();
          if (localStorage.getItem(rKey) !== '1' &&
              state.session?.user?.user_metadata?.tour_completed !== true) {
            _tourCheckPending = true;
            setTimeout(() => {
              _tourCheckPending = false;
              kabiDb._showOnboardingTour();
            }, 400);
          }
        }
      }, 1500);
      return;
    }

    const tourKey = 'kabi_tour_completed_' + email.toLowerCase();
    if (localStorage.getItem(tourKey) === '1') return; // already done

    // Also skip if Supabase metadata says done (dual-check for safety)
    const skipViaSupabase = state.session?.user?.user_metadata?.tour_completed === true;
    if (skipViaSupabase) {
      localStorage.setItem(tourKey, '1'); // sync to local so we don't re-check
      return;
    }

    _tourCheckPending = true;
    // Give KABi's UI time to fully render the sidebar
    setTimeout(() => {
      _tourCheckPending = false;
      kabiDb._showOnboardingTour();
    }, 900);
  };

  // Wire the check to both:
  //  A) MutationObserver — for LIVE navigation (click demo card → workspace opens)
  const _attachObserver = () => {
    if (!document.body) {
      setTimeout(_attachObserver, 50);
      return;
    }
    const workspaceObserver = new MutationObserver(_checkAndShowTour);
    workspaceObserver.observe(document.body, {
      attributes: true, attributeFilter: ['class'], subtree: true
    });
  };
  _attachObserver();

  //  B) Initial page load check — for session restore (workspace already active)
  //     KABi may have already restored the session and shown the workspace before
  //     kabiDb finished loading. Check periodically for the first ~10 seconds.
  let _initTries = 0;
  const _initCheckInterval = setInterval(() => {
    _initTries++;
    _checkAndShowTour();
    // Stop after 10 seconds OR once we detect an active workspace
    const anyActive = ['pg-employee', 'pg-hc', 'pg-ceo'].some(id =>
      document.getElementById(id)?.classList.contains('active')
    );
    if (_initTries >= 20 || (anyActive && _initTries > 3)) {
      clearInterval(_initCheckInterval);
    }
  }, 500);

  console.info('[KABi] Universal tour watcher active (observer + polling)');

  // ─── HC Sub-Tours — walk through tools inside each box ───
  // When user clicks Performance Evaluation / KPI Framework / People & Access /
  // AI Nudges box, we show a mini-tour of that section's tools.
  const _hcSubTours = {
    pe: [
      { sel: "button[onclick*=\"peAdminTab='dashboard'\"]", title: 'Dashboard',
        body: 'Overview of active evaluations, KABi performance %, and progress across departments.' },
      { sel: "button[onclick*=\"peAdminTab='quarters'\"]", title: 'Evaluation Cycles',
        body: 'Configure semi-annual or annual cycles. Set start/end dates and target audience.' },
      { sel: "button[onclick*=\"peAdminTab='inviews'\"]", title: 'INVIEWS Control',
        body: 'Open or close the INVIEWS assessment window. Controls when managers can rate their teams on behavioral, leadership, and technical tracks.' },
      { sel: "button[onclick*=\"peAdminTab='initiatives'\"]", title: 'Initiatives',
        body: 'Review employee initiatives that have already been approved by their managers. HC gives the final approval here.' },
      { sel: "button[onclick*=\"peAdminTab='settings'\"]", title: 'Settings',
        body: 'Adjust weights per department and level, choose justification mode, and toggle result visibility.' },
      { sel: "button[onclick*=\"peAdminTab='managers'\"]", title: 'Managers & Progress',
        body: 'Track evaluation completion by manager. See who has finished evaluating their team and who is still pending.' },
      { sel: "button[onclick*=\"peAdminTab='evals'\"]", title: 'Evaluations & Export',
        body: 'View every evaluation and release final scores to employees (two levels: global toggle plus per-employee release). Export data to Excel.' },
      { sel: "button[onclick*=\"peAdminTab='editreqs'\"]", title: 'Edit Requests',
        body: 'Approve or reject manager-initiated edit requests on already-submitted evaluations.' },
    ],
    kpi: [
      { sel: "button[onclick*=\"kpiSubTab='ov'\"]", title: 'Overview',
        body: 'Coverage stats: which functions have KPIs submitted and which are still pending across all pillars.' },
      { sel: "button[onclick*=\"kpiSubTab='sub'\"]", title: 'Submissions',
        body: 'Review manager KPI proposals. Approve or reject up to 4 KPIs per level per function.' },
      { sel: "button[onclick*=\"kpiSubTab='usr'\"]", title: 'Users',
        body: 'Manage which users can access which functions\' KPIs. Assign kpiAccess permissions here.' },
    ],
    people: [
      { sel: "button[onclick*=\"peopleSubTab='employees'\"]", title: 'Employees',
        body: 'Full employee list — add new employees, edit existing records, deactivate former staff, and export the roster.' },
      { sel: "button[onclick*=\"peopleSubTab='security'\"]", title: 'Security',
        body: 'Reset passwords for any user, manage roles (Manager, Employee, HC Admin, CEO), and configure access permissions.' },
    ],
    ai_nudge: [
      { sel: null, title: 'AI Nudges Configuration',
        body: 'Configure well-being check-in templates that appear on employee dashboards. Set the frequency (daily, weekly), pick categories, and preview how nudges will look.' },
    ],
  };

  const _showHcSubTour = (section) => {
    console.info(`[KABi sub-tour] fired for section: ${section}`);
    const steps = _hcSubTours[section];
    if (!steps || !steps.length) {
      console.warn(`[KABi sub-tour] no steps defined for: ${section}`);
      return;
    }

    // Check if this sub-tour was already seen for this user
    const email = (sessionStorage.getItem('kabi_session_v66') || '').toLowerCase();
    if (!email) {
      console.warn('[KABi sub-tour] no email found in sessionStorage');
      return;
    }
    const subKey = `kabi_hc_subtour_${section}_${email}`;
    if (localStorage.getItem(subKey) === '1') {
      console.info(`[KABi sub-tour] already seen: ${subKey}`);
      return;
    }

    // If main tour bubble or another sub-tour is still visible, close it first.
    // Previously we blocked here — that was too restrictive.
    const stale = document.getElementById('kabi-tour-bubble');
    const staleBd = document.getElementById('kabi-tour-backdrop');
    if (stale) { stale.remove(); console.info('[KABi sub-tour] removed stale bubble'); }
    if (staleBd) { staleBd.remove(); }

    console.info(`[KABi sub-tour] STARTING: ${section}, ${steps.length} steps`);

    let idx = 0;
    const backdrop = document.createElement('div');
    backdrop.id = 'kabi-tour-backdrop';
    const bubble = document.createElement('div');
    bubble.id = 'kabi-tour-bubble';
    let highlightedEl = null;

    const highlightEl = (el) => {
      if (highlightedEl) highlightedEl.classList.remove('kabi-tour-highlight');
      if (el) { el.classList.add('kabi-tour-highlight'); highlightedEl = el; }
      else highlightedEl = null;
    };

    const positionAt = (el) => {
      if (el) {
        try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
        setTimeout(() => {
          const rect = el.getBoundingClientRect();
          bubble.classList.add('side');
          const bTop = Math.max(20, rect.top - 4);
          const bLeft = rect.right + 18;
          bubble.style.top = bTop + 'px';
          bubble.style.left = bLeft + 'px';
          bubble.style.transform = '';
          if (bLeft + 340 > window.innerWidth) {
            bubble.classList.remove('side');
            bubble.style.top = (rect.bottom + 12) + 'px';
            bubble.style.left = Math.max(20, rect.left) + 'px';
          }
          try { _clampTourBubble(); } catch (e) {}
        }, 250);
      } else {
        bubble.classList.remove('side');
        bubble.style.top = '50%';
        bubble.style.left = '50%';
        bubble.style.transform = 'translate(-50%, -50%)';
      }
    };

    const cleanup = () => {
      highlightEl(null);
      backdrop.remove();
      bubble.remove();
      localStorage.setItem(subKey, '1');
    };

    const render = () => {
      const step = steps[idx];
      const el = step.sel ? document.querySelector(step.sel) : null;

      // Trigger the tab click on step 1+ (step 0 is the section's default first tab,
      // no click needed there). Try multiple methods for robustness:
      //   1) el.click() — native DOM click
      //   2) el.onclick.call() — fallback if 1 didn't fire the handler
      //   3) dispatchEvent — final fallback
      if (el && idx > 0) {
        let clicked = false;
        try { el.click(); clicked = true; } catch (e) {}
        if (!clicked && typeof el.onclick === 'function') {
          try { el.onclick.call(el, new MouseEvent('click', { bubbles: true })); } catch (e) {}
        }
        if (!clicked) {
          try {
            el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          } catch (e) {}
        }
      }

      // Wait for the section to re-render (renderPEAdmin/renderKPIFramework/etc.
      // rebuild the whole sidebar), then re-query the fresh element and position.
      setTimeout(() => {
        const freshEl = step.sel ? (document.querySelector(step.sel) || el) : null;
        highlightEl(freshEl);
        positionAt(freshEl);
      }, 280);
      // Also position immediately in case re-render is instant (avoids flicker)
      const eagerEl = step.sel ? document.querySelector(step.sel) : null;
      highlightEl(eagerEl);
      positionAt(eagerEl);
      const dotsHTML = steps.map((_, i) =>
        `<span style="width:6px;height:6px;border-radius:50%;background:${i === idx ? '#00c2e0' : '#dbe4f0'};transition:.2s"></span>`
      ).join('');
      bubble.innerHTML = `
        <button style="position:absolute;top:10px;right:10px;background:transparent;border:none;color:#94a3b8;font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px;line-height:1;font-family:inherit;" onclick="this.dataset.skip=1">✕</button>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
          <div style="width:28px;height:28px;border-radius:8px;background:rgba(0,194,224,0.12);color:#00c2e0;display:flex;align-items:center;justify-content:center;">
            <i class="ti ti-info-circle" style="font-size:16px;"></i>
          </div>
        </div>
        <h3 style="font-size:15px;font-weight:800;color:#0f172a;margin:0 0 6px;">${step.title}</h3>
        <p style="font-size:12.5px;color:#475569;margin:0 0 14px;line-height:1.5;">${step.body}</p>
        <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
          <div style="display:flex;gap:5px;align-items:center;">${dotsHTML}</div>
          <div style="display:flex;gap:8px;">
            ${idx > 0 ? '<button data-back="1" style="padding:8px 14px;background:#f1f5f9;color:#475569;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;">Back</button>' : ''}
            <button data-next="1" style="padding:8px 16px;background:linear-gradient(135deg,#00c2e0,#1382d8);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:800;cursor:pointer;font-family:inherit;">${idx === steps.length - 1 ? 'Finish ✓' : 'Next →'}</button>
          </div>
        </div>
      `;
      // Attach event handlers
      bubble.querySelector('[data-next]')?.addEventListener('click', () => {
        if (idx === steps.length - 1) { cleanup(); }
        else { idx++; render(); }
      });
      bubble.querySelector('[data-back]')?.addEventListener('click', () => { if (idx > 0) { idx--; render(); } });
      bubble.querySelector('button[onclick]')?.addEventListener('click', cleanup);
      try { requestAnimationFrame(_clampTourBubble); } catch (e) {}
    };

    document.body.appendChild(backdrop);
    document.body.appendChild(bubble);
    render();
  };

  // Wrap hcOpenSection to trigger sub-tour
  const _wrapHcOpenSection = () => {
    if (typeof window.hcOpenSection === 'function' && !window.hcOpenSection._kabiWrapped) {
      const orig = window.hcOpenSection;
      window.hcOpenSection = function(section) {
        console.info(`[KABi] hcOpenSection('${section}') triggered — sub-tour will fire in 900ms`);
        orig.apply(this, arguments);
        setTimeout(() => _showHcSubTour(section), 900);
      };
      window.hcOpenSection._kabiWrapped = true;
      console.info('[KABi] hcOpenSection wrapped for sub-tours');
      return true;
    }
    return false;
  };

  // Retry wrapping until hcOpenSection is defined by KABi
  let _wrapTries = 0;
  const _wrapInterval = setInterval(() => {
    _wrapTries++;
    if (_wrapHcOpenSection() || _wrapTries >= 30) clearInterval(_wrapInterval);
  }, 500);
})();
