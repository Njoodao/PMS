"""
KABi Performance System — Integration Proxy (FastAPI)
=====================================================
A thin, production-oriented backend that sits between the single-file KABi
frontend and every external service. It exists to solve the three things a
browser-only app cannot do safely or reliably:

  1. CORS         — browsers block direct calls to most provider/enterprise
                    APIs (Anthropic needs a special header; Jira/Pipedrive
                    block browser origins entirely). Server-to-server calls
                    have no CORS problem.
  2. Key security — API keys live in this server's .env, never in the browser
                    (today the POC keeps them in localStorage; this removes
                    that exposure for production).
  3. Reliability  — one stable surface for retries, timeouts, rate-limit
                    handling, OAuth/token refresh, webhooks and scheduled syncs.

Design goal: the frontend needs the SMALLEST possible change to adopt this.
Because every LLM provider KABi supports (OpenRouter, Groq, Kimi/Moonshot) is
OpenAI-compatible, this exposes an OpenAI-compatible passthrough per provider:

    POST /llm/{provider}/v1/chat/completions

so in the app's AI Engine you only set:

    window.KABi_LLM_Config.moonshotBaseUrl = "http://localhost:8100/llm/moonshot/v1"

…and the existing `_callMoonshot` code works unchanged, now key-safe + CORS-safe.
There is also a normalized `POST /llm/chat` for new integrations, and connector
proxies for Jira and Pipedrive.

Run:
    pip install -r requirements.txt
    cp .env.example .env          # then fill in the keys you actually use
    uvicorn main:app --reload --port 8100
"""

from __future__ import annotations

import os
from typing import Any, Optional

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

load_dotenv()

app = FastAPI(title="KABi Integration Proxy", version="1.0.0")

# ── CORS ────────────────────────────────────────────────────────────────────
# The KABi frontend may be served from a static host, file://, or a dev server.
# Lock ALLOWED_ORIGINS down to your real deployment origin(s) in production.
_origins_env = os.getenv("ALLOWED_ORIGINS", "*")
_allow_origins = ["*"] if _origins_env.strip() == "*" else [
    o.strip() for o in _origins_env.split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allow_origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Provider registry ─────────────────────────────────────────────────────────
# Each provider: upstream base URL + the env var holding its server-side key +
# the auth style. All the OpenAI-compatible ones share one passthrough handler.
PROVIDERS: dict[str, dict[str, Any]] = {
    "moonshot": {  # Kimi / Moonshot AI
        "base": os.getenv("MOONSHOT_BASE_URL", "https://api.moonshot.ai/v1"),
        "key_env": "MOONSHOT_API_KEY",
        "auth": "bearer",
        "default_model": os.getenv("MOONSHOT_MODEL", "moonshot-v1-auto"),
    },
    "openrouter": {
        "base": "https://openrouter.ai/api/v1",
        "key_env": "OPENROUTER_API_KEY",
        "auth": "bearer",
        "default_model": os.getenv("OPENROUTER_MODEL", "openai/gpt-5.6-terra"),
        "extra_headers": {"X-Title": "KABi PMS"},
    },
    "groq": {
        "base": "https://api.groq.com/openai/v1",
        "key_env": "GROQ_API_KEY",
        "auth": "bearer",
        "default_model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
    },
    "anthropic": {  # NOT OpenAI-compatible — handled specially
        "base": "https://api.anthropic.com/v1",
        "key_env": "ANTHROPIC_API_KEY",
        "auth": "x-api-key",
        "default_model": os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6"),
    },
}

HTTP_TIMEOUT = httpx.Timeout(60.0, connect=10.0)


def _server_key(provider: str) -> Optional[str]:
    cfg = PROVIDERS.get(provider)
    if not cfg:
        return None
    return os.getenv(cfg["key_env"]) or None


def _resolve_key(provider: str, request: Request) -> str:
    """Prefer the server-side key (secure). Fall back to a client-forwarded
    Authorization header so the proxy still works before .env is populated."""
    key = _server_key(provider)
    if key:
        return key
    auth = request.headers.get("authorization", "")
    if auth.lower().startswith("bearer "):
        return auth[7:].strip()
    if auth:
        return auth.strip()
    raise HTTPException(
        status_code=401,
        detail=f"No API key for '{provider}'. Set {PROVIDERS[provider]['key_env']} "
        f"in .env, or send it as an Authorization: Bearer header.",
    )


# ── Health ──────────────────────────────────────────────────────────────────
@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "kabi-integration-proxy",
        "llm_providers": {
            name: {"configured": bool(_server_key(name)), "base": cfg["base"]}
            for name, cfg in PROVIDERS.items()
        },
        "connectors": {
            "jira": bool(os.getenv("JIRA_BASE_URL") and os.getenv("JIRA_API_TOKEN")),
            "pipedrive": bool(os.getenv("PIPEDRIVE_API_TOKEN")),
        },
        "copilot_governance": {
            "roster_loaded": _load_roster() is not None,
            "audit_path": os.getenv("KABI_AUDIT_PATH", "audit.jsonl"),
        },
    }


