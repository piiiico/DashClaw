import { NextResponse } from 'next/server';
import { getSql } from '../../../lib/db.js';
import { getOrgId } from '../../../lib/org.js';
import { getSession, updateSession } from '../../../lib/sessions.js';

export async function GET(request, { params }) {
  try {
    const { sessionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);

    const session = await getSession(sql, sessionId, orgId);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Session detail error:', error);
    return NextResponse.json({ error: 'Failed to fetch session' }, { status: 500 });
  }
}

export async function PATCH(request, { params }) {
  try {
    const { sessionId } = await params;
    const sql = getSql();
    const orgId = getOrgId(request);
    const body = await request.json();

    const { status, green_level, branch_freshness, commits_behind, blocked_reason } = body;

    // At least one update field must be present
    if (!status && !green_level && !branch_freshness && commits_behind == null && !blocked_reason) {
      return NextResponse.json({ error: 'No update fields provided' }, { status: 400 });
    }

    const session = await updateSession(sql, sessionId, orgId, {
      status,
      green_level,
      branch_freshness,
      commits_behind,
      blocked_reason,
    });

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    return NextResponse.json({ session });
  } catch (error) {
    console.error('Session update error:', error);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}
