'use client';

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';

export interface AgentFilterOption {
  agent_id: string;
  agent_name?: string | null;
  [key: string]: unknown;
}

export interface AgentFilterValue {
  agents: AgentFilterOption[];
  agentId: string | null;
  setAgentId: (id: string | null) => void;
  loading: boolean;
}

const AgentFilterContext = createContext<AgentFilterValue | null>(null);

export function AgentFilterProvider({ children }: { children: ReactNode }) {
  const [agents, setAgents] = useState<AgentFilterOption[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null); // null = "All Agents"
  const [loading, setLoading] = useState(true);

  const fetchAgents = useCallback(async () => {
    try {
      const res = await fetch('/api/agents');
      if (!res.ok) throw new Error('Failed to fetch agents');
      const data = await res.json();
      setAgents(data.agents || []);
    } catch (error) {
      console.error('Failed to fetch agents:', error);
      setAgents([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  return (
    <AgentFilterContext.Provider value={{ agents, agentId, setAgentId, loading }}>
      {children}
    </AgentFilterContext.Provider>
  );
}

export function useAgentFilter(): AgentFilterValue {
  const ctx = useContext(AgentFilterContext);
  if (!ctx) {
    // Return defaults if used outside provider (non-dashboard pages)
    return { agents: [], agentId: null, setAgentId: () => {}, loading: false };
  }
  return ctx;
}
