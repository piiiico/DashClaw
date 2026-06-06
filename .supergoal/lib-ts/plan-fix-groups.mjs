import { readFileSync, writeFileSync } from 'node:fs';

const log = readFileSync('.supergoal/lib-ts/typecheck2.log', 'utf8');
const byFile = new Map();
for (const line of log.split('\n').map((l) => l.replace(/\r$/, ''))) {
  const m = line.match(/^(app\/[^(]+)\((\d+),\d+\): (error TS\d+: .*)$/);
  if (!m) continue;
  const [, file, ln, msg] = m;
  if (!byFile.has(file)) byFile.set(file, []);
  byFile.get(file).push(`L${ln}: ${msg.slice(0, 180)}`);
}
const files = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length); // most errors first
const N = 10;
const groups = Array.from({ length: N }, () => []);
const load = new Array(N).fill(0);
for (const [file, errs] of files) {
  let i = 0;
  for (let k = 1; k < N; k++) if (load[k] < load[i]) i = k;
  groups[i].push({ file, errors: errs });
  load[i] += errs.length;
}
console.log(`${files.length} error-files, ${[...byFile.values()].reduce((s, e) => s + e.length, 0)} errors -> ${N} groups`);
groups.forEach((g, i) => console.log(`  G${i + 1}: ${g.length} files, ${load[i]} errors`));
writeFileSync('.supergoal/lib-ts/fix-groups.json', JSON.stringify(groups));
console.log('wrote .supergoal/lib-ts/fix-groups.json');
