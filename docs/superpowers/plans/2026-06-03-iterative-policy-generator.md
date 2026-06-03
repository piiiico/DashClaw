# Iterative AI Policy Authoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dead-ending one-shot AI policy generator with a hybrid iterative flow (best-effort draft + targeted clarifying chips, never a hard reject) that lives in the Policies → Custom-tab panel, and retire the orphaned `/policies/generate` page.

**Architecture:** The generator is LLM-backed (`executeCompletion`). We change its output contract from "array of policies or `[]`" to a structured `{ drafts, assumptions, clarifications }` object the model must always populate, add the missing `protected_path` / `semantic_check` / `behavioral_anomaly` policy types, thread answered clarifications back into refinement, and rebuild the Custom-tab panel as a generate→review→refine→create loop reusing the existing guided draft editor.

**Tech Stack:** Next.js 16 (App Router), JavaScript, Vitest, the existing `app/policies/lib/policyFormModel.js` (`buildPolicySummary`, `compilePolicyPayload`, `POLICY_TYPE_OPTIONS`) and draft-editor components.

**Spec:** `docs/superpowers/specs/2026-06-03-iterative-policy-generator-design.md`

---

## File Structure

- **Modify** `app/lib/policy-generator.js` — expand `POLICY_TYPE_SCHEMAS`, rewrite `buildSystemPrompt`, rewrite `parseGeneratedPolicies` to the new shape, add `priorAnswers` to `generatePolicies`.
- **Modify** `app/api/policies/generate/route.js` — accept `answers`, return `{ drafts, assumptions, clarifications, ... }`.
- **Move** `app/policies/generate/components/*` → `app/policies/components/` and `app/policies/generate/lib/policyGeneratorDrafts.js` → `app/policies/lib/policyGeneratorDrafts.js` (reused by the panel).
- **Modify** `app/policies/components/CustomTab.jsx` — replace the textarea-only panel with the generate/review/refine/create loop.
- **Delete** `app/policies/generate/` (the orphaned page shell) once its reusable parts are relocated.
- **Modify** `app/lib/guard.js` — one stale comment (incidental, P1 fix follow-up).
- **Test** `__tests__/unit/policy-generator.test.js` (new), extend `__tests__/unit/...` route test if present.

---

## Task 1: Backend contract — new policy types + structured output (`policy-generator.js`)

**Files:**
- Modify: `app/lib/policy-generator.js`
- Test: `__tests__/unit/policy-generator.test.js` (create)

- [ ] **Step 1: Write failing tests for `parseGeneratedPolicies` new shape**