# ── OpenAI-compatible passthrough (OpenRouter / Groq / Kimi-Moonshot) ─────────
@app.post("/llm/{provider}/v1/chat/completions")
async def openai_passthrough(provider: str, request: Request):
    """Drop-in for the app's existing `_callMoonshot`/`_callGroq`/`_callOpenRouter`.
    Point `moonshotBaseUrl` (etc.) at `.../llm/moonshot/v1` and it just works —
    with the key held here, not in the browser."""
    provider = provider.lower()
    cfg = PROVIDERS.get(provider)
    if not cfg or cfg["auth"] != "bearer":
        raise HTTPException(status_code=404, detail=f"Unknown OpenAI-compatible provider '{provider}'.")

    body = await request.json()
    body.setdefault("model", cfg["default_model"])
    key = _resolve_key(provider, request)

    headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
    headers.update(cfg.get("extra_headers", {}))

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        try:
            resp = await client.post(f"{cfg['base']}/chat/completions", json=body, headers=headers)
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Upstream {provider} unreachable: {e}")
    return JSONResponse(status_code=resp.status_code, content=_safe_json(resp))


# ── Anthropic passthrough (native Messages API) ───────────────────────────────
@app.post("/llm/anthropic/v1/messages")
async def anthropic_passthrough(request: Request):
    body = await request.json()
    body.setdefault("model", PROVIDERS["anthropic"]["default_model"])
    key = _resolve_key("anthropic", request)
    headers = {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": request.headers.get("anthropic-version", "2023-06-01"),
    }
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        try:
            resp = await client.post(f"{PROVIDERS['anthropic']['base']}/messages", json=body, headers=headers)
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Upstream anthropic unreachable: {e}")
    return JSONResponse(status_code=resp.status_code, content=_safe_json(resp))


# ── Normalized LLM endpoint (recommended for new integrations) ────────────────
class ChatRequest(BaseModel):
    provider: str = "moonshot"
    model: Optional[str] = None
    messages: list[dict[str, Any]]
    system: Optional[str] = None
    max_tokens: int = 1500
    temperature: Optional[float] = None


