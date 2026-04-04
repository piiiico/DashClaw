"""Tests for dashclaw_agent_intel.session_tracker.SessionTracker."""

import re
import unittest
from datetime import datetime, timezone

from dashclaw_agent_intel.session_tracker import SessionTracker


# ---------------------------------------------------------------------------
# Initial state
# ---------------------------------------------------------------------------

class TestInitialState(unittest.TestCase):
    """Verify the fresh SessionTracker has correct defaults."""

    def test_initial_status_is_spawning(self):
        s = SessionTracker(agent_id="claude-code", workspace="/home/user/proj")
        state = s.get_state()
        self.assertEqual(state["status"], "spawning")

    def test_session_id_starts_with_prefix(self):
        s = SessionTracker(agent_id="claude-code", workspace="/tmp")
        self.assertTrue(s.get_state()["session_id"].startswith("sess_"))

    def test_session_id_has_correct_format(self):
        s = SessionTracker(agent_id="claude-code", workspace="/tmp")
        sid = s.get_state()["session_id"]
        # sess_ + 12 hex chars
        self.assertRegex(sid, r"^sess_[0-9a-f]{12}$")

    def test_initial_event_log_has_spawning_event(self):
        s = SessionTracker(agent_id="claude-code", workspace="/tmp")
        events = s.get_state()["events"]
        self.assertEqual(len(events), 1)
        self.assertEqual(events[0]["seq"], 1)
        self.assertEqual(events[0]["kind"], "spawning")
        self.assertIn("at", events[0])

    def test_agent_id_and_workspace_stored(self):
        s = SessionTracker(agent_id="aider", workspace="/projects/foo")
        state = s.get_state()
        self.assertEqual(state["agent_id"], "aider")
        self.assertEqual(state["workspace"], "/projects/foo")


# ---------------------------------------------------------------------------
# Valid transitions
# ---------------------------------------------------------------------------

class TestValidTransitions(unittest.TestCase):
    """Verify all valid transition paths."""

    def _make_session(self):
        return SessionTracker(agent_id="test", workspace="/tmp")

    def test_spawning_to_ready(self):
        s = self._make_session()
        s.transition("ready")
        self.assertEqual(s.get_state()["status"], "ready")

    def test_spawning_to_running(self):
        s = self._make_session()
        s.transition("running")
        self.assertEqual(s.get_state()["status"], "running")

    def test_ready_to_running(self):
        s = self._make_session()
        s.transition("ready")
        s.transition("running")
        self.assertEqual(s.get_state()["status"], "running")

    def test_running_to_finished(self):
        s = self._make_session()
        s.transition("running")
        s.transition("finished")
        self.assertEqual(s.get_state()["status"], "finished")

    def test_running_to_failed(self):
        s = self._make_session()
        s.transition("running")
        s.transition("failed", reason="OOM")
        self.assertEqual(s.get_state()["status"], "failed")

    def test_blocked_to_ready(self):
        s = self._make_session()
        s.transition("blocked", reason="server down")
        s.transition("ready")
        self.assertEqual(s.get_state()["status"], "ready")

    def test_blocked_to_running(self):
        s = self._make_session()
        s.transition("blocked", reason="timeout")
        s.transition("running")
        self.assertEqual(s.get_state()["status"], "running")

    def test_blocked_to_finished(self):
        s = self._make_session()
        s.transition("blocked", reason="stalled")
        s.transition("finished")
        self.assertEqual(s.get_state()["status"], "finished")

    def test_blocked_to_failed(self):
        s = self._make_session()
        s.transition("blocked", reason="network lost")
        s.transition("failed", reason="unrecoverable")
        self.assertEqual(s.get_state()["status"], "failed")


# ---------------------------------------------------------------------------
# Blocked reason handling
# ---------------------------------------------------------------------------

