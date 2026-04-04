#!/usr/bin/env python3
"""
DashClaw PreToolUse Hook v2 for Claude Code.

Evaluates all 40+ agent tool calls against DashClaw guard policies
using the dashclaw_agent_intel module for semantic classification.

Exit codes:
  0 - Allow the tool to proceed
  2 - Block the tool (Claude Code shows stderr to user)
"""

import json
import os
import sys
import tempfile
import time
import urllib.request
import urllib.error

# ---------------------------------------------------------------------------
# Load .env file (C:/Projects/DashClaw/.env) before reading config.
# Values already in the environment take precedence.
# ---------------------------------------------------------------------------

def _load_dotenv():
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    try:
        with open(env_path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, val = line.partition("=")
                key = key.strip()
                val = val.strip().strip('"').strip("'")
                if " #" in val:
                    val = val[:val.index(" #")].strip()
                if key and key not in os.environ:
                    os.environ[key] = val
    except FileNotFoundError:
        pass

_load_dotenv()

# ---------------------------------------------------------------------------
# Import dashclaw_agent_intel (sibling directory)
# ---------------------------------------------------------------------------

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dashclaw_agent_intel import classify_bash, scan_file_operation, classify_tool, McpHealthMonitor

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = (os.environ.get("DASHCLAW_BASE_URL") or "").rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""
AGENT_ID = os.environ.get("DASHCLAW_AGENT_ID") or "claude-code"
HOOK_MODE = os.environ.get("DASHCLAW_HOOK_MODE") or "enforce"
WORKSPACE = os.environ.get("DASHCLAW_WORKSPACE") or os.getcwd()
PERMISSION_MODE = os.environ.get("DASHCLAW_PERMISSION_MODE") or "danger"
GUARD_TIMEOUT = float(os.environ.get("DASHCLAW_GUARD_TIMEOUT") or "2.5")
APPROVAL_TIMEOUT = float(os.environ.get("DASHCLAW_APPROVAL_TIMEOUT") or "30")

# ---------------------------------------------------------------------------
# Intent-to-action_type mapping
# ---------------------------------------------------------------------------

_INTENT_TO_ACTION: dict[str, str] = {
    "readonly": "review",
    "write": "apply",
    "destructive": "security",
    "network": "api",
    "process_management": "security",
    "package_management": "build",
    "system_admin": "deploy",
    "unknown": "other",
}

# ---------------------------------------------------------------------------
# File-modifying tool names that trigger file scanning
# ---------------------------------------------------------------------------

_FILE_TOOLS = frozenset({"Write", "Edit", "MultiEdit", "NotebookEdit"})


def log(msg):
    """Print to stderr (visible to Claude Code user)."""
    sys.stderr.write(msg + "\n")
    sys.stderr.flush()


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only, no third-party)
# ---------------------------------------------------------------------------

def api_request(method, path, body=None, timeout=None):
    """Make an HTTP request to the DashClaw API. Returns parsed JSON or None."""
    if timeout is None:
        timeout = GUARD_TIMEOUT
    url = BASE_URL + path
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
        method=method,
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None


def guard_check(context):
    """POST /api/guard. Returns response dict or None on failure."""
    return api_request("POST", "/api/guard", body=context)


def create_action(context, status="running"):
    """POST /api/actions. Returns response dict or None on failure."""
    payload = dict(context)
    payload["status"] = status
    return api_request("POST", "/api/actions", body=payload)


def get_action(action_id):
    """GET /api/actions/<id>. Returns response dict or None."""
    return api_request("GET", "/api/actions/" + action_id, timeout=3)


# ---------------------------------------------------------------------------
# Intel enrichment
# ---------------------------------------------------------------------------

def _enrich_bash(tool_input: dict, tool_info: dict) -> dict:
    """Run bash classifier and build enriched intel for a Bash tool call."""
    command = tool_input.get("command") or ""
    bash_intel = classify_bash(command, mode=PERMISSION_MODE, workspace=WORKSPACE)

    # Map bash intent to action_type
    action_type = _INTENT_TO_ACTION.get(bash_intel["intent"], "other")

    # Risk: max of tool base_risk and bash risk_score
    base_risk = tool_info["risk_profile"]["base_risk"]
    risk_score = max(base_risk, bash_intel["risk_score"])

    # Boost for sensitive targets
    parsed = bash_intel.get("parsed", {})
    targets = parsed.get("targets", [])
    redirections = parsed.get("redirections", [])
    all_paths = list(targets) + [r.get("target", "") for r in redirections]

    for path in all_paths:
        if ".." in path.replace("\\", "/").split("/"):
            risk_score += 20
            break
    for path in all_paths:
        if _is_sensitive_path(path):
            risk_score += 15
            break

    risk_score = min(risk_score, 100)

    return {
        "action_type": action_type,
        "risk_score": risk_score,
        "reversible": bash_intel["reversible"],
        "declared_goal": "Bash: " + command[:120],
        "intel": {
            "bash": {
                "intent": bash_intel["intent"],
                "risk_score": bash_intel["risk_score"],
                "reversible": bash_intel["reversible"],
                "validations": bash_intel["validations"],
            },
        },
    }