@app.post("/llm/chat")
async def llm_chat(req: ChatRequest, request: Request):
    """One shape in, one shape out: {text, model, usage}. Routes to any provider
    and normalizes the response so callers don't care which backend answered."""
    provider = req.provider.lower()
    cfg = PROVIDERS.get(provider)
    if not cfg:
        raise HTTPException(status_code=404, detail=f"Unknown provider '{provider}'.")
    key = _resolve_key(provider, request)
    model = req.model or cfg["default_model"]

    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        if cfg["auth"] == "x-api-key":  # Anthropic
            payload: dict[str, Any] = {"model": model, "max_tokens": req.max_tokens, "messages": req.messages}
            if req.system:
                payload["system"] = req.system
            if req.temperature is not None:
                payload["temperature"] = req.temperature
            headers = {"Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01"}
            try:
                resp = await client.post(f"{cfg['base']}/messages", json=payload, headers=headers)
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"Upstream anthropic unreachable: {e}")
            data = _safe_json(resp)
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=data)
            text = "\n".join(b.get("text", "") for b in data.get("content", []) if b.get("type") == "text").strip()
            usage = data.get("usage", {})
            return {"text": text, "model": data.get("model", model),
                    "usage": {"input_tokens": usage.get("input_tokens", 0), "output_tokens": usage.get("output_tokens", 0)}}
        else:  # OpenAI-compatible
            msgs = ([{"role": "system", "content": req.system}] + req.messages) if req.system else req.messages
            payload = {"model": model, "messages": msgs, "max_tokens": req.max_tokens}
            if req.temperature is not None:
                payload["temperature"] = req.temperature
            headers = {"Content-Type": "application/json", "Authorization": f"Bearer {key}"}
            headers.update(cfg.get("extra_headers", {}))
            try:
                resp = await client.post(f"{cfg['base']}/chat/completions", json=payload, headers=headers)
            except httpx.RequestError as e:
                raise HTTPException(status_code=502, detail=f"Upstream {provider} unreachable: {e}")
            data = _safe_json(resp)
            if resp.status_code >= 400:
                raise HTTPException(status_code=resp.status_code, detail=data)
            choice = (data.get("choices") or [{}])[0]
            usage = data.get("usage", {})
            return {"text": (choice.get("message", {}).get("content") or "").strip(),
                    "model": data.get("model", model),
                    "usage": {"input_tokens": usage.get("prompt_tokens", 0), "output_tokens": usage.get("completion_tokens", 0)}}


# ── Connector: Jira (evidence for the Eval Copilot) ───────────────────────────
@app.get("/connectors/jira/search")
async def jira_search(jql: str, max_results: int = 50):
    """Server-side Jira search — no CORS, credentials stay here.
    Requires JIRA_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env."""
    base = os.getenv("JIRA_BASE_URL")
    email = os.getenv("JIRA_EMAIL")
    token = os.getenv("JIRA_API_TOKEN")
    if not (base and email and token):
        raise HTTPException(status_code=503, detail="Jira not configured (JIRA_BASE_URL / JIRA_EMAIL / JIRA_API_TOKEN).")
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, auth=(email, token)) as client:
        try:
            resp = await client.get(
                f"{base.rstrip('/')}/rest/api/3/search",
                params={"jql": jql, "maxResults": max_results},
                headers={"Accept": "application/json"},
            )
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Jira unreachable: {e}")
    return JSONResponse(status_code=resp.status_code, content=_safe_json(resp))


# ── Connector: Pipedrive (sales outcomes for the Eval Copilot) ────────────────
@app.get("/connectors/pipedrive/deals")
async def pipedrive_deals(status: str = "all_not_deleted", limit: int = 100):
    """Server-side Pipedrive deals — token stays here. Requires PIPEDRIVE_API_TOKEN
    (+ optional PIPEDRIVE_BASE_URL for a company domain)."""
    token = os.getenv("PIPEDRIVE_API_TOKEN")
    if not token:
        raise HTTPException(status_code=503, detail="Pipedrive not configured (PIPEDRIVE_API_TOKEN).")
    base = os.getenv("PIPEDRIVE_BASE_URL", "https://api.pipedrive.com/v1")
    async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as client:
        try:
            resp = await client.get(
                f"{base.rstrip('/')}/deals",
                params={"status": status, "limit": limit, "api_token": token},
            )
        except httpx.RequestError as e:
            raise HTTPException(status_code=502, detail=f"Pipedrive unreachable: {e}")
    return JSONResponse(status_code=resp.status_code, content=_safe_json(resp))


# ═══════════════════════════════════════════════════════════════════════════
# P3 — SERVER-SIDE COPILOT GOVERNANCE (authorization enforcement + audit)
# ───────────────────────────────────────────────────────────────────────────
# The client capability layer is a UX guardrail. THIS is the security boundary:
# the proxy independently resolves each user's capabilities + scope from the org
# ROSTER (the source of truth) — it never trusts a client-sent capability set —
# filters data to the authorized scope, and audit-logs every access decision.
#
# The requesting user's identity arrives in X-KABi-User. IN PRODUCTION this MUST
# be derived from a verified session / SSO token, NOT a client-settable header;
# the header is the scaffold's stand-in for that verified identity.
# ═══════════════════════════════════════════════════════════════════════════
import json as _json
from datetime import datetime, timezone

