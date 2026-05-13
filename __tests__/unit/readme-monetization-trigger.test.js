import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const readme = readFileSync(path.resolve('README.md'), 'utf8');
const lines = readme.split('\n');

describe('README.md — MON-01 commitment (D-03 location 4)', () => {
  // The May 2026 README repositioning moved DashClaw away from Claude-Code-
  // only framing. Claude Code remains one of several integration paths but
  // is no longer in the hero. The MON-01 launch-trigger commitment (50
  // verified Claude Code integrations in the wild) is still tracked, just
  // surfaced later in the README under "Free while we grow."

  it('contains the launch-trigger commitment (50 verified Claude Code integrations)', () => {
    // The trigger phrase may be lightly reflowed; both "50 verified Claude
    // Code integrations" and "50 verified instances" with Claude Code
    // context nearby are accepted variants.
    const triggerExact = readme.includes('50 verified Claude Code integrations');
    const triggerReflowed =
      readme.includes('Claude Code integration milestone') &&
      readme.includes('50 verified');
    expect(triggerExact || triggerReflowed).toBe(true);
  });

  it('trigger appears below the hero (not in the first 50 lines)', () => {
    // The repositioning explicitly demotes Claude-Code-centric copy out of
    // the hero. The trigger commitment now lives in the "Free while we grow"
    // section further down.
    const first50 = lines.slice(0, 50).join('\n');
    expect(first50).not.toMatch(/50 verified.*claude code/i);
  });

  it('points at /pricing for progress (live counter URL)', () => {
    expect(readme).toMatch(/\/pricing/);
  });

  it('references action_records + agent_id criterion so the counter is auditable', () => {
    // The launch-trigger is measurable, not hand-waved. The README documents
    // the SQL shape so readers can independently verify progress.
    expect(readme).toMatch(/action_records/);
    expect(readme).toMatch(/agent_id\s+ILIKE\s+'claude-code/);
  });

  it('contains no paywall/buy-CTA language near the trigger paragraph', () => {
    // The trigger is a launch commitment, not a purchase prompt.
    const triggerIdx = lines.findIndex((l) =>
      /50 verified Claude Code integrations|Claude Code integration milestone/.test(l)
    );
    expect(triggerIdx).toBeGreaterThanOrEqual(0);
    const paragraph = lines.slice(Math.max(0, triggerIdx - 3), triggerIdx + 5).join('\n');
    expect(paragraph).not.toMatch(/buy now|upgrade now|subscribe|purchase|checkout|pay now/i);
  });
});
