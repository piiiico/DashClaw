import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeRequest } from '../helpers.js';

// PATCH /api/sessions/[sessionId]. updateSession() applies a terminal-state
// guard (WHERE ... AND status != 'closed') and returns null both when the
// session is missing AND when it exists but is closed. The route must
// disambiguate: a closed session is a 409 conflict, not a contradictory 404
// (GET still returns the closed session).
const h = vi.hoisted(() => ({ getSession: vi.fn(), updateSession: vi.fn() }));

vi.mock('@/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/sessions.js', () => ({ getSession: h.getSession, updateSession: h.updateSession }));

import { PATCH } from '@/api/sessions/[sessionId]/route.js';

const ctx = { params: Promise.resolve({ sessionId: 'sess_1' }) };
const req = (body) =>
  makeRequest('http://localhost/api/sessions/sess_1', { headers: { 'x-org-id': 'org_test' }, body });

describe('PATCH /api/sessions/[sessionId]', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 409 when the session exists but is closed (not a misleading 404)', async () => {
    h.updateSession.mockResolvedValue(null); // terminal-state guard matched 0 rows
    h.getSession.mockResolvedValue({ id: 'sess_1', status: 'closed' });
    const res = await PATCH(req({ status: 'active' }), ctx);
    expect(res.status).toBe(409);
    const data = await res.json();
    expect(data.error).toMatch(/closed/i);
  });

  it('returns 404 when the session truly does not exist', async () => {
    h.updateSession.mockResolvedValue(null);
    h.getSession.mockResolvedValue(null);
    const res = await PATCH(req({ status: 'active' }), ctx);
    expect(res.status).toBe(404);
  });

  it('returns 200 with the updated session on success (no existence re-check)', async () => {
    h.updateSession.mockResolvedValue({ id: 'sess_1', status: 'active' });
    const res = await PATCH(req({ status: 'active' }), ctx);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.session.status).toBe('active');
    expect(h.getSession).not.toHaveBeenCalled();
  });

  it('returns 400 when no update fields are provided', async () => {
    const res = await PATCH(req({}), ctx);
    expect(res.status).toBe(400);
    expect(h.updateSession).not.toHaveBeenCalled();
  });
});
