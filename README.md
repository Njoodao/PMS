# KABi Performance Management System

An evidence-based performance-management platform: a **single-file web app** (frontend)
plus an optional **FastAPI integration proxy** (backend) and an optional **Supabase**
data layer. The app runs standalone in the browser by default (localStorage); the
backend and Supabase are additive for live integrations and shared data.

---

## Repository layout

### Frontend — required at runtime (static, no build)
| File | Purpose |
|---|---|
| `index.html` | The entire app (UI, logic, LLM client, governance layer) |
| `06_kabiDb.js` | Supabase data adapter (only used when Supabase is enabled) |
| `07_kabiKpiKnowledge.js` | Per-function KPI knowledge packs |
| `09_kabiKpiLibrary.js` | The 696-KPI enterprise library (from the 2026 Career Excel) |
| `10_kabiEvalCopilot.js` | Evaluation Copilot agent |
| `11_kabiEvalCopilotUI.js` | Evaluation Copilot UI |

> These six files must sit **together at the served root** — `index.html` loads the
> others via relative `./` paths. External libs (Supabase, SheetJS, EmailJS, Google
> Fonts) load from CDNs at runtime, so no bundling is needed.

### Backend — optional (`backend/`)
FastAPI proxy for live LLM providers + connectors (Jira/Pipedrive) + server-side
Copilot governance. See [`backend/README.md`](backend/README.md).
`main.py` · `requirements.txt` · `.env.example` · `Dockerfile` · `Procfile` · `.dockerignore`

### Database — optional
`08_levels_migration.sql` — schema/migration reference for the Supabase backend.

### Deployment scaffolding (this PR)
`.gitignore` · `render.yaml` · this `README.md`

### Reference / source docs (optional — safe to keep or move to `/docs`)
The `*.md` handoff notes, `*.pdf`, `*.pptx`, and `*.xlsx` source files (including
`KABi_Enterprise_KPI_Library_2026_Career_Enhanced.xlsx`, the source for
`09_kabiKpiLibrary.js`) and `KABi Performance System.html` (design prototype). None
are needed to run the app.

---

## Deploy the frontend (static — zero build)

Any static host works because the app is plain HTML/JS.

**GitHub Pages:** push the repo, then Settings → Pages → Source = `main` / root. Visit
`https://<user>.github.io/<repo>/`.

**Netlify / Vercel / Cloudflare Pages:** "Import repo", **no build command**, publish
directory = repo root. Done.

That's the whole app — it runs immediately in **localStorage mode** (no backend, no DB).

## Deploy the backend (optional)

Only needed for **live** LLM calls that a browser can't make (CORS/key-safety), live
Jira/Pipedrive connectors, or server-side governance/audit.

```bash
cd backend
cp .env.example .env      # fill in only the keys you use — NEVER commit .env
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8100
```

- **Docker:** `docker build -t kabi-proxy backend && docker run -p 8100:8100 --env-file backend/.env kabi-proxy`
- **Render / Railway / Fly:** use the included `render.yaml` (Blueprint) or `backend/Procfile`. Set secrets in the host's dashboard, **not** in the repo.
- Point the app at it: in the browser console (or a small bootstrap), set
  `window.KABI_PROXY_URL = "https://your-proxy"`. The AI Engine's Kimi base URL can be
  set to `.../llm/moonshot/v1`. See `backend/README.md`.

## Optional: Supabase (shared data instead of localStorage)

1. Create a Supabase project and run `08_levels_migration.sql`.
2. In `index.html` (top `<script>`), replace `SUPABASE_URL` + `SUPABASE_ANON_KEY` with
   **your project's** values. *(The anon key is public-by-design and protected by Row
   Level Security — but use your own project's key, not the sample one.)*
3. Enable it at runtime: `localStorage.setItem('kabi_db_backend','1')` then reload.
   Default (unset) = safe localStorage mode.

---

## Configuration & secrets

| Value | Where it lives | Commit? |
|---|---|---|
| LLM API keys (Anthropic/OpenRouter/Groq/Kimi) | Entered in-app (AI Engine) → browser localStorage; or the proxy's `.env` | ❌ never |
| Connector tokens (Jira/Pipedrive) | Proxy `.env` (server-side) | ❌ never |
| Supabase URL + **anon** key | `index.html` | ✅ public-by-design (RLS); use your own |
| Supabase service_role key | never used client-side | ❌ never |
| Roster + audit log | proxy `KABI_ROSTER_PATH` / `KABI_AUDIT_PATH` | ❌ ignored by `.gitignore` |

`.gitignore` already excludes `.env`, audit logs, exported rosters, `__pycache__`, and
virtualenvs.

---

## Minimal upload for "just the app"

If you only want the running app on GitHub Pages, these are the **required** files:

```
index.html
06_kabiDb.js
07_kabiKpiKnowledge.js
09_kabiKpiLibrary.js
10_kabiEvalCopilot.js
11_kabiEvalCopilotUI.js
```

Add `backend/`, `render.yaml`, `08_levels_migration.sql` when you want the proxy /
Supabase. Everything else is documentation.