Create `__tests__/unit/policy-generator.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseGeneratedPolicies } from '@/lib/policy-generator.js';

describe('parseGeneratedPolicies — structured {drafts, assumptions, clarifications}', () => {
  it('keeps valid drafts and passes through assumptions + clarifications', () => {
    const raw = JSON.stringify({
      drafts: [{ name: 'Protect secrets', policy_type: 'protected_path', rules: { paths: ['.env', 'secrets/'], action: 'block' }, confidence: 0.9 }],
      assumptions: ['Assumed protected paths from common sensitive locations'],
      clarifications: [{ id: 'action', question: 'How strict?', field: 'rules.action', suggestions: ['warn', 'block', 'require approval'], multi: false }],
    });
    const out = parseGeneratedPolicies(raw);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0].policy_type).toBe('protected_path');
    expect(out.assumptions[0]).toMatch(/Assumed/);
    expect(out.clarifications[0].id).toBe('action');
    expect(out.warnings).toEqual([]);
  });

  it('drops an invalid draft into warnings but keeps the response usable', () => {
    const raw = JSON.stringify({ drafts: [{ name: '', policy_type: 'not_a_type', rules: {} }], assumptions: [], clarifications: [] });
    const out = parseGeneratedPolicies(raw);
    expect(out.drafts).toHaveLength(0);
    expect(out.warnings.length).toBeGreaterThan(0);
    // never dead-ends: with no drafts and no clarifications, one is synthesized
    expect(out.clarifications.length).toBeGreaterThan(0);
  });

  it('never dead-ends on a JSON parse failure', () => {
    const out = parseGeneratedPolicies('not json at all');
    expect(out.drafts).toEqual([]);
    expect(out.clarifications.length).toBeGreaterThan(0);
  });

  it('accepts a bare array as drafts (back-compat)', () => {
    const raw = JSON.stringify([{ name: 'Block deploys', policy_type: 'block_action_type', rules: { action_types: ['deploy'] } }]);
    const out = parseGeneratedPolicies(raw);
    expect(out.drafts).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

Run: `npx vitest run __tests__/unit/policy-generator.test.js`
Expected: FAIL (new shape not implemented — `parseGeneratedPolicies` returns `{policies, warnings}`, no `drafts`/`clarifications`).

- [ ] **Step 3: Add the missing policy-type schemas**

In `app/lib/policy-generator.js`, replace the `POLICY_TYPE_SCHEMAS` object (lines 18-26) with:

```javascript
const POLICY_TYPE_SCHEMAS = {
  risk_threshold: '{ "threshold": <number 0-100>, "action": "block"|"warn"|"require_approval" }',
  require_approval: '{ "action_types": ["deploy", "migrate", ...] }',
  block_action_type: '{ "action_types": ["deploy", "migrate", ...] }',
  rate_limit: '{ "max_actions": <number>, "window_minutes": <number>, "action": "warn"|"block" }',
  permission_escalation: '{ "enforce": true }',
  green_contract: '{ "action_types": ["deploy"], "required_level": "targeted"|"package"|"workspace"|"merge_ready", "action": "block"|"require_approval" }',
  branch_freshness: '{ "action_types": ["deploy"], "freshness": ["stale", "diverged"], "max_commits_behind": <number>, "action": "block"|"require_approval" }',
  protected_path: '{ "paths": ["glob", ...], "action": "block"|"warn"|"require_approval" }  // protects files/dirs from being written or deleted; use for "don\\'t delete/touch X"',
  semantic_check: '{ "instruction": "what to check for in the action content", "action": "block"|"warn"|"require_approval" }',
  behavioral_anomaly: '{ "similarity_threshold": <0.0-1.0, default 0.75>, "min_history": <number, default 5>, "action": "warn"|"block"|"require_approval" }',
};
```

- [ ] **Step 4: Rewrite `buildSystemPrompt` to demand the never-empty structured object**

Replace the `## Instructions` block at the end of `buildSystemPrompt` (lines 78-84) with:

```javascript
## Output Format
Return ONLY a single JSON object (no markdown fences, no prose) with exactly these keys:
{
  "drafts": [ { "name": string, "policy_type": one of the types above, "rules": object matching that type's schema, "confidence": 0.0-1.0 } ],
  "assumptions": [ string ],      // plain-English assumptions you made to fill gaps
  "clarifications": [ { "id": string, "question": string, "field": "rules.<key>"|"policy_type", "suggestions": [string], "multi": boolean } ]
}

## Rules
- NEVER return an empty response and NEVER refuse. Always make progress.
- If the request is clear: return one or more drafts and list any assumptions you made.
- If the request is workable but vague (e.g. "protect things I care about"): return a BEST-EFFORT draft AND clarifications that tighten it. State your assumptions.
- If you genuinely cannot draft yet: return drafts: [] and 1-3 clarifications with concrete, clickable `suggestions`.
- `suggestions` must be concrete values the user can pick (e.g. paths like ".env", "secrets/", "migrations/"; or "warn"/"block"/"require approval"). For enum fields use only allowed values.
- Map "delete/remove/protect files or paths" to `protected_path`.
- If the input describes multiple distinct policies, return one draft per policy.`;
```

(Leave the `typeDescriptions`/`examples` composition above it unchanged.)

- [ ] **Step 5: Rewrite `parseGeneratedPolicies` for the new shape**

Replace the entire `parseGeneratedPolicies` function (lines 87-129) with:

```javascript
function makeGenericClarification() {
  return {
    id: 'intent',
    question: 'What should this policy govern, and how strict should it be?',
    field: 'policy_type',
    suggestions: ['block deploys', 'protect a path from deletion', 'require approval over a risk level', 'rate-limit an agent'],
    multi: false,
  };
}

