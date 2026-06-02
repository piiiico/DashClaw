import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRequest } from '../helpers.js';
import { generateSigningKey } from '../../app/lib/integrity/keys.js';
import { verifyBundle } from '../../app/lib/integrity/bundle.js';

const KEY = generateSigningKey('export-test-kid');

const {
  mockSql, mockLoadFramework, mockMapPolicies, mockGetActivePolicies, mockConvertPolicies,
  mockGenMd, mockAnalyzeGaps, mockCreateSnapshot, mockGetGuardEvidence, mockGetActionEvidence,
} = vi.hoisted(() => ({
  mockSql: Object.assign(vi.fn(async () => []), { query: vi.fn(async () => []) }),
  mockLoadFramework: vi.fn(),
  mockMapPolicies: vi.fn(),
  mockGetActivePolicies: vi.fn(),
  mockConvertPolicies: vi.fn(),
  mockGenMd: vi.fn(),
  mockAnalyzeGaps: vi.fn(),
  mockCreateSnapshot: vi.fn(),
  mockGetGuardEvidence: vi.fn(),
  mockGetActionEvidence: vi.fn(),
}));

vi.mock('@/lib/db.js', () => ({ getSql: () => mockSql }));
vi.mock('@/lib/org.js', () => ({ getOrgId: () => 'org_test' }));
vi.mock('@/lib/compliance/mapper.js', () => ({ mapPolicies: mockMapPolicies, loadFramework: mockLoadFramework, listFrameworks: vi.fn() }));
vi.mock('@/lib/repositories/guardrails.repository.js', () => ({ getActivePolicies: mockGetActivePolicies }));
vi.mock('@/lib/guardrails/converter.js', () => ({ convertPolicies: mockConvertPolicies }));
vi.mock('@/lib/compliance/reporter.js', () => ({ generateMarkdownReport: mockGenMd, generateJsonReport: vi.fn() }));
vi.mock('@/lib/compliance/analyzer.js', () => ({ analyzeGaps: mockAnalyzeGaps }));
vi.mock('@/lib/repositories/compliance.repository.js', () => ({
  createSnapshot: mockCreateSnapshot,
  listSnapshots: vi.fn(async () => []),
  getGuardDecisionEvidence: mockGetGuardEvidence,
  getActionRecordEvidence: mockGetActionEvidence,
}));
vi.mock('@/lib/integrity/server-key.js', () => ({
  getServerSigningKey: vi.fn(async () => ({ kid: KEY.kid, privateKeyJwk: KEY.privateKeyJwk, publicKeyJwk: KEY.publicKeyJwk, source: 'db' })),
  getServerPublicJwks: vi.fn(async () => ({ keys: [KEY.publicKeyJwk] })),
}));

import { generateExport } from '@/lib/compliance/exporter.js';

const EXPORT_RECORD = {
  id: 'ce_1', org_id: 'org_test', name: 'Test', frameworks: '["soc2"]', format: 'markdown',
  window_days: 30, include_evidence: true, include_remediation: false, include_trends: false,
};

// Scan every persisted SQL value for the signed bundle written to report_content.
function findCompletedReportContent() {
  for (const c of mockSql.mock.calls) {
    for (let i = 1; i < c.length; i++) {
      const v = c[i];
      if (typeof v === 'string' && v.startsWith('{')) {
        try {
          const parsed = JSON.parse(v);
          if (parsed.version === 'dashclaw-compliance-bundle/v1' && parsed.signature && parsed.payload) return parsed;
        } catch { /* not the bundle */ }
      }
    }
  }
  return null;
}

describe('generateExport — signed compliance bundle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = 'postgres://unit-test';
    mockSql.mockImplementation(async () => []);
    mockSql.mockResolvedValueOnce([EXPORT_RECORD]); // first SELECT returns the export record
    mockLoadFramework.mockReturnValue({ id: 'soc2', name: 'SOC 2' });
    mockMapPolicies.mockReturnValue({ summary: { total_controls: 10, covered: 8, partial: 1, gaps: 1, coverage_percentage: 80 } });
    mockAnalyzeGaps.mockReturnValue({ remediation_plan: [], summary: { estimated_total_effort: '0h' }, risk_assessment: { overall_risk: 'LOW' } });
    mockGenMd.mockReturnValue('# SOC 2 Report\n\nbody');
    mockGetActivePolicies.mockResolvedValue([]);
    mockConvertPolicies.mockReturnValue({});
    mockGetGuardEvidence.mockResolvedValue([]);
    mockGetActionEvidence.mockResolvedValue([]);
    mockCreateSnapshot.mockResolvedValue({});
  });

  it('stores a signed bundle in report_content (not plain markdown) that re-verifies', async () => {
    const res = await generateExport(makeRequest('http://localhost/api/compliance/exports', {}), 'ce_1');
    expect(res.status).toBe('completed');

    const bundle = findCompletedReportContent();
    expect(bundle).toBeTruthy();
    expect(bundle.version).toBe('dashclaw-compliance-bundle/v1');
    // The human-readable report lives inside the signed payload, not as bare markdown.
    expect(JSON.stringify(bundle.payload)).toContain('SOC 2 Report');
    // Independently re-verifiable against the published key.
    expect(verifyBundle(bundle, [KEY.publicKeyJwk]).ok).toBe(true);
  });

  it('binds the payload: tampering the report sections breaks verification', async () => {
    await generateExport(makeRequest('http://localhost/api/compliance/exports', {}), 'ce_1');
    const bundle = findCompletedReportContent();
    expect(bundle).toBeTruthy();
    bundle.payload.sections = ['# TAMPERED'];
    expect(verifyBundle(bundle, [KEY.publicKeyJwk]).ok).toBe(false);
  });
});
