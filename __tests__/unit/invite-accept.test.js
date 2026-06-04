/**
 * Security regression tests for the team-invite lockdown.
 *
 * The reported incident: an invite link could be consumed by a different-email
 * account, and login alone dropped strangers into the shared workspace. The
 * fix restores an email-validated accept path (acceptInvite) and rejects
 * link-only invites. These tests pin that logic.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { acceptInvite } from '@/lib/repositories/invites.repository.js';

// SQL mock that answers by query text, so it's robust to ensureInvitesTable's
// CREATE statements and to call ordering.
function makeSql({ invite, user, memberCount = [{ count: 1 }], updateInvite = [{ id: 'inv_1' }] }) {
  const calls = [];
  const fn = async (strings, ...values) => {
    const text = Array.isArray(strings) ? strings.join(' ') : String(strings);
    calls.push({ text, values });
    if (text.includes('CREATE TABLE') || text.includes('CREATE INDEX')) return [];
    if (text.includes('FROM invites') && text.includes('WHERE token')) return invite ?? [];
    if (text.includes('COUNT(*)') && text.includes('FROM users')) return memberCount;
    if (text.includes('FROM users') && text.includes('WHERE id')) return user ?? [];
    if (text.includes('UPDATE invites')) return updateInvite;
    if (text.includes('UPDATE users')) return [];
    return [];
  };
  fn.calls = calls;
  return fn;
}

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();

beforeEach(() => vi.clearAllMocks());

describe('acceptInvite — email-validated team join', () => {
  it('rejects a mismatched-email account (the core hole)', async () => {
    const sql = makeSql({
      invite: [{ id: 'inv_1', org_id: 'org_main', email: 'invited@x.com', role: 'member', status: 'pending', expires_at: future }],
      user: [{ id: 'usr_2', email: 'stranger@y.com', org_id: 'org_personal' }],
    });
    const res = await acceptInvite(sql, { token: 't'.repeat(64), userId: 'usr_2' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(403);
    // The user row must NOT have been moved.
    expect(sql.calls.some((c) => c.text.includes('UPDATE users'))).toBe(false);
  });

  it('accepts when the signed-in email matches the invite', async () => {
    const sql = makeSql({
      invite: [{ id: 'inv_1', org_id: 'org_main', email: 'invited@x.com', role: 'member', status: 'pending', expires_at: future }],
      user: [{ id: 'usr_2', email: 'INVITED@x.com', org_id: 'org_personal' }], // case-insensitive
    });
    const res = await acceptInvite(sql, { token: 't'.repeat(64), userId: 'usr_2' });
    expect(res.ok).toBe(true);
    expect(res.org_id).toBe('org_main');
    expect(res.role).toBe('member');
    expect(sql.calls.some((c) => c.text.includes('UPDATE users'))).toBe(true);
  });

  it('rejects a link-only invite with no email', async () => {
    const sql = makeSql({
      invite: [{ id: 'inv_1', org_id: 'org_main', email: null, role: 'member', status: 'pending', expires_at: future }],
      user: [{ id: 'usr_2', email: 'anyone@y.com', org_id: 'org_personal' }],
    });
    const res = await acceptInvite(sql, { token: 't'.repeat(64), userId: 'usr_2' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(403);
  });

  it('rejects an expired invite', async () => {
    const sql = makeSql({
      invite: [{ id: 'inv_1', org_id: 'org_main', email: 'invited@x.com', role: 'member', status: 'pending', expires_at: past }],
      user: [{ id: 'usr_2', email: 'invited@x.com', org_id: 'org_personal' }],
    });
    const res = await acceptInvite(sql, { token: 't'.repeat(64), userId: 'usr_2' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(410);
  });

  it('rejects an already-consumed invite', async () => {
    const sql = makeSql({
      invite: [{ id: 'inv_1', org_id: 'org_main', email: 'invited@x.com', role: 'member', status: 'accepted', expires_at: future }],
      user: [{ id: 'usr_2', email: 'invited@x.com', org_id: 'org_personal' }],
    });
    const res = await acceptInvite(sql, { token: 't'.repeat(64), userId: 'usr_2' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(409);
  });

  it('blocks moving a user who is not the sole member of their current org', async () => {
    const sql = makeSql({
      invite: [{ id: 'inv_1', org_id: 'org_main', email: 'invited@x.com', role: 'member', status: 'pending', expires_at: future }],
      user: [{ id: 'usr_2', email: 'invited@x.com', org_id: 'org_other' }],
      memberCount: [{ count: 3 }],
    });
    const res = await acceptInvite(sql, { token: 't'.repeat(64), userId: 'usr_2' });
    expect(res.ok).toBe(false);
    expect(res.code).toBe(409);
    expect(sql.calls.some((c) => c.text.includes('UPDATE users'))).toBe(false);
  });
});
