from typing import Any, Dict, List, Optional, Union
from uuid import UUID
import time

try:
    from langchain_core.callbacks import BaseCallbackHandler
    from langchain_core.outputs import LLMResult
except ImportError:
    # Dummy class to prevent import errors if langchain is not installed
    class BaseCallbackHandler:
        pass
    class LLMResult:
        pass

from dashclaw import DashClaw

class DashClawCallbackHandler(BaseCallbackHandler):
    """
    LangChain CallbackHandler for DashClaw.
    Automatically logs actions, tools, LLM calls, and token usage to your DashClaw dashboard.
    
    Usage:
        handler = DashClawCallbackHandler(claw)
        agent.run(..., callbacks=[handler])
    """

    def __init__(self, client: DashClaw):
        """
        Initialize the callback handler.
        
        Args:
            client: An initialized DashClaw client instance.
        """
        self.client = client
        self.run_map = {}  # Map LangChain run_id -> DashClaw action_id
        self.run_started_at = {}  # Map LangChain run_id -> monotonic start timestamp

    def _get_action_id(self, run_id: UUID) -> Optional[str]:
        return self.run_map.get(str(run_id))

    def _mark_run_start(self, run_id: UUID) -> None:
        self.run_started_at[str(run_id)] = time.monotonic()

    def _consume_duration_ms(self, run_id: UUID) -> int:
        started = self.run_started_at.pop(str(run_id), None)
        if started is None:
            return 0
        return max(0, int((time.monotonic() - started) * 1000))

    def on_llm_start(
        self, serialized: Dict[str, Any], prompts: List[str], *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any
    ) -> None:
        """Run when LLM starts running."""
        try:
            self._mark_run_start(run_id)
            model = kwargs.get('invocation_params', {}).get('model_name') or 'unknown-llm'
            prompt_preview = (prompts[0][:100] + "...") if prompts else "LLM Generation"
            
            # Create action
            res = self.client.create_action(
                action_type="planning",
                declared_goal=f"LLM Generate: {prompt_preview}",
                input_summary=prompts[0] if prompts else None,
                parent_action_id=self.run_map.get(str(parent_run_id)) if parent_run_id else None,
                risk_score=10, # Low risk for generation
                systems_touched=["llm", model]
            )
            
            if res and 'action_id' in res:
                self.run_map[str(run_id)] = res['action_id']
        except Exception as e:
            print(f"[DashClaw] Failed to log LLM start: {e}")

    def on_llm_end(self, response: LLMResult, *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any) -> None:
        """Run when LLM ends running."""
        action_id = self._get_action_id(run_id)
        if not action_id:
            self.run_started_at.pop(str(run_id), None)
            return

        try:
            duration_ms = self._consume_duration_ms(run_id)
            # Extract output
            output = response.generations[0][0].text
            
            # Extract token usage if available (OpenAI/Anthropic usually provide this)
            llm_output = response.llm_output or {}
            token_usage = llm_output.get('token_usage', {})
            tokens_in = token_usage.get('prompt_tokens', 0)
            tokens_out = token_usage.get('completion_tokens', 0)
            model = llm_output.get('model_name')

            update_payload = {
                "status": "completed",
                "output_summary": output[:500] + "..." if len(output) > 500 else output,
                "duration_ms": duration_ms
            }

            # Add token usage for Cost Analytics
            if tokens_in or tokens_out:
                update_payload["tokens_in"] = tokens_in
                update_payload["tokens_out"] = tokens_out
                # Actions API will auto-calculate cost based on these + model

            self.client.update_outcome(action_id, **update_payload)
            
            # Also report to dedicated token API for aggregated stats
            if tokens_in or tokens_out:
                self.client.report_token_usage(tokens_in, tokens_out, model=model, session_key=str(parent_run_id or run_id))

        except Exception as e:
            print(f"[DashClaw] Failed to log LLM end: {e}")
        finally:
            self.run_map.pop(str(run_id), None)
            self.run_started_at.pop(str(run_id), None)

    def on_tool_start(
        self, serialized: Dict[str, Any], input_str: str, *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any
    ) -> None:
        """Run when tool starts running."""
        try:
            self._mark_run_start(run_id)
            tool_name = serialized.get("name", "tool")
            
            res = self.client.create_action(
                action_type="tool", # Mapped to 'api' or 'function' in UI
                declared_goal=f"Use Tool: {tool_name}",
                input_summary=input_str,
                parent_action_id=self.run_map.get(str(parent_run_id)) if parent_run_id else None,
                risk_score=30, # Moderate risk for tools
                systems_touched=[tool_name]
            )
            
            if res and 'action_id' in res:
                self.run_map[str(run_id)] = res['action_id']
        except Exception as e:
            print(f"[DashClaw] Failed to log Tool start: {e}")

    def on_tool_end(self, output: str, *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any) -> None:
        """Run when tool ends running."""
        action_id = self._get_action_id(run_id)
        if not action_id:
            self.run_started_at.pop(str(run_id), None)
            return

        try:
            duration_ms = self._consume_duration_ms(run_id)
            self.client.update_outcome(
                action_id,
                status="completed",
                output_summary=str(output)[:1000], # Truncate large tool outputs
                duration_ms=duration_ms
            )
        except Exception as e:
            print(f"[DashClaw] Failed to log Tool end: {e}")
        finally:
            self.run_map.pop(str(run_id), None)
            self.run_started_at.pop(str(run_id), None)

    def on_tool_error(self, error: Union[Exception, KeyboardInterrupt], *, run_id: UUID, parent_run_id: Optional[UUID] = None, **kwargs: Any) -> None:
        """Run when tool errors."""
        action_id = self._get_action_id(run_id)
        if not action_id:
            self.run_started_at.pop(str(run_id), None)
            return

        try:
            duration_ms = self._consume_duration_ms(run_id)
            self.client.update_outcome(
                action_id,
                status="failed",
                error_message=str(error),
                duration_ms=duration_ms
            )
        except Exception as e:
            print(f"[DashClaw] Failed to log Tool error: {e}")
        finally:
            self.run_map.pop(str(run_id), None)
            self.run_started_at.pop(str(run_id), None)
