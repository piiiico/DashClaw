#!/usr/bin/env python3
"""
Hermes Agent on_session_end hook for DashClaw.

Fires at the end of every `run_conversation()` call. Sends a finalize
signal to `/api/code-sessions/ingest-live` so the server can run the
optimizer + alerts pass on the now-complete session.

Never blocks. Best-effort.
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dashclaw_common import (  # noqa: E402
    AGENT_ID,
    WORKSPACE,
    api_request,
    derive_slug,
    emit_noop,
    log_error,
    post_handoff_create,
    read_cache,
    read_stdin_json,
)


def _utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _summarize_session(data: dict, state: dict) -> str:
    """Best-effort 1-2 sentence wrap-up. Falls back to a generic line."""
    turns = state.get("turns_recorded") or data.get("turn_count") or "?"
    tools = data.get("tools_used") or []
    last_tool = (data.get("last_tool_use") or {}).get("name") or "—"
    tool_str = ", ".join(tools[:5]) if tools else "—"
    return (
        f"Wrapped session with {turns} turns; last tool: {last_tool}. "
        f"Touched: {tool_str}."
    )


def _collect_open_loops(agent_id: str) -> list:
    try:
        resp = api_request("GET", f"/api/actions/loops?agent_id={agent_id}&status=open", timeout=3)
        return ((resp or {}).get("loops") or [])[:10]
    except Exception as e:
        log_error("on_session_end", f"_collect_open_loops failed: {type(e).__name__}: {e}")
        return []


def _collect_recent_decisions(agent_id: str) -> list:
    try:
        resp = api_request("GET", f"/api/guard/decisions?agent_id={agent_id}&limit=10", timeout=3)
        return ((resp or {}).get("decisions") or [])[:10]
    except Exception as e:
        log_error("on_session_end", f"_collect_recent_decisions failed: {type(e).__name__}: {e}")
        return []


def main() -> int:
    data = read_stdin_json()
    session_id = data.get("session_id") or ""
    if not session_id:
        emit_noop()
        return 0

    state = read_cache(session_id, suffix="session")
    payload = {
        "session_uuid": session_id,
        "agent_id": AGENT_ID,
        "finalize": True,
        "project": {
            "slug": state.get("slug") or derive_slug(WORKSPACE),
            "cwd": state.get("workspace") or WORKSPACE,
            "source_host": "hook",
        },
        "ended_at": datetime.now(timezone.utc).isoformat(),
        "completed": bool(data.get("completed", True)),
        "interrupted": bool(data.get("interrupted", False)),
    }

    try:
        result = api_request("POST", "/api/code-sessions/ingest-live", body=payload, timeout=8)
        if not result:
            log_error("on_session_end", "ingest-live finalize returned None")
    except Exception as e:
        log_error("on_session_end", f"{type(e).__name__}: {e}")

    # Best-effort handoff for the next session of the same agent.
    try:
        bundle = {
            "summary": _summarize_session(data, state),
            "open_loops": _collect_open_loops(AGENT_ID),
            "decisions_made": _collect_recent_decisions(AGENT_ID),
            "state_snapshot": data.get("state") or {},
            "generated_at": _utc_iso(),
        }
        handoff_id = post_handoff_create(
            agent_id=AGENT_ID,
            project_id=data.get("project_id"),
            bundle=bundle,
        )
        if handoff_id:
            log_error("on_session_end", f"handoff created: {handoff_id}")
    except Exception as e:
        log_error("on_session_end", f"handoff_create failed: {type(e).__name__}: {e}")

    emit_noop()
    return 0


if __name__ == "__main__":
    sys.exit(main())
