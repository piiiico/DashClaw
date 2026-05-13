import { describe, it, expect } from 'vitest';
import { detectRepeatedRuns } from '@/lib/claude-code/repeated-runs.js';

describe('claude-code/repeated-runs', () => {
  it('single-request batch is LOW confidence (not a stuck loop)', () => {
    const events = [
      { name: 'TaskCreate', requestId: 'R1' },
      { name: 'TaskCreate', requestId: 'R1' },
      { name: 'TaskCreate', requestId: 'R1' },
      { name: 'TaskCreate', requestId: 'R1' },
    ];
    const runs = detectRepeatedRuns(events);
    expect(runs.length).toBe(1);
    expect(runs[0].confidence).toBe('low');
    expect(runs[0].allInOneRequest).toBe(true);
    expect(runs[0].evidence).toMatch(/single model request/);
  });

  it('same tool, same target, across 3+ distinct requests is HIGH confidence', () => {
    const events = [
      { name: 'Read', requestId: 'R1', target: 'app.js' },
      { name: 'Read', requestId: 'R2', target: 'app.js' },
      { name: 'Read', requestId: 'R3', target: 'app.js' },
      { name: 'Read', requestId: 'R4', target: 'app.js' },
    ];
    const runs = detectRepeatedRuns(events);
    expect(runs.length).toBe(1);
    expect(runs[0].confidence).toBe('high');
    expect(runs[0].requestSpread).toBe(4);
  });

  it('same tool across 2 requests with different targets is MEDIUM confidence', () => {
    const events = [
      { name: 'Edit', requestId: 'R1', target: 'a.js' },
      { name: 'Edit', requestId: 'R2', target: 'b.js' },
      { name: 'Edit', requestId: 'R2', target: 'c.js' },
    ];
    const runs = detectRepeatedRuns(events);
    expect(runs.length).toBe(1);
    expect(runs[0].confidence).toBe('medium');
    expect(runs[0].targetSpread).toBeGreaterThanOrEqual(2);
  });

  it('run shorter than threshold does not fire', () => {
    const events = [
      { name: 'Read', requestId: 'R1' },
      { name: 'Read', requestId: 'R2' },
      { name: 'Edit', requestId: 'R3' },
    ];
    expect(detectRepeatedRuns(events)).toEqual([]);
  });

  it('events without request_id default to LOW confidence', () => {
    const events = [
      { name: 'Write' }, { name: 'Write' }, { name: 'Write' },
    ];
    const runs = detectRepeatedRuns(events);
    expect(runs.length).toBe(1);
    expect(runs[0].confidence).toBe('low');
  });
});
