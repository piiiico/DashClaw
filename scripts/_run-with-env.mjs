import { execFileSync } from 'child_process';
import './_load-env.mjs';

const script = process.argv[2];
if (!script) {
  console.error('Usage: node scripts/_run-with-env.mjs <script>');
  process.exit(1);
}
const extraArgs = process.argv.slice(3);
// Run under tsx so scripts importing app/lib modules resolve `.js` specifiers
// to the migrated `.ts` files (Node has no extensionAlias; webpack/tsc/vitest do).
execFileSync('node', ['--import', 'tsx', script, ...extraArgs], { stdio: 'inherit', env: process.env });
