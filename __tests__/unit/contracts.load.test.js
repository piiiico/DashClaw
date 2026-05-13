import { describe, expect, it } from 'vitest';
import { loadContracts } from '../../scripts/lib/contracts/load-contracts.mjs';

describe('loadContracts', () => {
  it('loads the contract index and resolves domain manifests', async () => {
    const contracts = await loadContracts(process.cwd());

    expect(contracts.index.version).toBe(1);
    expect(contracts.api.capabilities.domain).toBe('capabilities');
    expect(contracts.schema['action-records'].table).toBe('action_records');
    expect(contracts.setup['runtime-env-prerequisites'].owner).toBe('app/lib/setup/runtime-env-prerequisites.mjs');
    expect(contracts.setup['runtime-prerequisites'].owner).toBe('app/lib/setup/runtime-prerequisites.mjs');
    expect(contracts.setup['runtime-migration'].owner).toBe('app/api/setup/migrate/route.js');
    expect(contracts.sdk['release-plan'].node.current_version).toBe('2.12.0');
  });
});
