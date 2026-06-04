export const dynamic = 'force-dynamic';
export const revalidate = 0;

import { NextResponse } from 'next/server';
import { getUserId } from '../../../lib/org.js';
import { getSql } from '../../../lib/db.js';
import { incrementMeter } from '../../../lib/usage.js';
import { logActivity } from '../../../lib/audit.js';
import { getInviteByToken, acceptInvite } from '../../../lib/repositories/invites.repository.js';

// GET /api/invite/[token] — invite details for the accept page.
export async function GET(request, { params }) {
  try {
    const { token } = await params;
    if (!token || token.length !== 64) {
      return NextResponse.json({ error: 'Invalid invite link' }, { status: 400 });
    }

    const sql = getSql();
    const invite = await getInviteByToken(sql, token);
    if (!invite) {
      return NextResponse.json({ error: 'Invite not found' }, { status: 404 });
    }

    const expired = new Date(invite.expires_at) < new Date();
    return NextResponse.json({
      invite: {
        id: invite.id,
        org_name: invite.org_name,
        role: invite.role,
        email: invite.email,
        status: expired && invite.status === 'pending' ? 'expired' : invite.status,
        expires_at: invite.expires_at,
      },
    });
  } catch (error) {
    console.error('Invite GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch invite' }, { status: 500 });
  }
}

// POST /api/invite/[token] — accept the invite as the authenticated user.
// The email-match + atomic-consume logic lives in the repository so this route
// stays SQL-free (route-sql:check). The signed-in user's id is injected by the
// middleware (x-user-id) for same-origin dashboard requests.
export async function POST(request, { params }) {
  try {
    const { token } = await params;
    if (!token || token.length !== 64) {
      return NextResponse.json({ error: 'Invalid invite link' }, { status: 400 });
    }

    const userId = getUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const sql = getSql();
    const result = await acceptInvite(sql, { token, userId });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.code });
    }

    // Fire-and-forget meter increment — a metering failure must not undo the join.
    incrementMeter(result.org_id, 'members', sql).catch((err) => {
      console.warn('[Invite] Failed to increment members meter:', err.message);
    });

    logActivity({
      orgId: result.org_id, actorId: userId, action: 'invite.accepted',
      resourceType: 'invite', resourceId: result.invite_id,
      details: { role: result.role }, request,
    }, sql);

    return NextResponse.json({ success: true, org_id: result.org_id, role: result.role });
  } catch (error) {
    console.error('Invite POST error:', error);
    return NextResponse.json({ error: 'Failed to accept invite' }, { status: 500 });
  }
}
