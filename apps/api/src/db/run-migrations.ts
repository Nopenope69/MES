import { MigrationRunner } from './migration-runner';
import { getDatabase } from './database';

async function main() {
  const runner = new MigrationRunner();
  console.log('[MIGRATIONS] Discovering database migration scripts...');
  const files = runner.getMigrationFiles();
  console.log(`[MIGRATIONS] Found ${files.length} migration file(s).`);

  const db = getDatabase();
  console.log('[MIGRATIONS] Executing pending migrations...');
  const summary = await runner.runPendingMigrations(db);

  console.log('[MIGRATIONS] Summary:');
  console.log(`  - Applied: ${summary.appliedCount}`);
  console.log(`  - Skipped (already applied): ${summary.skippedCount}`);
  console.log(`  - Total: ${summary.totalAvailable}`);
  if (summary.appliedMigrations.length > 0) {
    console.log('  - Newly Applied:', summary.appliedMigrations.join(', '));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[MIGRATIONS FAILED]', err);
    process.exit(1);
  });
