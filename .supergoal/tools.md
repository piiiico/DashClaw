# Tools detected this session

- **Context7 MCP** — available (`mcp__plugin_context7_context7__resolve-library-id` / `query-docs`). Use for current Next 16 / React 18 / TypeScript / Zod 4 / drizzle docs during foundation + schema phases.
- **WebSearch / WebFetch** — available (deferred tools). Use sparingly for TS-on-Next-16 config specifics if Context7 is thin.
- **Workflow (Ultracode dynamic workflows)** — available and ON. Used for parallel read-only repository analysis (recon) and will be used inside execution phases for bounded conversion / test creation / adversarial verification, as the user requested.
- **Project skills relevant to phases:**
  - `c--projects-dashclaw-route-changes` — focused API-route changes with verification (Phase 9 route conversion).
  - `dashclaw-ship` — post-merge accuracy sweep across docs/openapi/api-inventory/livingcode/SDK READMEs/version (final docs phase + version sync).
  - `dashclaw-platform-intelligence` — platform expert / live queries via `python -m livingcode query`.
  - `impeccable` / `frontend-design` / `frontend-verify` — UI (Phase 10 TSX) + the `/spend/code` brand-orange chart visual check.
  - `superpowers:test-driven-development`, `:verification-before-completion`, `:requesting-code-review` — discipline for test + verify phases.
- **repo-state.sh** — copied to `.supergoal/repo-state.sh` at dispatch; authoritative working-tree-vs-baseline deliverable + cleanliness check (committed + staged + unstaged + untracked), per user's explicit requirement.

## Host / toolchain
- OS: Windows 11, shell PowerShell (Bash also available). Node v24.15.0, npm 10.9.0.
- Caveat: `startup:smoke` fails on this host (Node24 Windows `spawn('npm.cmd')` EINVAL) and `test:api` needs a live dev server — both preexisting, environmental, NOT migration-caused. The verification matrix treats them as preexisting on this host.
