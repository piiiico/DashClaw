/**
 * Composed sub-agent identities use the form `<parent>:<agent_type>`
 * (e.g. `claude-code:explore`) — see docs/rfcs/2026-06-01-subagent-fleet-identities.md.
 *
 * Governance lookups (pairing, identity) fall back to the base parent so a
 * sub-agent inherits the parent's pairing/permissions when it has none of its
 * own, matching Claude Code's "sub-agents inherit the parent's permissions" model.
 * An exact row for the composed id always wins over the inherited parent row.
 *
 * @param agentId
 * @returns the parent id (substring before the first `:`), or null when the id
 *   is not composed.
 */
export function baseAgentId(agentId: unknown): string | null {
  if (typeof agentId !== 'string') return null;
  const i = agentId.indexOf(':');
  return i > 0 ? agentId.slice(0, i) : null;
}
