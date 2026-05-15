/**
 * Repository for team invites
 * Handles all database operations for invites table
 */

export const VALID_ROLES = ['admin', 'member'];

let _tableChecked = false;
export async function ensureInvitesTable(sql) {
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

export async function createInvite(sql, { orgId, email, role, invitedBy }) {
  await ensureInvitesTable(sql);
  // Validation
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  // RFC 5321 caps email address length at 254 chars — enforce it before the
  // regex to bound worst-case matching time on adversarial input.
  if (email && (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
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

export async function listPendingInvites(sql, orgId) {
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

export async function getInviteById(sql, inviteId, orgId) {
  await ensureInvitesTable(sql);
  const rows = await sql`
    SELECT id, status FROM invites WHERE id = ${inviteId} AND org_id = ${orgId}
  `;
  return rows[0] || null;
}

export async function revokeInvite(sql, inviteId, orgId) {
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
