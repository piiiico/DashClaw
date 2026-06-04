# SDK/MCP `session_id` Stamping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the MCP `dashclaw_record` tool and both SDKs stamp `action_records.session_id` so session→action linkage is exact (Direct path) instead of relying only on the time-window Fallback.

**Architecture:** Client-side only — the platform already accepts, persists, and unions `session_id` (validate → route → repo → `sessions.js`). Hybrid per surface: MCP gets an **ambient** active-session stamp held in the per-client `createToolHandlers` closure (persists across calls on stdio, inert per-request on HTTP, never module-global so no cross-org leak) plus an explicit override; the Node and Python SDKs get a **first-class explicit** `session_id` (no ambient client state).

**Tech Stack:** Node 20 / Next.js 16, Vitest (JS gate), Python `unittest` (run via `npm run sdk:integration:python`), `@dashclaw/mcp-server` (stdio + `/api/mcp` HTTP).

**Spec:** `docs/superpowers/specs/2026-06-04-sdk-mcp-session-id-stamping-design.md`

---

## File structure

| File | Change | Responsibility |
|------|--------|----------------|
| `mcp-server/lib/tools.js` | Modify | `dashclaw_record` schema + ambient `activeSessionId` in `createToolHandlers`; `session_start` stashes id; `session_end` clears on match |
| `__tests__/unit/mcp-tools.test.js` | Modify | Ambient-stamping behavior + schema assertion |
| `sdk/dashclaw.js` | Modify | `createAction` JSDoc makes `session_id` first-class (passthrough already works) |
| `__tests__/unit/sdk-session-stamping.test.js` | Create | Node passthrough regression guard |
| `sdk-python/dashclaw/client.py` | Modify | `create_action` gains explicit `session_id=None` param |
| `sdk-python/tests/test_sdk_v2_surface.py` | Modify | Python explicit-param + omit-when-None tests |
| `app/docs/page.js` | Modify | Add `session_id` to the `dashclaw_record` tool inputs string |
| `sdk/README.md`, `sdk-python/README.md`, `mcp-server/README.md` | Modify | Document the field/ambient behavior |
| `package.json`, `sdk/package.json`, `sdk-python/pyproject.toml`, `mcp-server/package.json`, `contracts/sdk/release-plan.json`, `package-lock.json` | Modify | Patch bump 4.1.0→4.1.1 (mcp-server 1.0.2→1.0.3) |

**Not modified (verified):** `PROJECT_DETAILS.md:216` lists method *names* only (no params); `app/docs/page.js:680` already documents `session_id` on `createAction`. No new routes/methods/tools/migrations.

---

## Task 1: MCP — ambient `session_id` stamping

**Files:**
- Modify: `mcp-server/lib/tools.js` (schema ~62, factory 448–459, `dashclaw_record` 483–502, `dashclaw_session_start` 568–575, `dashclaw_session_end` 577–583)
- Test: `__tests__/unit/mcp-tools.test.js`

- [ ] **Step 1: Write the failing tests**

In `__tests__/unit/mcp-tools.test.js`, add a schema assertion inside the existing `describe('Tool Definitions', …)` block (after the existing `it('every definition …')`, before its closing `});`):

```javascript
  it('dashclaw_record schema includes optional session_id', () => {
    const rec = TOOL_DEFINITIONS.find((d) => d.name === 'dashclaw_record');
    expect(rec.inputSchema.properties.session_id).toBeDefined();
    expect(rec.inputSchema.properties.session_id.type).toBe('string');
    expect(rec.inputSchema.required || []).not.toContain('session_id');
  });
```

And add a new `describe` block inside `describe('Tool Handlers', …)` (e.g. right after the existing `describe('dashclaw_record', …)` block closes). `session_start` and `record` both use `mockPost`, so order the mock with `mockResolvedValueOnce`; `session_end` uses `mockPatch`:

