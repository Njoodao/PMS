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
  const levelDbToLabel = {
    top_management: 'Top Management',
    management:     'Management',
    staff_level:    'Staff Level',
  };
  const levelLabelToDb = {
    'Top Management': 'top_management',
    'Management':     'management',
    'Staff Level':    'staff_level',
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

      // Onboarding tour — shown once per user, right after password change
      if (data.user?.user_metadata?.tour_completed !== true) {
        // Wait a bit for the UI to settle after login
        setTimeout(() => kabiDb._showOnboardingTour(), 800);
      }
      return data.session;
    },

    /** Return the tour steps for the current user's role. */
    _getTourSteps() {
      // Determine role from the current employee record + auth metadata
      const emp = state.myEmp;
      const isHC       = emp?.isHCAdmin === true;
      const isCEO      = emp?.isCEO === true;
      const isManager  = emp?.hasManagerPortal === true || false;

      // Fallback: infer manager from mgr chain (does anyone have this email as their mgr?)
      const inferredManager = !isManager && state.mirror.PE_EMPLOYEES.some(e =>
        e.mgr?.toLowerCase() === emp?.email?.toLowerCase() && !e.isFormer
      );

      const role = isHC ? 'hc' : (isCEO ? 'ceo' : (isManager || inferredManager ? 'manager' : 'employee'));

      const commonWelcome = {
        icon: '👋',
        title: `Welcome to KABi, ${emp?.name?.split(' ')[0] || 'there'}!`,
        body: `This is a quick tour of the KABi Performance Management System. We'll show you the main features you'll use. It only takes a minute — you can skip anytime.`
      };

      const commonEnd = {
        icon: '🎉',
        title: `You're all set!`,
        body: `That's the tour. If you ever need a refresher, ask your HC representative. Have a productive day!`
      };

      if (role === 'employee') {
        return [
          commonWelcome,
          { icon: '🏠', title: 'Your Dashboard',
            body: 'This is your personal home. See your profile, upcoming celebrations, notifications, and recent activity — all in one glance.' },
          { icon: '🎯', title: 'My KPIs',
            body: `When your manager submits KPIs for your function and HC approves them, they'll appear here. You'll see what you're being evaluated on for the current cycle.` },
          { icon: '💡', title: 'Initiatives',
            body: `Submit ideas that improve KABi — academic (certificates, research) or general (process improvements, projects). Your manager reviews first, then HC gives final approval.` },
          { icon: '🧠', title: 'INVIEWS Self-Assessment',
            body: `Score yourself on behavioral, leadership, and technical competencies. This is private — even your manager cannot see the individual scores. Only aggregate is used.` },
          { icon: '🔔', title: 'Notifications',
            body: `Meeting requests, appreciation notes, evaluation releases, and initiative decisions all arrive here in real-time.` },
          commonEnd
        ];
      }

      if (role === 'manager') {
        return [
          commonWelcome,
          { icon: '🏠', title: 'Your Dashboard',
            body: `Your personal profile plus a summary of pending items across your team — evaluations to complete, initiatives to review, and notifications.` },
          { icon: '👥', title: 'My Team',
            body: `See all your direct reports. Send notes, schedule 1:1 meetings, and (when the cycle is open) start their performance evaluations.` },
          { icon: '📊', title: 'KPI Framework',
            body: `For each function you manage, propose up to 4 KPIs per level. HC reviews and approves, then those KPIs become official for the current cycle.` },
          { icon: '✅', title: 'Evaluate Team',
            body: `When it's evaluation time, score your reports across their KPIs, competencies, digital adoption, and initiatives. The AI Coach helps but final decisions are yours.` },
          { icon: '💡', title: 'Team Initiatives',
            body: `When your team members submit initiatives, they appear in the "My Team" page for your review. Approve them and they move to HC for final approval.` },
          { icon: '🔔', title: 'Notifications',
            body: `Real-time updates on team activity, HC decisions, and messages from other managers.` },
          commonEnd
        ];
      }

      if (role === 'hc') {
        return [
          commonWelcome,
          { icon: '🎯', title: 'HC Performance Hub',
            body: `The main tab. Review manager KPI submissions, approve or reject, monitor evaluation progress across all departments.` },
          { icon: '📈', title: 'All Submissions',
            body: `Every KPI submission from every manager — filterable, exportable to Excel. This is your central pipeline.` },
          { icon: '💡', title: 'Initiative Approvals',
            body: `Two-stage flow: manager approves → arrives at HC. You make the final call. Approved initiatives count toward employees' evaluation scores.` },
          { icon: '⚙️', title: 'Settings & Configuration',
            body: `Tune weights per department × level, justification mode, cycle timing, and toggle result visibility. Everything the system needs to run.` },
          { icon: '🏆', title: 'Release Results',
            body: `When you flip "results_visible" ON and mark individual evaluations as released, employees can finally see their scores. This is intentional — you control the moment.` },
          { icon: '🔔', title: 'Notifications & Audit',
            body: `Every important action across the system is auditable. Notifications keep you in the loop.` },
          commonEnd
        ];
      }

      // CEO
      return [
        commonWelcome,
        { icon: '📊', title: 'Executive Dashboard',
          body: `Organization-wide performance overview — scores by department, level, and location. Sourced from a live materialized view for speed.` },
        { icon: '👥', title: 'Full Organization View',
          body: `Explore any employee's evaluation, KPIs, and history. You have read access to everything (except the private INVIEWS breakdown).` },
        { icon: '📈', title: 'Trends & Patterns',
          body: `Identify high performers, watch retention risks, and see how the org evolves cycle over cycle.` },
        commonEnd
      ];
    },

    /** Show the sequential onboarding tour. Called once per user. */
    _showOnboardingTour() {
      const steps = kabiDb._getTourSteps();
      if (!steps || steps.length === 0) return;

      let idx = 0;
      const modal = document.createElement('div');
      modal.id = 'kabi-onboarding-tour';
      modal.innerHTML = `
        <div id="kabi-tour-backdrop" style="position:fixed;inset:0;background:rgba(0,15,40,0.86);z-index:2147483646;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif;backdrop-filter:blur(6px);">
          <div style="background:linear-gradient(135deg,#0a1f52,#132a6b);padding:36px;border-radius:16px;max-width:520px;width:90%;color:#fff;box-shadow:0 24px 60px rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.08);position:relative;">
            <button id="kabi-tour-skip" title="Skip tour" style="position:absolute;top:12px;right:12px;background:transparent;border:none;color:rgba(255,255,255,0.5);font-size:20px;cursor:pointer;padding:4px 8px;border-radius:6px;transition:all 0.15s;">✕</button>
            <div id="kabi-tour-icon" style="font-size:44px;margin-bottom:10px;line-height:1;"></div>
            <h2 id="kabi-tour-title" style="margin:0 0 8px;font-size:22px;font-weight:800;letter-spacing:-0.01em;"></h2>
            <p id="kabi-tour-body" style="margin:0 0 24px;font-size:14px;line-height:1.65;opacity:0.85;"></p>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;">
              <div style="display:flex;gap:5px;" id="kabi-tour-dots"></div>
              <div style="display:flex;gap:8px;">
                <button id="kabi-tour-back" style="padding:10px 18px;background:rgba(255,255,255,0.06);color:rgba(255,255,255,0.7);border:1px solid rgba(255,255,255,0.08);border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;">← Back</button>
                <button id="kabi-tour-next" style="padding:10px 22px;background:linear-gradient(135deg,#00c2e0,#1338b0);color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit;letter-spacing:0.3px;">Next →</button>
              </div>
            </div>
          </div>
        </div>`;
      document.body.appendChild(modal);

      const iconEl  = document.getElementById('kabi-tour-icon');
      const titleEl = document.getElementById('kabi-tour-title');
      const bodyEl  = document.getElementById('kabi-tour-body');
      const backBtn = document.getElementById('kabi-tour-back');
      const nextBtn = document.getElementById('kabi-tour-next');
      const skipBtn = document.getElementById('kabi-tour-skip');
      const dotsEl  = document.getElementById('kabi-tour-dots');

      function render() {
        const step = steps[idx];
        iconEl.textContent  = step.icon || '✨';
        titleEl.textContent = step.title || '';
        bodyEl.textContent  = step.body || '';
        backBtn.style.visibility = idx === 0 ? 'hidden' : 'visible';
        nextBtn.textContent = idx === steps.length - 1 ? 'Finish ✓' : 'Next →';
        // Progress dots
        dotsEl.innerHTML = steps.map((_, i) => {
          const active = i === idx;
          const past = i < idx;
          const color = active ? '#00c2e0' : (past ? 'rgba(0,194,224,0.4)' : 'rgba(255,255,255,0.15)');
          const size = active ? '10px' : '7px';
          return `<div style="width:${size};height:${size};border-radius:50%;background:${color};transition:all 0.2s;"></div>`;
        }).join('');
      }

      async function finish() {
        modal.remove();
        try {
          await state.supabase.auth.updateUser({
            data: { tour_completed: true }
          });
          console.info('[kabiDb] Onboarding tour completed — flag saved');
        } catch (e) {
          console.warn('[kabiDb] Could not save tour_completed flag:', e.message);
        }
      }

      nextBtn.onclick = () => {
        if (idx < steps.length - 1) { idx++; render(); }
        else finish();
      };
      backBtn.onclick = () => { if (idx > 0) { idx--; render(); } };
      skipBtn.onclick = finish;

      // Escape key = skip
      const onKey = (e) => { if (e.key === 'Escape') { skipBtn.click(); } };
      document.addEventListener('keydown', onKey, { once: false });
      // Cleanup on removal
      const cleanup = () => document.removeEventListener('keydown', onKey);
      modal.addEventListener('DOMNodeRemoved', cleanup, { once: true });

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
          <div style="position:fixed;inset:0;background:rgba(0,15,40,0.92);z-index:2147483647;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif;backdrop-filter:blur(8px);">
            <div style="background:linear-gradient(135deg,#0a1f52,#132a6b);padding:36px;border-radius:16px;max-width:460px;width:90%;color:#fff;box-shadow:0 24px 60px rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.08);">
              <div style="font-size:36px;margin-bottom:12px;">🎉</div>
              <h2 style="margin:0 0 8px;font-size:24px;font-weight:800;">Welcome to KABi</h2>
              <p style="margin:0 0 24px;opacity:0.8;font-size:14px;line-height:1.6;">This is your first login. Please set a new secure password to continue. This is required only once.</p>
              <label style="display:block;margin:0 0 6px;font-size:13px;font-weight:600;opacity:0.9;">New password</label>
              <input id="kabi-fl-pw1" type="password" placeholder="At least 8 characters" autocomplete="new-password" style="width:100%;padding:12px 14px;margin:0 0 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.35);color:#fff;font-size:14px;box-sizing:border-box;outline:none;transition:border-color 0.15s;" />
              <label style="display:block;margin:0 0 6px;font-size:13px;font-weight:600;opacity:0.9;">Confirm password</label>
              <input id="kabi-fl-pw2" type="password" placeholder="Repeat the same password" autocomplete="new-password" style="width:100%;padding:12px 14px;margin:0 0 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(0,0,0,0.35);color:#fff;font-size:14px;box-sizing:border-box;outline:none;transition:border-color 0.15s;" />
              <div id="kabi-fl-err" style="color:#f87171;font-size:13px;margin:0 0 14px;min-height:18px;font-weight:500;"></div>
              <button id="kabi-fl-submit" style="width:100%;padding:14px;background:linear-gradient(135deg,#00c2e0,#1338b0);color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:800;cursor:pointer;letter-spacing:0.3px;">Set password & continue</button>
              <div style="margin-top:16px;padding:10px 12px;background:rgba(255,193,7,0.1);border:1px solid rgba(255,193,7,0.3);border-radius:6px;font-size:12px;opacity:0.9;line-height:1.5;">💡 Tip: use a mix of letters, numbers and symbols. Store it somewhere safe.</div>
            </div>
          </div>`;

        document.body.appendChild(modal);
        const pw1 = document.getElementById('kabi-fl-pw1');
        const pw2 = document.getElementById('kabi-fl-pw2');
        const err = document.getElementById('kabi-fl-err');
        const btn = document.getElementById('kabi-fl-submit');
        pw1.focus();

        [pw1, pw2].forEach(el => {
          el.addEventListener('focus', () => el.style.borderColor = 'rgba(0,194,224,0.6)');
          el.addEventListener('blur',  () => el.style.borderColor = 'rgba(255,255,255,0.15)');
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
        setTimeout(() => kabiDb._showOnboardingTour(), 800);
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
      try {
        await state.supabase.auth.updateUser({ data: { tour_completed: false } });
        console.info('[kabiDb] Tour flag reset. Reloading in 500ms...');
        setTimeout(() => location.reload(), 500);
      } catch (e) {
        console.error('Could not reset tour flag:', e.message);
      }
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
})();