function sanitizeClarifications(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c.question === 'string')
    .slice(0, 4)
    .map((c, i) => ({
      id: typeof c.id === 'string' && c.id ? c.id : `q${i}`,
      question: c.question,
      field: typeof c.field === 'string' ? c.field : null,
      suggestions: Array.isArray(c.suggestions) ? c.suggestions.filter((s) => typeof s === 'string').slice(0, 8) : [],
      multi: Boolean(c.multi),
    }));
}

export function parseGeneratedPolicies(rawContent) {
  const warnings = [];
  let cleaned = (rawContent || '').trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return { drafts: [], assumptions: [], clarifications: [makeGenericClarification()], warnings: ['Failed to parse model response as JSON'] };
  }

  // Back-compat: a bare array means drafts-only.
  const obj = Array.isArray(parsed) ? { drafts: parsed } : (parsed && typeof parsed === 'object' ? parsed : null);
  if (!obj) {
    return { drafts: [], assumptions: [], clarifications: [makeGenericClarification()], warnings: ['Model response was not a JSON object'] };
  }

  const drafts = [];
  for (const item of Array.isArray(obj.drafts) ? obj.drafts : []) {
    const result = validatePolicy({ name: item.name, policy_type: item.policy_type, rules: JSON.stringify(item.rules || {}) });
    if (result.valid) {
      drafts.push({
        name: item.name,
        policy_type: item.policy_type,
        rules: item.rules,
        confidence: typeof item.confidence === 'number' ? item.confidence : null,
        recovery_recipe: item.recovery_recipe || null,
      });
    } else {
      warnings.push(`"${item.name || 'unnamed'}": ${result.errors.join(', ')}`);
    }
  }

  const assumptions = Array.isArray(obj.assumptions) ? obj.assumptions.filter((a) => typeof a === 'string') : [];
  const clarifications = sanitizeClarifications(obj.clarifications);

  // Never dead-end.
  if (drafts.length === 0 && clarifications.length === 0) {
    clarifications.push(makeGenericClarification());
  }

  return { drafts, assumptions, clarifications, warnings };
}
```

- [ ] **Step 6: Run the tests — verify they pass**

Run: `npx vitest run __tests__/unit/policy-generator.test.js`
Expected: PASS (all 4).

- [ ] **Step 7: Commit**

```bash
git add app/lib/policy-generator.js __tests__/unit/policy-generator.test.js
git commit -m "feat(policy-generator): structured drafts+clarifications output + protected_path/semantic_check/behavioral_anomaly types"
```

---

## Task 2: `generatePolicies` returns the new shape + threads answers

**Files:**
- Modify: `app/lib/policy-generator.js` (the `generatePolicies` function, lines 146-181)
- Test: `__tests__/unit/policy-generator.test.js` (extend)

- [ ] **Step 1: Write the failing test (mock LLM + settings)**

Append to `__tests__/unit/policy-generator.test.js`:

```javascript
import { vi } from 'vitest';

vi.mock('@/lib/repositories/settings.repository.js', () => ({
  getSettings: vi.fn(async () => [{ key: 'OPENAI_API_KEY', value: 'sk-test' }]),
}));
const mockExec = vi.fn();
vi.mock('@/lib/providers.js', () => ({ executeCompletion: (...a) => mockExec(...a) }));

