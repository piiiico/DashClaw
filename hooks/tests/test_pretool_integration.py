"""Integration tests for dashclaw_pretool.py v2.

Starts a mock HTTP server on a random port and runs the pretool hook
as a subprocess, verifying enriched intel is sent to the guard API.

Uses only the Python standard library.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import HTTPServer, BaseHTTPRequestHandler

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")


# ---------------------------------------------------------------------------
# Mock HTTP server
# ---------------------------------------------------------------------------

class _RequestLog:
    """Thread-safe accumulator for incoming requests."""

    def __init__(self):
        self.requests: list[dict] = []
        self._lock = threading.Lock()
        # Default response for /api/guard
        self.guard_response: dict = {"decision": "allow"}

    def add(self, method: str, path: str, body: dict | None):
        with self._lock:
            self.requests.append({"method": method, "path": path, "body": body})

    def get_all(self) -> list[dict]:
        with self._lock:
            return list(self.requests)

    def clear(self):
        with self._lock:
            self.requests.clear()


def _make_handler(log: _RequestLog):
    """Factory that produces a handler class bound to *log*."""

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            length = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(length) if length else b""
            body = json.loads(raw) if raw else None
            log.add("POST", self.path, body)

            if self.path == "/api/guard":
                resp = json.dumps(log.guard_response).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            elif self.path == "/api/actions":
                resp = json.dumps({"action_id": "test-action-001"}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(resp)))
                self.end_headers()
                self.wfile.write(resp)
            else:
                self.send_response(404)
                self.end_headers()

        def do_GET(self):
            log.add("GET", self.path, None)
            self.send_response(200)
            resp = json.dumps({"status": "running"}).encode()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(resp)))
            self.end_headers()
            self.wfile.write(resp)

        def log_message(self, fmt, *args):
            # Silence request logging during tests.
            pass

    return Handler


def _find_free_port() -> int:
    """Find a free TCP port on localhost."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


# ---------------------------------------------------------------------------
# Test helper
# ---------------------------------------------------------------------------

