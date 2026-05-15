import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import * as acorn from 'acorn';

const ROOT_DIR = process.cwd();
const SCRIPTS_DIR = path.resolve(ROOT_DIR, 'scripts');
const VALID_EXTENSIONS = new Set(['.js', '.mjs']);

function collectScriptFiles(dir) {
  const entries = readdirSync(dir);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      files.push(...collectScriptFiles(fullPath));
      continue;
    }

    if (stats.isFile() && VALID_EXTENSIONS.has(path.extname(fullPath))) {
      files.push(fullPath);
    }
  }

  return files;
}

function checkFileSyntax(filePath) {
  const extension = path.extname(filePath);
  // .mjs is always ESM. .js defaults to CommonJS in this repo (no
  // "type":"module" in package.json), but a handful of legacy scripts
  // were authored with `import` statements; try ESM as a fallback so
  // those don't false-positive while still catching real syntax errors.
  const primarySourceType = extension === '.mjs' ? 'module' : 'script';
  const fallbackSourceType = extension === '.mjs' ? null : 'module';

  let code;
  try {
    code = readFileSync(filePath, 'utf8');
  } catch (error) {
    return { ok: false, stderr: error.message };
  }

  const parseAs = (sourceType) => {
    try {
      acorn.parse(code, {
        ecmaVersion: 'latest',
        sourceType,
        allowHashBang: true,
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, stderr: error.message };
    }
  };

  const primary = parseAs(primarySourceType);
  if (primary.ok || !fallbackSourceType) return primary;
  const fallback = parseAs(fallbackSourceType);
  return fallback.ok ? fallback : primary;
}

const files = collectScriptFiles(SCRIPTS_DIR).sort();
const failures = [];

for (const filePath of files) {
  const result = checkFileSyntax(filePath);
  if (!result.ok) {
    failures.push({ filePath, stderr: result.stderr });
  }
}

if (failures.length > 0) {
  console.error(`Script syntax check failed (${failures.length} file${failures.length === 1 ? '' : 's'}):`);
  for (const failure of failures) {
    console.error(`\n[${path.relative(ROOT_DIR, failure.filePath)}]`);
    console.error(failure.stderr.trim());
  }
  process.exit(1);
}

console.log(`Script syntax check passed (${files.length} files).`);
