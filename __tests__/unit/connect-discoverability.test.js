import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function readRepoFile(relativePath) {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('connect page discoverability', () => {
  it('exposes /connect in the public navbar source', () => {
    const source = readRepoFile('app/components/PublicNavbar.tsx');

    expect(source).toContain('href="/connect"');
  });

  it('exposes /connect from the self-host page source', () => {
    const source = readRepoFile('app/self-host/page.tsx');

    expect(source).toContain('href="/connect"');
  });
});