describe('generatePolicies', () => {
  it('returns drafts+clarifications and threads prior answers into the prompt', async () => {
    const { generatePolicies } = await import('@/lib/policy-generator.js');
    mockExec.mockResolvedValue({
      content: JSON.stringify({ drafts: [{ name: 'Protect .env', policy_type: 'protected_path', rules: { paths: ['.env'], action: 'block' }, confidence: 0.9 }], assumptions: [], clarifications: [] }),
      provider: 'openai', model: 'gpt-4.1', cost_usd: 0.001,
    });
    const sql = vi.fn();
    const out = await generatePolicies(sql, 'org_1', 'protect me from deletes', [{ id: 'paths', value: ['.env'] }]);
    expect(out.drafts[0].policy_type).toBe('protected_path');
    expect(out.clarifications).toEqual([]);
    // prior answer appears in the user message sent to the LLM
    const messages = mockExec.mock.calls[0][3];
    expect(JSON.stringify(messages)).toContain('.env');
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run __tests__/unit/policy-generator.test.js -t generatePolicies`
Expected: FAIL (signature has no `priorAnswers`; returns `generated_policies`, not `drafts`).

- [ ] **Step 3: Update `generatePolicies`**

Replace the body of `generatePolicies` (lines 146-181) with:

```javascript
export async function generatePolicies(sql, orgId, inputText, priorAnswers = []) {
  const { getSettings } = await import('./repositories/settings.repository.js');
  const settings = await getSettings(sql, orgId, { category: 'integration' });
  const providerKeys = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY', 'TOGETHER_API_KEY', 'PERPLEXITY_API_KEY'];
  const hasProvider = settings.some((s) => providerKeys.includes(s.key) && s.value);

  if (!hasProvider) {
    return { error: 'No LLM provider configured. Add an API key in Settings or /setup.' };
  }

  const answersText = (Array.isArray(priorAnswers) ? priorAnswers : [])
    .filter((a) => a && a.id)
    .map((a) => `- ${a.id}: ${Array.isArray(a.value) ? a.value.join(', ') : a.value}`)
    .join('\n');
  const userContent = answersText
    ? `${inputText}\n\nClarifications the user provided:\n${answersText}`
    : inputText;

  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: userContent },
  ];

  const completion = await executeCompletion(sql, orgId, DEFAULT_STRATEGY_CONFIG, messages, {
    max_tokens: 2048,
    temperature: 0.3,
  });

  const { drafts, assumptions, clarifications, warnings } = parseGeneratedPolicies(completion.content);
  const inputHash = createHash('sha256').update(inputText).digest('hex').slice(0, 16);

  return {
    drafts,
    assumptions,
    clarifications,
    warnings,
    input_hash: inputHash,
    llm_metadata: { provider: completion.provider, model: completion.model, cost_usd: completion.cost_usd },
  };
}
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run __tests__/unit/policy-generator.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/policy-generator.js __tests__/unit/policy-generator.test.js
git commit -m "feat(policy-generator): generatePolicies threads prior answers, returns drafts/assumptions/clarifications"
```

---

## Task 3: API route — accept `answers`, return new shape, create from reviewed draft

**Files:**
- Modify: `app/api/policies/generate/route.js`
- Test: `__tests__/unit/policies-generate-route.test.js` (create)

- [ ] **Step 1: Write the failing route test**

Create `__tests__/unit/policies-generate-route.test.js`:

```javascript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';

const { mockGenerate, mockGetOrgRole } = vi.hoisted(() => ({ mockGenerate: vi.fn(), mockGetOrgRole: vi.fn(() => 'admin') }));
vi.mock('@/lib/db.js', () => ({ getSql: () => vi.fn() }));
vi.mock('@/lib/org', () => ({ getOrgId: () => 'org_1', getOrgRole: mockGetOrgRole }));
vi.mock('@/lib/policy-generator.js', () => ({ generatePolicies: mockGenerate }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({ insertPolicy: vi.fn() }));

import { POST } from '@/api/policies/generate/route.js';

describe('POST /api/policies/generate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('dry_run returns drafts+clarifications and threads answers', async () => {
    mockGenerate.mockResolvedValue({ drafts: [], assumptions: [], clarifications: [{ id: 'paths', question: 'Which paths?', suggestions: ['.env'], multi: true }], warnings: [], input_hash: 'h' });
    const res = await POST(makeRequest('http://localhost/api/policies/generate', {
      headers: { 'x-org-id': 'org_1' },
      body: { input_text: 'protect my files', answers: [{ id: 'x', value: 'y' }], dry_run: true },
    }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.clarifications[0].id).toBe('paths');
    expect(mockGenerate).toHaveBeenCalledWith(expect.anything(), 'org_1', 'protect my files', [{ id: 'x', value: 'y' }]);
  });
});
```

- [ ] **Step 2: Run — verify it fails**

Run: `npx vitest run __tests__/unit/policies-generate-route.test.js`
Expected: FAIL (route returns `generated_policies`, ignores `answers`).

- [ ] **Step 3: Update the route**

In `app/api/policies/generate/route.js`, change the body parse + dry_run branch. Replace from the `const { input_text, dry_run = true } = body;` line through the `if (dry_run) { ... }` block with:

```javascript
    const { input_text, dry_run = true, answers = [] } = body;

    // Creating policies is an admin-only write, matching /api/policies and
    // /api/policies/import. dry_run previews stay open to any org member.
    if (!dry_run && getOrgRole(request) !== 'admin') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    if (!input_text || typeof input_text !== 'string' || input_text.trim().length === 0) {
      return NextResponse.json({ error: 'input_text is required and must be a non-empty string' }, { status: 400 });
    }
    if (input_text.length > MAX_INPUT_LENGTH) {
      return NextResponse.json({ error: `input_text exceeds maximum length of ${MAX_INPUT_LENGTH} characters` }, { status: 400 });
    }

    const result = await generatePolicies(sql, orgId, input_text.trim(), Array.isArray(answers) ? answers : []);
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 422 });
    }

    if (dry_run) {
      return NextResponse.json({
        drafts: result.drafts,
        assumptions: result.assumptions,
        clarifications: result.clarifications,
        warnings: result.warnings,
        input_hash: result.input_hash,
      });
    }