```javascript
  describe('dashclaw_record session_id stamping', () => {
    it('stamps the active session from dashclaw_session_start onto a later record', async () => {
      mockPost.mockResolvedValueOnce({ session: { id: 'sess_42' } }); // session_start
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });          // record
      await handlers.dashclaw_session_start({ agent_id: 'a', workspace: 'w' });
      await handlers.dashclaw_record({ action_type: 'research', declared_goal: 'g', status: 'completed' });
      const [path, body] = mockPost.mock.calls[1];
      expect(path).toBe('/api/actions');
      expect(body.session_id).toBe('sess_42');
    });

    it('lets an explicit session_id override the active session', async () => {
      mockPost.mockResolvedValueOnce({ session: { id: 'sess_42' } });
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });
      await handlers.dashclaw_session_start({ agent_id: 'a' });
      await handlers.dashclaw_record({ action_type: 'x', declared_goal: 'g', status: 'completed', session_id: 'sess_explicit' });
      expect(mockPost.mock.calls[1][1].session_id).toBe('sess_explicit');
    });

    it('omits session_id when no session is active', async () => {
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });
      await handlers.dashclaw_record({ action_type: 'x', declared_goal: 'g', status: 'completed' });
      expect(mockPost.mock.calls[0][1].session_id).toBeUndefined();
    });

    it('clears the active session on a matching session_end', async () => {
      mockPost.mockResolvedValueOnce({ session: { id: 'sess_42' } });                 // start
      mockPatch.mockResolvedValueOnce({ session: { id: 'sess_42', status: 'completed' } }); // end
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });                          // record after end
      await handlers.dashclaw_session_start({ agent_id: 'a' });
      await handlers.dashclaw_session_end({ session_id: 'sess_42', status: 'completed' });
      await handlers.dashclaw_record({ action_type: 'x', declared_goal: 'g', status: 'completed' });
      expect(mockPost.mock.calls[1][1].session_id).toBeUndefined();
    });

    it('keeps the active session when session_end targets a different session', async () => {
      mockPost.mockResolvedValueOnce({ session: { id: 'sess_42' } });                    // start
      mockPatch.mockResolvedValueOnce({ session: { id: 'sess_other', status: 'completed' } }); // end other
      mockPost.mockResolvedValueOnce({ action_id: 'act_1' });                             // record
      await handlers.dashclaw_session_start({ agent_id: 'a' });
      await handlers.dashclaw_session_end({ session_id: 'sess_other', status: 'completed' });
      await handlers.dashclaw_record({ action_type: 'x', declared_goal: 'g', status: 'completed' });
      expect(mockPost.mock.calls[1][1].session_id).toBe('sess_42');
    });
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/unit/mcp-tools.test.js`
Expected: FAIL — schema test fails (`session_id` undefined in schema); stamping tests fail (`body.session_id` is undefined because the handler never sets it).

- [ ] **Step 3: Add `session_id` to the `dashclaw_record` inputSchema**

In `mcp-server/lib/tools.js`, in the `dashclaw_record` definition, add the property after `cost_estimate` (line 62):

```javascript
        cost_estimate: { type: 'number', description: 'Estimated cost in USD' },
        session_id: { type: 'string', description: 'Session to attribute this action to. Defaults to the session started via dashclaw_session_start in this connection.' },
```

- [ ] **Step 4: Add the ambient session variable to the factory**

In `createToolHandlers(client)`, after the `const agentId = …` line (457) and before `return {` (459):

```javascript
  const agentId = (input) => client.agentId || input.agent_id;

  // Ambient session: dashclaw_session_start stashes the created session id here
  // so dashclaw_record auto-stamps it without the LLM re-threading it. Lives in
  // this per-client closure — per-process for stdio, per-request for HTTP — so
  // it is never module-global and the stateless HTTP transport can't leak one
  // org's session onto another's record.
  let activeSessionId = null;

  return {
```

- [ ] **Step 5: Stamp the session in `dashclaw_record`**

Replace the `dashclaw_record` handler body (483–502) so the session is resolved once and only added when present (conditional spread keeps the existing "undefined fields are dropped" behavior and never sends `session_id: null`):

```javascript
    async dashclaw_record(input) {
      const sessionId = input.session_id ?? activeSessionId;
      const body = {
        action_type: input.action_type,
        declared_goal: input.declared_goal,
        status: input.status,
        risk_score: input.risk_score ?? 30,
        agent_id: agentId(input),
        reasoning: input.reasoning,
        confidence: input.confidence,
        systems_touched: input.systems_touched,
        reversible: input.reversible,
        output_summary: input.output_summary,
        tokens_in: input.tokens_in,
        tokens_out: input.tokens_out,
        model: input.model,
        cost_estimate: input.cost_estimate,
        ...(sessionId ? { session_id: sessionId } : {}),
      };
      const result = await client.post('/api/actions', body, { timeout: 10000 });
      return JSON.stringify(result);
    },
```

- [ ] **Step 6: Adopt the session in `dashclaw_session_start`**

Replace the `dashclaw_session_start` handler (568–575):

