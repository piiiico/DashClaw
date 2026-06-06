export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { listAgentsForOrg } from '../../../lib/repositories/agents.repository.js';

/**
 * GET /api/swarm/graph
 * Returns a graph representation of agent communication within the organization.
 * Nodes: Agents
 * Edges: Communication frequency (messages sent/received)
 */
export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);
    const { searchParams } = new URL(request.url);
    const swarmId = searchParams.get('swarm_id');

    // 1. Fetch all agents in the org (broad discovery via repository)
    let agents;
    if (swarmId) {
      // Swarm-scoped: start with action_records for the swarm, then merge broader discovery
      const swarmAgents = await sql`SELECT DISTINCT agent_id, MAX(agent_name) as name FROM action_records WHERE org_id = ${orgId} AND swarm_id = ${swarmId} GROUP BY agent_id`;
      const allAgents = await listAgentsForOrg(sql, orgId);
      const swarmIds = new Set(swarmAgents.map((a: { agent_id: string }) => a.agent_id));
      // Merge any agents not already found via swarm action_records
      agents = [
        ...swarmAgents,
        ...allAgents.filter((a: { agent_id: string }) => !swarmIds.has(a.agent_id)).map((a: { agent_id: string; agent_name?: string }) => ({ agent_id: a.agent_id, name: a.agent_name }))
      ];
    } else {
      const allAgents = await listAgentsForOrg(sql, orgId);
      agents = allAgents.map((a: { agent_id: string; agent_name?: string }) => ({ agent_id: a.agent_id, name: a.agent_name }));
    }

    // 2. Fetch communication links (messages between agents)
    // We aggregate counts to create edge weights
    const linksQuery = sql`
      SELECT from_agent_id as source, to_agent_id as target, COUNT(*) as weight
      FROM agent_messages
      WHERE org_id = ${orgId}
        AND from_agent_id IS NOT NULL
        AND to_agent_id IS NOT NULL
      GROUP BY from_agent_id, to_agent_id
    `;

    const rawLinks = await linksQuery;

    // 3. Fetch handoff links (another form of connection)
    const handoffLinksQuery = sql`
      SELECT agent_id as source, 'system' as target, COUNT(*) as weight
      FROM handoffs
      WHERE org_id = ${orgId}
      GROUP BY agent_id
    `;
    // Note: In a real swarm, handoffs might be to specific agents,
    // but the current schema only has the agent who created the handoff.
    // For now, we'll focus on messaging for links.

    // 4. Calculate agent stats for node sizing
    const statsQuery = sql`
      SELECT agent_id,
             COUNT(*) as action_count,
             AVG(risk_score) as avg_risk,
             SUM(cost_estimate) as total_cost
      FROM action_records
      WHERE org_id = ${orgId}
      GROUP BY agent_id
    `;
    const agentStats = await statsQuery;
    const statsMap: Record<string, { action_count?: number; avg_risk?: number; total_cost?: number }> = Object.fromEntries(agentStats.map((s: { agent_id: string }) => [s.agent_id, s]));

    // Format for graph visualization (Nodes & Links)
    const nodes = agents.map((a: { agent_id: string; name?: string }) => ({
      id: a.agent_id,
      name: a.name || a.agent_id,
      actions: statsMap[a.agent_id]?.action_count || 0,
      risk: parseFloat(String(statsMap[a.agent_id]?.avg_risk || 0)),
      cost: parseFloat(String(statsMap[a.agent_id]?.total_cost || 0)),
      val: Math.log10((statsMap[a.agent_id]?.action_count || 1) + 1) * 10 // Node size factor
    }));

    // Filter links to only include nodes we have
    const agentIds = new Set(nodes.map((n: { id: string }) => n.id));
    const links = rawLinks
      .filter((l: { source: string; target: string }) => agentIds.has(l.source) && agentIds.has(l.target))
      .map((l: { source: string; target: string; weight: string }) => ({
        source: l.source,
        target: l.target,
        weight: parseInt(l.weight, 10)
      }));

    return NextResponse.json({
      nodes,
      links,
      swarm_id: swarmId || 'all',
      total_agents: nodes.length,
      total_links: links.length
    });
  } catch (error) {
    console.error('[SWARM] Graph API error:', error);
    return NextResponse.json({ error: 'Failed to generate swarm graph' }, { status: 500 });
  }
}