```

Then update the `dry_run=false` create loop below it to iterate `result.drafts` instead of `result.generated_policies`:

```javascript
    // dry_run=false — create the drafts via repository
    const createdPolicies = [];
    for (const policy of result.drafts) {
      const policyId = `gp_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
      await insertPolicy(sql, orgId, { id: policyId, name: policy.name, policyType: policy.policy_type, rules: JSON.stringify(policy.rules) });
      createdPolicies.push(policyId);
    }
    return NextResponse.json({ created_policies: createdPolicies, count: createdPolicies.length });
```

- [ ] **Step 4: Run — verify pass**

Run: `npx vitest run __tests__/unit/policies-generate-route.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/policies/generate/route.js __tests__/unit/policies-generate-route.test.js
git commit -m "feat(api): /api/policies/generate accepts answers, returns drafts/assumptions/clarifications"
```

---

## Task 4: Relocate the reusable draft components/helpers to shared dirs

**Files:**
- Move: `app/policies/generate/components/{PolicyDraftCandidateCard,PolicyDraftCandidateList,PolicyGeneratedAdvancedDetails,PolicyGeneratedDraftEditor}.jsx` → `app/policies/components/`
- Move: `app/policies/generate/lib/policyGeneratorDrafts.js` → `app/policies/lib/policyGeneratorDrafts.js`

- [ ] **Step 1: Move the files (git mv preserves history)**

```bash
git mv app/policies/generate/components/PolicyDraftCandidateCard.jsx app/policies/components/PolicyDraftCandidateCard.jsx
git mv app/policies/generate/components/PolicyDraftCandidateList.jsx app/policies/components/PolicyDraftCandidateList.jsx
git mv app/policies/generate/components/PolicyGeneratedAdvancedDetails.jsx app/policies/components/PolicyGeneratedAdvancedDetails.jsx
git mv app/policies/generate/components/PolicyGeneratedDraftEditor.jsx app/policies/components/PolicyGeneratedDraftEditor.jsx
git mv app/policies/generate/lib/policyGeneratorDrafts.js app/policies/lib/policyGeneratorDrafts.js
```

- [ ] **Step 2: Fix the two relative imports broken by the move**

Only two of the moved files have cross-directory imports that change. Make these exact edits:

In `app/policies/components/PolicyGeneratedDraftEditor.jsx`, line 1 — it pointed two levels up to the shared components dir, which is now its own dir:

```diff
- import PolicyAuthoringPanel from '../../components/PolicyAuthoringPanel';
+ import PolicyAuthoringPanel from './PolicyAuthoringPanel';
```

In `app/policies/lib/policyGeneratorDrafts.js`, line 1 — it pointed two levels up to the shared lib dir, which is now its own dir:

```diff
- import { buildPolicySummary, createDefaultPolicyFormState } from '../../lib/policyFormModel.js';
+ import { buildPolicySummary, createDefaultPolicyFormState } from './policyFormModel.js';
```

The other three moved files need no import changes: `PolicyDraftCandidateCard.jsx` (no relative imports), `PolicyDraftCandidateList.jsx` (imports sibling `./PolicyDraftCandidateCard` — unchanged), `PolicyGeneratedAdvancedDetails.jsx` (only `react`). `PolicyGeneratedDraftEditor.jsx`'s second import (`./PolicyGeneratedAdvancedDetails`) is a sibling and stays.

- [ ] **Step 3: Verify it compiles**

Run: `npx next build`
Expected: build succeeds (no unresolved imports). The standalone page still imports from `./components` / `./lib` and will break here — that is expected; it is deleted in Task 6. To keep the build green between commits, do Task 6 in the SAME commit as this task (see Step 4).

- [ ] **Step 4: (Deferred commit)** — do not commit yet; commit together with Task 5 + Task 6 so the build never lands broken.

---

## Task 5: Rebuild the Custom-tab panel as the iterative loop

**Files:**
- Modify: `app/policies/components/CustomTab.jsx`

- [ ] **Step 1: Update imports + state**

At the top of `CustomTab.jsx`, add imports for the relocated pieces and helpers (next to existing imports):

```javascript
import PolicyGeneratedDraftEditor from './PolicyGeneratedDraftEditor';
import { normalizeGeneratedPolicyDrafts } from '../lib/policyGeneratorDrafts.js';
import { buildPolicySummary, compilePolicyPayload, POLICY_TYPE_OPTIONS as POLICY_TYPES } from '../lib/policyFormModel.js';
```

(If `buildPolicySummary` is already imported in this file, do not duplicate it.)

Replace the generator state declarations (the `genInput`/`genError`/`genSuccess`/`genLoading` group) with:

```javascript
  const [genInput, setGenInput] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genSuccess, setGenSuccess] = useState(null);
  const [genDrafts, setGenDrafts] = useState([]);
  const [genDraftForm, setGenDraftForm] = useState(null);
  const [genAssumptions, setGenAssumptions] = useState([]);
  const [genClarifications, setGenClarifications] = useState([]);
  const [genAnswers, setGenAnswers] = useState({}); // { [id]: string|string[] }
  const [genAgents, setGenAgents] = useState([]);
```

Add an agents fetch effect (the draft editor scopes to agents):

```javascript
  useEffect(() => {
    let cancelled = false;
    fetch('/api/agents').then((r) => (r.ok ? r.json() : { agents: [] }))
      .then((d) => { if (!cancelled) setGenAgents(d.agents || []); })
      .catch(() => { if (!cancelled) setGenAgents([]); });
    return () => { cancelled = true; };
  }, []);
```

- [ ] **Step 2: Replace `handleGenerate` with a generate/refine function + a create function**

Replace the existing `handleGenerate` (lines ~266-290) with:

```javascript
  const runGenerator = async (answers) => {
    setGenLoading(true);
    setGenError(null);
    setGenSuccess(null);
    try {
      const answerList = Object.entries(answers || {}).map(([id, value]) => ({ id, value }));
      const res = await fetch('/api/policies/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input_text: genInput, answers: answerList, dry_run: true }),
      });
      const data = await res.json();
      if (!res.ok) { setGenError(data.error || 'Failed to generate policy drafts'); return; }
      const drafts = normalizeGeneratedPolicyDrafts(data.drafts || []);
      setGenDrafts(drafts);
      setGenAssumptions(data.assumptions || []);
      setGenClarifications(data.clarifications || []);
      setGenDraftForm(drafts.length ? JSON.parse(JSON.stringify(drafts[0].formState)) : null);
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenLoading(false);
    }
  };

  const handleGenerate = () => runGenerator({});
  const handleRefine = () => runGenerator(genAnswers);

  const toggleAnswer = (id, value, multi) => {
    setGenAnswers((prev) => {
      if (!multi) return { ...prev, [id]: value };
      const cur = Array.isArray(prev[id]) ? prev[id] : [];
      return { ...prev, [id]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value] };
    });
  };

  const handleCreateDraft = async () => {
    if (!genDraftForm) return;
    setGenLoading(true);
    setGenError(null);
    try {
      const payload = compilePolicyPayload(genDraftForm);
      const res = await fetch('/api/policies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setGenError(data.error || 'Failed to create policy'); return; }
      setGenSuccess(`Created policy "${payload.name}".`);
      setGenInput(''); setGenDrafts([]); setGenDraftForm(null); setGenAssumptions([]); setGenClarifications([]); setGenAnswers({});
      fetchPolicies();
    } catch (err) {
      setGenError(err.message);
    } finally {
      setGenLoading(false);
    }
  };
```

- [ ] **Step 3: Replace the panel JSX (the textarea-only block)**

Replace the AI Generator panel body (the contents inside `{showGenerator && (...)}`, currently lines ~418-456, from `<p className="text-xs text-secondary">Describe...` through the closing button `</div>`) with the loop UI:

```jsx
          <p className="text-xs text-secondary">Describe what you want DashClaw to prevent or enforce in plain English. DashClaw drafts a policy and asks follow-ups to pin it down — it never just says no.</p>
          {genSuccess && <div className="rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-xs text-success">{genSuccess}</div>}
          {genError && <div className="rounded-lg border border-error/30 bg-error-subtle px-3 py-2 text-xs text-error">{genError}</div>}
          <textarea
            value={genInput}
            onChange={(e) => setGenInput(e.target.value)}
            placeholder="e.g. Stop my agents from deleting things I care about"
            rows={3}
            maxLength={5000}
            className="w-full resize-none rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-xs text-secondary placeholder:text-disabled transition-colors hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] tabular-nums text-tertiary">{genInput.length}/5000</span>
            <button onClick={handleGenerate} disabled={genLoading || !genInput.trim()}
              className="flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
              <Sparkles size={12} aria-hidden="true" /> {genLoading ? 'Working…' : (genDrafts.length || genClarifications.length ? 'Regenerate' : 'Generate')}
            </button>
          </div>

          {genAssumptions.length > 0 && (
            <div className="rounded-lg border border-border bg-surface-tertiary px-3 py-2 text-[11px] text-tertiary">
              <span className="font-medium text-secondary">Assumptions:</span> {genAssumptions.join('; ')}
            </div>
          )}

          {genClarifications.length > 0 && (
            <div className="space-y-2 rounded-lg border border-brand/20 bg-brand/5 p-3">
              <div className="text-xs font-medium text-white">Help me get this right:</div>
              {genClarifications.map((c) => (
                <div key={c.id} className="space-y-1">
                  <div className="text-[11px] text-secondary">{c.question}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.suggestions.map((s) => {
                      const active = c.multi ? (genAnswers[c.id] || []).includes(s) : genAnswers[c.id] === s;
                      return (
                        <button key={s} onClick={() => toggleAnswer(c.id, s, c.multi)}
                          className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${active ? 'border-brand bg-brand/15 text-brand' : 'border-border bg-surface-tertiary text-secondary hover:border-border-hover'}`}>
                          {s}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <button onClick={handleRefine} disabled={genLoading}
                className="mt-1 flex items-center gap-1.5 rounded-lg border border-brand/20 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:border-brand/40 hover:bg-brand/15 disabled:opacity-50">
                <Sparkles size={12} aria-hidden="true" /> {genLoading ? 'Refining…' : 'Refine with my answers'}
              </button>
            </div>
          )}

          {genDraftForm && (
            <div className="space-y-3 rounded-lg border border-border bg-surface-tertiary p-3">
              <div className="text-xs font-medium text-white">Review &amp; save</div>
              <PolicyGeneratedDraftEditor
                draft={genDrafts[0] || null}
                form={genDraftForm}
                setForm={setGenDraftForm}
                policyTypes={POLICY_TYPES}
                actionOptions={ACTION_OPTIONS}
                agents={genAgents}
                summary={buildPolicySummary(genDraftForm)}
                saving={genLoading}
                onSave={handleCreateDraft}
                saveDisabled={!genDraftForm?.name?.trim()}
              />
            </div>
          )}