```javascript
    async dashclaw_session_start(input) {
      const result = await client.post('/api/sessions', {
        agent_id: input.agent_id,
        workspace: input.workspace,
        branch: input.branch,
      }, { timeout: 10000 });
      // Adopt the new session as the ambient default for subsequent records.
      activeSessionId = result?.session?.id ?? activeSessionId;
      return JSON.stringify(result);
    },
```

- [ ] **Step 7: Clear the session on a matching `dashclaw_session_end`**

Replace the `dashclaw_session_end` handler (577–583):

```javascript
    async dashclaw_session_end(input) {
      const result = await client.patch(`/api/sessions/${input.session_id}`, {
        status: input.status,
        summary: input.summary,
      }, { timeout: 10000 });
      // Only clear when ending the session we're actively stamping, so ending an
      // unrelated session doesn't silently unset the active one.
      if (activeSessionId === input.session_id) activeSessionId = null;
      return JSON.stringify(result);
    },
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run __tests__/unit/mcp-tools.test.js`
Expected: PASS — all new tests green, and the existing `exports exactly 26 tool definitions` / `every definition has …` tests still pass (count and shape unchanged).

- [ ] **Step 9: Commit**

```bash
git add mcp-server/lib/tools.js __tests__/unit/mcp-tools.test.js
git commit -m "feat(mcp): stamp action session_id from the active dashclaw session"
```

---

## Task 2: Node SDK — make `session_id` first-class on `createAction`

**Files:**
- Modify: `sdk/dashclaw.js` (JSDoc above `createAction`, 159–169)
- Create: `__tests__/unit/sdk-session-stamping.test.js`

> Note: `createAction` already forwards `action.session_id` via `...action`, so the test below passes before the code change — it is a **regression guard** (a future refactor of `createAction` must not silently drop the field). The code change in this task is JSDoc only. Do Step 1→2 to confirm the guard reflects current behavior, then Step 3 documents it.

- [ ] **Step 1: Write the regression-guard test**

