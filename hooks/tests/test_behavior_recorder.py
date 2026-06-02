"""Tests for dashclaw_agent_intel.behavior_recorder.

Covers deterministic redaction, opt-in gating, fail-silent behavior, and the
PreToolUse -> PostToolUse pending-sample roundtrip that produces a redacted
JSONL behavior sample on local disk.
"""

import json
import os
import tempfile
import unittest

from dashclaw_agent_intel import behavior_recorder as br


class TestRedaction(unittest.TestCase):
    def test_scrubs_known_secret_shapes(self):
        secrets = [
            "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA",
            "sk_live_AAAAAAAAAAAAAAAA",
            "ghp_AAAAAAAAAAAAAAAAAAAAAAAA",
            "AKIAABCDEFGHIJKLMNOP",
        ]
        for s in secrets:
            out = br.redact_text("token=%s end" % s)
            self.assertIn("<REDACTED:", out)
            self.assertNotIn(s, out)

    def test_env_assignment_keeps_variable_name(self):
        out = br.redact_text("ANTHROPIC_API_KEY=sk-ant-secretvalue123456")
        self.assertIn("ANTHROPIC_API_KEY=<REDACTED:env_assign>", out)
        self.assertNotIn("secretvalue", out)

    def test_bounds_length(self):
        self.assertEqual(len(br.redact_text("a" * 5000)), br._MAX_FIELD)

    def test_redact_path_home_and_workspace(self):
        ws = "/tmp/project"
        out = br.redact_path("/tmp/project/app/api/auth/route.js", workspace=ws)
        self.assertEqual(out, "app/api/auth/route.js")

    def test_command_shape_preserves_verbs_redacts_operands(self):
        shape = br.command_shape("git push --force origin /secret/path", workspace="/tmp/project")
        self.assertIn("git", shape)
        self.assertIn("push", shape)
        self.assertIn("--force", shape)
        self.assertIn("<path>", shape)

    def test_command_shape_redacts_secret_token(self):
        shape = br.command_shape("export TOKEN=ghp_AAAAAAAAAAAAAAAAAAAAAAAA")
        self.assertNotIn("ghp_AAAA", shape)


class TestRecorderRoundtrip(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DASHCLAW_BEHAVIOR_SAMPLES_ENABLED"] = "1"
        os.environ["DASHCLAW_BEHAVIOR_SAMPLES_DIR"] = self.tmp.name
        self.workspace = "/tmp/project"

    def tearDown(self):
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_ENABLED", None)
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_DIR", None)
        self.tmp.cleanup()

    def _read_all_samples(self):
        rows = []
        for name in os.listdir(self.tmp.name):
            if not name.endswith(".jsonl"):
                continue
            with open(os.path.join(self.tmp.name, name), encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if line:
                        rows.append(json.loads(line))
        return rows

    def test_pre_then_post_writes_completed_sample(self):
        context = {
            "agent_id": "claude-code",
            "action_type": "apply",
            "risk_score": 35,
            "reversible": True,
            "target": "/tmp/project/app/api/auth/route.js",
            "tool": {"category": "file_io"},
            "intel": {"file": {"sensitive_path": True}},
        }
        tool_input = {"file_path": "/tmp/project/app/api/auth/route.js", "content": "x"}
        br.record_pre("tu_1", "Write", tool_input, context, {"matched_policies": []}, "allow", "enforce", self.workspace)
        # No sample written yet (pending).
        self.assertEqual(self._read_all_samples(), [])
        br.record_post("tu_1", "completed", {"exit_code": 0}, action_id="act_123", workspace=self.workspace)

        rows = self._read_all_samples()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row["tool"], "Write")
        self.assertEqual(row["outcome_status"], "completed")
        self.assertEqual(row["action_id"], "act_123")
        self.assertEqual(row["write_paths"], ["app/api/auth/route.js"])
        self.assertEqual(row["guard_decision"], "allow")
        self.assertTrue(row["event_id"].startswith("bse_"))

    def test_enforce_block_writes_terminal_sample_immediately(self):
        context = {"agent_id": "claude-code", "action_type": "security", "risk_score": 90, "reversible": False,
                   "intel": {"bash": {"intent": "destructive"}}, "tool": {"category": "execution"}}
        tool_input = {"command": "rm -rf /tmp/project/data"}
        br.record_pre("tu_block", "Bash", tool_input, context, {"matched_policies": ["gp_x"]}, "block", "enforce", self.workspace)
        rows = self._read_all_samples()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome_status"], "blocked")
        self.assertEqual(rows[0]["bash_intent"], "destructive")

    def test_post_marks_failed(self):
        context = {"agent_id": "a", "action_type": "build", "risk_score": 25, "reversible": True, "tool": {}, "intel": {}}
        br.record_pre("tu_f", "Bash", {"command": "npm run build"}, context, {}, "allow", "enforce", self.workspace)
        br.record_post("tu_f", "failed", {"error_type": "runtime"}, action_id=None, workspace=self.workspace)
        rows = self._read_all_samples()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["outcome_status"], "failed")
        self.assertEqual(rows[0]["error_type"], "runtime")


class TestGatingAndFailSilent(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["DASHCLAW_BEHAVIOR_SAMPLES_DIR"] = self.tmp.name

    def tearDown(self):
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_ENABLED", None)
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_DIR", None)
        self.tmp.cleanup()

    def test_disabled_records_nothing(self):
        os.environ.pop("DASHCLAW_BEHAVIOR_SAMPLES_ENABLED", None)
        self.assertFalse(br.is_enabled())
        br.record_pre("tu_x", "Bash", {"command": "ls"}, {"agent_id": "a", "tool": {}, "intel": {}}, {}, "allow", "enforce", "/tmp/p")
        br.record_post("tu_x", "completed", {}, None, "/tmp/p")
        self.assertEqual(os.listdir(self.tmp.name), [])

    def test_fail_silent_on_garbage(self):
        os.environ["DASHCLAW_BEHAVIOR_SAMPLES_ENABLED"] = "1"
        # Missing/garbage context must not raise.
        br.record_pre("tu_g", None, None, None, None, None, "enforce", None)
        br.record_post("tu_missing_pending", "completed", None, None, None)


if __name__ == "__main__":
    unittest.main()