_CAP_KEYS = [
    "view_self_profile", "view_self_assigned_kpis", "view_self_final_result",
    "view_direct_reports", "view_indirect_reports", "view_team_kpi_progress",
    "view_department_aggregates", "view_org_aggregates", "view_org_individual_results",
    "generate_kpis", "validate_kpis", "submit_kpis", "review_kpi_submissions", "approve_kpi_submissions",
    "evaluate_direct_reports", "submit_evaluations", "review_all_evaluations", "approve_evaluations",
    "request_score_edit", "approve_score_edit", "manage_evaluation_cycles", "manage_weights_and_scoring",
    "manage_inviews", "manage_connectors", "manage_people_and_access", "release_results",
    "export_team_data", "export_org_data", "send_notifications",
    "view_team_performance_tracker", "view_department_insights", "view_calibration_insights",
]

_ROSTER_CACHE: dict[str, Any] = {"path": None, "mtime": None, "data": None}


def _load_roster() -> Optional[dict]:
    """Org source of truth: {employees:[...], users:{email:{role,isCEO,hasManagerPortal,
    kpiAccess,fnAccess,viewIndirect,viewOrg,hcActions}}, config:{resultsVisible}}.
    In production this is your HRIS/DB; here it's a JSON file the app can export.
    Path via KABI_ROSTER_PATH. Cached by mtime."""
    path = os.getenv("KABI_ROSTER_PATH")
    if not path or not os.path.exists(path):
        return None
    try:
        mtime = os.path.getmtime(path)
        if _ROSTER_CACHE["path"] == path and _ROSTER_CACHE["mtime"] == mtime:
            return _ROSTER_CACHE["data"]
        with open(path, "r", encoding="utf-8") as f:
            data = _json.load(f)
        _ROSTER_CACHE.update({"path": path, "mtime": mtime, "data": data})
        return data
    except Exception:
        return None


def _audit(user: str, action: str, entity: Any, capability: str, decision: str, extra: Optional[dict] = None) -> None:
    """Append-only audit trail — every access decision that touches employee data."""
    rec = {
        "ts": datetime.now(timezone.utc).isoformat(),
        "user": user, "action": action, "entity": entity,
        "capability": capability, "decision": decision,
    }
    if extra:
        rec.update(extra)
    try:
        with open(os.getenv("KABI_AUDIT_PATH", "audit.jsonl"), "a", encoding="utf-8") as f:
            f.write(_json.dumps(rec, ensure_ascii=False) + "\n")
    except Exception:
        pass


