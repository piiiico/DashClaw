#!/usr/bin/env python3

"""
DashClaw Python SDK Live Integration Tests -- Field-Mapping Level

Validates Python SDK methods against a real DashClaw instance by calling
SDK methods, reading back persisted records, and asserting stored values
match inputs. The Python counterpart to scripts/test-sdk-live.mjs.

WARNING: This script performs REAL WRITES against a live DashClaw instance.
It creates test actions, loops, assumptions, handoffs, threads, snippets,
preferences, messages, and other records. Run against development or staging
instances, not production, unless you are comfortable with test data.

Usage:
    npm run sdk:live:python                                  # via repo script
    DASHCLAW_URL=https://staging.example.com \\
        DASHCLAW_API_KEY=oc_live_xxx \\
        python scripts/test-sdk-live-python.py               # explicit env

Required env:
    DASHCLAW_API_KEY   - API key for the target instance

Optional env:
    DASHCLAW_URL       - Base URL (default: http://localhost:3000)
    DASHCLAW_AGENT_ID  - Agent ID for test records (default: sdk-live-test-agent-py)
"""

import os
import sys
import json
import traceback
import urllib.request
import urllib.error
from datetime import datetime, timezone

# Ensure sdk-python is importable when run from repo root
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "sdk-python"))

from dashclaw import DashClaw, DashClawError

BASE_URL = os.environ.get("DASHCLAW_URL", "http://localhost:3000")
API_KEY = os.environ.get("DASHCLAW_API_KEY", "")
AGENT_ID = os.environ.get("DASHCLAW_AGENT_ID", "sdk-live-test-agent-py")

if not API_KEY:
    print("DASHCLAW_API_KEY is required. Run via _run-with-env.mjs or export the variable.")
    sys.exit(1)


# -- Test infrastructure ------------------------------------------------

passed = 0
failed = 0
failures = []
category_errors = []


def log(tag, msg):
    print(f"  {tag} {msg}")


def check(condition, label, detail=None):
    global passed, failed
    if condition:
        passed += 1
        log("PASS", label)
    else:
        failed += 1
        log("FAIL", label)
        entry = {"label": label}
        if detail:
            entry.update(detail)
        failures.append(entry)


# -- Signing setup ------------------------------------------------------

