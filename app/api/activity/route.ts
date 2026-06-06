import { NextResponse } from 'next/server';
import { getSql } from '../../lib/db.js';
import { getOrgId } from '../../lib/org.js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

// GET /api/activity - List activity logs (all members can read)
export async function GET(request: Request) {
  try {
    const orgId = getOrgId(request);
    const sql = getSql();
    const { searchParams } = new URL(request.url);

    const action = searchParams.get('action');
    const actorId = searchParams.get('actor_id');
    const resourceType = searchParams.get('resource_type');
    const before = searchParams.get('before');
    const after = searchParams.get('after');
    const limit = Math.min(parseInt(searchParams.get('limit') || '50', 10), 200);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    // Build dynamic WHERE clause
    const conditions = ['al.org_id = $1'];
    const params: (string | number)[] = [orgId];
    let paramIdx = 2;

    if (action) {
      conditions.push(`al.action = $${paramIdx++}`);
      params.push(action);
    }
    if (actorId) {
      conditions.push(`al.actor_id = $${paramIdx++}`);
      params.push(actorId);
    }
    if (resourceType) {
      conditions.push(`al.resource_type = $${paramIdx++}`);
      params.push(resourceType);
    }
    if (before) {
      conditions.push(`al.created_at < $${paramIdx++}`);
      params.push(before);
    }
    if (after) {
      conditions.push(`al.created_at > $${paramIdx++}`);
      params.push(after);
    }

    const where = conditions.join(' AND ');

    const query = `
      SELECT al.*, u.name AS actor_name, u.image AS actor_image
      FROM activity_logs al
      LEFT JOIN users u ON al.actor_id = u.id
      WHERE ${where}
      ORDER BY al.created_at DESC
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `;
    params.push(limit, offset);

    const logs = await sql.query(query, params);

    // Get counts for stats
    const countQuery = `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE al.created_at::date = CURRENT_DATE) AS today,
        COUNT(DISTINCT al.actor_id) AS unique_actors
      FROM activity_logs al
      WHERE al.org_id = $1
    `;
    const stats = await sql.query(countQuery, [orgId]);

    return NextResponse.json({
      events: logs,
      stats: stats[0] || { total: 0, today: 0, unique_actors: 0 },
      pagination: { limit, offset },
    });
  } catch (error) {
    console.error('Activity API GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch activity logs' }, { status: 500 });
  }
}
