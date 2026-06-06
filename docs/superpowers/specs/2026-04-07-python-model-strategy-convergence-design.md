# Python Model Strategy Convergence Design

Date: 2026-04-07
Status: proposed
Owner: SDK Lead

## Goal

Extend Python SDK contract convergence into the model-strategy domain so `contracts:check` fails when Python model-strategy public surface drifts from the repo, while keeping the implementation slice narrowly scoped.

## Problem

Current state:

- Node SDK exposes model-strategy CRUD plus `completeWithStrategy(...)`
- Python SDK already exposes model-strategy CRUD plus `complete_with_strategy(...)`
- the API route exists at `POST /api/model-strategies/{strategyId}/complete`
- Python model strategies are not yet represented in the SDK contract system

This means:

- the route and wrapper exist
- parity is implicit, not enforced
- CI still cannot tell us when Python model-strategy surface drifts

## Scope

This design covers:

1. Python model-strategy contract declarations
2. validator support for the Python model-strategy domain
3. optional focused Python route-shape test for `complete_with_strategy(...)`
4. release-plan and parity-doc updates

Out of scope:

- changing Node model-strategy surface
- changing route semantics
- adding new model strategy methods
- broader namespace redesign

## Current Source Of Truth

### Existing route

- [route.js](../../../app/api/model-strategies/[strategyId]/complete/route.ts)

The route expects:

- `messages` array
- optional:
  - `max_tokens`
  - `temperature`
  - `task_mode`

### Existing Python surface

- [client.py](../../../sdk-python/dashclaw/client.py)

Python already has:

- `list_model_strategies(...)`
- `create_model_strategy(...)`
- `get_model_strategy(...)`
- `update_model_strategy(...)`
- `delete_model_strategy(...)`
- `complete_with_strategy(...)`

### Existing contract system

- [public-surface.json](../../../contracts/sdk/public-surface.json)
- [release-plan.json](../../../contracts/sdk/release-plan.json)
- [check-sdk-surface.mjs](../../../scripts/lib/contracts/check-sdk-surface.mjs)

Current Python domains in the contract:

- `capabilities`
- `workflows`

Missing:

- `model_strategies`

## Recommended Approach

Add a third Python domain to the SDK contract:

- `model_strategies`

with required methods:

- `list_model_strategies`
- `create_model_strategy`
- `get_model_strategy`
- `update_model_strategy`
- `delete_model_strategy`
- `complete_with_strategy`

Then extend the existing validator to discover and validate that domain using the same grouped-domain pattern already added for `capabilities` and `workflows`.

Because the Python wrapper already exists, implementation risk is low. The main work is:

- make the contract explicit
- prove route-shape behavior with a focused test
- update docs and release-plan

## Contract Shape

`contracts/sdk/public-surface.json` should add:

```json
"model_strategies": {
  "canonical_root": "model_strategies",
  "required_methods": [
    "list_model_strategies",
    "create_model_strategy",
    "get_model_strategy",
    "update_model_strategy",
    "delete_model_strategy",
    "complete_with_strategy"
  ]
}
```

within Python `domains`.

## Validator Behavior

The Python domain selector in [check-sdk-surface.mjs](../../../scripts/lib/contracts/check-sdk-surface.mjs) should recognize:

- `capabilities`
- `workflows`
- `model_strategies`

For `model_strategies`, selection should be based on Python method names containing:

- `model_strategy`
- or `strategy` if kept narrowly scoped to the declared domain list

The validator should continue to emit:

- `missing_python_sdk_method`
- `undeclared_python_sdk_method`

## Testing Strategy

### JavaScript contract tests

Extend:

- [contracts.sdk-surface.test.js](../../../__tests__/unit/contracts.sdk-surface.test.js)

Add:

- failing test for missing Python model-strategy method
- failing test for undeclared discovered model-strategy method
- passing test with all three Python domains aligned

### Python route-shape test

Add one focused test file:

- `sdk-python/tests/test_python_model_strategies_runtime.py`

Verify:

```python
client.complete_with_strategy(
    "mst_1",
    messages=[{"role": "user", "content": "Summarize this"}],
    max_tokens=256,
    temperature=0.7,
    task_mode="reasoning",
)
```

produces:

- method: `POST`
- path: `/api/model-strategies/mst_1/complete`
- body includes:
  - `messages`
  - `max_tokens`
  - `temperature`
  - `task_mode`

This is mostly a confidence check, not a new behavior feature.

## Docs To Update

- [README.md](../../../sdk-python/README.md)
- [sdk-parity.md](../../sdk-parity.md)
- [2026-04-07-sdk-migration-matrix.md](../../planning/2026-04-07-sdk-migration-matrix.md)

The docs should say:

- Python model-strategy domain is now contract-enforced
- `complete_with_strategy(...)` is part of the converged execution surface

## Release Plan

Because this changes the enforced public Python SDK contract, `contracts/sdk/release-plan.json` must update in the same slice:

- add `model_strategies` to Python `domains`
- update `reason` to mention model strategy convergence
- keep `current_version` unchanged
- keep `next_bump: "minor"`

## Risks

### 1. Overmatching Python methods

Risk:

- a loose selector for `strategy` catches unrelated methods

Mitigation:

- keep selector conservative
- prefer matching `model_strategy` first
- use the declared required method list as the true boundary

### 2. Accidental behavior changes

Risk:

- “touching” `complete_with_strategy(...)` introduces unnecessary behavior changes

Mitigation:

- only change Python runtime behavior if a focused route-shape test proves a mismatch

## Success Criteria

This slice is complete when:

1. Python `model_strategies` is declared in the SDK contract
2. `contracts:check` fails if Python model-strategy surface drifts
3. focused JS contract tests pass
4. focused Python route-shape test passes
5. parity docs and release-plan are updated
6. `npm run contracts:check` passes
7. `npm run docs:check` passes

## Recommended Next Step After This

After model-strategy convergence:

1. knowledge collection convergence

That would complete the main execution-studio Python contract coverage sweep in the same domain-by-domain style.
