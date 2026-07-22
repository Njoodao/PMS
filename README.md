# KABi Performance Management System (PMS)

A white-label, evidence-based performance-management app: a single-file frontend
(`index.html`) plus an **optional** FastAPI backend for LLM key-safety and connectors.
Cross-device shared branding works via **Supabase** (no server needed).

## Repository layout

```
.
├── index.html                    # The app (host statically, or open directly)
├── 06_kabiDb.js                  # Supabase data layer
├── 07_kabiKpiKnowledge.js        # KPI knowledge packs
├── 09_kabiKpiLibrary.js          # Level-specific KPI library (696 KPIs)
├── 10_kabiEvalCopilot.js         # Evaluation copilot (agent)
├── 11_kabiEvalCopilotUI.js       # Evaluation copilot UI
├── backend/                      # FastAPI integration proxy (optional)
│   ├── main.py                   #   LLM passthrough + /branding + connectors + governance
│   ├── requirements.txt  Dockerfile  Procfile  .env.example  README.md
├── db/                           # Supabase SQL — run in the Supabase SQL editor
│   ├── 08_levels_migration.sql
│   ├── 09_rls_policies.sql
│   └── 10_app_settings.sql       #   ← shared branding table (cross-device)
├── render.yaml                   # Render Blueprint: backend + static frontend
└── .github/workflows/static.yml  # GitHub Pages deploy for the frontend
```

> ⚠️ The five `*.js` files must stay in the **same folder** as `index.html` — it
> loads them by relative path.

## Deploy

### Frontend — GitHub Pages
Enable Pages (Settings → Pages → Source: GitHub Actions). `static.yml` publishes on push to `main`.

### Cross-device shared branding (recommended for GitHub Pages)
The browser talks to Supabase directly — no server required:
1. In your Supabase project's SQL editor, run **`db/10_app_settings.sql`**.
2. `window.SUPABASE_URL` / `window.SUPABASE_ANON_KEY` are already set in `index.html`.
3. That's it — branding set by the Super Admin now reaches every user on every device.
   (Without this table, branding still works but stays per-browser.)

### Backend (optional) — LLM key-safety + Jira/Pipedrive connectors
Deploy `backend/` (Render Blueprint via `render.yaml`, or Docker). Then in
`index.html` set `window.KABI_PROXY_URL` to the backend URL
(e.g. `https://kabi-proxy.onrender.com`). Copy `backend/.env.example` → `.env`
and fill only the keys you use. LLM model is picked **per provider** automatically.

### Full Supabase data mode (optional)
To store ALL app data in Supabase (not just branding): run `db/08` + `db/09`,
then set `localStorage.kabi_db_backend = '1'`. RLS is required (anon key is public).

## Notes
- No backend & no Supabase table → the app runs fully in the browser (localStorage),
  branding stays per-browser.
- `window.KABI_PROXY_URL` empty → uses `http://localhost:8100` for local dev.
