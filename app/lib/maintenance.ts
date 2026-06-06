import { randomUUID } from 'node:crypto';

/**
 * Memory Maintenance Logic
 * Proactively identifies stale facts and conflicting assumptions.
 */

// Tagged-template SQL client (Neon). Returns DB rows as loosely-typed records.
type SqlClient = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

interface AssumptionRow {
  agent_id?: string | null;
  assumption?: string;
  action_id?: string;
  [key: string]: unknown;
}

interface FailureRow {
  agent_id?: string | null;
  decision?: string;
  outcome_notes?: string | null;
  [key: string]: unknown;
}

interface AgentTask {
  assumptions: AssumptionRow[];
  conflicts: FailureRow[];
}

export async function identifyStaleAssumptions(orgId: string, sql: SqlClient): Promise<AssumptionRow[]> {
  // Find unvalidated assumptions older than 7 days
  const staleAssumptions = await sql`
    SELECT a.*, ar.agent_id
    FROM assumptions a
    LEFT JOIN action_records ar ON a.action_id = ar.action_id
    WHERE a.org_id = ${orgId}
      AND a.validated = 0
      AND a.invalidated = 0
      AND a.created_at < NOW() - INTERVAL '7 days'
    ORDER BY a.created_at ASC
  `;
  return staleAssumptions as AssumptionRow[];
}

export async function identifyConflictingDecisions(orgId: string, sql: SqlClient): Promise<FailureRow[]> {
  // Find decisions with 'failure' outcomes that might contradict earlier lessons
  // This is a simple implementation; deep semantic conflict detection would require LLM
  const failures = await sql`
    SELECT d.*, o.notes as outcome_notes
    FROM decisions d
    JOIN outcomes o ON d.id = o.decision_id
    WHERE d.org_id = ${orgId}
      AND o.result = 'failure'
      AND d.timestamp > NOW() - INTERVAL '24 hours'
  `;
  return failures as FailureRow[];
}

export async function runMemoryMaintenance(orgId: string, sql: SqlClient) {
  const staleAssumptions = await identifyStaleAssumptions(orgId, sql);
  const recentFailures = await identifyConflictingDecisions(orgId, sql);

  if (staleAssumptions.length === 0 && recentFailures.length === 0) {
    return { status: 'clean', message: 'Memory health is optimal.' };
  }

  // Group by agent to send personalized maintenance messages
  const agentTasks: Record<string, AgentTask> = {};

  for (const asm of staleAssumptions) {
    const aid = asm.agent_id || 'unknown';
    if (!agentTasks[aid]) agentTasks[aid] = { assumptions: [], conflicts: [] };
    agentTasks[aid].assumptions.push(asm);
  }

  for (const fail of recentFailures) {
    const aid = fail.agent_id || 'unknown';
    if (!agentTasks[aid]) agentTasks[aid] = { assumptions: [], conflicts: [] };
    agentTasks[aid].conflicts.push(fail);
  }

  const results = { agents_notified: 0, messages_sent: 0 };

  for (const [agentId, data] of Object.entries(agentTasks)) {
    if (agentId === 'unknown') continue;

    const maintenanceMessage = composeMaintenanceMessage(data);
    const sent = await sendSystemMessage(orgId, agentId, 'Memory Maintenance', maintenanceMessage, sql);
    if (sent) {
      results.agents_notified++;
      results.messages_sent++;
    }
  }

  return { status: 'processed', ...results };
}

function composeMaintenanceMessage(data: AgentTask): string {
  let msg = `### 🧹 Memory Maintenance Required

`;
  msg += `I've identified items in your long-term memory that require verification or pruning to maintain operational accuracy.

`;

  if (data.assumptions.length > 0) {
    msg += `#### ⚠️ Stale Assumptions
The following assumptions have been unvalidated for over 7 days. Please verify if these still hold true:
`;
    data.assumptions.slice(0, 5).forEach(a => {
      msg += `- **${a.assumption}** (Action: ${a.action_id})
`;
    });
    if (data.assumptions.length > 5) msg += `- ...and ${data.assumptions.length - 5} more.
`;
    msg += "\n";
  }

  if (data.conflicts.length > 0) {
    msg += `#### 📉 Recent Decision Failures
You've had recent failures that might contradict established patterns. Review these cases:
`;
    data.conflicts.slice(0, 3).forEach(f => {
      msg += `- **${f.decision}**: ${f.outcome_notes || 'No notes provided.'}
`;
    });
    msg += "\n";
  }

  msg += "Suggested Action: Use the `validate_assumption` tool to update your state, or archive stale lessons in your local memory.";

  return msg;
}

async function sendSystemMessage(orgId: string, toAgentId: string, subject: string, body: string, sql: SqlClient): Promise<boolean> {
  const id = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const now = new Date().toISOString();

  try {
    await sql`
      INSERT INTO agent_messages (
        id, org_id, thread_id, from_agent_id, to_agent_id,
        message_type, subject, body, urgent, status,
        doc_ref, read_by, created_at
      ) VALUES (
        ${id}, ${orgId}, null, 'system', ${toAgentId},
        'lesson', ${subject}, ${body}, true, 'sent',
        null, null, ${now}
      )
    `;
    return true;
  } catch (err) {
    console.error('[MAINTENANCE] Failed to send system message:', (err as Error)?.message);
    return false;
  }
}