def _resolve_auth(email: str, roster: dict) -> dict:
    """AUTHORITATIVE, server-side AUTH_CONTEXT — mirrors the client
    kabiBuildAuthContext but is the source of truth. Never trusts client input."""
    email = (email or "").lower()
    users = roster.get("users", {}) or {}
    employees = roster.get("employees", []) or []
    cfg = roster.get("config", {}) or {}
    u = users.get(email, {}) or {}
    emp = next((e for e in employees if (e.get("email") or "").lower() == email), None)
    role = (u.get("role") or "").lower()
    is_ceo = bool(u.get("isCEO") or role == "ceo")
    is_former = bool(emp and emp.get("isFormer"))
    is_fte = (not emp) or (not emp.get("employmentType")) or emp.get("employmentType") == "fte"
    is_super = role == "pm_super_admin"
    is_hc = role in ("hc", "hc_admin")
    is_scoped = role in {"product_admin", "tech_admin", "commercial_admin", "ops_admin", "finance_admin"}
    results_released = bool(cfg.get("resultsVisible"))

    # Reporting tree (active only) — direct + all descendants
    by_mgr: dict[str, list] = {}
    for e in employees:
        if e.get("isFormer"):
            continue
        by_mgr.setdefault((e.get("mgr") or "").lower(), []).append(e)
    direct = by_mgr.get(email, [])
    direct_ids = [e.get("id") for e in direct]
    all_reports, stack, seen = [], list(direct), set()
    while stack:
        e = stack.pop()
        eid = str(e.get("id"))
        if eid in seen:
            continue
        seen.add(eid)
        all_reports.append(e)
        stack.extend(by_mgr.get((e.get("email") or "").lower(), []))
    indirect_ids = [e.get("id") for e in all_reports if e.get("id") not in direct_ids]

    has_mgr_portal = bool(u.get("hasManagerPortal"))
    is_manager = has_mgr_portal or len(direct_ids) > 0
    kpi_access = bool(u.get("kpiAccess") or (emp and emp.get("kpiAccess")))
    permitted_fns = list(u.get("fnAccess") or (emp.get("fnAccess") if emp else []) or (
        ([emp.get("fn")] if emp and isinstance(emp.get("fn"), str) else (emp.get("fn") if emp else [])) or []))

    caps = {k: False for k in _CAP_KEYS}
    if not is_former:
        caps["view_self_profile"] = True
        caps["view_self_assigned_kpis"] = True
        caps["view_self_final_result"] = results_released
        if is_manager:
            caps["view_direct_reports"] = True
            caps["view_indirect_reports"] = bool(u.get("viewIndirect") or (emp and emp.get("viewIndirect")))
            caps["view_team_kpi_progress"] = bool(emp and emp.get("teamTracker"))
            caps["view_team_performance_tracker"] = bool(emp and emp.get("teamTracker"))
            caps["view_department_insights"] = bool(emp and emp.get("deptInsight"))
            caps["evaluate_direct_reports"] = True
            caps["submit_evaluations"] = True
            caps["request_score_edit"] = True
            caps["export_team_data"] = True
            caps["send_notifications"] = True
            if kpi_access:
                caps["generate_kpis"] = caps["validate_kpis"] = caps["submit_kpis"] = True
        if is_scoped:
            caps["generate_kpis"] = caps["validate_kpis"] = True
            caps["review_kpi_submissions"] = True
            caps["view_department_aggregates"] = True
        if is_hc:
            caps["review_kpi_submissions"] = True
            caps["review_all_evaluations"] = True
            caps["view_calibration_insights"] = True
            caps["view_department_aggregates"] = True
            caps["send_notifications"] = True
            if u.get("viewOrg"):
                caps["view_org_aggregates"] = True
        if is_super:
            for k in _CAP_KEYS:
                caps[k] = True
        if is_ceo:
            caps["view_org_aggregates"] = True
            caps["view_department_aggregates"] = True
            caps["view_org_individual_results"] = True
            caps["view_calibration_insights"] = True
            caps["review_kpi_submissions"] = True
            caps["export_org_data"] = True
            if u.get("hcActions"):
                caps["manage_weights_and_scoring"] = caps["manage_evaluation_cycles"] = caps["release_results"] = True
    if is_former:
        caps = {k: False for k in _CAP_KEYS}
    if not is_fte:
        caps["evaluate_direct_reports"] = caps["submit_evaluations"] = False
        caps["generate_kpis"] = caps["validate_kpis"] = caps["submit_kpis"] = False

    portal = ("former" if is_former else "executive" if is_ceo
              else "admin" if (is_super or is_hc or is_scoped) else "manager" if is_manager else "employee")
    return {
        "corporate_email": email, "employee_id": emp.get("id") if emp else None,
        "role": role, "portal_mode": portal, "is_fte": is_fte, "is_former": is_former,
        "is_ceo": is_ceo, "is_super_admin": is_super,
        "direct_report_ids": direct_ids, "indirect_report_ids": indirect_ids,
        "permitted_function_ids": permitted_fns, "results_released": results_released,
        "capabilities": caps,
    }