def _enrich_file(tool_name: str, tool_input: dict, tool_info: dict) -> dict:
    """Run file scanner and build enriched intel for a file tool call."""
    path = tool_input.get("file_path") or tool_input.get("path") or "unknown"
    content = tool_input.get("content") or ""

    file_intel = scan_file_operation(path, content, workspace=WORKSPACE)

    # Determine action_type from file characteristics
    if file_intel["sensitive_path"]:
        action_type = "security"
    else:
        action_type = "apply"

    # Risk from tool base
    base_risk = tool_info["risk_profile"]["base_risk"]
    risk_score = base_risk

    # Boost for traversal or outside workspace
    if file_intel["traversal_detected"] or file_intel["outside_workspace"]:
        risk_score += 20
    # Boost for sensitive file
    if file_intel["sensitive_path"]:
        risk_score += 15

    risk_score = min(risk_score, 100)

    return {
        "action_type": action_type,
        "risk_score": risk_score,
        "reversible": True,
        "declared_goal": "%s: %s" % (tool_name, path),
        "intel": {
            "file": {
                "traversal_detected": file_intel["traversal_detected"],
                "outside_workspace": file_intel["outside_workspace"],
                "sensitive_path": file_intel["sensitive_path"],
                "sensitive_pattern": file_intel["sensitive_pattern"],
                "binary_detected": file_intel["binary_detected"],
                "size_bytes": file_intel["size_bytes"],
                "resolved_path": file_intel["resolved_path"],
            },
        },
    }


def _enrich_mcp(tool_name: str, tool_input: dict, tool_info: dict) -> dict:
    """Check MCP server health and build enriched intel for an mcp__ tool."""
    # Extract server name: mcp__<server>__<method>
    parts = tool_name.split("__")
    server_name = parts[1] if len(parts) >= 2 else "unknown"

    monitor = McpHealthMonitor.from_state_file()
    health = monitor.check(server_name)

    base_risk = tool_info["risk_profile"]["base_risk"]
    risk_score = base_risk

    # Unhealthy servers get a risk boost
    if not health["healthy"]:
        risk_score += 15

    risk_score = min(risk_score, 100)

    return {
        "action_type": "api",
        "risk_score": risk_score,
        "reversible": True,
        "declared_goal": "MCP: %s" % tool_name,
        "intel": {
            "mcp": {
                "server": health["server"],
                "status": health["status"],
                "healthy": health["healthy"],
                "error": health["error"],
            },
        },
    }


def _enrich_default(tool_name: str, tool_input: dict, tool_info: dict) -> dict:
    """Build intel context for any other governed tool."""
    base_risk = tool_info["risk_profile"]["base_risk"]
    category = tool_info["category"]

    # Map category to a reasonable action_type
    category_action_map = {
        "execution": "security",
        "orchestration": "deploy",
        "file_io": "apply",
        "interactive": "other",
        "mcp": "api",
        "unknown": "other",
    }
    action_type = category_action_map.get(category, "other")

    return {
        "action_type": action_type,
        "risk_score": base_risk,
        "reversible": True,
        "declared_goal": "%s: %s" % (tool_name, json.dumps(tool_input)[:120]),
        "intel": {},
    }


def _is_sensitive_path(path: str) -> bool:
    """Quick check if a path string matches common sensitive patterns."""
    lower = path.lower()
    for pattern in (".env", "secret", "credential", "private_key", ".pem", "id_rsa", ".key"):
        if pattern in lower:
            return True
    return False


# ---------------------------------------------------------------------------
# Temp file for passing action_id to PostToolUse
# ---------------------------------------------------------------------------

def write_action_id(tool_use_id, action_id):
    """Write action_id to a temp file keyed by tool_use_id."""
    path = os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + tool_use_id)
    try:
        with open(path, "w") as f:
            f.write(action_id)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Decision handlers
# ---------------------------------------------------------------------------

def handle_allow(context, tool_use_id):
    """Record the action and exit 0."""
    resp = create_action(context, status="running")
    if resp:
        action_id = (resp.get("action_id")
                     or (resp.get("action") or {}).get("action_id")
                     or "")
        if action_id:
            write_action_id(tool_use_id, action_id)
    sys.exit(0)


def handle_warn(guard_resp, context, tool_use_id):
    """Print warning, record action, exit 0."""
    warnings = guard_resp.get("warnings") or guard_resp.get("reasons") or []
    msg = warnings[0] if warnings else "Policy warning"
    log("[DashClaw] Warning: " + msg)
    resp = create_action(context, status="running")
    if resp:
        action_id = (resp.get("action_id")
                     or (resp.get("action") or {}).get("action_id")
                     or "")
        if action_id:
            write_action_id(tool_use_id, action_id)
    sys.exit(0)


