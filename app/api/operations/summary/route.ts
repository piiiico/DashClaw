export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { apiErrorResponse } from '../../../lib/apiErrors.js';

export async function GET(request: Request) {
  try {
    const sql = getSql();
    const orgId = getOrgId(request);

    // Each query is individually resilient — a single failing query won't break the whole card
    const safe = (promise: Promise<Record<string, unknown>[]>): Promise<Record<string, unknown>[]> =>
      promise.catch(() => [{} as Record<string, unknown>]);

    const [throughput, latency, approvalBacklog, workflowHealth, capHealth] = await Promise.all([
      // Decision throughput
      safe(sql`
        SELECT
          COUNT(*) FILTER (WHERE timestamp_start::timestamptz > NOW() - INTERVAL '1 hour')::int AS last_1h,
          COUNT(*) FILTER (WHERE timestamp_start::timestamptz > NOW() - INTERVAL '24 hours')::int AS last_24h
        FROM action_records
        WHERE org_id = ${orgId}
          AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      `),

      // Decision latency — use AVG as fallback since PERCENTILE_CONT can fail on some configs
      safe(sql`
        SELECT
          COALESCE(AVG(duration_ms), 0)::int AS p50,
          COALESCE(MAX(duration_ms), 0)::int AS p95
        FROM action_records
        WHERE org_id = ${orgId}
          AND status = 'completed'
          AND duration_ms IS NOT NULL
          AND duration_ms > 0
          AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      `),

      // Approval backlog
      safe(sql`
        SELECT
          COUNT(*)::int AS pending_count,
          COALESCE(EXTRACT(EPOCH FROM (NOW() - MIN(timestamp_start::timestamptz))) / 60, 0)::int AS oldest_minutes,
          COALESCE(EXTRACT(EPOCH FROM (NOW() - AVG(timestamp_start::timestamptz))) / 60, 0)::int AS avg_wait_minutes
        FROM action_records
        WHERE org_id = ${orgId}
          AND status = 'pending_approval'
      `),

      // Workflow health (last 24h)
      safe(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'running')::int AS running,
          COUNT(*) FILTER (WHERE status = 'failed')::int AS failed_24h,
          COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_24h,
          COALESCE(AVG(duration_ms) FILTER (WHERE status = 'completed' AND duration_ms > 0), 0)::int AS avg_duration_ms
        FROM action_records
        WHERE org_id = ${orgId}
          AND action_type = 'workflow_execute'
          AND timestamp_start::timestamptz > NOW() - INTERVAL '24 hours'
      `),

      // Capability health counts
      safe(sql`
        SELECT
          COUNT(*) FILTER (WHERE health_status = 'healthy' OR health_status IS NULL)::int AS healthy,
          COUNT(*) FILTER (WHERE health_status = 'degraded')::int AS degraded,
          COUNT(*) FILTER (WHERE health_status = 'failing')::int AS failing
        FROM capabilities
        WHERE org_id = ${orgId}
      `),
    ]);

    return NextResponse.json({
      throughput: {
        last_1h: throughput[0]?.last_1h || 0,
        last_24h: throughput[0]?.last_24h || 0,
      },
      latency: {
        p50_ms: latency[0]?.p50 || 0,
        p95_ms: latency[0]?.p95 || 0,
      },
      approval_backlog: {
        pending_count: approvalBacklog[0]?.pending_count || 0,
        oldest_minutes: approvalBacklog[0]?.oldest_minutes || 0,
        avg_wait_minutes: approvalBacklog[0]?.avg_wait_minutes || 0,
      },
      workflows: {
        running: workflowHealth[0]?.running || 0,
        failed_24h: workflowHealth[0]?.failed_24h || 0,
        completed_24h: workflowHealth[0]?.completed_24h || 0,
        avg_duration_ms: workflowHealth[0]?.avg_duration_ms || 0,
      },
      capabilities: {
        healthy: capHealth[0]?.healthy || 0,
        degraded: capHealth[0]?.degraded || 0,
        failing: capHealth[0]?.failing || 0,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, 'OPERATIONS_SUMMARY');
  }
}