def setup_signed_sdk():
    """Generate an ephemeral RSA-2048 keypair, register + approve it, return a signed SDK client."""
    try:
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.backends import default_backend
    except ImportError:
        print("  [!] 'cryptography' package not installed -- skipping signed agent setup")
        print("      Install with: pip install cryptography")
        print("      Actions will fail if ENFORCE_AGENT_SIGNATURES=true on the target instance")
        return DashClaw(
            base_url=BASE_URL,
            api_key=API_KEY,
            agent_id=AGENT_ID,
            agent_name="SDK Live Test Agent (Python)",
        )

    # Generate ephemeral keypair
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048,
        backend=default_backend(),
    )

    # Export public key as PEM for registration
    public_pem = private_key.public_key().public_bytes(
        serialization.Encoding.PEM,
        serialization.PublicFormat.SubjectPublicKeyInfo,
    ).decode("utf-8")

    # Create unsigned client for pairing registration
    unsigned_sdk = DashClaw(
        base_url=BASE_URL,
        api_key=API_KEY,
        agent_id=AGENT_ID,
        agent_name="SDK Live Test Agent (Python)",
    )

    # Register the public key via pairing flow
    pairing_res = unsigned_sdk.create_pairing(
        public_key_pem=public_pem,
        algorithm="RSASSA-PKCS1-v1_5",
        agent_name="SDK Live Test Agent (Python)",
    )
    pairing_id = pairing_res.get("pairing", {}).get("id")
    if not pairing_id:
        raise RuntimeError(f"create_pairing did not return a pairing ID: {pairing_res}")

    # Approve via direct API call (requires admin role on API key)
    base = BASE_URL.rstrip("/")
    approve_url = f"{base}/api/pairings/{pairing_id}/approve"
    req = urllib.request.Request(
        approve_url,
        data=b"{}",
        headers={"x-api-key": API_KEY, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Failed to approve test pairing ({e.code}): {body}")

    # Return signed client
    return DashClaw(
        base_url=BASE_URL,
        api_key=API_KEY,
        agent_id=AGENT_ID,
        agent_name="SDK Live Test Agent (Python)",
        private_key=private_key,
    )


# -- Test categories ----------------------------------------------------

def test_action_recording(sdk):
    print("\n--- Category 1: Action Recording ---")

    res = sdk.create_action(
        action_type="research",
        declared_goal="sdk-live-test-py: verify action field mapping",
        reasoning="integration test for field persistence",
        risk_score=17,
        confidence=88,
        reversible=True,
    )
    action_id = res.get("action_id")

    check(
        isinstance(action_id, str) and action_id.startswith("act_"),
        f"create_action: action_id has act_ prefix (got {action_id})",
    )

    # Read back
    get_res = sdk.get_action(action_id)
    action = get_res.get("action", {})

    check(
        action.get("declared_goal") == "sdk-live-test-py: verify action field mapping",
        "create_action -> get_action: declared_goal matches",
        {"sent": "sdk-live-test-py: verify action field mapping", "stored": action.get("declared_goal")},
    )
    check(
        action.get("action_type") == "research",
        "create_action -> get_action: action_type matches",
        {"sent": "research", "stored": action.get("action_type")},
    )
    check(
        action.get("agent_id") == AGENT_ID,
        f"create_action -> get_action: agent_id injected ({AGENT_ID})",
        {"sent": AGENT_ID, "stored": action.get("agent_id")},
    )

    # Update outcome
    patch_res = sdk.update_outcome(action_id, status="completed", output_summary="sdk-live-test-py: outcome verified")

    check(
        patch_res.get("action", {}).get("status") == "completed",
        "update_outcome: status returned as completed",
    )

    # Re-read
    updated = sdk.get_action(action_id).get("action", {})
    check(
        updated.get("status") == "completed",
        "update_outcome -> get_action: status persisted",
        {"sent": "completed", "stored": updated.get("status")},
    )
    check(
        updated.get("output_summary") == "sdk-live-test-py: outcome verified",
        "update_outcome -> get_action: output_summary persisted",
        {"sent": "sdk-live-test-py: outcome verified", "stored": updated.get("output_summary")},
    )

    return action_id


def test_loops_and_assumptions(sdk, action_id):
    print("\n--- Category 2: Loops & Assumptions ---")

    loop_res = sdk.register_open_loop(
        action_id=action_id,
        loop_type="dependency",
        description="sdk-live-test-py: verify loop field mapping",
        priority="high",
    )
    loop_id = loop_res.get("loop_id")
    check(isinstance(loop_id, str), f"register_open_loop: loop_id returned (got {loop_id})")

    loops_res = sdk.get_open_loops(limit=10)
    loops = loops_res.get("loops", [])
    stored = next((l for l in loops if l.get("id") == loop_id or l.get("loop_id") == loop_id), None)
    check(stored is not None, f"register_open_loop -> get_open_loops: loop {loop_id} found")

    if stored:
        check(
            stored.get("loop_type") == "dependency",
            "register_open_loop -> get_open_loops: loop_type persisted",
            {"sent": "dependency", "stored": stored.get("loop_type")},
        )
        check(
            stored.get("priority") == "high",
            "register_open_loop -> get_open_loops: priority persisted",
            {"sent": "high", "stored": stored.get("priority")},
        )

    # Assumption
    a_res = sdk.register_assumption(
        action_id=action_id,
        assumption="sdk-live-test-py: default locale is UTC",
        basis="integration test assumption",
    )
    assumption_id = a_res.get("assumption_id")
    check(isinstance(assumption_id, str), f"register_assumption: assumption_id returned (got {assumption_id})")

    a_stored = sdk.get_assumption(assumption_id).get("assumption", {})
    check(
        a_stored.get("assumption") == "sdk-live-test-py: default locale is UTC",
        "register_assumption -> get_assumption: assumption text persisted",
        {"sent": "sdk-live-test-py: default locale is UTC", "stored": a_stored.get("assumption")},
    )


def test_signals(sdk):
    print("\n--- Category 3: Signals ---")

    try:
        sdk.heartbeat(status="online")
    except Exception:
        pass

    res = sdk.get_signals()
    check(isinstance(res.get("signals"), list), "get_signals: returns signals array")
    check(isinstance(res.get("counts"), dict), "get_signals: returns counts object")


def test_dashboard_data(sdk):
    print("\n--- Category 4: Dashboard Data ---")

    res = sdk.report_token_usage(tokens_in=100, tokens_out=200, model="sdk-live-test-model-py", context_used=300)
    check(isinstance(res, dict), "report_token_usage: returns a response object")


def test_handoffs(sdk):
    print("\n--- Category 5: Session Handoffs ---")

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    res = sdk.create_handoff(
        summary="sdk-live-test-py: handoff field mapping verified",
        session_date=today,
        key_decisions=["used batch inserts", "skipped retry logic"],
        open_tasks=["verify row counts"],
        next_priorities=["run integration suite"],
    )
    handoff_id = res.get("handoff_id")
    check(isinstance(handoff_id, str), f"create_handoff: handoff_id returned ({handoff_id})")

    list_res = sdk.get_handoffs(date=today, limit=20)
    handoffs = list_res.get("handoffs", [])
    stored = next((h for h in handoffs if h.get("id") == handoff_id or h.get("handoff_id") == handoff_id), None)
    check(stored is not None, f"create_handoff -> get_handoffs: handoff {handoff_id} found")

    if stored:
        check(
            stored.get("summary") == "sdk-live-test-py: handoff field mapping verified",
            "create_handoff -> get_handoffs: summary persisted",
            {"sent": "sdk-live-test-py: handoff field mapping verified", "stored": stored.get("summary")},
        )
        check(
            stored.get("agent_id") == AGENT_ID,
            "create_handoff -> get_handoffs: agent_id injected",
            {"sent": AGENT_ID, "stored": stored.get("agent_id")},
        )


def test_context_manager(sdk):
    print("\n--- Category 6: Context Manager ---")

    import time as _time
    thread_name = f"sdk-live-test-py-{int(_time.time())}"
    res = sdk.create_thread(name=thread_name, summary="sdk-live-test-py: context thread field mapping")
    thread_id = res.get("thread_id")

    check(
        isinstance(thread_id, str) and thread_id.startswith("ct_"),
        f"create_thread: thread_id has ct_ prefix (got {thread_id})",
    )

    list_res = sdk.get_threads(status="active", limit=50)
    threads = list_res.get("threads", [])
    stored = next((t for t in threads if t.get("id") == thread_id or t.get("thread_id") == thread_id), None)
    check(stored is not None, f"create_thread -> get_threads: thread {thread_id} found")

    if stored:
        check(
            stored.get("name") == thread_name,
            "create_thread -> get_threads: name persisted",
            {"sent": thread_name, "stored": stored.get("name")},
        )


def test_snippets(sdk):
    print("\n--- Category 7: Automation Snippets ---")

    import time as _time
    snippet_name = f"sdk-live-test-py-{int(_time.time())}"

    res = sdk.save_snippet(
        name=snippet_name,
        code="# sdk-live-test-py: snippet code content",
        description="sdk-live-test-py: verifying snippet field mapping",
        language="python",
        tags=["sdk-test", "field-mapping"],
    )
    snippet_id = res.get("snippet_id")
    check(isinstance(snippet_id, str), f"save_snippet: snippet_id returned (got {snippet_id})")

    snippet = sdk.get_snippet(snippet_id).get("snippet", {})
    check(
        snippet.get("name") == snippet_name,
        "save_snippet -> get_snippet: name persisted",
        {"sent": snippet_name, "stored": snippet.get("name")},
    )
    check(
        snippet.get("code") == "# sdk-live-test-py: snippet code content",
        "save_snippet -> get_snippet: code persisted",
    )
    check(
        snippet.get("language") == "python",
        "save_snippet -> get_snippet: language persisted",
    )


def test_user_preferences(sdk):
    print("\n--- Category 8: User Preferences ---")

    res = sdk.set_preference(
        preference="sdk-live-test-py: prefers verbose logging",
        category="workflow",
        confidence=75,
    )
    pref_id = res.get("preference_id")
    check(isinstance(pref_id, str), f"set_preference: preference_id returned (got {pref_id})")

    summary = sdk.get_preference_summary()
    check(isinstance(summary, dict), "set_preference -> get_preference_summary: returns object")


def test_daily_digest(sdk):
    print("\n--- Category 9: Daily Digest ---")

    res = sdk.get_daily_digest()
    check(isinstance(res, dict), "get_daily_digest: returns an object")


def test_security_scanning(sdk):
    print("\n--- Category 10: Security Scanning ---")

    res = sdk.scan_content("sdk-live-test-py: hello world no sensitive data here", "test")
    check(isinstance(res.get("clean"), bool), "scan_content: returns clean boolean")
    check(isinstance(res.get("findings_count"), int), "scan_content: returns findings_count number")
    check(isinstance(res.get("findings"), list), "scan_content: returns findings array")
    check(res.get("clean") is True, "scan_content: clean text flagged as clean")


def test_messaging(sdk):
    print("\n--- Category 11: Agent Messaging ---")

    # Direct message
    res = sdk.send_message(
        to=AGENT_ID,
        type="info",
        subject="sdk-live-test-py: direct message",
        body="sdk-live-test-py: field mapping assertion -- direct",
    )
    msg_id = res.get("message_id")
    check(isinstance(msg_id, str), f"send_message (direct): message_id returned ({msg_id})")

    sent = sdk.get_sent_messages(limit=50).get("messages", [])
    stored = next((m for m in sent if m.get("id") == msg_id or m.get("message_id") == msg_id), None)
    check(stored is not None, f"send_message (direct) -> get_sent_messages: message {msg_id} found")

    if stored:
        check(
            stored.get("to_agent_id") == AGENT_ID,
            f'send_message (direct): to_agent_id matches ("{AGENT_ID}")',
            {"sent": AGENT_ID, "stored": stored.get("to_agent_id")},
        )

    # Broadcast (no `to`)
    bcast_res = sdk.send_message(
        type="status",
        subject="sdk-live-test-py: broadcast",
        body="sdk-live-test-py: field mapping assertion -- broadcast",
    )
    bcast_id = bcast_res.get("message_id")
    check(isinstance(bcast_id, str), f"send_message (broadcast): message_id returned ({bcast_id})")

    sent2 = sdk.get_sent_messages(limit=50).get("messages", [])
    bcast_stored = next((m for m in sent2 if m.get("id") == bcast_id or m.get("message_id") == bcast_id), None)
    if bcast_stored:
        check(
            bcast_stored.get("to_agent_id") is None,
            "send_message (broadcast): to_agent_id is null",
            {"expected": None, "stored": bcast_stored.get("to_agent_id")},
        )


def test_behavior_guard(sdk):
    print("\n--- Category 12: Behavior Guard ---")

    res = sdk.guard({"action_type": "deploy", "risk_score": 40, "declared_goal": "sdk-live-test-py: guard check"})
    check(isinstance(res.get("decision"), str), f'guard: returns decision string (got "{res.get("decision")}")')
    check(
        res.get("decision") in ("allow", "warn", "block", "require_approval"),
        f'guard: decision is a known value (got "{res.get("decision")}")',
    )
    check(isinstance(res.get("reasons"), list), "guard: returns reasons array")


def test_webhooks(sdk):
    print("\n--- Category 14: Webhooks ---")

    res = sdk.get_webhooks()
    webhooks = res.get("webhooks", res) if isinstance(res, dict) else res
    check(isinstance(webhooks, list), "get_webhooks: returns an array")


# -- Main runner --------------------------------------------------------

def run_category(label, fn, *args):
    try:
        return fn(*args)
    except Exception as err:
        global failed
        failed += 1
        msg = f"[CATEGORY ERROR] {label}: {err}"
        print(f"  FAIL {msg}")
        category_errors.append({"label": label, "error": str(err)})
        return None


def main():
    global failed

    print(f"\n{'=' * 60}")
    print("DashClaw Python SDK Live Integration Tests")
    print(f"{'=' * 60}")
    print(f"  Base URL:  {BASE_URL}")
    print(f"  Agent ID:  {AGENT_ID}")
    print(f"  WARNING:   This suite performs REAL WRITES to the target instance.")
    print(f"{'=' * 60}")

    # Set up signed SDK
    print("\n--- Setup: Agent Identity & Signing ---")
    try:
        sdk = setup_signed_sdk()
        print("  PASS Ephemeral keypair generated, pairing registered and approved")
    except Exception as err:
        print(f"  FAIL Could not set up signed SDK: {err}")
        print("  The API key may not have admin role, or the instance may be unreachable.")
        traceback.print_exc()
        sys.exit(1)

    # Run categories
    action_id = run_category("Action Recording", test_action_recording, sdk)
    run_category("Loops & Assumptions", test_loops_and_assumptions, sdk, action_id or "act_fallback")
    run_category("Signals", test_signals, sdk)
    run_category("Dashboard Data", test_dashboard_data, sdk)
    run_category("Handoffs", test_handoffs, sdk)
    run_category("Context Manager", test_context_manager, sdk)
    run_category("Snippets", test_snippets, sdk)
    run_category("User Preferences", test_user_preferences, sdk)
    run_category("Daily Digest", test_daily_digest, sdk)
    run_category("Security Scanning", test_security_scanning, sdk)
    run_category("Agent Messaging", test_messaging, sdk)
    run_category("Behavior Guard", test_behavior_guard, sdk)
    run_category("Webhooks", test_webhooks, sdk)

    # Summary
    total = passed + failed
    print(f"\n{'=' * 60}")
    print(f"Results: {passed}/{total} passed, {failed} failed")

    if category_errors:
        print(f"\n--- Category-level errors ({len(category_errors)}) ---")
        print("These indicate an endpoint/schema/connectivity issue, not a field-mapping bug:")
        for e in category_errors:
            print(f"  [!] {e['label']}: {e['error']}")

    if failures:
        print(f"\n--- Failed assertions ({len(failures)}) ---")
        for f in failures:
            print(f"\n  FAIL: {f['label']}")
            if "sent" in f:
                print(f"        sent:     {json.dumps(f['sent'])}")
            if "stored" in f:
                print(f"        stored:   {json.dumps(f['stored'])}")
            if "expected" in f:
                print(f"        expected: {json.dumps(f['expected'])}")
            if "got" in f:
                print(f"        got:      {json.dumps(f['got'])}")

    print(f"{'=' * 60}\n")

    if failed > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
