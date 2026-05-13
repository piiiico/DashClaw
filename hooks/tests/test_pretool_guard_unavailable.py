"""Regression tests for handle_guard_unavailable (BUG-04).

Verifies that when /api/guard is unreachable, the hook:

1. Enforce + block policy (default): exits 2, writes orphan log.
2. Enforce + warn policy: exits 0 with stderr warning, writes orphan log.
3. Enforce + allow policy: exits 0 silently, writes orphan log.
4. Observe mode: exits 0 with stderr notice, writes orphan log.
5. Orphan-log write failure: policy is still honored, error is appended
   to dashclaw_hook_errors.log (non-fatal).

Prior to Phase 1.5 Plan 3, the hook logged a single stderr line and
sys.exit(0) when /api/guard was unreachable — every outage produced
zero audit records and let every governed action proceed.

Uses only the Python standard library. Follows the subprocess +
unittest pattern from test_handle_block_audit.py. Does not hit the
network: DASHCLAW_BASE_URL points at 127.0.0.1 port 1, which reliably
refuses connections (or exceeds the tiny guard timeout below).
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest


_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_PRETOOL_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_pretool.py")

# 127.0.0.1:1 (TCPMUX) is reserved and unlikely to be listening. If a
# connection somehow succeeds, the guard timeout below will still bound
# the test at ~500ms.
_UNREACHABLE_URL = "http://127.0.0.1:1"


_GOVERNED_BASH_INPUT = {
    "tool_name": "Bash",
    "tool_input": {"command": "rm -rf /tmp/dashclaw-bug04-test-fixture"},
    "tool_use_id": "tu-bug04-guard-unreachable",
}


def _run_hook(home_dir, tmp_dir, env_overrides=None, timeout=15):
    """Run the pretool hook as a subprocess with a scoped HOME + TMP.

    Returns (exit_code, stdout, stderr).
    """
    env = os.environ.copy()
    for key in list(env.keys()):
        if key.startswith("DASHCLAW_"):
            del env[key]
    # Disable .env walking so the operator's local .env cannot leak into the
    # subprocess and override test expectations. Production hooks never set this.
    env["DASHCLAW_DISABLE_DOTENV"] = "1"

    env["HOME"] = home_dir
    env["USERPROFILE"] = home_dir
    env["TEMP"] = tmp_dir
    env["TMP"] = tmp_dir
    env["TMPDIR"] = tmp_dir

    env["DASHCLAW_BASE_URL"] = _UNREACHABLE_URL
    env["DASHCLAW_API_KEY"] = "test-key-bug04"
    env["DASHCLAW_AGENT_ID"] = "test-agent-bug04"
    env["DASHCLAW_WORKSPACE"] = tmp_dir
    env["DASHCLAW_PERMISSION_MODE"] = "danger"
    env["DASHCLAW_GUARD_TIMEOUT"] = "0.5"

    if env_overrides:
        env.update(env_overrides)

    proc = subprocess.run(
        [sys.executable, _PRETOOL_SCRIPT],
        input=json.dumps(_GOVERNED_BASH_INPUT).encode("utf-8"),
        capture_output=True,
        timeout=timeout,
        env=env,
    )
    return (
        proc.returncode,
        proc.stdout.decode("utf-8", errors="replace"),
        proc.stderr.decode("utf-8", errors="replace"),
    )


def _read_orphan_log(home_dir):
    path = os.path.join(home_dir, ".dashclaw", "orphan-actions.jsonl")
    if not os.path.exists(path):
        return []
    records = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    return records


class TestGuardUnavailable(unittest.TestCase):
    """Regression tests for BUG-04 — guard unreachable must never be silent."""

    def setUp(self):
        self._home_ctx = tempfile.TemporaryDirectory()
        self._tmp_ctx = tempfile.TemporaryDirectory()
        self.home_dir = self._home_ctx.name
        self.tmp_dir = self._tmp_ctx.name

    def tearDown(self):
        self._home_ctx.cleanup()
        self._tmp_ctx.cleanup()

    def _assert_orphan_record(self, expected_policy, expected_mode):
        records = _read_orphan_log(self.home_dir)
        self.assertEqual(
            len(records), 1,
            "Expected exactly one orphan record. Got: " + str(records),
        )
        rec = records[0]
        self.assertEqual(rec.get("reason"), "guard_unreachable")
        self.assertEqual(rec.get("base_url"), _UNREACHABLE_URL)
        self.assertEqual(rec.get("policy"), expected_policy)
        self.assertEqual(rec.get("hook_mode"), expected_mode)
        self.assertIsInstance(rec.get("context"), dict)

    # -----------------------------------------------------------------------

    def test_enforce_block_default_exits_2_with_orphan_log(self):
        """Default policy is block: hook exits 2 and writes orphan record."""
        code, _out, err = _run_hook(self.home_dir, self.tmp_dir)

        self.assertEqual(code, 2, "stderr=" + err)
        self.assertIn("Blocked", err)
        self.assertIn("unreachable", err)
        self._assert_orphan_record(expected_policy="block", expected_mode="enforce")

    def test_enforce_warn_exits_0_with_stderr_warning(self):
        """warn policy proceeds with a loud stderr warning + orphan log."""
        code, _out, err = _run_hook(
            self.home_dir, self.tmp_dir,
            env_overrides={"DASHCLAW_GUARD_UNAVAILABLE_POLICY": "warn"},
        )

        self.assertEqual(code, 0, "stderr=" + err)
        self.assertIn("proceeding", err)
        self.assertTrue(
            ("\u26a0" in err) or ("warn" in err.lower()),
            "warn-mode stderr should contain ⚠ or the word 'warn'. Got: " + err,
        )
        self._assert_orphan_record(expected_policy="warn", expected_mode="enforce")

    def test_enforce_allow_exits_0_with_orphan_log(self):
        """allow policy proceeds and still writes orphan log for backfill."""
        code, _out, err = _run_hook(
            self.home_dir, self.tmp_dir,
            env_overrides={"DASHCLAW_GUARD_UNAVAILABLE_POLICY": "allow"},
        )

        self.assertEqual(code, 0, "stderr=" + err)
        self.assertIn("proceeding", err)
        self.assertIn("DASHCLAW_GUARD_UNAVAILABLE_POLICY=allow", err)
        self._assert_orphan_record(expected_policy="allow", expected_mode="enforce")

    def test_observe_mode_exits_0_with_orphan_log(self):
        """Observe mode proceeds regardless of policy and still logs."""
        code, _out, err = _run_hook(
            self.home_dir, self.tmp_dir,
            env_overrides={"DASHCLAW_HOOK_MODE": "observe"},
        )

        self.assertEqual(code, 0, "stderr=" + err)
        self.assertIn("[observe]", err)
        self.assertIn("orphan", err)
        self._assert_orphan_record(expected_policy="block", expected_mode="observe")

    def test_orphan_log_write_failure_is_non_fatal(self):
        """If the orphan log can't be written, policy is still honored.

        We block orphan-log creation by making ~/.dashclaw exist as a FILE,
        so os.makedirs(..., exist_ok=True) raises FileExistsError. The
        handler must catch that, log to dashclaw_hook_errors.log, and
        still enforce the policy (exit 2 for default block).
        """
        dashclaw_dir_as_file = os.path.join(self.home_dir, ".dashclaw")
        with open(dashclaw_dir_as_file, "w", encoding="utf-8") as f:
            f.write("conflicting file in place of directory")

        code, _out, err = _run_hook(self.home_dir, self.tmp_dir)

        self.assertEqual(code, 2, "stderr=" + err)
        self.assertIn("Blocked", err)

        self.assertFalse(
            os.path.isdir(dashclaw_dir_as_file),
            "~/.dashclaw should still be the file we planted",
        )

        error_log = os.path.join(self.tmp_dir, "dashclaw_hook_errors.log")
        self.assertTrue(
            os.path.exists(error_log),
            "dashclaw_hook_errors.log should capture orphan-log write failure",
        )
        with open(error_log, "r", encoding="utf-8") as f:
            content = f.read()
        self.assertIn("handle_guard_unavailable", content)
        self.assertIn("orphan log write failed", content)


if __name__ == "__main__":
    unittest.main()
