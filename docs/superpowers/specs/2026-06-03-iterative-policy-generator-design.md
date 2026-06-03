# Iterative AI Policy Authoring — Design Spec

**Date:** 2026-06-03
**Status:** Approved (design); pending implementation plan
**Owner:** Wes (DashClaw)

## Problem

The AI policy generator dead-ends on reasonable requests. For input *"protect me from
my agents deleting things I care about"* it returns **"DashClaw could not generate a
policy draft from that input. Try being more specific…"** instead of helping the user
get specific. Two root causes:

1. **Missing policy type.** `app/lib/policy-generator.js` exposes only **7 of the 12**
   enforceable policy types to the LLM (`POLICY_TYPE_SCHEMAS`). It is **missing
   `protected_path`** — the exact type for "stop agents from deleting/touching things I
   care about." With no type to map to, the model returns an empty array.
2. **Reject-on-ambiguity UX.** The system prompt instructs the model to return `[]`
   when input is unclear, and both front-ends render that as a hard rejection. There is
   no path to refine vague intent into a concrete policy.

There is also **surface duplication**: a standalone `/policies/generate` page
(`dry_run:true` → guided editor) exists but is **orphaned** (no link anywhere in the
app), while the wired surface is the inline "AI generator" panel in the Policies →
Custom tab (`CustomTab.jsx`, `dry_run:false`). Both call `POST /api/policies/generate`.

The generator is **LLM-backed** (`executeCompletion`, requires a provider key in
Settings). This is consistent with the "no LLM in the core runtime" principle — that
applies to guard/record, not to this optional authoring feature.

## Goals

- The generator **never dead-ends**. It always returns either a usable draft (with
  stated assumptions) or specific clarifying questions to refine intent — usually both.
- It can express **deletion/path-protection** policies (`protected_path`) and the other
  enforceable types it currently can't emit.
- **One discoverable surface**: the iterative flow lives in the Custom-tab panel; the
  orphaned standalone page is retired.
- Each refinement converges (answers feed back into the next generation), within the
  existing per-call budget cap.

## Non-goals

- Introducing a multi-turn free-form **chat**. The approved model is *hybrid*: a
  best-effort draft + targeted follow-up chips, not an open chat thread.
- Mapping `non_fabrication` from natural language (it needs a structured
  source-of-truth; not NL-friendly — stays out of the generator).
- Changing the **"No LLM provider configured"** behavior. That is a real config gap and
  keeps its own clear, actionable error (it is not a dead-end to paper over).
- Resolving the broader `/api/context/*`-archived question (tracked separately in
  `AUDIT_FINDINGS.md`).

## Decisions (approved)

1. **Surface:** build the iterative flow into the inline **Custom-tab "AI generator"
   panel**; fold in the orphaned page's "review draft before saving" step; **delete
   `app/policies/generate/`** (page + its now-unused components).
2. **Interaction model:** **Hybrid** — always return a best-effort draft plus targeted
   clarifying questions (mostly clickable chips). Answering refines the draft. No
   rejection.

## Architecture

### Backend — `app/lib/policy-generator.js`

**Expand `POLICY_TYPE_SCHEMAS`** to include the enforceable types the engine reads but
the generator can't currently emit. Each schema must match what `evaluateGuard`
(`app/lib/guard.js`) actually parses:

- `protected_path`: `{ "paths": ["glob", …], "action": "block"|"warn"|"require_approval" }`
  (engine: `guard.js` `case 'protected_path'`, matches `rules.paths` against
  `context.target` / `context.write_paths`; default action `require_approval`).
- `semantic_check`, `behavioral_anomaly`, `webhook_check` — add with schemas matching
  their `guard.js` cases.
- Keep the existing 7. (`non_fabrication` intentionally excluded — see Non-goals.)

**New LLM output contract.** Replace "return `[]` when unclear" with a structured
object the model must always populate:

```json
{
  "drafts": [ { "name", "policy_type", "rules", "confidence" } ],
  "assumptions": ["Assumed protected paths = the project root", …],
  "clarifications": [
    { "id": "paths", "question": "Which paths should be protected?", "field": "rules.paths",
      "suggestions": [".env", "secrets/", "migrations/", "<repo root>"], "multi": true },
    { "id": "action", "question": "How strict?", "field": "rules.action",
      "suggestions": ["warn", "block", "require approval"], "multi": false }
  ]
}
```

Rules the prompt enforces: **never return empty**; if confident → `drafts` + the
`assumptions` made; if ambiguous → a best-effort draft (with explicit assumptions) **and**
`clarifications`; if truly underspecified → `clarifications` only (with concrete
`suggestions`). Suggestions are LLM-generated (context-aware), validated against allowed
values where the field is an enum (e.g. `action`, `policy_type`, action types).

