'use client';

import { useState, useEffect } from 'react';
import { Users } from 'lucide-react';

interface AgentScopePickerProps {
  agentIds?: string[];
  onChange: (ids: string[]) => void;
}

export default function AgentScopePicker({ agentIds = [], onChange }: AgentScopePickerProps) {
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const res = await fetch('/api/agents');
        if (res.ok) {
          const data = await res.json();
          setAgents(data.agents || []);
        }
      } catch { /* ignore */ }
    };
    fetchAgents();
  }, []);

  const isAllAgents = !agentIds || agentIds.length === 0;

  const toggleAgent = (id: string) => {
    if (agentIds.includes(id)) {
      onChange(agentIds.filter(a => a !== id));
    } else {
      onChange([...agentIds, id]);
    }
  };

  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-tertiary mb-2">Applies to</div>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onChange([])}
          className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors ${
            isAllAgents
              ? 'bg-brand/10 border border-brand/40 text-brand'
              : 'bg-white/5 border border-white/5 text-secondary hover:text-white'
          }`}
        >
          <Users size={12} /> All agents
        </button>
        {agents.map(agent => {
          const active = agentIds.includes(agent.agent_id);
          return (
            <button
              key={agent.agent_id}
              onClick={() => toggleAgent(agent.agent_id)}
              className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                active
                  ? 'bg-brand/10 border border-brand/40 text-brand'
                  : 'bg-white/5 border border-white/5 text-secondary hover:text-white'
              }`}
            >
              {agent.agent_name || agent.agent_id}
            </button>
          );
        })}
      </div>
      {agents.length === 0 && (
        <div className="mt-2 text-xs text-tertiary">No agents discovered yet. Policies will apply to all agents.</div>
      )}
    </div>
  );
}