def _run_hook(stdin_data: dict, env_overrides: dict | None = None, timeout: float = 10) -> tuple[int, str, str]:
    """Run the pretool hook as a subprocess.

    Returns (exit_code, stdout, stderr).
    """
    env = os.environ.copy()
    # Remove any real DashClaw config so the hook uses our overrides.
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    # Disable .env walking so the operator's local .env cannot leak into the
    # subprocess and override test expectations. Production hooks never set this.
    env["DASHCLAW_DISABLE_DOTENV"] = "1"
    if env_overrides:
        env.update(env_overrides)

    proc = subprocess.run(
        [sys.executable, _PRETOOL_SCRIPT],
        input=json.dumps(stdin_data).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return proc.returncode, proc.stdout.decode("utf-8", errors="replace"), proc.stderr.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestPretoolIntegration(unittest.TestCase):
    """Integration tests that run the hook against a mock guard server."""

    server: HTTPServer
    server_thread: threading.Thread
    log: _RequestLog
    base_url: str

    @classmethod
    def setUpClass(cls):
        cls.log = _RequestLog()
        port = _find_free_port()
        handler = _make_handler(cls.log)
        cls.server = HTTPServer(("127.0.0.1", port), handler)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.server_thread.start()
        cls.base_url = "http://127.0.0.1:%d" % port

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server_thread.join(timeout=5)

    def setUp(self):
        self.log.clear()
        self.log.guard_response = {"decision": "allow"}

    def _env(self, **extra) -> dict:
        """Build the base environment dict pointing at our mock server."""
        env = {
            "DASHCLAW_BASE_URL": self.base_url,
            "DASHCLAW_API_KEY": "test-key-123",
            "DASHCLAW_AGENT_ID": "test-agent",
            "DASHCLAW_HOOK_MODE": "enforce",
            "DASHCLAW_WORKSPACE": tempfile.gettempdir(),
            "DASHCLAW_PERMISSION_MODE": "danger",
        }
        env.update(extra)
        return env

    # -----------------------------------------------------------------------
    # 1. Bash sends enriched intel with bash.intent
    # -----------------------------------------------------------------------

    def test_bash_sends_enriched_intel(self):
        """Bash tool calls should include bash intel with intent in the guard request."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "ls -la"}, "tool_use_id": "tu-001"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1, "Expected exactly one guard call")

        body = guard_reqs[0]["body"]
        self.assertIn("intel", body)
        self.assertIn("bash", body["intel"])
        self.assertIn("intent", body["intel"]["bash"])
        self.assertEqual(body["intel"]["bash"]["intent"], "readonly")
        self.assertEqual(body["tool"]["name"], "Bash")
        self.assertEqual(body["tool"]["category"], "execution")

    def test_bash_destructive_sends_high_risk(self):
        """Destructive bash commands should produce high risk scores."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "rm -rf /tmp/stuff"}, "tool_use_id": "tu-002"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertIn("intel", body)
        self.assertEqual(body["intel"]["bash"]["intent"], "destructive")
        self.assertGreaterEqual(body["risk_score"], 70)

    # -----------------------------------------------------------------------
    # 2. Read tool is ungoverned (no guard call)
    # -----------------------------------------------------------------------

    def test_read_tool_ungoverned(self):
        """Read is a 'search' category tool, which is ungoverned. No guard call should be made."""
        code, _, _ = _run_hook(
            {"tool_name": "Read", "tool_input": {"file_path": "/tmp/test.txt"}, "tool_use_id": "tu-003"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 0, "Read should not trigger a guard call")

    def test_glob_tool_ungoverned(self):
        """Glob is a 'search' category tool, which is ungoverned."""
        code, _, _ = _run_hook(
            {"tool_name": "Glob", "tool_input": {"pattern": "*.py"}, "tool_use_id": "tu-004"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 0, "Glob should not trigger a guard call")

    # -----------------------------------------------------------------------
    # 3. Write sends file intel with traversal_detected
    # -----------------------------------------------------------------------

    def test_write_sends_file_intel(self):
        """Write tool calls should include file intel in the guard request."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": "/tmp/output.txt", "content": "hello"},
                "tool_use_id": "tu-005",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertIn("intel", body)
        self.assertIn("file", body["intel"])
        self.assertIn("traversal_detected", body["intel"]["file"])
        self.assertEqual(body["tool"]["name"], "Write")

    def test_write_traversal_detected(self):
        """Write with path traversal should set traversal_detected=True and boost risk."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": "../../../etc/passwd", "content": "evil"},
                "tool_use_id": "tu-006",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertTrue(body["intel"]["file"]["traversal_detected"])
        # Traversal adds +20 to base risk of 40
        self.assertGreaterEqual(body["risk_score"], 55)

    def test_write_sensitive_path(self):
        """Write to a .env file should flag sensitive_path."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Write",
                "tool_input": {"file_path": "/tmp/.env", "content": "SECRET=123"},
                "tool_use_id": "tu-007",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertTrue(body["intel"]["file"]["sensitive_path"])
        self.assertEqual(body["action_type"], "security")

    # -----------------------------------------------------------------------
    # 4. mcp__ tools include MCP health
    # -----------------------------------------------------------------------

    def test_mcp_tool_includes_health(self):
        """MCP tool calls should include mcp health info in the guard request."""
        code, _, _ = _run_hook(
            {
                "tool_name": "mcp__agentcash__get_balance",
                "tool_input": {},
                "tool_use_id": "tu-008",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertIn("intel", body)
        self.assertIn("mcp", body["intel"])
        self.assertEqual(body["intel"]["mcp"]["server"], "agentcash")
        self.assertIn("healthy", body["intel"]["mcp"])
        self.assertIn("status", body["intel"]["mcp"])
        self.assertEqual(body["tool"]["category"], "mcp")
        self.assertEqual(body["action_type"], "api")

    # -----------------------------------------------------------------------
    # 5. Unknown tools are governed
    # -----------------------------------------------------------------------

    def test_unknown_tool_governed(self):
        """Unknown tools (not in catalog, not mcp__) should be governed."""
        code, _, _ = _run_hook(
            {
                "tool_name": "SomeNewTool",
                "tool_input": {"data": "test"},
                "tool_use_id": "tu-009",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1, "Unknown tools should be governed")

        body = guard_reqs[0]["body"]
        self.assertEqual(body["tool"]["category"], "unknown")

    # -----------------------------------------------------------------------
    # 6. Block decision returns exit code 2
    # -----------------------------------------------------------------------

    def test_block_decision_exits_2(self):
        """When guard returns 'block', the hook should exit with code 2."""
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Dangerous operation not allowed"],
            "matched_policies": ["no-destructive"],
        }
        code, _, stderr = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}, "tool_use_id": "tu-010"},
            self._env(),
        )
        self.assertEqual(code, 2)
        self.assertIn("Blocked", stderr)

    # -----------------------------------------------------------------------
    # 7. Warn decision prints warning and exits 0
    # -----------------------------------------------------------------------

    def test_warn_decision_exits_0(self):
        """When guard returns 'warn', the hook should print warning and exit 0."""
        self.log.guard_response = {
            "decision": "warn",
            "warnings": ["This operation is risky"],
        }
        code, _, stderr = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "npm install foo"}, "tool_use_id": "tu-011"},
            self._env(),
        )
        self.assertEqual(code, 0)
        self.assertIn("Warning", stderr)

    # -----------------------------------------------------------------------
    # 8. No config = silent pass-through
    # -----------------------------------------------------------------------

    def test_no_config_passes_through(self):
        """Without BASE_URL/API_KEY, the hook should exit 0 silently."""
        code, _, stderr = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "ls"}, "tool_use_id": "tu-012"},
            # Explicitly set empty values to override anything from .env
            {"DASHCLAW_BASE_URL": "", "DASHCLAW_API_KEY": ""},
        )
        self.assertEqual(code, 0)
        self.assertEqual(stderr.strip(), "")

    # -----------------------------------------------------------------------
    # 9. Edit tool is governed and sends file intel
    # -----------------------------------------------------------------------

    def test_edit_tool_sends_file_intel(self):
        """Edit tool calls should include file intel in the guard request."""
        code, _, _ = _run_hook(
            {
                "tool_name": "Edit",
                "tool_input": {"file_path": "/tmp/code.py", "old_string": "a", "new_string": "b"},
                "tool_use_id": "tu-013",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertIn("file", body["intel"])
        self.assertEqual(body["tool"]["name"], "Edit")
        self.assertEqual(body["tool"]["category"], "file_io")

    # -----------------------------------------------------------------------
    # 10. System tools (EnterPlanMode) are ungoverned
    # -----------------------------------------------------------------------

    def test_system_tool_ungoverned(self):
        """System tools like EnterPlanMode should be ungoverned."""
        code, _, _ = _run_hook(
            {"tool_name": "EnterPlanMode", "tool_input": {}, "tool_use_id": "tu-014"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 0, "System tools should not trigger guard calls")

    # -----------------------------------------------------------------------
    # 11. Observe mode lets blocked actions through
    # -----------------------------------------------------------------------

    def test_observe_mode_allows_blocks(self):
        """In observe mode, blocked decisions should log a warning and exit 0."""
        self.log.guard_response = {
            "decision": "block",
            "reasons": ["Not allowed"],
            "matched_policies": ["strict-policy"],
        }
        code, _, stderr = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "rm -rf /"}, "tool_use_id": "tu-015"},
            self._env(DASHCLAW_HOOK_MODE="observe"),
        )
        self.assertEqual(code, 0)
        self.assertIn("[observe]", stderr)

    # -----------------------------------------------------------------------
    # 12. Guard context includes tool metadata
    # -----------------------------------------------------------------------

    def test_guard_context_has_tool_metadata(self):
        """Guard requests should include tool name, category, and permission."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "echo hello"}, "tool_use_id": "tu-016"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        body = guard_reqs[0]["body"]

        self.assertIn("tool", body)
        self.assertEqual(body["tool"]["name"], "Bash")
        self.assertEqual(body["tool"]["category"], "execution")
        self.assertEqual(body["tool"]["required_permission"], "danger")
        self.assertEqual(body["agent_id"], "test-agent")

    # -----------------------------------------------------------------------
    # 13. Bash network intent maps to api action_type
    # -----------------------------------------------------------------------

    def test_bash_network_maps_to_api(self):
        """Bash command with network intent should map to 'api' action_type."""
        code, _, _ = _run_hook(
            {"tool_name": "Bash", "tool_input": {"command": "curl https://example.com"}, "tool_use_id": "tu-017"},
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        body = guard_reqs[0]["body"]

        self.assertEqual(body["action_type"], "api")
        self.assertEqual(body["intel"]["bash"]["intent"], "network")

    # -----------------------------------------------------------------------
    # 14. NotebookEdit is governed as file_io
    # -----------------------------------------------------------------------

    def test_notebook_edit_governed(self):
        """NotebookEdit should be governed and classified as file_io."""
        code, _, _ = _run_hook(
            {
                "tool_name": "NotebookEdit",
                "tool_input": {"file_path": "/tmp/nb.ipynb", "content": "{}"},
                "tool_use_id": "tu-018",
            },
            self._env(),
        )
        self.assertEqual(code, 0)

        reqs = self.log.get_all()
        guard_reqs = [r for r in reqs if r["path"] == "/api/guard"]
        self.assertEqual(len(guard_reqs), 1)

        body = guard_reqs[0]["body"]
        self.assertEqual(body["tool"]["category"], "file_io")
        self.assertIn("file", body["intel"])


if __name__ == "__main__":
    unittest.main()
