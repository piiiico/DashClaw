#!/usr/bin/env python3
"""
DashClaw PostToolUse Hook v2 for Claude Code.

Records the outcome of governed tool calls by updating the action record
created by the PreToolUse hook. v2 adds richer outcome reporting:
  - 500-char output summaries (up from 200)
  - Structured outcome_metadata with exit_code, error_type classification
  - Improved error detection: checks exit code AND error field
  - Error classification: timeout, permission, not_found, runtime

Never blocks. Always exits 0.
"""

import json
import os
import sys
import tempfile
import urllib.request
import urllib.error
from datetime import datetime, timezone

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
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = (os.environ.get("DASHCLAW_BASE_URL") or "").rstrip("/")
API_KEY = os.environ.get("DASHCLAW_API_KEY") or ""

MAX_SUMMARY = 500


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------

def _classify_error(error_str):
    """Classify an error string into a category.

    Returns one of: timeout, permission, not_found, runtime.
    """
    lower = error_str.lower()
    if "timeout" in lower or "timed out" in lower:
        return "timeout"
    if "permission" in lower or "denied" in lower:
        return "permission"
    if "not found" in lower or "no such file" in lower:
        return "not_found"
    return "runtime"


# ---------------------------------------------------------------------------
# Outcome extraction
# ---------------------------------------------------------------------------

def _extract_outcome(tool_response):
    """Extract structured outcome from tool_response.

    Returns (status, output_summary, outcome_metadata).
    """
    error_val = tool_response.get("error")
    exit_code = tool_response.get("exit_code")
    output_val = str(tool_response.get("output") or tool_response.get("stdout") or "")

    metadata = {}

    # Record exit_code if present
    if exit_code is not None:
        metadata["exit_code"] = exit_code

    # Priority 1: explicit error field
    if error_val:
        error_str = str(error_val)
        metadata["error_type"] = _classify_error(error_str)
        return "failed", error_str[:MAX_SUMMARY], metadata

    # Priority 2: non-zero exit code
    if exit_code is not None and exit_code != 0:
        metadata["error_type"] = _classify_error(output_val)
        summary = output_val[:MAX_SUMMARY] if output_val else "Process exited with code %d" % exit_code
        return "failed", summary, metadata

    # Otherwise: completed
    return "completed", output_val[:MAX_SUMMARY], metadata


# ---------------------------------------------------------------------------
# HTTP helper
# ---------------------------------------------------------------------------

def _patch_action(action_id, body):
    """PATCH /api/actions/{action_id}. Silently ignores failures."""
    url = BASE_URL + "/api/actions/" + action_id
    data = json.dumps(body).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Content-Type": "application/json",
            "x-api-key": API_KEY,
        },
        method="PATCH",
    )
    try:
        urllib.request.urlopen(req, timeout=2)
    except Exception:
        pass  # Never block on outcome recording failure


# ---------------------------------------------------------------------------
# Temp file helpers
# ---------------------------------------------------------------------------

def _read_action_id(tool_use_id):
    """Read action_id from the temp file written by PreToolUse.

    Returns action_id string or None if not found.
    """
    path = os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + tool_use_id)
    try:
        with open(path, "r") as f:
            return f.read().strip() or None
    except Exception:
        return None


def _cleanup_temp(tool_use_id):
    """Remove the temp file for this tool_use_id."""
    path = os.path.join(tempfile.gettempdir(), "dashclaw_last_action_" + tool_use_id)
    try:
        os.remove(path)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Exit silently if DashClaw is not configured
    if not BASE_URL or not API_KEY:
        sys.exit(0)

    # Parse stdin
    try:
        raw = sys.stdin.read()
        data = json.loads(raw) if raw.strip() else {}
    except Exception:
        sys.exit(0)

    tool_use_id = data.get("tool_use_id") or ""
    if not tool_use_id:
        sys.exit(0)

    # Find the action ID from the temp file written by PreToolUse
    action_id = _read_action_id(tool_use_id)
    if not action_id:
        sys.exit(0)

    # Extract structured outcome from tool_response
    tool_response = data.get("tool_response") or {}
    status, output_summary, outcome_metadata = _extract_outcome(tool_response)

    # PATCH the action with the outcome
    timestamp_end = datetime.now(timezone.utc).isoformat()
    body = {
        "status": status,
        "output_summary": output_summary,
        "timestamp_end": timestamp_end,
        "outcome_metadata": outcome_metadata,
    }
    _patch_action(action_id, body)

    # Clean up temp file
    _cleanup_temp(tool_use_id)

    sys.exit(0)


if __name__ == "__main__":
    main()
