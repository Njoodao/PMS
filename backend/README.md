# KABi Integration Proxy (FastAPI)

A thin backend that sits between the single-file KABi frontend and every
external service (LLM providers + connectors). It answers the question you
asked — *"could FastAPI make any integration integrate successfully and more
stable?"* — **yes**, and this is that layer.

## Why it exists

The KABi app is a single HTML file that runs in the browser. A browser **cannot**:

| Limitation in the browser | What the proxy does |
|---|---|
| CORS blocks most provider/enterprise APIs (Jira, Pipedrive, and often Kimi) | Calls them **server-to-server** — no CORS |
| API keys sit in `localStorage` (exposed) | Keys live in this server's **`.env`**, never shipped to the browser |
| No retries / rate-limit / OAuth / webhooks / scheduled sync | One stable place to add all of it |

So integrations become **reliable and stable**, and *any* OpenAI-compatible or
REST service can be added here without touching the frontend.

## Run it

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env          # fill in only the keys you use
uvicorn main:app --reload --port 8100
```

Check it: open <http://localhost:8100/health> — it lists which providers/
connectors are configured. Interactive API docs: <http://localhost:8100/docs>.

## Point the KABi app at it (minimal change)

Every LLM provider KABi supports is OpenAI-compatible, and the app already has a
base-URL override. In the browser console (or your bootstrap config) set:

```js
window.KABi_LLM_Config = window.KABi_LLM_Config || {};
window.KABi_LLM_Config.moonshotBaseUrl = "http://localhost:8100/llm/moonshot/v1";
```

Now the app's existing Kimi path calls the proxy instead of Moonshot directly —
**CORS-safe and key-safe** (the key can live in the proxy's `.env`, so you don't
even paste it into the app). The same pattern works for `groq` and `openrouter`
(`.../llm/groq/v1`, `.../llm/openrouter/v1`), and `.../llm/anthropic/v1` exposes
Anthropic's native Messages endpoint.

> When `.env` holds the provider key, the proxy uses it and ignores the browser.
> When it doesn't, the proxy forwards the key the browser sends — so it works
> immediately during migration, then gets more secure once you fill in `.env`.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness + which integrations are configured |
| `POST /llm/{provider}/v1/chat/completions` | OpenAI-compatible passthrough (`moonshot` / `groq` / `openrouter`) — drop-in for the app |
| `POST /llm/anthropic/v1/messages` | Anthropic native passthrough |
| `POST /llm/chat` | **Normalized** `{provider, model, messages, system, max_tokens}` → `{text, model, usage}` (recommended for new code) |
| `GET /connectors/jira/search?jql=...` | Server-side Jira search (evidence for the Eval Copilot) |
| `GET /connectors/pipedrive/deals` | Server-side Pipedrive deals (sales outcomes) |
| `GET /copilot/context` | Server-resolved AUTH_CONTEXT (capabilities + scope) for the caller |
| `GET /copilot/employee/{id}` | Employee data **only if in-scope + capable** — else 403; every access audited |
| `GET /copilot/audit?limit=50` | Recent audit entries (org-level access only) |

## Copilot governance (P3 — the real security boundary)

The client app has a capability layer, but that's a **UX guardrail** (client JS is
editable). These `/copilot/*` endpoints are the **enforcement boundary**: the proxy
independently resolves each user's capabilities + scope from the **org roster** (the
source of truth) — it **never trusts a client-sent capability set** — filters data to
the authorized scope, and **audit-logs every access decision** (allow *and* deny).

- **Identity:** the caller is identified by the `X-KABi-User` header. **In production
  this MUST come from a verified session / SSO token, not a client-settable header** —
  the header is the scaffold's stand-in.
- **Roster:** set `KABI_ROSTER_PATH` to a JSON export of your org
  (`{config, users, employees}` — see `.env.example` for the shape). The app can
  generate it in the browser console with **`kabiExportRoster()`** (downloads
  `kabi_roster.json`). In production, point this at your HRIS/DB instead.
- **Audit:** every employee-data access is appended to `KABI_AUDIT_PATH` (JSONL:
  `ts, user, action, entity, capability, decision`). Read it back via `/copilot/audit`
  (org-level access only).

Behaviour verified: manager sees a direct report (200) but an outsider is **denied
(403)**; super admin sees anyone; a **COO-by-title resolves to `is_ceo:false`** (no CEO
authorization); no identity → 401; no roster → 503; every decision lands in the audit log.

## Production notes

- Set `ALLOWED_ORIGINS` to your real deployment origin(s) — do **not** ship `*`.
- Put this behind HTTPS (a reverse proxy such as Nginx/Caddy, or a platform like
  Render/Railway/Fly/Azure App Service).
- Add auth between the frontend and this proxy (session cookie or a short-lived
  token) so only signed-in KABi users can spend your provider credits.
- Extend the connector section with the systems you use (Slack, MS Graph,
  Qualtrics, HRIS) following the Jira/Pipedrive pattern.
