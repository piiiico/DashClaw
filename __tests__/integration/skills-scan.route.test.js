import { describe, it, expect, vi, beforeEach } from 'vitest';

const repo = vi.hoisted(() => ({
  getCachedScan: vi.fn(),
  upsertScan: vi.fn(),
  getScanById: vi.fn(),
}));
const scanner = vi.hoisted(() => ({
  scanSkillContent: vi.fn(),
  hashContent: vi.fn(),
}));
vi.mock('../../app/lib/repositories/skill-scan-results.repository.js', () => repo);
vi.mock('../../app/lib/skill-scanner.js', () => scanner);
vi.mock('../../app/lib/db.js', () => ({ getSql: () => ({}) }));
vi.mock('../../app/lib/org.js', () => ({ getOrgId: () => 'org_1' }));

beforeEach(() => {
  Object.values(repo).forEach((fn) => fn.mockReset());
  Object.values(scanner).forEach((fn) => fn.mockReset());
});

describe('POST /api/skills/scan', () => {
  it('returns cached result when target_hash already exists', async () => {
    scanner.hashContent.mockReturnValue('sha256:cached');
    repo.getCachedScan.mockResolvedValue({ id: 'scn_cached', findings: [], passed: true });
    const { POST } = await import('../../app/api/skills/scan/route.js');
    const res = await POST(new Request('http://test/api/skills/scan', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ skill_name: 'my-skill', files: { 'a.py': 'print("x")' } }),
    }));
    expect(res.status).toBe(200);
    expect(repo.upsertScan).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.id).toBe('scn_cached');
    expect(json.cached).toBe(true);
  });

  it('runs the scanner + persists when no cache', async () => {
    scanner.hashContent.mockReturnValue('sha256:new');
    scanner.scanSkillContent.mockReturnValue({ findings: [{ severity: 'high', rule_id: 'x' }], passed: false });
    repo.getCachedScan.mockResolvedValue(null);
    repo.upsertScan.mockResolvedValue({ id: 'scn_new', skill_name: 'my-skill', target_hash: 'sha256:new', findings: [{ severity: 'high' }], passed: false });
    const { POST } = await import('../../app/api/skills/scan/route.js');
    const res = await POST(new Request('http://test/api/skills/scan', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ skill_name: 'my-skill', files: { 'evil.py': 'whatever' } }),
    }));
    expect(res.status).toBe(200);
    expect(scanner.scanSkillContent).toHaveBeenCalled();
    expect(repo.upsertScan).toHaveBeenCalled();
    const json = await res.json();
    expect(json.passed).toBe(false);
    expect(json.cached).toBe(false);
  });

  it('returns 400 when skill_name missing', async () => {
    const { POST } = await import('../../app/api/skills/scan/route.js');
    const res = await POST(new Request('http://test/api/skills/scan', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ files: {} }),
    }));
    expect(res.status).toBe(400);
  });

  it('returns 400 when files missing or empty', async () => {
    const { POST } = await import('../../app/api/skills/scan/route.js');
    const res = await POST(new Request('http://test/api/skills/scan', {
      method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' },
      body: JSON.stringify({ skill_name: 'x' }),
    }));
    expect(res.status).toBe(400);
  });
});

describe('GET /api/skills/scans/[id]', () => {
  it('returns scan by id', async () => {
    repo.getScanById.mockResolvedValue({ id: 'scn_1', findings: [], passed: true });
    const { GET } = await import('../../app/api/skills/scans/[id]/route.js');
    const res = await GET(new Request('http://test/api/skills/scans/scn_1', { headers: { 'x-api-key': 'k' } }), {
      params: Promise.resolve({ id: 'scn_1' }),
    });
    expect(res.status).toBe(200);
  });

  it('returns 404 when not found', async () => {
    repo.getScanById.mockResolvedValue(null);
    const { GET } = await import('../../app/api/skills/scans/[id]/route.js');
    const res = await GET(new Request('http://test/api/skills/scans/scn_x', { headers: { 'x-api-key': 'k' } }), {
      params: Promise.resolve({ id: 'scn_x' }),
    });
    expect(res.status).toBe(404);
  });
});
