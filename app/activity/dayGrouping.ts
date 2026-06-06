// Pure client-side day-grouping helpers for /activity (CCI-04, D-13).
//
// Factored out of page.js so vitest can import without the JSX parser path.
// Page re-exports these so any consumer importing from the page continues
// to resolve (e.g. other app components).
//
// These functions are agent-agnostic. If useAgentFilter is active upstream,
// the events array fed in is already filtered — grouping does not re-apply
// any agent filter.

export function groupEventsByDay(events: any[]): any[] {
  const groups = new Map<string, any>();
  for (const evt of events) {
    const d = new Date(evt.timestamp);
    const dayKey = d.toISOString().slice(0, 10);
    if (!groups.has(dayKey)) {
      const label = d.toLocaleDateString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
      });
      groups.set(dayKey, {
        dayKey, label, events: [],
        counts: { approved: 0, denied: 0, allowed: 0, errored: 0 },
      });
    }
    const group = groups.get(dayKey);
    group.events.push(evt);
    if (evt.category === 'guard') {
      if (evt.status === 'allow') group.counts.allowed += 1;
      else if (evt.status === 'block' || evt.status === 'deny') group.counts.denied += 1;
    } else if (evt.category === 'decision') {
      if (evt.status === 'completed') group.counts.approved += 1;
      else if (evt.status === 'failed' || evt.status === 'error') group.counts.errored += 1;
    }
  }
  return Array.from(groups.values());
}

export function summarizeDay({ counts }: { counts: any }): string {
  const s = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  return `— ${s(counts.approved, 'approval')}, ${s(counts.denied, 'denial')}, `
       + `${s(counts.allowed, 'silent allow')}, ${s(counts.errored, 'error')}`;
}