**Signature:** `generatePolicies(sql, orgId, inputText, priorAnswers = [])`.
`priorAnswers` (the user's answered clarifications) is appended to the LLM context so
each refine narrows the result. Existing `maxBudgetUsd: 0.10` per call is retained; the
flow converges in ~1–2 refinements.

**`parseGeneratedPolicies`** updates to the new shape: validate each draft via
`validatePolicy` (drop+warn on invalid, as today), pass through `assumptions` and
`clarifications` untouched. A JSON parse failure degrades to
`{ drafts: [], assumptions: [], clarifications: [<generic "tell me the action/scope">] }`
— still no hard reject.

### API — `app/api/policies/generate/route.js`

- **Request:** `{ input_text, answers?: [{id, value}], dry_run?: boolean }`.
- **Response (200):** `{ drafts, assumptions, clarifications, input_hash, llm_metadata }`.
- **Errors:** missing provider key → existing `{ error: "No LLM provider configured…" }`
  (422). Admin gate on the `dry_run:false` write path stays (P1 fix).
- The panel always calls **`dry_run:true`** for Generate/Refine (the LLM only ever
  produces drafts to review). **Saving goes through `POST /api/policies`** with the
  user's *reviewed/edited* draft — the same path the standalone page uses today — so
  edits are never discarded by a re-generation. (The `dry_run:false` re-generate-and-
  create branch stays for API back-compat but the panel does not use it.)

### Frontend — Policies → Custom tab panel (`app/policies/components/CustomTab.jsx`)

The panel becomes the loop:

1. User types intent → **Generate** (`dry_run:true`).
2. Panel renders: editable draft(s) in the existing guided editor
   (`PolicyGeneratedDraftEditor`), an **"Assumptions I made"** line, and the
   `clarifications` as **chips** (suggestions clickable; `multi` allows several).
3. Selecting chips / editing the draft / typing more → **Refine** re-calls
   `/api/policies/generate` with accumulated `answers` → updated drafts + (usually
   fewer) clarifications.
4. **Create** saves the reviewed/edited draft(s) via `POST /api/policies` (preserving
   edits — never re-generates).
5. No "could not generate" dead-end: when `drafts` is empty the panel leads with the
   clarifying chips ("Let's narrow it down").

Retire the standalone page: delete `app/policies/generate/` (page + components only used
by it — verify importers first). The richer "review before save" capability moves into
the panel.

## Data flow

```
intent text ──▶ POST /api/policies/generate {input_text, dry_run:true}
                         │
                 generatePolicies(sql, org, text, answers=[])  ── LLM ─┐
                         │                                              │
              {drafts, assumptions, clarifications} ◀────────────────-─┘
                         │
   panel shows draft (editable) + assumptions + clarification chips
                         │  user answers chips / edits ──▶ Refine
                         │  POST /api/policies/generate {input_text, answers:[…], dry_run:true}  (loop)
                         ▼
              Create ──▶ POST /api/policies {reviewed/edited draft} ──▶ policies created
```

## Error handling

- No provider key → actionable 422 surfaced verbatim in the panel (link to /setup).
- LLM/JSON failure → degrade to generic clarifications (never a hard reject).
- Invalid drafts from the model → dropped with a `warnings` entry, remaining valid
  drafts still shown; if all invalid, fall through to clarifications.

## Testing

- `parseGeneratedPolicies`: new shape; parse-failure degradation; invalid-draft drop.
- Route: returns `clarifications` for vague input (mocked LLM); `answers` threaded into
  the prompt; admin gate on write; no-provider 422.
- A delete-protection prompt (mocked LLM) yields a valid `protected_path` draft.
- Full gate before commit: lint · `npx vitest run` · `npx next build` · guard scripts.

## Incidental cleanup (in-scope, created by adjacent work)

- `guard.js:550-551` comment ("`target` is the only path field that survives guard input
  validation") is now stale — the P1 fix added `write_paths` to `GUARD_INPUT_SCHEMA`.
  Update the comment while touching `protected_path`.

## Build sequence (detailed in the implementation plan)

1. Backend: expand policy types + new LLM contract + `parseGeneratedPolicies` + tests.
2. API: request/response shape + thread `answers`.
3. Frontend: panel iterative loop (draft + assumptions + chips + refine + create).
4. Retire `app/policies/generate/` (after confirming no shared importers).
5. Docs cascade per the SDK/route checklist if the API response shape is documented.
6. Full verification + commit/push.
