import { describe, it, expect } from 'vitest';
import CONTEXT_GAPS from '@/lib/claude-code/rules/context-gaps.js';

function ev(name, target) { return { name, target }; }

describe('claude-code/rules/context-gaps', () => {
  it('CONTEXT_GAPS_DETECTED fires when same file is read 3+ times in opening window', () => {
    const events = [
      ev('Read', 'src/db.js'),
      ev('Read', 'src/db.js'),
      ev('Grep', 'src/db.js'),
      ev('Edit', 'src/db.js'),
    ];
    const f = CONTEXT_GAPS.inspect({ toolEvents: events });
    expect(f).toBeTruthy();
    expect(f.ruleId).toBe('CONTEXT_GAPS_DETECTED');
    expect(f.evidence.gaps[0].target).toBe('src/db.js');
    expect(f.evidence.gaps[0].earlyCount).toBe(3);
    expect(f.actionable.kind).toBe('generate_claude_md');
  });

  it('CONTEXT_GAPS_DETECTED also fires on global repeat (>=5 across full session)', () => {
    const events = [];
    for (let i = 0; i < 12; i++) events.push(ev('Bash', `step ${i}`));
    for (let i = 0; i < 5; i++) events.push(ev('Read', 'src/auth.js'));
    const f = CONTEXT_GAPS.inspect({ toolEvents: events });
    expect(f).toBeTruthy();
    const gap = f.evidence.gaps.find(g => g.target === 'src/auth.js');
    expect(gap).toBeTruthy();
    expect(gap.reason).toBe('global');
  });

  it('CONTEXT_GAPS_DETECTED does not fire on a single read or path-less Bash', () => {
    const events = [
      ev('Bash', 'ls -la'),
      ev('Bash', 'git status'),
      ev('Read', 'src/db.js'),
    ];
    expect(CONTEXT_GAPS.inspect({ toolEvents: events })).toBe(null);
  });

  it('CONTEXT_GAPS_DETECTED ignores Glob patterns without literal paths', () => {
    const events = [
      ev('Glob', '**/*.ts'),
      ev('Glob', '**/*.ts'),
      ev('Glob', '**/*.ts'),
    ];
    expect(CONTEXT_GAPS.inspect({ toolEvents: events })).toBe(null);
  });

  it('CONTEXT_GAPS_DETECTED counts Read and Grep against the same target together', () => {
    const events = [
      ev('Read', 'src/db.js'),
      ev('Grep', 'src/db.js'),
      ev('Grep', 'src/db.js'),
    ];
    const f = CONTEXT_GAPS.inspect({ toolEvents: events });
    expect(f).toBeTruthy();
    expect(f.evidence.gaps[0].earlyCount).toBe(3);
  });
});
