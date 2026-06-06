import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name).split('\\').join('/');
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js') && e.name !== 'validate.js') {
      const lines = readFileSync(p, 'utf8').split('\n').length;
      out.push([p, lines]);
    }
  }
  return out;
}

const files = walk('app/lib').sort((a, b) => b[1] - a[1]); // largest first
const N = 12;
const groups = Array.from({ length: N }, () => []);
const load = new Array(N).fill(0);
for (const [p, n] of files) {
  let i = 0;
  for (let k = 1; k < N; k++) if (load[k] < load[i]) i = k;
  groups[i].push(p);
  load[i] += n;
}
const total = files.reduce((s, [, n]) => s + n, 0);
console.log(`${files.length} files (excl validate.js), ${total} lines -> ${N} groups`);
groups.forEach((g, i) => console.log(`  G${i + 1}: ${g.length} files, ${load[i]} lines`));
mkdirSync('.supergoal/lib-ts', { recursive: true });
writeFileSync('.supergoal/lib-ts/groups.json', JSON.stringify(groups));
console.log('wrote .supergoal/lib-ts/groups.json');
