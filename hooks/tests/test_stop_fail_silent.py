"""Regression test for the Stop hook fail-silent contract.

The DashClaw hook contract requires that even with
DASHCLAW_CODE_SESSIONS_ENABLED=1, a missing DASHCLAW_BASE_URL /
DASHCLAW_API_KEY must NOT cause the hook to traceback or non-zero
exit. Claude Code must never see a hook failure.
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest


_HOOKS_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_STOP_SCRIPT = os.path.join(_HOOKS_DIR, "dashclaw_stop.py")


def _write_fixture_transcript():
    fd, path = tempfile.mkstemp(suffix=".jsonl", prefix="dashclaw_silent_")
    entries = [
        {"type": "user", "sessionId": "s-silent", "uuid": "u-prompt",
         "timestamp": "2026-05-13T12:00:00Z",
         "message": {"role": "user", "content": "hi"}},
        {"type": "assistant", "sessionId": "s-silent", "uuid": "u-1",
         "requestId": "R1", "timestamp": "2026-05-13T12:00:01Z",
         "cwd": "C:/Projects/SilentDemo",
         "message": {"role": "assistant", "model": "claude-sonnet-4-6", "id": "M1",
                     "content": [{"type": "text", "text": "ok"}],
                     "usage": {"input_tokens": 10, "output_tokens": 5,
                               "cache_creation_input_tokens": 0,
                               "cache_read_input_tokens": 0}}},
    ]
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")
    return path


class TestStopHookFailSilent(unittest.TestCase):
    def test_runs_with_code_sessions_enabled_and_no_base_url(self):
        transcript = _write_fixture_transcript()
        try:
            env = {
                **{k: v for k, v in os.environ.items() if not k.startswith("DASHCLAW_")},
                "DASHCLAW_BASE_URL": "",
                "DASHCLAW_API_KEY": "",
                "DASHCLAW_CODE_SESSIONS_ENABLED": "1",
                "DASHCLAW_DISABLE_DOTENV": "1",
            }
            stdin = json.dumps({"session_id": "s-silent", "transcript_path": transcript}).encode("utf-8")
            result = subprocess.run(
                [sys.executable, _STOP_SCRIPT],
                input=stdin, env=env, capture_output=True, timeout=10,
            )
            self.assertEqual(result.returncode, 0,
                             f"non-zero exit: stdout={result.stdout!r} stderr={result.stderr!r}")
            self.assertNotIn(b"Traceback", result.stderr)
        finally:
            try:
                os.remove(transcript)
            except FileNotFoundError:
                pass

    def test_runs_with_unreachable_base_url(self):
        transcript = _write_fixture_transcript()
        try:
            env = {
                **{k: v for k, v in os.environ.items() if not k.startswith("DASHCLAW_")},
                "DASHCLAW_BASE_URL": "http://127.0.0.1:1",
                "DASHCLAW_API_KEY": "test-key",
                "DASHCLAW_CODE_SESSIONS_ENABLED": "1",
                "DASHCLAW_DISABLE_DOTENV": "1",
            }
            stdin = json.dumps({"session_id": "s-silent", "transcript_path": transcript}).encode("utf-8")
            result = subprocess.run(
                [sys.executable, _STOP_SCRIPT],
                input=stdin, env=env, capture_output=True, timeout=15,
            )
            self.assertEqual(result.returncode, 0,
                             f"non-zero exit: stderr={result.stderr!r}")
            self.assertNotIn(b"Traceback", result.stderr)
        finally:
            try:
                os.remove(transcript)
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    unittest.main()
