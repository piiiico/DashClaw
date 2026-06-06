import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  CORE_SETUP_TABLES,
  SETUP_MIGRATION_SCRIPTS,
  SETUP_READINESS_MIGRATION_SCRIPTS,
} from '../../../app/lib/setup/runtime-prerequisites.mjs';

const CONSUMER_EXPECTATIONS = {
  setup_script: [
    '../app/lib/setup/runtime-prerequisites.mjs',
    'SETUP_MIGRATION_SCRIPTS',
    'buildSetupMigrationCommands',
  ],
  schema_check: [
    './setup/runtime-prerequisites.mjs',
    'CORE_SETUP_TABLES',
    'getSetupMigrationCommand',
  ],
  readiness_workflow: [
    '../setup/runtime-prerequisites.mjs',
    'SETUP_READINESS_MIGRATION_SCRIPTS',
    'buildSetupMigrationCommands',
  ],
};

function sameList(left = [], right = []) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function loadConsumerSources(rootDir, consumers = {}) {
  const entries = Object.entries(consumers);
  const sources = {};

  await Promise.all(entries.map(async ([name, relativePath]) => {
    const full = path.join(rootDir, relativePath);
    let source;
    try {
      source = await readFile(full, 'utf8');
    } catch (err) {
      // TypeScript migration: a consumer source listed with a .js path may now
      // be .ts. Node's readFile has no extensionAlias (unlike webpack/tsc), so
      // fall back to the .ts file before failing.
      if (err?.code === 'ENOENT' && full.endsWith('.js')) {
        source = await readFile(full.replace(/\.js$/, '.ts'), 'utf8');
      } else {
        throw err;
      }
    }
    sources[name] = source;
  }));

  return sources;
}

export async function checkSetupPrerequisites(contracts, runtimeSetup = null, rootDir = process.cwd()) {
  const findings = [];
  const setupContract = contracts.setup['runtime-prerequisites'];
  const runtime = runtimeSetup || {
    migrationScripts: SETUP_MIGRATION_SCRIPTS,
    readinessMigrationScripts: SETUP_READINESS_MIGRATION_SCRIPTS,
    coreTables: CORE_SETUP_TABLES,
    consumers: await loadConsumerSources(rootDir, setupContract?.consumers),
  };

  if (!sameList(setupContract?.migration_scripts, runtime.migrationScripts)) {
    findings.push({
      code: 'setup_migration_contract_drift',
      message: 'shared setup migration inventory does not match contracts/setup/runtime-prerequisites.json',
    });
  }

  if (!sameList(setupContract?.readiness_migration_scripts, runtime.readinessMigrationScripts)) {
    findings.push({
      code: 'setup_readiness_contract_drift',
      message: 'shared readiness migration inventory does not match contracts/setup/runtime-prerequisites.json',
    });
  }

  if (!sameList(setupContract?.core_tables, runtime.coreTables)) {
    findings.push({
      code: 'setup_core_tables_contract_drift',
      message: 'shared core setup tables do not match contracts/setup/runtime-prerequisites.json',
    });
  }

  for (const [consumerName, source] of Object.entries(runtime.consumers || {})) {
    const requiredTokens = CONSUMER_EXPECTATIONS[consumerName] || [];
    const missingToken = requiredTokens.find((token) => !source.includes(token));
    if (missingToken) {
      findings.push({
        code: 'setup_consumer_not_using_shared_prerequisites',
        message: `${consumerName} is missing shared setup prerequisite token ${missingToken}`,
      });
    }
  }

  return { ok: findings.length === 0, findings };
}