Create `__tests__/unit/sdk-session-stamping.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const { DashClaw } = await import('../../sdk/dashclaw.js');

describe('createAction session_id passthrough', () => {
  let claw;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ action_id: 'act_1' }) });
    claw = new DashClaw({ baseUrl: 'http://localhost:3000', apiKey: 'k', agentId: 'a1' });
  });

  it('forwards session_id to POST /api/actions', async () => {
    await claw.createAction({ action_type: 'research', declared_goal: 'g', session_id: 'sess_7' });
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/api/actions');
    expect(JSON.parse(opts.body).session_id).toBe('sess_7');
  });

  it('omits session_id when not provided', async () => {
    await claw.createAction({ action_type: 'research', declared_goal: 'g' });
    const [, opts] = mockFetch.mock.calls[0];
    expect(JSON.parse(opts.body).session_id).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test (characterizes current behavior)**

Run: `npx vitest run __tests__/unit/sdk-session-stamping.test.js`
Expected: PASS — confirms the spread already forwards `session_id` and omits it when absent.

- [ ] **Step 3: Document `session_id` in the `createAction` JSDoc**

In `sdk/dashclaw.js`, replace the JSDoc block above `createAction` (159–169) so the closing lines read:

```javascript
   * is recorded with a signed receipt in the decision ledger.
   *
   * Optional `session_id`: pass the id from `createSession()` to link this
   * action to a session via the Direct path (exact attribution). When omitted,
   * the server falls back to time-window correlation by agent_id.
   * @param {Object} action
   * @param {string} [action.session_id] Session to attribute this action to.
   */
  async createAction(action) {
```

- [ ] **Step 4: Re-run to confirm still green**

Run: `npx vitest run __tests__/unit/sdk-session-stamping.test.js`
Expected: PASS (no behavior change).

- [ ] **Step 5: Commit**

```bash
git add sdk/dashclaw.js __tests__/unit/sdk-session-stamping.test.js
git commit -m "docs(sdk): document createAction session_id as first-class + guard test"
```

---

## Task 3: Python SDK — explicit `session_id` param on `create_action`

**Files:**
- Modify: `sdk-python/dashclaw/client.py` (`create_action`, 301–323)
- Test: `sdk-python/tests/test_sdk_v2_surface.py` (`TestCreateAction`, 104–122)

- [ ] **Step 1: Write the failing tests**

In `sdk-python/tests/test_sdk_v2_surface.py`, add to the `TestCreateAction` class (after `test_passes_kwargs_through`, before the class ends at line 123):

```python
    def test_includes_session_id_when_provided(self):
        client = RecordingDashClaw()
        client.create_action("api_call", "goal", session_id="sess_7")
        call = client.calls[-1]
        self.assertEqual(call["body"]["session_id"], "sess_7")

    def test_omits_session_id_when_not_provided(self):
        client = RecordingDashClaw()
        client.create_action("api_call", "goal")
        call = client.calls[-1]
        self.assertNotIn("session_id", call["body"])

    def test_session_id_is_a_named_parameter(self):
        import inspect
        params = inspect.signature(DashClaw.create_action).parameters
        self.assertIn("session_id", params)
```

- [ ] **Step 2: Run the tests to verify the signature test fails**

Run: `npm run sdk:integration:python`
Expected: FAIL — `test_session_id_is_a_named_parameter` fails (`session_id` is not yet a named parameter; it is only absorbed by `**kwargs`). The other two may already pass via kwargs.

- [ ] **Step 3: Add the explicit `session_id` parameter**

In `sdk-python/dashclaw/client.py`, change the `create_action` signature and payload assembly (301–323). Add `session_id=None` before `**kwargs`, append a docstring line, and include it in the payload only when provided:

```python
    def create_action(self, action_type, declared_goal, session_id=None, **kwargs):
        """I am attempting X.

        Non-fabrication (optional): pass ``content`` (the outbound text) and
        ``source_of_truth`` ({"allowedFacts": [...], "requiredFacts": [...],
        "forbiddenPatterns"?: [...], "extract"?: {...}}) to have a
        ``non_fabrication`` guard policy verify the content before the action
        proceeds. A violation blocks the action or routes it to approval and is
        recorded with a signed receipt in the decision ledger.

        Optional ``session_id``: pass the id from ``create_session()`` to link
        this action to a session via the Direct path (exact attribution). When
        omitted, the server falls back to time-window correlation by agent_id.
        """
        payload = {
            "action_type": action_type,
            "declared_goal": declared_goal,
            "agent_id": self.agent_id,
            **kwargs,
        }
        if session_id is not None:
            payload["session_id"] = session_id

        # Identity Verification: Sign the payload if a private key is available.
        signature = self._sign_payload(payload)
        if signature:
            payload["_signature"] = signature

        return self._request("/api/actions", "POST", json=payload)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run sdk:integration:python`
Expected: PASS — all three new tests green; existing `TestCreateAction` tests still pass (backward compatible: old callers and kwarg callers unaffected).

- [ ] **Step 5: Commit**

```bash
git add sdk-python/dashclaw/client.py sdk-python/tests/test_sdk_v2_surface.py
git commit -m "feat(py-sdk): add explicit session_id param to create_action"
```

---

## Task 4: Documentation surfaces

**Files:** `app/docs/page.js`, `sdk/README.md`, `sdk-python/README.md`, `mcp-server/README.md`

- [ ] **Step 1: Add `session_id` to the MCP `dashclaw_record` inputs in the docs site**

In `app/docs/page.js`, update the `dashclaw_record` tool entry (line 398):

```javascript
                      { tool: 'dashclaw_record', desc: 'Log action to audit trail', inputs: 'action_type, declared_goal, status, session_id' },
```

(The `createAction` MethodEntry at line 680 already documents session linkage — no change there.)

- [ ] **Step 2: Note `session_id` in the Node SDK README**

In `sdk/README.md`, immediately after the `createAction` example block that ends at line 59 (`});`), insert a note line:

```markdown

> Pass `session_id` (the `sess_…` id from `createSession()`) to link this action to a session exactly; otherwise the server correlates by agent + time window.
```

- [ ] **Step 3: Note `session_id` in the Python SDK README**

In `sdk-python/README.md`, update the `create_action` table row (line 110) to list `session_id`:

```markdown
| `create_action(action_type, declared_goal, session_id=None, **kwargs)` | Record a new action. Optional: session_id (exact session linkage), risk_score, systems_touched, reversible |
```

- [ ] **Step 4: Note ambient stamping in the MCP server README**

In `mcp-server/README.md`, immediately after the tools table (after the `dashclaw_session_end` row, line 100), insert:

```markdown

