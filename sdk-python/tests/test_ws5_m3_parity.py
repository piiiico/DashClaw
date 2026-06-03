import unittest

from dashclaw.client import DashClaw


class RecordingDashClaw(DashClaw):
    def __init__(self):
        super().__init__(
            base_url="https://example.test",
            api_key="test-key",
            agent_id="agent-1",
        )
        self.calls = []
        self.stub_responses = {}

    def _request(self, path, method="GET", body=None, json=None):
        payload = json or body
        self.calls.append({"path": path, "method": method, "body": payload})
        return self.stub_responses.get(path, {"ok": True, "path": path, "method": method, "body": payload})


class WS5M3ParityTests(unittest.TestCase):
    def test_message_actions_and_thread_endpoints(self):
        client = RecordingDashClaw()

        client.mark_read(["msg_1", "msg_2"])
        self.assertEqual(client.calls[-1]["method"], "PATCH")
        self.assertEqual(client.calls[-1]["path"], "/api/messages")
        self.assertEqual(
            client.calls[-1]["body"],
            {"message_ids": ["msg_1", "msg_2"], "action": "read", "agent_id": "agent-1"},
        )

        client.archive_messages(["msg_3"])
        self.assertEqual(client.calls[-1]["body"]["action"], "archive")

        client.broadcast(body="hello everyone", message_type="status", subject="daily", thread_id="mt_1")
        self.assertEqual(client.calls[-1]["path"], "/api/messages")
        self.assertEqual(client.calls[-1]["body"]["to_agent_id"], None)
        self.assertEqual(client.calls[-1]["body"]["message_type"], "status")
        self.assertEqual(client.calls[-1]["body"]["thread_id"], "mt_1")

        client.create_message_thread(name="Coordination", participants=["agent-1", "agent-2"])
        self.assertEqual(client.calls[-1]["path"], "/api/messages/threads")
        self.assertEqual(client.calls[-1]["method"], "POST")
        self.assertEqual(client.calls[-1]["body"]["created_by"], "agent-1")

        client.get_message_threads(status="open", limit=3)
        self.assertIn("/api/messages/threads?", client.calls[-1]["path"])
        self.assertIn("status=open", client.calls[-1]["path"])
        self.assertIn("limit=3", client.calls[-1]["path"])

        client.resolve_message_thread("mt_1", summary="resolved")
        self.assertEqual(client.calls[-1]["path"], "/api/messages/threads")
        self.assertEqual(client.calls[-1]["method"], "PATCH")
        self.assertEqual(client.calls[-1]["body"]["status"], "resolved")

        client.save_shared_doc(name="Runbook", content="v1")
        self.assertEqual(client.calls[-1]["path"], "/api/messages/docs")
        self.assertEqual(client.calls[-1]["method"], "POST")
        self.assertEqual(client.calls[-1]["body"]["agent_id"], "agent-1")

    def test_report_memory_health_accepts_composed_report(self):
        client = RecordingDashClaw()
        client.report_memory_health({"health": {"score": 90}, "entities": [{"name": "Repo"}], "topics": []})
        self.assertEqual(client.calls[-1]["path"], "/api/memory")
        self.assertEqual(client.calls[-1]["method"], "POST")
        self.assertEqual(client.calls[-1]["body"]["health"]["score"], 90)

    def test_report_memory_health_accepts_split_arguments(self):
        client = RecordingDashClaw()
        client.report_memory_health({"score": 88}, entities=[{"name": "Agent"}], topics=[{"name": "Ops"}])
        self.assertEqual(
            client.calls[-1]["body"],
            {"health": {"score": 88}, "entities": [{"name": "Agent"}], "topics": [{"name": "Ops"}]},
        )


if __name__ == "__main__":
    unittest.main()
