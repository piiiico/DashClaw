"""Full integration tests for the dashclaw-agent-intel pipeline.

Exercises the complete flow that the pretool hook uses:
classify_tool -> classify_bash / scan_file_operation -> build context -> verify intel.

Uses only the Python standard library.
"""

import unittest

from dashclaw_agent_intel import (
    classify_bash,
    scan_file_operation,
    classify_tool,
    SessionTracker,
    McpHealthMonitor,
)


class TestFullPipeline(unittest.TestCase):

    def test_bash_git_push_full_pipeline(self):
        """Classify tool -> classify bash -> build context -> verify intel."""
        tool_info = classify_tool("Bash", {"command": "git push origin main"})
        assert tool_info["category"] == "execution"
        assert tool_info["governed"] == True

        bash_info = classify_bash("git push origin main", mode="workspace_write", workspace="/tmp/project")
        assert bash_info["intent"] == "write"
        assert bash_info["risk_score"] >= 30

        context = {
            "agent_id": "test-agent",
            "action_type": "apply",
            "risk_score": max(tool_info["risk_profile"]["base_risk"], bash_info["risk_score"]),
            "intel": {"tool": tool_info, "bash": bash_info},
        }
        assert "intel" in context
        assert "bash" in context["intel"]

    def test_file_write_traversal_full_pipeline(self):
        """Classify tool -> scan file -> verify traversal detected."""
        tool_info = classify_tool("Write", {"file_path": "../../etc/passwd", "content": "bad"})
        assert tool_info["governed"] == True

        file_info = scan_file_operation("../../etc/passwd", "bad", "/tmp/project")
        assert file_info["traversal_detected"] == True
        assert file_info["outside_workspace"] == True

        risk = tool_info["risk_profile"]["base_risk"]
        if file_info["traversal_detected"] or file_info["outside_workspace"]:
            risk = min(risk + 20, 100)
        assert risk >= 50

    def test_mcp_tool_full_pipeline(self):
        """Classify MCP tool -> check health -> verify governed."""
        tool_info = classify_tool("mcp__agentcash__search", {"query": "test"})
        assert tool_info["category"] == "mcp"
        assert tool_info["governed"] == True

        mcp = McpHealthMonitor()
        mcp.register("agentcash", status="connected")
        health = mcp.check("agentcash")
        assert health["healthy"] == True

    def test_session_lifecycle_full_pipeline(self):
        """Create session -> transition through states -> verify event log."""
        session = SessionTracker(agent_id="test", workspace="/tmp")
        assert session.get_state()["status"] == "spawning"

        session.transition("ready")
        session.transition("running")
        session.transition("finished")
        assert session.get_state()["status"] == "finished"
        assert len(session.get_state()["events"]) == 4

    def test_destructive_bash_high_risk(self):
        """Verify rm -rf gets high risk and destructive intent."""
        tool_info = classify_tool("Bash", {"command": "rm -rf /"})
        bash_info = classify_bash("rm -rf /", mode="workspace_write", workspace="/tmp/project")
        assert bash_info["intent"] == "destructive"
        assert bash_info["risk_score"] >= 85
        assert bash_info["reversible"] == False

    def test_ungoverned_tool_skipped(self):
        """Verify Read tool is ungoverned by default."""
        tool_info = classify_tool("Read", {"file_path": "/tmp/test.txt"})
        assert tool_info["governed"] == False
        assert tool_info["category"] == "search"

    def test_sensitive_file_write_pipeline(self):
        """Verify .env file write detected as sensitive."""
        tool_info = classify_tool("Write", {"file_path": ".env", "content": "SECRET=foo"})
        file_info = scan_file_operation(".env", "SECRET=foo", "/tmp/project")
        assert file_info["sensitive_path"] == True
        assert file_info["sensitive_pattern"] == "env_file"

    def test_unknown_tool_governed(self):
        """Verify unknown tools fail-safe to governed."""
        tool_info = classify_tool("FutureTool2027", {})
        assert tool_info["governed"] == True
        assert tool_info["category"] == "unknown"


if __name__ == "__main__":
    unittest.main()
