/**
 * GovernedAgent: a thin wrapper around the Anthropic Messages API that routes
 * EVERY tool call through DashClaw before it runs and records the outcome.
 *
 * Flow per tool call (mirrors hooks/dashclaw_pretool.py + posttool):
 *   1. classify   -> action_type, risk_score, reversible, declared_goal
 *   2. guard      -> allow | warn | block | require_approval
 *   3. block      -> record status 'blocked', return the reason to the model
 *      approval   -> record 'pending_approval', wait, then run or report denial
 *      allow/warn -> record 'running', run, then PATCH the outcome
 *   4. failure    -> record status 'failed' with the error summary
 *
 * The result: this conversation shows up in your Decisions Ledger the same way
 * Claude Code does, because the harness owns the tool loop.
 */

import { ApprovalDeniedError } from 'dashclaw';
import { classifyTool } from './classify.js';

function actionIdOf(resp) {
  return resp?.action?.action_id || resp?.action_id || null;
}

function summarize(output) {
  const s = typeof output === 'string' ? output : JSON.stringify(output);
  return s.length > 280 ? s.slice(0, 277) + '...' : s;
}

export class GovernedAgent {
  constructor({ claw, anthropic, model, system, tools, maxTokens = 2048, guardUnavailablePolicy = 'warn' }) {
    this.claw = claw;
    this.anthropic = anthropic;
    this.model = model;
    this.system = system;
    this.tools = tools;
    this.maxTokens = maxTokens;
    this.guardUnavailablePolicy = guardUnavailablePolicy;
    this.actionIds = [];
  }

  async _guard(context) {
    try {
      return { ok: true, decision: await this.claw.guard(context) };
    } catch (err) {
      // Network or server error reaching the guard. Mirror the hook policy.
      return { ok: false, error: err };
    }
  }

  async _record(context, status) {
    try {
      const id = actionIdOf(await this.claw.createAction({ ...context, status }));
      if (id) this.actionIds.push(id);
      return id;
    } catch {
      return null;
    }
  }

  async _runTool(name, input) {
    const tool = this.tools[name];
    if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
    return tool.run(input);
  }

  _result(block, obj) {
    return { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(obj) };
  }

  // Govern + execute one tool_use block, return a tool_result block.
  async _governedToolCall(block) {
    const hint = this.tools[block.name]?.governance || {};
    const ctx = classifyTool(block.name, block.input, hint);

    const guarded = await this._guard(ctx);

    // --- guard unreachable -------------------------------------------------
    if (!guarded.ok) {
      if (this.guardUnavailablePolicy === 'block') {
        await this._record(ctx, 'blocked');
        return this._result(block, { error: 'BLOCKED: DashClaw guard unreachable (fail closed).' });
      }
      process.stdout.write('[DashClaw] guard unreachable; proceeding per policy\n');
      return this._safeExecute(block, ctx);
    }

    const decision = guarded.decision || {};
    const verdict = decision.decision || 'allow';
    const reason =
      decision.reason ||
      decision.reasons?.[0] ||
      decision.warnings?.[0] ||
      decision.matched_policies?.[0] ||
      '';

    // --- block -------------------------------------------------------------
    if (verdict === 'block') {
      await this._record(ctx, 'blocked');
      return this._result(block, { error: `BLOCKED BY POLICY: ${reason}` });
    }

    // --- require approval --------------------------------------------------
    if (verdict === 'require_approval') {
      const id = await this._record(ctx, 'pending_approval');
      if (!id) {
        return this._result(block, { error: 'Approval could not be created; action skipped.' });
      }
      process.stdout.write(
        `\n[DashClaw] Approval required for ${block.name}\n` +
        `           Approve: dashclaw approve ${id}\n` +
        `           Replay:  ${this.claw.baseUrl}/replay/${id}\n`
      );
      try {
        await this.claw.waitForApproval(id);
      } catch (err) {
        const summary = err instanceof ApprovalDeniedError ? `Denied: ${err.message}` : String(err.message || err);
        await this.claw.updateOutcome(id, { status: 'failed', output_summary: summary });
        return this._result(block, { error: summary });
      }
      return this._executeApproved(block, id);
    }

    // --- allow / warn ------------------------------------------------------
    if (verdict === 'warn' && reason) process.stdout.write(`[DashClaw] Warning: ${reason}\n`);
    return this._safeExecute(block, ctx);
  }

  // Record 'running', execute, PATCH outcome. Used for allow/warn paths.
  async _safeExecute(block, ctx) {
    const id = await this._record(ctx, 'running');
    try {
      const output = await this._runTool(block.name, block.input);
      if (id) await this.claw.updateOutcome(id, { status: 'completed', output_summary: summarize(output) });
      return { type: 'tool_result', tool_use_id: block.id, content: output };
    } catch (err) {
      if (id) await this.claw.updateOutcome(id, { status: 'failed', output_summary: String(err.message || err) });
      return this._result(block, { error: String(err.message || err) });
    }
  }

  // Execute an already approved action by id, then PATCH its outcome.
  async _executeApproved(block, id) {
    try {
      const output = await this._runTool(block.name, block.input);
      await this.claw.updateOutcome(id, { status: 'completed', output_summary: summarize(output) });
      return { type: 'tool_result', tool_use_id: block.id, content: output };
    } catch (err) {
      await this.claw.updateOutcome(id, { status: 'failed', output_summary: String(err.message || err) });
      return this._result(block, { error: String(err.message || err) });
    }
  }

  /**
   * Run the agentic loop to completion for the given message history.
   * Mutates and returns `messages`, plus the assistant's final text.
   */
  async run(messages) {
    const toolDefs = Object.values(this.tools).map((t) => t.definition);
    let finalText = '';

    while (true) {
      const response = await this.anthropic.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        ...(this.system ? { system: this.system } : {}),
        tools: toolDefs,
        messages,
      });

      messages.push({ role: 'assistant', content: response.content });
      for (const b of response.content) if (b.type === 'text') finalText += b.text;

      if (response.stop_reason !== 'tool_use') break;

      const toolResults = [];
      for (const block of response.content) {
        if (block.type !== 'tool_use') continue;
        process.stdout.write(`[tool] ${block.name}(${JSON.stringify(block.input)})\n`);
        toolResults.push(await this._governedToolCall(block));
      }
      messages.push({ role: 'user', content: toolResults });
    }

    return { text: finalText, messages, actionIds: this.actionIds };
  }
}
