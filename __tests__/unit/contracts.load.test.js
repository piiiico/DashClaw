import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadContracts } from '../../scripts/lib/contracts/load-contracts.mjs';

/**
 * Drift-proof contracts loader test.
 *
 * Earlier versions of this test hardcoded the SDK version string
 * (e.g. `.toBe('2.11.1')`) and went red every time
 * contracts/sdk/release-plan.json was bumped without a matching test
 * update. Most recently the 2.11.1 -> 2.12.0 bump in commit 97b319d6
 * landed on main without the test update and CI was red until a
 * follow-up commit caught up.
 *
 * The fix is to verify the loader against the raw JSON files instead
 * of pinning a literal version. A version bump now passes
 * automatically because both sides of the comparison move together.
 * Tests still fail loudly if:
 *   - The loader stops parsing a file or reads the wrong path.
 *   - A version string drops the semver shape.
 *   - The release-plan structure changes (missing node/python entry,
 *     missing current_version, etc.) without a deliberate test update.
 */

const SEMVER = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

describe('loadContracts', () => {
  it('loads the contract index and resolves domain manifests', async () => {
    const root = process.cwd();
    const contracts = await loadContracts(root);

    // Index shape
    expect(contracts.index.version).toBe(1);

    // Domain manifests resolve to the values their relative paths point at
    expect(contracts.api.capabilities.domain).toBe('capabilities');
    expect(contracts.schema['action-records'].table).toBe('action_records');
    expect(contracts.setup['runtime-env-prerequisites'].owner).toBe('app/lib/setup/runtime-env-prerequisites.mjs');
    expect(contracts.setup['runtime-prerequisites'].owner).toBe('app/lib/setup/runtime-prerequisites.mjs');
    expect(contracts.setup['runtime-migration'].owner).toBe('app/api/setup/migrate/route.js');
  });

  it('release-plan loads the same content the raw JSON file contains', async () => {
    // Read the same file the loader reads, by going through the index.
    const root = process.cwd();
    const index = JSON.parse(await readFile(path.join(root, 'contracts/index.json'), 'utf8'));
    const releasePlanPath = index?.sdk?.['release-plan'];
    expect(releasePlanPath, 'contracts/index.json must reference release-plan').toBeTypeOf('string');

    const rawReleasePlan = JSON.parse(await readFile(path.join(root, releasePlanPath), 'utf8'));
    const contracts = await loadContracts(root);

    // The loaded value must equal the raw JSON. Catches any future
    // bug where the loader silently drops keys, returns a cached copy,
    // or routes the path through a transform.
    expect(contracts.sdk['release-plan']).toEqual(rawReleasePlan);
  });

  it('release-plan has the expected shape and semver-shaped versions', async () => {
    // Validate the shape directly so a malformed release-plan.json is
    // caught here rather than at a later integration point. Does not
    // pin specific version numbers.
    const root = process.cwd();
    const contracts = await loadContracts(root);
    const plan = contracts.sdk['release-plan'];

    for (const language of ['node', 'python']) {
      expect(plan[language], `${language} entry must exist`).toBeTypeOf('object');
      expect(plan[language].current_version, `${language}.current_version must be a string`).toBeTypeOf('string');
      expect(plan[language].current_version, `${language}.current_version must be semver-shaped`).toMatch(SEMVER);
      expect(plan[language].next_bump, `${language}.next_bump must be set`).toBeTypeOf('string');
      expect(plan[language].reason, `${language}.reason must be set`).toBeTypeOf('string');
    }
  });
});