```

Define `ACTION_OPTIONS` at the top of the file if not already present (copy from the standalone page):

```javascript
const ACTION_OPTIONS = ['build', 'deploy', 'post', 'apply', 'security', 'message', 'api', 'calendar', 'research', 'review', 'fix', 'refactor', 'test', 'config', 'monitor', 'alert', 'cleanup', 'sync', 'migrate', 'other'];
```

Update the panel's close button handler to also clear the new state:

```javascript
              onClick={() => { setShowGenerator(false); setGenError(null); setGenSuccess(null); setGenDrafts([]); setGenDraftForm(null); setGenAssumptions([]); setGenClarifications([]); setGenAnswers({}); }}
```

- [ ] **Step 4: Verify `PolicyGeneratedDraftEditor` prop names match**

Run: `grep -n "props\|form\|setForm\|onSave\|saveDisabled\|policyTypes\|actionOptions\|agents\|summary\|draft" app/policies/components/PolicyGeneratedDraftEditor.jsx | head -20`
Confirm the component destructures exactly these props; adjust the call site if any name differs.

---

## Task 6: Retire the orphaned standalone page

**Files:**
- Delete: `app/policies/generate/page.jsx` (and the now-empty `generate/components`, `generate/lib` dirs)

- [ ] **Step 1: Confirm nothing links to the page**

Run: `grep -rn "policies/generate" app --include=*.js --include=*.jsx | grep -v "/api/policies/generate" | grep -v "app/policies/generate/"`
Expected: no results (the page is orphaned; the only `/policies/generate` references are the API route, which stays).

- [ ] **Step 2: Delete the page + leftover dirs**

```bash
git rm app/policies/generate/page.jsx
git rm -r app/policies/generate/components app/policies/generate/lib 2>/dev/null || true
```

(If `git mv` in Task 4 already emptied `components`/`lib`, only `page.jsx` remains to remove.)

- [ ] **Step 3: Full verification (Tasks 4-6 land together)**

```bash
npm run lint
npx vitest run
npx next build
```
Expected: lint clean; all tests pass; build succeeds with no route at `/policies/generate` and no unresolved imports.

- [ ] **Step 4: Commit Tasks 4 + 5 + 6 together**

```bash
git add -A
git commit -m "feat(policies): iterative AI generator in Custom-tab panel; retire orphaned /policies/generate page"
```

---

## Task 7: Incidental comment fix + final gate + docs

**Files:**
- Modify: `app/lib/guard.js` (comment at the `protected_path` case, ~line 550)

- [ ] **Step 1: Fix the stale guard comment**

In `app/lib/guard.js`, the `protected_path` case comment says `target` is the only path field that survives validation. The P1 fix added `write_paths` to `GUARD_INPUT_SCHEMA`. Update the comment:

```javascript
      // Behavior Learning protected-path gate. Matches the action's target path and
      // any write_paths a caller provides against the policy's globs using the same
      // matcher the Policy Coach simulates with, so enforcement and simulation agree.
      // Both `target` and `write_paths` now survive guard input validation (see
      // GUARD_INPUT_SCHEMA).