class TestBlockedReason(unittest.TestCase):
    """Verify blocked_reason is set and cleared correctly."""

    def test_blocked_sets_reason(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("blocked", reason="MCP server disconnected")
        state = s.get_state()
        self.assertEqual(state["blocked_reason"], "MCP server disconnected")

    def test_failed_sets_reason(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("failed", reason="crash")
        state = s.get_state()
        self.assertEqual(state["blocked_reason"], "crash")

    def test_reason_cleared_on_non_blocked_transition(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("blocked", reason="disk full")
        s.transition("ready")
        state = s.get_state()
        self.assertIsNone(state["blocked_reason"])

    def test_blocked_without_reason_sets_none(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("blocked")
        state = s.get_state()
        self.assertIsNone(state["blocked_reason"])


# ---------------------------------------------------------------------------
# Event log
# ---------------------------------------------------------------------------

class TestEventLog(unittest.TestCase):
    """Verify event logging is correct and sequential."""

    def test_events_have_sequential_ids(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("ready")
        s.transition("running")
        s.transition("finished")
        events = s.get_state()["events"]
        seqs = [e["seq"] for e in events]
        self.assertEqual(seqs, [1, 2, 3, 4])

    def test_event_kinds_match_transitions(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("ready")
        s.transition("running")
        events = s.get_state()["events"]
        kinds = [e["kind"] for e in events]
        self.assertEqual(kinds, ["spawning", "ready", "running"])

    def test_blocked_event_includes_detail(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("blocked", reason="MCP server disconnected")
        events = s.get_state()["events"]
        blocked_evt = events[-1]
        self.assertEqual(blocked_evt["detail"], "MCP server disconnected")

    def test_non_blocked_event_has_no_detail(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("ready")
        events = s.get_state()["events"]
        ready_evt = events[-1]
        self.assertNotIn("detail", ready_evt)

    def test_event_timestamps_are_iso_format(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("ready")
        events = s.get_state()["events"]
        for e in events:
            # Should parse as ISO-8601 without error.
            dt = datetime.fromisoformat(e["at"])
            self.assertIsNotNone(dt.tzinfo)


# ---------------------------------------------------------------------------
# Invalid transitions
# ---------------------------------------------------------------------------

class TestInvalidTransitions(unittest.TestCase):
    """Verify ValueError on illegal state transitions."""

    def test_finished_to_running_raises(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("running")
        s.transition("finished")
        with self.assertRaises(ValueError):
            s.transition("running")

    def test_failed_to_ready_raises(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("failed", reason="crash")
        with self.assertRaises(ValueError):
            s.transition("ready")

    def test_finished_to_finished_raises(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("running")
        s.transition("finished")
        with self.assertRaises(ValueError):
            s.transition("finished")

    def test_invalid_target_status_raises(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        with self.assertRaises(ValueError):
            s.transition("nonexistent_status")

    def test_ready_to_spawning_raises(self):
        """spawning is not a valid target for any state."""
        s = SessionTracker(agent_id="test", workspace="/tmp")
        s.transition("ready")
        with self.assertRaises(ValueError):
            s.transition("spawning")


# ---------------------------------------------------------------------------
# status_since tracking
# ---------------------------------------------------------------------------

class TestStatusSince(unittest.TestCase):
    """Verify status_since updates on each transition."""

    def test_status_since_is_iso_timestamp(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        state = s.get_state()
        dt = datetime.fromisoformat(state["status_since"])
        self.assertIsNotNone(dt.tzinfo)

    def test_status_since_updates_on_transition(self):
        s = SessionTracker(agent_id="test", workspace="/tmp")
        t1 = s.get_state()["status_since"]
        s.transition("ready")
        t2 = s.get_state()["status_since"]
        # t2 should be >= t1 (could be equal in fast tests).
        self.assertGreaterEqual(t2, t1)


# ---------------------------------------------------------------------------
# Session ID uniqueness
# ---------------------------------------------------------------------------

class TestSessionIdUniqueness(unittest.TestCase):
    """Session IDs should be unique across instances."""

    def test_different_sessions_have_different_ids(self):
        a = SessionTracker(agent_id="a", workspace="/tmp")
        b = SessionTracker(agent_id="b", workspace="/tmp")
        self.assertNotEqual(
            a.get_state()["session_id"],
            b.get_state()["session_id"],
        )


if __name__ == "__main__":
    unittest.main()
