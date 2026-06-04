#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Discover ALL test_*.py under sdk-python/tests (not just the ws5 parity set).
// All currently pass offline; keeping the net wide so new SDK tests gate by default.
const testArgs = ['-m', 'unittest', 'discover', '-s', 'sdk-python/tests', '-p', 'test_*.py'];

function isWindows() {
  return process.platform === 'win32';
}

function getCandidates() {
  const out = [];
  if (process.env.PYTHON && process.env.PYTHON.trim()) {
    out.push({ cmd: process.env.PYTHON.trim(), args: [] });
  }

  if (isWindows()) {
    const miniconda = 'C:\\ProgramData\\miniconda3\\python.exe';
    if (fs.existsSync(miniconda)) {
      out.push({ cmd: miniconda, args: [] });
    }

    out.push({ cmd: 'py', args: ['-3'] });
    out.push({ cmd: 'python', args: [] });
  } else {
    out.push({ cmd: 'python3', args: [] });
    out.push({ cmd: 'python', args: [] });
  }

  return out;
}

function tryRun(cmd, args) {
  const pythonPathEntries = [path.join(process.cwd(), 'sdk-python')];
  if (process.env.PYTHONPATH) {
    pythonPathEntries.push(process.env.PYTHONPATH);
  }

  const result = spawnSync(cmd, [...args, ...testArgs], {
    stdio: 'inherit',
    shell: false,
    env: {
      ...process.env,
      PYTHONPATH: pythonPathEntries.join(path.delimiter),
    },
  });

  if (typeof result.status === 'number') {
    return result.status;
  }
  return null;
}

function main() {
  const candidates = getCandidates();

  for (const candidate of candidates) {
    const status = tryRun(candidate.cmd, candidate.args);
    if (status === 0) return;
  }

  console.error('Unable to run Python unittest harness with available interpreters.');
  console.error('Set PYTHON to a valid interpreter path and retry.');
  process.exit(1);
}

main();
