/**
 * Repository for team invites
 * Handles all database operations for invites table
 */
import type { SqlTag } from '../types/db';

export const VALID_ROLES = ['admin', 'member'];

interface CreateInviteInput {
  orgId: string;
  email?: string;
  role: string;
  invitedBy: string;
}

interface AcceptInviteInput {
  token: string;
  userId: string;
}

type AcceptInviteResult =
  | { ok: false; code: number; error: string }
  | { ok: true; org_id: unknown; role: unknown; invite_id: unknown };

let _tableChecked = false;
export async function ensureInvitesTable(sql: SqlTag): Promise<void> {
  if (_tableChecked) return;
  await sql`
    CREATE TABLE IF NOT EXISTS invites (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      email TEXT,
      role TEXT DEFAULT 'member',
      token TEXT UNIQUE NOT NULL,
      invited_by TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      accepted_by TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_invites_org_id ON invites(org_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_invites_status ON invites(status)`;
  _tableChecked = true;
}

export async function createInvite(
  sql: SqlTag,
  { orgId, email, role, invitedBy }: CreateInviteInput
): Promise<{ id: string; token: string; email: string; role: string; expires_at: string }> {
  await ensureInvitesTable(sql);
  // Validation
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  // Every invite must target a specific email address. Link-only invites are
  // not allowed: a shareable link with no email lets anyone who obtains it
  // join the workspace, which is exactly the hole this closes (the accept
  // path enforces that the signed-in user's email matches this address).
  if (!email) {
    throw new Error('Invalid invite: an email address is required');
  }
  // RFC 5321 caps email address length at 254 chars — enforce it before the
  // regex to bound worst-case matching time on adversarial input.
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Invalid email address');
  }

  const crypto = await import('crypto');
  const inviteId = `inv_${crypto.randomUUID()}`;
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(); // 7 days

  await sql`
    INSERT INTO invites (id, org_id, email, role, token, invited_by, status, expires_at, created_at)
    VALUES (${inviteId}, ${orgId}, ${email}, ${role}, ${token}, ${invitedBy}, 'pending', ${expiresAt}, ${now})
  `;

  return {
    id: inviteId,
    token,
    email,
    role,
    expires_at: expiresAt,
  };
}

/**
 * Look up an invite by its token, joined to the org name — for the accept
 * page's GET. Returns null when not found.
 */
export async function getInviteByToken(sql: SqlTag, token: string): Promise<Record<string, unknown> | null> {
  await ensureInvitesTable(sql);
  const rows = await sql`
    SELECT i.id, i.org_id, i.email, i.role, i.status, i.expires_at, i.created_at,
           o.name AS org_name
    FROM invites i
    JOIN organizations o ON o.id = i.org_id
    WHERE i.token = ${token}
    LIMIT 1
  `;
  return rows[0] || null;
}

/**
 * Accept an invite for an authenticated user. Performs every safety check the
 * incident exposed, all inside the repository so route files stay SQL-free:
 *   - invite exists, is pending, not expired
 *   - invite is tied to an email (link-only invites rejected)
 *   - the signed-in user's email MATCHES the invited email (the core fix —
 *     a different-email account can no longer consume someone else's invite)
 *   - the user isn't already in the target org
 *   - the user is the sole member of their current (personal/limbo) workspace,
 *     so accepting can't strand teammates in the org they're leaving
 * The invite is consumed atomically (UPDATE ... WHERE status='pending') so two
 * concurrent accepts can't both succeed. Returns a tagged result the route
 * maps to an HTTP status.
 */
export async function acceptInvite(sql: SqlTag, { token, userId }: AcceptInviteInput): Promise<AcceptInviteResult> {
  await ensureInvitesTable(sql);

  const inviteRows = await sql`
    SELECT id, org_id, email, role, status, expires_at
    FROM invites WHERE token = ${token} LIMIT 1
  `;
  if (inviteRows.length === 0) return { ok: false, code: 404, error: 'Invite not found' };
  const invite = inviteRows[0]!;

  if (invite.status !== 'pending') {
    return { ok: false, code: 409, error: `Invite has already been ${invite.status}` };
  }
  if (new Date(invite.expires_at as string) < new Date()) {
    return { ok: false, code: 410, error: 'Invite has expired' };
  }
  if (!invite.email) {
    return { ok: false, code: 403, error: 'This invite is not tied to an email address and cannot be accepted' };
  }

  const userRows = await sql`SELECT id, email, org_id FROM users WHERE id = ${userId} LIMIT 1`;
  if (userRows.length === 0) return { ok: false, code: 404, error: 'User not found' };
  const user = userRows[0]!;

  // The core security check: the authenticated account must own the invited email.
  if (!user.email || (user.email as string).toLowerCase() !== (invite.email as string).toLowerCase()) {
    return { ok: false, code: 403, error: 'This invite is for a different email address. Sign in with the invited account.' };
  }

  if (user.org_id === invite.org_id) {
    return { ok: false, code: 409, error: 'You are already a member of this workspace' };
  }

  const memberCount = await sql`SELECT COUNT(*)::int AS count FROM users WHERE org_id = ${user.org_id}`;
  if (Number(memberCount[0]?.count || 0) > 1) {
    return { ok: false, code: 409, error: 'Leave your current workspace before joining another' };
  }

  const updated = await sql`
    UPDATE invites SET status = 'accepted', accepted_by = ${userId}
    WHERE token = ${token} AND status = 'pending'
    RETURNING id
  `;
  if (updated.length === 0) return { ok: false, code: 409, error: 'Invite is no longer available' };

  await sql`UPDATE users SET org_id = ${invite.org_id}, role = ${invite.role} WHERE id = ${userId}`;

  return { ok: true, org_id: invite.org_id, role: invite.role, invite_id: invite.id };
}

export async function listPendingInvites(sql: SqlTag, orgId: string): Promise<Record<string, unknown>[]> {
  await ensureInvitesTable(sql);
  const invites = await sql`
    SELECT id, email, role, status, expires_at, created_at
    FROM invites
    WHERE org_id = ${orgId}
      AND status = 'pending'
      AND expires_at::timestamptz > NOW()
    ORDER BY created_at DESC
  `;

  return invites;
}

export async function getInviteById(
  sql: SqlTag,
  inviteId: string,
  orgId: string
): Promise<Record<string, unknown> | null> {
  await ensureInvitesTable(sql);
  const rows = await sql`
    SELECT id, status FROM invites WHERE id = ${inviteId} AND org_id = ${orgId}
  `;
  return rows[0] || null;
}

export async function revokeInvite(
  sql: SqlTag,
  inviteId: string,
  orgId: string
): Promise<{ success: boolean; revoked: string }> {
  await ensureInvitesTable(sql);
  if (!inviteId || !inviteId.startsWith('inv_')) {
    throw new Error('Valid invite id is required');
  }

  const existing = await getInviteById(sql, inviteId, orgId);
  if (!existing) {
    throw new Error('Invite not found');
  }
  if (existing.status !== 'pending') {
    throw new Error('Invite is not pending');
  }

  await sql`
    UPDATE invites SET status = 'revoked' WHERE id = ${inviteId} AND org_id = ${orgId}
  `;

  return { success: true, revoked: inviteId };
}
