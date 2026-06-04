import { Users } from 'lucide-react';
import PolicyBasicsSection from './PolicyBasicsSection';
import PolicyRuleBuilderSection from './PolicyRuleBuilderSection';
import PolicySummaryCard from './PolicySummaryCard';

function PolicyAgentScope({ agentIds, setAgentIds, agents }) {
  const isAllAgents = agentIds.length === 0;

  const toggleAgent = (id) => {
    setAgentIds((prev) =>
      prev.includes(id) ? prev.filter((agentId) => agentId !== id) : [...prev, id]
    );
  };

  return (
    <div>
      <label className="block text-xs text-secondary mb-2 flex items-center gap-1.5">
        <Users size={12} />
        Agent Scope
      </label>
      <div className="flex items-center gap-3 mb-2">
        <button
          type="button"
          onClick={() => setAgentIds([])}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            isAllAgents
              ? 'bg-brand text-white'
              : 'bg-surface-tertiary text-secondary border border-border hover:text-white'
          }`}
        >
          All Agents
        </button>
        <span className="text-[10px] text-disabled">or pick specific agents:</span>
      </div>
      {agents.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <button
              key={agent.agent_id}
              type="button"
              onClick={() => toggleAgent(agent.agent_id)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                agentIds.includes(agent.agent_id)
                  ? 'bg-brand text-white'
                  : 'bg-surface-tertiary text-secondary border border-border hover:text-white'
              }`}
            >
              {agent.agent_name || agent.agent_id}
            </button>
          ))}
        </div>
      ) : (
        <p className="text-[10px] text-disabled">No agents discovered yet. Policies will apply to all agents by default.</p>
      )}
    </div>
  );
}

export default function PolicyAuthoringPanel({
  form,
  policyTypes,
  actionOptions,
  agents,
  summary,
  onChange,
  typeLocked = false,
}) {
  const setField = (field, value) => onChange((current) => ({ ...current, [field]: value }));

  return (
    <div className="space-y-4">
      <PolicyBasicsSection
        form={form}
        policyTypes={policyTypes}
        onChange={setField}
        typeLocked={typeLocked}
      />

      <PolicyRuleBuilderSection
        form={form}
        actionOptions={actionOptions}
        onChange={setField}
      />

      <PolicyAgentScope
        agentIds={form.agentIds || []}
        setAgentIds={(value) =>
          onChange((current) => ({
            ...current,
            agentIds: typeof value === 'function' ? value(current.agentIds || []) : value,
          }))
        }
        agents={agents}
      />

      <PolicySummaryCard summary={summary} />
    </div>
  );
}
