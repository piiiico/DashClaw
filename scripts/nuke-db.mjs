import { createSqlFromEnv } from './_db.mjs';
import readline from 'node:readline';

// Fail loud — destructive script must surface async rejections.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const sql = createSqlFromEnv();

async function confirm() {
  // Skip the prompt when --yes is passed (CI / scripted runs); otherwise
  // require the operator to type NUKE so a paste-into-wrong-terminal can't
  // wipe a real database.
  if (process.argv.includes('--yes')) return true;
  if (!process.stdin.isTTY) {
    console.error('Refusing to nuke: stdin is not a TTY and --yes was not passed.');
    return false;
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question('Type NUKE to drop every table in the connected database: ', (answer) => {
      rl.close();
      resolve(answer.trim() === 'NUKE');
    });
  });
}

async function nuke() {
  console.log('☢️  NUKING DATABASE...');
  console.log('    (This will delete ALL data in the connected database)');

  if (!(await confirm())) {
    console.log('Aborted.');
    process.exit(1);
  }

  try {
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_type = 'BASE TABLE'
    `;

    if (tables.length === 0) {
      console.log('✅ No tables found. Database is already clean.');
      process.exit(0);
    }

    console.log(`Found ${tables.length} tables. Dropping...`);

    for (const t of tables) {
      console.log(`   Dropping ${t.table_name}...`);
      await sql.unsafe(`DROP TABLE IF EXISTS "${t.table_name}" CASCADE`);
    }

    console.log('✅ Database nuked successfully.');
    process.exit(0);
  } catch (err) {
    // Exit non-zero so callers (CI, wrappers) can detect the failure —
    // the previous `finally { process.exit(0) }` masked every error.
    console.error('❌ Error nuking database:', err);
    process.exit(1);
  }
}

nuke();