def handle_block(guard_resp, context):
    """Block in enforce mode, warn in observe mode."""
    reasons = guard_resp.get("reasons") or []
    policies = guard_resp.get("matched_policies") or []
    reason = reasons[0] if reasons else "Guard policy violation"
    policy = policies[0] if policies else "guard policy"

    if HOOK_MODE == "observe":
        log("[DashClaw] [observe] Would block: " + reason)
        sys.exit(0)

    log("[DashClaw] Blocked by policy: " + reason)
    log("Policy: " + policy)
    log("Action: " + context["declared_goal"])
    log("Run 'dashclaw approvals' to review or override.")
    sys.exit(2)


def handle_require_approval(guard_resp, context, tool_use_id):
    """Create pending action, wait for approval, or block on timeout."""
    policies = guard_resp.get("matched_policies") or []
    policy = policies[0] if policies else "require_approval policy"

    resp = create_action(context, status="pending_approval")
    if not resp:
        log("[DashClaw] Could not create approval request, proceeding")
        sys.exit(0)

    action_id = (resp.get("action_id")
                 or (resp.get("action") or {}).get("action_id")
                 or "")
    if not action_id:
        log("[DashClaw] Could not create approval request, proceeding")
        sys.exit(0)

    if HOOK_MODE == "observe":
        log("[DashClaw] [observe] Would require approval for: " + context["declared_goal"])
        write_action_id(tool_use_id, action_id)
        sys.exit(0)

    log("[DashClaw] Approval required")
    log("Action ID: " + action_id)
    log("Goal:      " + context["declared_goal"])
    log("Policy:    " + policy)
    log("Replay:    " + BASE_URL + "/replay/" + action_id)
    log("")
    log("Approve from terminal: dashclaw approve " + action_id)
    log("Or visit the approval queue in your DashClaw dashboard.")
    log("Waiting for approval... (%ds timeout, then blocking)" % int(APPROVAL_TIMEOUT))

    deadline = time.time() + APPROVAL_TIMEOUT
    while time.time() < deadline:
        time.sleep(3)
        action_resp = get_action(action_id)
        if not action_resp:
            continue
        action = action_resp.get("action") or action_resp
        if action.get("approved_by"):
            write_action_id(tool_use_id, action_id)
            sys.exit(0)
        status = action.get("status", "")
        if status == "running":
            write_action_id(tool_use_id, action_id)
            sys.exit(0)
        if status in ("failed", "cancelled"):
            log("[DashClaw] Action denied by operator.")
            sys.exit(2)

    log("[DashClaw] Approval timeout. Blocking tool execution.")
    sys.exit(2)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Exit silently if DashClaw is not configured
    if not BASE_URL or not API_KEY:
        sys.exit(0)

    # Parse stdin -- read as raw bytes and decode as UTF-8 to handle
    # Windows PowerShell which pipes UTF-8 BOM bytes through cp1252 stdin
    try:
        raw = sys.stdin.buffer.read().decode("utf-8-sig").strip()
        data = json.loads(raw) if raw else {}
    except Exception:
        sys.exit(0)

    tool_name = data.get("tool_name", "")
    tool_input = data.get("tool_input") or {}
    tool_use_id = data.get("tool_use_id") or "unknown"

    # Step 1: Classify the tool using the intel module
    tool_info = classify_tool(tool_name, tool_input)

    # Step 2: If not governed, exit 0 immediately
    if not tool_info["governed"]:
        sys.exit(0)

    # Step 3: Build enriched intel context based on tool type
    if tool_name == "Bash":
        enrichment = _enrich_bash(tool_input, tool_info)
    elif tool_name in _FILE_TOOLS:
        enrichment = _enrich_file(tool_name, tool_input, tool_info)
    elif tool_name.startswith("mcp__"):
        enrichment = _enrich_mcp(tool_name, tool_input, tool_info)
    else:
        enrichment = _enrich_default(tool_name, tool_input, tool_info)

    # Step 4: Build guard context
    context = {
        "action_type": enrichment["action_type"],
        "agent_id": AGENT_ID,
        "declared_goal": enrichment["declared_goal"],
        "risk_score": enrichment["risk_score"],
        "reversible": enrichment["reversible"],
        "systems_touched": [tool_info["category"]],
        "tool": {
            "name": tool_name,
            "category": tool_info["category"],
            "required_permission": tool_info["required_permission"],
        },
        "intel": enrichment.get("intel", {}),
    }

    # Step 5: POST /api/guard with enriched context
    guard_resp = guard_check(context)
    if guard_resp is None:
        log("[DashClaw] Guard unavailable, proceeding")
        sys.exit(0)

    # Step 6: Handle decision
    decision = guard_resp.get("decision", "allow")

    if decision == "allow":
        handle_allow(context, tool_use_id)
    elif decision == "warn":
        handle_warn(guard_resp, context, tool_use_id)
    elif decision == "block":
        handle_block(guard_resp, context)
    elif decision == "require_approval":
        handle_require_approval(guard_resp, context, tool_use_id)
    else:
        handle_allow(context, tool_use_id)


if __name__ == "__main__":
    main()
