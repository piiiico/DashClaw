/**
 * Task-to-Agent Matching Engine
 * Absorbed from Agent-Task-Router/src/matcher.js
 *
 * Scores agents based on:
 * 1. Capability match (40 pts)
 * 2. Availability / load (20 pts)
 * 3. Performance history (25 pts)
 * 4. Skill priority (15 pts)
 * + Urgency bonus for idle agents on critical tasks
 *
 * Adapted: removed SQLite dependency. Metrics are passed in as a parameter.
 */

interface Capability {
  skill: string;
  priority?: number;
}

interface Agent {
  id?: string;
  status?: string;
  current_load: number;
  max_concurrent: number;
  capabilities?: string | unknown[] | null;
  [key: string]: unknown;
}

interface Task {
  required_skills?: string | unknown[] | null;
  urgency?: string;
}

interface AgentMetric {
  agent_id?: string;
  skill?: string;
  tasks_completed: number;
  tasks_failed: number;
}

interface ScoredAgent {
  agent: Agent;
  score: number;
  reasons: string[];
}

/**
 * Safely parse a JSON array stored as a string in a DB field.
 * Returns [] on null, undefined, or malformed JSON instead of throwing.
 */
function safeParseJsonArray(val: string | unknown[] | null | undefined): unknown[] {
  if (Array.isArray(val)) return val;
  try {
    return JSON.parse((val as string) || '[]');
  } catch {
    return [];
  }
}

/**
 * Find best matching agent for a task
 */
export function findBestMatch(task: Task, candidates: Agent[], allMetrics: AgentMetric[] = []): ScoredAgent | null {
  const requiredSkills = safeParseJsonArray(task.required_skills) as string[];

  if (requiredSkills.length === 0) {
    const available = candidates
      .filter(a => a.status === 'available' && a.current_load < a.max_concurrent)
      .sort((a, b) => a.current_load - b.current_load);

    if (available.length === 0) return null;
    return { agent: available[0] as Agent, score: 1.0, reasons: ['No skill requirements, routed to least-loaded agent'] };
  }

  const scored = candidates
    .filter(a => a.status === 'available' && a.current_load < a.max_concurrent)
    .map(agent => scoreAgent(agent, requiredSkills, task, allMetrics))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored.length > 0 ? (scored[0] as ScoredAgent) : null;
}

function scoreAgent(agent: Agent, requiredSkills: string[], task: Task, allMetrics: AgentMetric[]): ScoredAgent {
  const reasons: string[] = [];
  let score = 0;

  // Parse capabilities - handle both string JSON and array formats
  const capabilities = safeParseJsonArray(agent.capabilities);

  const capObjects: Capability[] = capabilities.map(c =>
    typeof c === 'string' ? { skill: c, priority: 0 } : (c as Capability)
  );
  const agentSkills = capObjects.map(c => c.skill);

  // 1. Capability match (0-40)
  const matched = requiredSkills.filter(s => agentSkills.includes(s));
  const coverage = matched.length / requiredSkills.length;

  if (coverage === 0) return { agent, score: 0, reasons: ['No matching skills'] };

  score += coverage * 40;
  reasons.push(`Skill match: ${matched.length}/${requiredSkills.length} (${Math.round(coverage * 100)}%)`);

  // 2. Availability (0-20)
  const loadRatio = agent.current_load / agent.max_concurrent;
  score += (1 - loadRatio) * 20;
  reasons.push(`Load: ${agent.current_load}/${agent.max_concurrent} (${Math.round((1 - loadRatio) * 100)}% free)`);

  // 3. Performance history (0-25)
  const agentMetrics = allMetrics.filter(m =>
    m.agent_id === agent.id && requiredSkills.includes(m.skill as string)
  );

  if (agentMetrics.length > 0) {
    const total = agentMetrics.reduce((sum, m) => sum + (m.tasks_completed + m.tasks_failed), 0);
    const successful = agentMetrics.reduce((sum, m) => sum + m.tasks_completed, 0);
    const rate = total > 0 ? successful / total : 0.5;
    score += rate * 25;
    reasons.push(`Success rate: ${Math.round(rate * 100)}% (${total} tasks)`);
  } else {
    score += 12.5;
    reasons.push('No performance history (neutral score)');
  }

  // 4. Skill priority (0-15)
  const prioritySum = capObjects
    .filter(c => requiredSkills.includes(c.skill))
    .reduce((sum, c) => sum + (c.priority || 0), 0);
  const maxPriority = requiredSkills.length * 10;
  score += maxPriority > 0 ? (prioritySum / maxPriority) * 15 : 0;
  if (prioritySum > 0) reasons.push(`Skill priority bonus: ${prioritySum}`);

  // 5. Urgency boost
  const urgency = task.urgency || 'normal';
  if (urgency === 'critical' && agent.current_load === 0) {
    score += 10;
    reasons.push('Urgency boost: idle agent for critical task');
  }

  return { agent, score: Math.round(score * 100) / 100, reasons };
}

/**
 * Rank all candidate agents for a task (for routing decision logs)
 */
export function rankAgents(task: Task, candidates: Agent[], allMetrics: AgentMetric[] = []): ScoredAgent[] {
  const requiredSkills = safeParseJsonArray(task.required_skills) as string[];

  return candidates
    .map(agent => scoreAgent(agent, requiredSkills, task, allMetrics))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score);
}