> **Session linkage:** after `dashclaw_session_start`, the server auto-stamps that session's id onto every `dashclaw_record` in the same connection (stdio). Pass `session_id` on `dashclaw_record` to override, or on the HTTP transport (`POST /api/mcp`) where each request is stateless.
```

- [ ] **Step 5: Commit**

```bash
git add app/docs/page.js sdk/README.md sdk-python/README.md mcp-server/README.md
git commit -m "docs: document session_id stamping across docs site + SDK/MCP READMEs"
```

---

## Task 5: Version bump (4.1.0 → 4.1.1) + full gate

**Files:** `package.json`, `sdk/package.json`, `sdk-python/pyproject.toml`, `mcp-server/package.json`, `contracts/sdk/release-plan.json`, `package-lock.json`

- [ ] **Step 1: Bump the unified platform+SDK version**

Run: `npm run version:set -- 4.1.1`
Expected: "Set DashClaw version to 4.1.1 in: package.json, sdk/package.json, sdk-python/pyproject.toml". The root self-dep stays `dashclaw@^4.0.0` (untouched — `version:set` only edits the top-level version field).

- [ ] **Step 2: Bump the MCP server's own manifest**

In `mcp-server/package.json`, change `"version": "1.0.2"` to `"version": "1.0.3"`.

- [ ] **Step 3: Refresh the release-plan record**

In `contracts/sdk/release-plan.json`, set both `node.current_version` and `python.current_version` to `"4.1.1"`, keep both `next_bump` as `"none"`, and replace both `reason` strings with:

```
4.1.1 — patch. Client-side session_id stamping: MCP dashclaw_record auto-stamps the active dashclaw_session_start session (explicit override) and create_action/createAction document session_id as a first-class field for exact session→action linkage. Additive; no breaking changes. Self-dep stays ^4.0.0.
```

- [ ] **Step 4: Resync the lockfile**

Run: `npm install`
Expected: only `package-lock.json` updates its root `version` to 4.1.1; no dependency tree changes (self-dep range unchanged).

- [ ] **Step 5: Run the version + count checks**

Run: `npm run version:sync:check`
Expected: "platform + SDK versions are in sync: 4.1.1".

Run: `npm run sdk:count`
Expected: Node 104 / Python 203 (unchanged — `session_id` is a param, not a new method).

- [ ] **Step 6: Run the full gate**

Run each and READ the output:
- `npm run lint` → 0 errors
- `npx vitest run` → full JS suite passes (0 failed)
- `npm run sdk:integration:python` → Python suite passes
- `npm run livingcode:refresh` → then `git status --short`: if any generated artifact changed because of the new MCP schema field, stage it; if nothing changed, proceed (the `dashclaw_record` schema is not enumerated in committed artifacts, so no change is expected)

- [ ] **Step 7: Commit the bump**

```bash
git add package.json sdk/package.json sdk-python/pyproject.toml mcp-server/package.json contracts/sdk/release-plan.json package-lock.json
git commit -m "chore(release): bump platform + SDKs to 4.1.1 (session_id stamping)"
```

- [ ] **Step 8: Push (its own gated step)**

Confirm lint + full vitest + Python suite all green in Step 6 first, then:

```bash
git push origin main
```

> **Publish is the owner's step:** `npm run release:sdks` publishes `dashclaw@4.1.1` to npm + PyPI (idempotent — skips versions already on the registry). The platform redeploys on push.

---

## Self-Review

**1. Spec coverage:**
- MCP ambient + explicit override + schema → Task 1. ✓
- Node first-class (doc) + passthrough → Task 2. ✓
- Python explicit `session_id=None`, omit-when-None → Task 3. ✓
- Edge cases (record-before-start omits; session_end clears only on match; double-start latest-wins implicit) → Task 1 Steps 1/5/6/7 tests. ✓
- Docs (docs site, both SDK READMEs, MCP README) → Task 4; `PROJECT_DETAILS.md` excluded with reason. ✓
- Patch bump across platform+both SDKs + mcp-server + release-plan → Task 5. ✓
- Gate (lint + full vitest + Python + sdk:count) → Task 5 Steps 5–6. ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every run step states expected output.

**3. Type/name consistency:** `activeSessionId` (closure var), `result?.session?.id` (matches `{ session }` response and the `mockResolvedValueOnce({ session: { id } })` test fixtures), conditional `...(sessionId ? { session_id } : {})`, Python `session_id=None`/`payload["session_id"]` — consistent across tasks. The MCP `mockPost` call indexing accounts for `session_start` and `record` both using `mockPost` (index 0 = start, index 1 = record) while `session_end` uses `mockPatch`.

**4. No-regression guards:** record-without-session omits the field (no `session_id: null` on the wire), so existing MCP record calls are unaffected; Node spread and Python kwargs paths remain backward compatible.