def _emp_in_scope(ctx: dict, emp_id: Any) -> bool:
    if ctx.get("is_super_admin") or ctx["capabilities"].get("view_org_individual_results"):
        return True
    if str(ctx.get("employee_id")) == str(emp_id):
        return True
    if str(emp_id) in map(str, ctx.get("direct_report_ids", [])):
        return True
    if ctx["capabilities"].get("view_indirect_reports") and str(emp_id) in map(str, ctx.get("indirect_report_ids", [])):
        return True
    return False


def _require_ctx(x_kabi_user: Optional[str]) -> dict:
    if not x_kabi_user:
        raise HTTPException(status_code=401, detail="Missing X-KABi-User (in production, derive from the verified session).")
    roster = _load_roster()
    if not roster:
        raise HTTPException(status_code=503, detail="Roster not configured — set KABI_ROSTER_PATH to the exported org JSON.")
    return _resolve_auth(x_kabi_user, roster)


@app.get("/copilot/context")
async def copilot_context(x_kabi_user: Optional[str] = Header(default=None)):
    """Server-resolved AUTH_CONTEXT for the authenticated user — the authoritative
    capabilities + scope the model/UI must obey."""
    ctx = _require_ctx(x_kabi_user)
    _audit(ctx["corporate_email"], "context", None, "-", "allow")
    return ctx


@app.get("/copilot/employee/{emp_id}")
async def copilot_employee(emp_id: str, x_kabi_user: Optional[str] = Header(default=None)):
    """Return an employee's data ONLY if the requester is in-scope and capable.
    Out-of-scope requests are denied here (server-side), not merely hidden — and
    every decision is audited."""
    ctx = _require_ctx(x_kabi_user)
    if not _emp_in_scope(ctx, emp_id):
        _audit(ctx["corporate_email"], "view_employee", emp_id, "scope", "deny")
        raise HTTPException(status_code=403, detail="Employee is outside your authorized scope.")
    roster = _load_roster() or {}
    emp = next((e for e in roster.get("employees", []) if str(e.get("id")) == str(emp_id)), None)
    if not emp:
        _audit(ctx["corporate_email"], "view_employee", emp_id, "-", "not_found")
        raise HTTPException(status_code=404, detail="Employee not found.")
    if emp.get("isFormer"):
        _audit(ctx["corporate_email"], "view_employee", emp_id, "-", "deny_former")
        raise HTTPException(status_code=409, detail="Former employee — excluded from active scope.")
    # Minimum-necessary, capability-aware projection
    out = {"id": emp.get("id"), "name": emp.get("name"), "title": emp.get("title"),
           "dept": emp.get("dept"), "level": emp.get("level"), "mgrName": emp.get("mgrName")}
    if ctx["capabilities"].get("view_team_kpi_progress") or ctx["capabilities"].get("view_org_individual_results") or str(ctx.get("employee_id")) == str(emp_id):
        out["kpiAccessible"] = True
    if ctx.get("results_released") and (str(ctx.get("employee_id")) == str(emp_id) or ctx["capabilities"].get("view_org_individual_results")):
        out["finalResultVisible"] = True
    _audit(ctx["corporate_email"], "view_employee", emp_id, "scope", "allow")
    return out


@app.get("/copilot/audit")
async def copilot_audit(limit: int = 50, x_kabi_user: Optional[str] = Header(default=None)):
    """Recent audit entries — visible only to accounts that can review the org
    (super admin / org-view)."""
    ctx = _require_ctx(x_kabi_user)
    if not (ctx.get("is_super_admin") or ctx["capabilities"].get("view_org_aggregates")):
        _audit(ctx["corporate_email"], "view_audit", None, "view_org_aggregates", "deny")
        raise HTTPException(status_code=403, detail="Audit log requires org-level access.")
    path = os.getenv("KABI_AUDIT_PATH", "audit.jsonl")
    rows: list[dict] = []
    try:
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                lines = f.readlines()[-max(1, min(limit, 500)):]
            rows = [_json.loads(ln) for ln in lines if ln.strip()]
    except Exception:
        pass
    return {"count": len(rows), "entries": rows}


def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except Exception:
        return {"error": {"message": resp.text[:2000], "status": resp.status_code}}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", "8100")), reload=True)
