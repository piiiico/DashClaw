"""Tests for dashclaw_agent_intel.mcp_monitor.McpHealthMonitor."""

import json
import os
import tempfile
import unittest

from dashclaw_agent_intel.mcp_monitor import McpHealthMonitor


class TestRegisterAndCheckConnected(unittest.TestCase):
    """Register a server as connected and verify check() returns healthy."""

    def test_register_connected_server(self):
        mcp = McpHealthMonitor()
        mcp.register("agentcash", status="connected")
        result = mcp.check("agentcash")
        self.assertEqual(result["server"], "agentcash")
        self.assertEqual(result["status"], "connected")
        self.assertIsNone(result["error"])
        self.assertTrue(result["healthy"])


class TestCheckUnhealthyError(unittest.TestCase):
    """Register a server with status=error and verify unhealthy."""

    def test_error_server_unhealthy(self):
        mcp = McpHealthMonitor()
        mcp.register("chrome-devtools", status="error", error="connection refused")
        result = mcp.check("chrome-devtools")
        self.assertEqual(result["server"], "chrome-devtools")
        self.assertEqual(result["status"], "error")
        self.assertEqual(result["error"], "connection refused")
        self.assertFalse(result["healthy"])


class TestCheckAuthRequired(unittest.TestCase):
    """auth_required status is not healthy."""

    def test_auth_required_unhealthy(self):
        mcp = McpHealthMonitor()
        mcp.register("secure-api", status="auth_required")
        result = mcp.check("secure-api")
        self.assertEqual(result["status"], "auth_required")
        self.assertIsNone(result["error"])
        self.assertFalse(result["healthy"])


class TestCheckUnknownServer(unittest.TestCase):
    """Checking an unregistered server returns disconnected/unhealthy."""

    def test_unknown_server(self):
        mcp = McpHealthMonitor()
        result = mcp.check("nonexistent")
        self.assertEqual(result["server"], "nonexistent")
        self.assertEqual(result["status"], "disconnected")
        self.assertIsNone(result["error"])
        self.assertFalse(result["healthy"])


class TestListServers(unittest.TestCase):
    """list_servers() returns all registered server dicts."""

    def test_list_multiple_servers(self):
        mcp = McpHealthMonitor()
        mcp.register("agentcash", status="connected")
        mcp.register("chrome-devtools", status="error", error="timeout")
        servers = mcp.list_servers()
        self.assertEqual(len(servers), 2)
        names = {s["server"] for s in servers}
        self.assertEqual(names, {"agentcash", "chrome-devtools"})

    def test_list_empty(self):
        mcp = McpHealthMonitor()
        self.assertEqual(mcp.list_servers(), [])


class TestStatePersistence(unittest.TestCase):
    """save() + from_state_file() roundtrip preserves state."""

    def test_roundtrip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            state_file = os.path.join(tmpdir, "test_mcp_state.json")
            mcp = McpHealthMonitor(state_file=state_file)
            mcp.register("agentcash", status="connected")
            mcp.register("chrome-devtools", status="error", error="refused")
            mcp.save()

            # Verify file exists and is valid JSON.
            self.assertTrue(os.path.isfile(state_file))
            with open(state_file) as f:
                data = json.load(f)
            self.assertIn("agentcash", data)

            # Load into a new monitor.
            mcp2 = McpHealthMonitor.from_state_file(state_file)
            result = mcp2.check("agentcash")
            self.assertEqual(result["status"], "connected")
            self.assertTrue(result["healthy"])

            result2 = mcp2.check("chrome-devtools")
            self.assertEqual(result2["status"], "error")
            self.assertEqual(result2["error"], "refused")

    def test_from_state_file_missing_file(self):
        """Loading from a non-existent file returns an empty monitor."""
        mcp = McpHealthMonitor.from_state_file("/nonexistent/path/state.json")
        self.assertEqual(mcp.list_servers(), [])

    def test_save_catches_oserror(self):
        """save() on an invalid path doesn't raise."""
        mcp = McpHealthMonitor(state_file="/nonexistent/dir/state.json")
        mcp.register("test", status="connected")
        # Should not raise — fire-and-forget semantics.
        mcp.save()


class TestUpdateStatus(unittest.TestCase):
    """Registering the same server twice updates its state."""

    def test_update_overwrites(self):
        mcp = McpHealthMonitor()
        mcp.register("agentcash", status="connecting")
        self.assertEqual(mcp.check("agentcash")["status"], "connecting")
        self.assertFalse(mcp.check("agentcash")["healthy"])

        mcp.register("agentcash", status="connected")
        self.assertEqual(mcp.check("agentcash")["status"], "connected")
        self.assertTrue(mcp.check("agentcash")["healthy"])

    def test_error_cleared_on_status_change(self):
        """Error field is cleared when status changes away from error."""
        mcp = McpHealthMonitor()
        mcp.register("svc", status="error", error="timeout")
        self.assertEqual(mcp.check("svc")["error"], "timeout")

        mcp.register("svc", status="connected")
        self.assertIsNone(mcp.check("svc")["error"])


class TestCheckReturnsCopy(unittest.TestCase):
    """check() returns a copy, so mutating it doesn't affect internal state."""

    def test_mutating_result_does_not_affect_state(self):
        mcp = McpHealthMonitor()
        mcp.register("agentcash", status="connected")
        result = mcp.check("agentcash")
        result["status"] = "error"
        # Internal state must be unchanged.
        self.assertEqual(mcp.check("agentcash")["status"], "connected")


class TestValidStatuses(unittest.TestCase):
    """Only valid status values are accepted."""

    def test_invalid_status_raises(self):
        mcp = McpHealthMonitor()
        with self.assertRaises(ValueError):
            mcp.register("svc", status="bogus")

    def test_all_valid_statuses_accepted(self):
        mcp = McpHealthMonitor()
        for status in ("disconnected", "connecting", "connected",
                        "auth_required", "error"):
            mcp.register(f"svc-{status}", status=status)
            self.assertEqual(mcp.check(f"svc-{status}")["status"], status)


if __name__ == "__main__":
    unittest.main()
