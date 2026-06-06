'use client';

import { useAgentFilter } from '../lib/AgentFilterContext';
import { getAgentColor } from '../lib/colors';
import { Users } from 'lucide-react';

export default function AgentFilterDropdown() {
  const { agents, agentId, setAgentId, loading } = useAgentFilter();

  if (loading || agents.length === 0) return null;

  return (
    <div className="flex items-center gap-2">
      <Users size={14} className="text-tertiary" aria-hidden="true" />
      <label htmlFor="agent-filter" className="sr-only">
        Filter by agent
      </label>
      <select
        id="agent-filter"
        value={agentId || ''}
        onChange={(e) => setAgentId(e.target.value || null)}
        className="cursor-pointer appearance-none rounded-lg border border-border bg-surface-tertiary px-2.5 py-1.5 pr-7 text-sm text-secondary transition-colors duration-150 hover:border-border-hover focus:border-brand/50 focus:outline-none focus:ring-2 focus:ring-brand/20"
        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center' }}
      >
        <option value="" className="bg-secondary text-secondary">All agents</option>
        {agents.map((agent) => (
          <option key={agent.agent_id} value={agent.agent_id} className="bg-secondary text-secondary">
            {agent.agent_name || agent.agent_id}
          </option>
        ))}
      </select>
    </div>
  );
}
