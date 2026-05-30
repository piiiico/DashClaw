# Organism Safety Matrix

**Status:** Drafted and ready for use
**Date:** 2026-04-10
**Scope:** Governed maintenance for DashClaw's `livingcode` organism loop

## Purpose

This matrix defines what the organism may propose, what an executor may perform, what requires explicit approval, and what is hard-blocked.

The goal is simple: let DashClaw demonstrate governed maintenance without pretending low-risk work and high-risk work are the same thing.

## Safety classes

### 1. Auto-safe
Work in this class may be delegated and executed without extra approval if the task is narrow, reversible, and verified.

Allowed work:
- Documentation updates
- Subsystem documentation
- TODO and FIXME triage into docs or issue lists
- Small isolated test additions that do not alter runtime behavior
- Non-executable planning artifacts
- Read-only sensing, reporting, and backlog generation

Required constraints:
- Scope must be explicit
- No file deletions
- No secret handling changes
- No auth, policy enforcement, middleware, billing, or execution-path changes
- Verification must be included in the handoff

### 2. Safe-with-review
Work in this class may be proposed automatically, but needs human approval before execution.

Includes:
- Refactors in non-critical code paths
- Small logic changes outside protected zones
- Test harness fixes that affect execution behavior
- CI or workflow changes
- Dependency updates
- Schema changes outside `.organism/` and `organism.json`
- New scripts that write to the repository

Approval trigger:
- Any change that modifies code behavior, developer workflow, deployment behavior, or automation behavior

### 3. Hands-off
Work in this class is blocked for autonomous or delegated execution.

Includes:
- Authentication and identity logic
- Approval and policy enforcement paths
- Middleware
- Billing, metering, settlement, or payment logic
- Secrets, credentials, environment handling, or key material
- `organism.json`
- `.organism/`
- File deletion, archive cleanup, or destructive reorganization
- Autonomous execution wiring that would let the organism modify code on its own

## Protected paths

Changes under these paths are never auto-safe.

### Hard-protected files
- `organism.json`
- `middleware.js`
- `.env.example`
- `package.json`
- `package-lock.json`
- `vercel.json`
- `Dockerfile`
- `docker-compose.yml`
- `.github/workflows/**`

### Hard-protected directories
- `.organism/**` — **except** `.organism/digests/` and `.organism/backlog/`, which are committed organism-authored state that the weekly-digest routine and the livingcode planner are designed to write. The blanket block applies to everything else under `.organism/`.
- `app/api/**`
- `app/actions/**`
- `app/(dashboard)/**`
- `cli/**`
- `sdk/**`
- `sdk-python/**`
- `schema/**`
- `drizzle/**`
- `hooks/**`
- `scripts/**`

## Auto-safe zones

The following zones are preferred for the first governed maintenance tasks.

- `docs/**`
- `README.md`
- `ROADMAP.md`
- `CHANGELOG.md` when documenting already-completed work only
- `.planning/**` if used for non-executable planning artifacts

Auto-safe work inside these zones is still blocked if it:
- changes commands in a way that alters execution behavior without verification
- documents nonexistent behavior as if already shipped
- removes substantial historical material
- introduces references to secrets, private endpoints, or unsafe instructions

## Approval triggers

Escalate for approval before execution if any of the following are true:
- touches a protected path
- changes runtime logic
- changes CLI commands or flags
- changes schemas or contracts
- changes test configuration or CI behavior
- adds or updates dependencies
- writes executable automation
- modifies more than 3 files
- includes migration, deletion, rename, or move operations
- cannot be verified with a bounded check

## Hard-block actions

These actions are forbidden for autonomous governed maintenance:
- Editing `organism.json`
- Editing anything under `.organism/` by hand or via the maintenance loop (the weekly-digest routine and the livingcode planner own `.organism/digests/` and `.organism/backlog/` respectively — those write paths are the system's, not a maintainer's)
- Deleting files or folders
- Running archive cleanup
- Changing auth flows
- Changing approval or governance enforcement logic
- Changing payment, billing, or escrow behavior
- Changing middleware behavior
- Changing production environment or deployment configuration
- Enabling self-modifying execution loops

## Governed handoff shape

Every delegated maintenance task must include:
- Objective
- Exact in-scope files
- Exact out-of-bounds files and zones
- Safety class
- Verification command or manual verification step
- Escalation rule if new files or code paths are discovered

## First recommended governed tasks

Best first tasks under this matrix:
1. Document a critical subsystem in `docs/operator/`
2. Triage TODO/FIXME comments into a single docs artifact
3. Add a tiny isolated documentation-adjacent test only if it avoids protected paths

## Recommendation

Use this matrix as the gating document for the first end-to-end governed maintenance demo:
- organism senses
- planner proposes
- policy checks classify
- bounded executor performs one auto-safe docs task
- verification runs
- organism re-measures
