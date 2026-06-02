import { describe, expect, it } from 'vitest';
import { deriveAssumptionStatus, ASSUMPTION_FILTER_OPTIONS } from '../../app/lib/assumptions-status.js';

// Regression coverage for the assumptions page reading a nonexistent string
// `status` field. The /api/assumptions response returns integer `validated`
// and `invalidated` columns only.
describe('deriveAssumptionStatus', () => {
  it('maps the integer validated column to "validated"', () => {
    expect(deriveAssumptionStatus({ validated: 1, invalidated: 0 })).toBe('validated');
  });

  it('maps the integer invalidated column to "invalidated"', () => {
    expect(deriveAssumptionStatus({ validated: 0, invalidated: 1 })).toBe('invalidated');
  });

  it('treats unvalidated rows (and missing rows) as "pending"', () => {
    expect(deriveAssumptionStatus({ validated: 0, invalidated: 0 })).toBe('pending');
    expect(deriveAssumptionStatus({})).toBe('pending');
    expect(deriveAssumptionStatus(null)).toBe('pending');
  });

  it('does NOT read a nonexistent string `status` field', () => {
    // The API never returns `status`; a stray value must not influence the result.
    expect(deriveAssumptionStatus({ status: 'validated', validated: 0, invalidated: 0 })).toBe('pending');
  });

  it('exposes filter options whose values are derivable statuses', () => {
    const values = ASSUMPTION_FILTER_OPTIONS.map((o) => o.value);
    expect(values).toContain('all');
    expect(values).toEqual(expect.arrayContaining(['validated', 'invalidated', 'pending']));
  });
});
