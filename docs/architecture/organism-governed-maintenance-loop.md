# Organism Governed Maintenance Loop

Date: 2026-04-10
Status: Draft v1
Owner: DashClaw internal infrastructure

## Purpose

This document defines the supervised maintenance loop for DashClaw's organism system.

The goal is not unrestricted autonomy. The goal is to let the repository sense itself, surface bounded maintenance opportunities, route only low-risk work to an executor, and keep DashClaw's governance layer in control of anything that could cause damage.

## Core loop

The loop is:

1. `livingcode` senses current repository state
2. `livingcode` proposes backlog items
3. MoltFire interprets the backlog and classifies task safety
4. DashClaw governance decides what is allowed, blocked, or approval-gated
5. Claude Code or another executor performs only approved bounded work
6. Verification runs
7. `livingcode` re-measures the repository afterward

Short form:

**sense -> classify -> govern -> execute -> verify -> re-measure**

## Role boundaries

### The organism (`livingcode`)
Owns:
- sensing
- state reports
- backlog proposal generation
- review recommendations
- baseline tracking

Does not own:
- irreversible execution
- autonomous mutation of core runtime files
- autonomous mutation of `.organism/`
- autonomous mutation of `organism.json`
- broad refactoring authority

### MoltFire
Owns:
- interpreting organism output
- identifying the highest-value work
- classifying risk
- deciding whether a task is auto-safe, review-required, or hands-off
- deciding whether to keep work local or delegate
- reviewing execution output
- reporting state, drift, and outcomes to Wes

### DashClaw governance
Owns:
- policy enforcement
- approval gating
- protected path control
- action logging
- evidence trail and receipts
- stopping destructive or out-of-scope operations

### Claude Code
Owns:
- narrow, explicit implementation work
- documentation tasks
- isolated test additions
- low-risk cleanup when clearly bounded and verifiable

Does not own:
- strategy
- prioritization
- protected-path changes without approval
- broad refactors without explicit human judgment

## Daily operating rhythm

### Recommended automated morning run
The automated daily run should execute only:

1. `python -m livingcode sense`
2. `python -m livingcode plan`
3. `python -m livingcode review`

Recommended cadence:
- once daily
- around 8:00 AM local time

Automation: handled by the cloud weekly-digest routine (writes to `.organism/digests/`). The previous local Windows scheduled-task wrapper has been retired.

### Why `cycle` is excluded from unattended automation
`cycle` is a higher-order orchestration path and should remain manual until the governance and executor boundaries are proven stable. For now, unattended automation should observe, plan, and review only.

## Daily interpretation pass

After the automated run, MoltFire should inspect:
- latest `state-reports/`
- latest `backlog/`
- latest `cycle-history/`
- `cycle-counter.json`
- `consecutive-failures.json`
- any trend shifts in structural debt or CI posture

Then summarize the organism in four buckets:

### 1. State
What is true right now.
Examples:
- current cycle number
- collector health
- review verdict
- major pressure areas

### 2. New
What changed since the previous pass.
Examples:
- files over limit increased or decreased
- new backlog items appeared
- CI health changed
- a recommendation flipped from healthy to needs discussion

### 3. Actionable
What can be done now.
Examples:
- safe documentation work
- safe TODO triage
- safe route test additions

### 4. Drift
What pattern is accumulating.
Examples:
- persistent file sprawl
- recurring backlog items
- low bus factor
- repeated untested route concentration

## Safety classes

Every organism-generated task should be assigned one of three safety classes.

### Auto-safe
Allowed to be delegated without asking Wes first.

Requirements:
- narrow scope
- reversible
- low blast radius
- no protected-path touch
- no contract/schema change
- easy to verify

Examples:
- document a subsystem
- produce a TODO/FIXME triage summary
- add tests for a small isolated set of untested routes

### Safe with review
Allowed to be worked on, but should be reviewed before it is considered accepted.

Examples:
- internal refactors in peripheral areas
- moderately scoped file splits in non-critical paths
- broader test harness changes

### Hands-off
Do not auto-delegate.

Examples:
- auth
- approvals
- middleware
- policy engine
- payment logic
- contracts/OpenAPI
- migrations/schema
- archive deletion
- `.organism/**`
- `organism.json`

## Protected zones

The following should be treated as protected by default.

### Always blocked for autonomous work
- `organism.json`
- `.organism/**`
- auth paths
- approval engine paths
- policy engine paths
- schema and migration paths
- destructive delete operations in core directories

### Approval required
- any file deletion
- any rename/move
- edits to broad runtime choke points
- edits affecting public SDK surface
- edits affecting public API contract
- large multi-file changes beyond the agreed auto-safe threshold

## Claude Code handoff standard

Every task delegated to Claude Code should contain:

### Objective
One specific result.

### Scope
The only files or directories it may touch.

### Out of bounds
Protected paths and forbidden classes of change.

### Verification
What must pass for the work to count.

### Escalation condition
When Claude Code must stop and ask instead of improvising.

### Example
- Objective: Add isolated tests for two untested API routes
- Scope: specific route handlers and their tests only
- Out of bounds: auth, middleware, policy engine, SDK public surface, `.organism`, `organism.json`
- Verification: targeted tests pass, no contract changes, no unrelated file edits
- Escalation: stop if route behavior must change or shared harness work becomes necessary

## Pacing rules

To avoid maintenance theater and repo thrash:
- execute at most 1 or 2 safe tasks per daily pass
- prefer the smallest reversible batch
- verify before declaring success
- do not mark backlog items resolved based on intuition
- let the next organism pass confirm whether the maintenance pressure actually changed

## Recommended first task types

Best early candidates:
- subsystem documentation
- TODO/FIXME triage summaries
- tiny batches of isolated route tests

Not recommended as first auto-safe tasks:
- archive cleanup
- large file splits
- core governance/runtime refactors

## Governance integration path

### Near-term path
Use DashClaw governance around executor sessions.

Flow:
1. organism proposes
2. MoltFire classifies
3. Claude Code runs only bounded tasks
4. DashClaw policies gate dangerous actions
5. all actions receive receipts and outcomes

### Longer-term path
Promote the organism into a first-class governed DashClaw agent.

That future version would:
- emit structured maintenance proposals
- request governed capabilities
- wait for approvals when necessary
- leave a native DashClaw audit trail for each maintenance attempt

## Daily brief format

Suggested format for Wes:

### DashClaw Organism Brief

**State**
- current cycle
- review verdict
- failures
- main pressure

**New**
- metric changes since previous pass
- new backlog items
- warnings added or cleared

**Safe candidates**
- 1 to 3 bounded tasks that can be executed safely

**Blocked or review-required**
- tasks that should not auto-run

**Actions taken**
- what was delegated
- what verified successfully
- what remains unresolved

## Current v1 stance

At the current maturity level:
- `livingcode` should observe, plan, and review automatically
- MoltFire should provide daily judgment
- Claude Code should only execute bounded safe tasks
- DashClaw should be the policy and approval layer
- Wes should retain control over risky changes and scope expansion

That is the safest and most useful operating model for the project right now.
