# KABi Performance Management System (PMS)

A white-label, evidence-based performance-management app: a single-file frontend
(`index.html`) plus an **optional** FastAPI backend for LLM key-safety, connectors
(Jira / Pipedrive), and **cross-device shared branding**.

## Repository layout

```
.
├── index.html                    # The app (host statically, or open directly)
├── 06_kabiDb.js                  # Supabase data layer (used only if Supabase is on)
├── 07_kabiKpiKnowledge.js        # KPI knowledge packs
├── 09_kabiKpiLibrary.js          # Level-specific KPI library (696 KPIs)
├── 10_kabiEvalCopilot.js         # Evaluation copilot (agent)
├── 11_kabiEvalCopilotUI.js       # Evaluation copilot UI
├── backend/                      # FastAPI integration proxy (optional, recommended)
│   ├── main.py                   #   LLM passthrough + /branding + connectors + governance
│   ├── requirements.txt
│   ├── Dockerfile
│   ├── Procfile
│   └── .env.example              #   copy to .env and fill only the keys you use
├── db/                           # Supabase SQL — run once, ONLY if you enable Supabase
│   ├── 08_levels_migration.sql
│   └── 09_rls_policies.sql
├── render.yaml                   # Render Blueprint: backend + static frontend
└── .github/workflows/static.yml  # GitHub Pages deploy for the frontend
```

> ⚠️ The five `*.js` files must stay in the **same folder** as `index.html` — it
> loads them by relative path (`./06_kabiDb.js`, …).

## Deploy

### Option A — Render (backend + frontend from one Blueprint)
1. Push this repo to GitHub.
2. Render → **New → Blueprint** → select this repo. `render.yaml` creates:
   - `kabi-proxy` (FastAPI) from `backend/`
   - `kabi-app` (static) serving the repo root
3. On the `kabi-proxy` service, set the secret env vars (API keys, `ALLOWED_ORIGINS`).
4. In `index.html`, set `window.KABI_PROXY_URL` to the `kabi-proxy` URL
   (e.g. `https://kabi-proxy.onrender.com`).

### Option B — GitHub Pages (frontend) + backend elsewhere
1. Enable **GitHub Pages** (Settings → Pages → Source: GitHub Actions). The
   `static.yml` workflow publishes the frontend on every push to `main`.
2. Deploy `backend/` anywhere (Render / Docker) and point the app at it by setting
   `window.KABI_PROXY_URL` in `index.html` to that backend URL.

### Backend environment
Copy `backend/.env.example` → `backend/.env` and fill only what you use:
`ANTHROPIC_API_KEY` / `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `MOONSHOT_API_KEY`,
`JIRA_*`, `PIPEDRIVE_API_TOKEN`, `ALLOWED_ORIGINS`, `KABI_BRAND_PATH`.

### Supabase (optional — OFF by default)
The app runs fully in the browser (localStorage) with zero Supabase setup.
To enable shared multi-user data: run `db/08_levels_migration.sql` then
`db/09_rls_policies.sql` in your Supabase project, fill `window.SUPABASE_*` in
`index.html`, and set `localStorage.kabi_db_backend = '1'`.
**RLS (`09`) is required** — the anon key is public.

## Notes
- **No backend?** The app still works entirely in the browser (localStorage). The
  backend adds LLM key-safety, connectors, and branding that reaches every device.
- `window.KABI_PROXY_URL` left empty → uses `http://localhost:8100` for local dev.
- LLM model is chosen **per provider** automatically (Anthropic → claude-sonnet-4-6,
  Groq → llama-3.3-70b-versatile, OpenRouter → openai/…, Kimi → moonshot-v1-auto).
