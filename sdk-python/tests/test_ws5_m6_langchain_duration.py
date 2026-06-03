import pathlib
import sys
import time
import unittest
from types import SimpleNamespace
from uuid import uuid4

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "sdk-python"))

from dashclaw.integrations.langchain import DashClawCallbackHandler  # noqa: E402


class RecordingClient:
    def __init__(self):
        self.created = []
        self.updated = []
        self.tokens = []

    def create_action(self, **kwargs):
        self.created.append(kwargs)
        return {"action_id": f"act_{len(self.created)}"}

    def update_outcome(self, action_id, **kwargs):
        self.updated.append({"action_id": action_id, **kwargs})
        return {"ok": True}

    def report_token_usage(self, tokens_in, tokens_out, **kwargs):
        self.tokens.append({"tokens_in": tokens_in, "tokens_out": tokens_out, **kwargs})
        return {"ok": True}


class LangChainDurationTelemetryTests(unittest.TestCase):
    def test_llm_end_reports_measured_duration_ms(self):
        client = RecordingClient()
        handler = DashClawCallbackHandler(client)
        run_id = uuid4()

        handler.on_llm_start(
            {"name": "llm"},
            ["summarize this"],
            run_id=run_id,
            invocation_params={"model_name": "gpt-test"},
        )

        handler.run_started_at[str(run_id)] = time.monotonic() - 1.2

        response = SimpleNamespace(
            generations=[[SimpleNamespace(text="done")]],
            llm_output={
                "token_usage": {"prompt_tokens": 11, "completion_tokens": 7},
                "model_name": "gpt-test",
            },
        )

        handler.on_llm_end(response, run_id=run_id)

        self.assertEqual(len(client.updated), 1)
        self.assertGreaterEqual(client.updated[0]["duration_ms"], 1100)
        self.assertEqual(client.updated[0]["status"], "completed")
        self.assertEqual(len(client.tokens), 1)
        self.assertNotIn(str(run_id), handler.run_map)
        self.assertNotIn(str(run_id), handler.run_started_at)

    def test_tool_error_reports_duration_and_cleans_up(self):
        client = RecordingClient()
        handler = DashClawCallbackHandler(client)
        run_id = uuid4()

        handler.on_tool_start({"name": "web_search"}, "query text", run_id=run_id)
        handler.run_started_at[str(run_id)] = time.monotonic() - 0.6

        handler.on_tool_error(RuntimeError("boom"), run_id=run_id)

        self.assertEqual(len(client.updated), 1)
        self.assertEqual(client.updated[0]["status"], "failed")
        self.assertIn("boom", client.updated[0]["error_message"])
        self.assertGreaterEqual(client.updated[0]["duration_ms"], 500)
        self.assertNotIn(str(run_id), handler.run_map)
        self.assertNotIn(str(run_id), handler.run_started_at)


if __name__ == "__main__":
    unittest.main()