```

- [ ] **Step 2: Docs check — if the generate response shape is documented anywhere, update it**

Run: `grep -rn "generated_policies\|policies/generate" app/docs docs sdk/README.md sdk-python/README.md PROJECT_DETAILS.md 2>/dev/null | grep -v node_modules`
If any doc describes the `/api/policies/generate` response as `generated_policies`, update it to `{ drafts, assumptions, clarifications }`. (If none, skip.)

- [ ] **Step 3: Full gate**

```bash
npm run lint
npx vitest run
npx next build
npm run route-sql:check
npm run docs:check
npm run version:check
npm run openapi:check
npm run api:inventory:check
npm run contracts:check
```
Expected: all pass.

- [ ] **Step 4: Commit + push**

```bash
git add -A
git commit -m "docs+fix(guard): refresh protected_path comment; align generate-API docs"
git push origin main
```

---

## Manual verification (operator — no-DevTools rule)

After deploy, in Policies → Custom → AI generator:
1. Type "Stop my agents from deleting things I care about" → Generate. Expect a `protected_path` draft + chips for paths (`.env`, `secrets/`, …) and strictness (warn/block/require approval), not a rejection.
2. Click a couple of path chips + a strictness chip → Refine. Expect the draft to tighten.
3. Edit the draft if desired → Save. Expect the policy to appear in the list with your edits intact.
4. Confirm `/policies/generate` (typed directly) now 404s.
