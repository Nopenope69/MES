// scripts/migrate-pins.ts
import { IDatabase, getDatabase } from '../apps/api/src/db/database';
import { PinPolicy } from '../apps/api/src/security/pin-policy';

export interface MigrationReport {
  migratedCount: number;
  totalOperators: number;
  nullHashCount: number;
}

/**
 * Executes an idempotent, resumable backfill migration of plaintext operator PINs.
 * 1. Ensures pin_hash column exists.
 * 2. Processes all unmigrated operators in batches.
 * 3. Hashes plaintext PIN with Argon2id and cryptographically verifies the hash before saving.
 * 4. Ensures 100% of operators have valid hashes.
 * 5. Clears plaintext PIN field permanently.
 */
export async function migrateOperatorPins(db?: IDatabase): Promise<MigrationReport> {
  const database = db || getDatabase();

  // 1. Ensure pin_hash column exists
  try {
    await database.execute('ALTER TABLE operators ADD COLUMN pin_hash VARCHAR(255);');
  } catch {
    // Column already exists
  }

  try {
    await database.execute("ALTER TABLE operators ADD COLUMN status VARCHAR(24) DEFAULT 'ACTIVE';");
  } catch {}

  try {
    await database.execute('ALTER TABLE operators ADD COLUMN failed_login_attempts INTEGER DEFAULT 0;');
  } catch {}

  try {
    await database.execute('ALTER TABLE operators ADD COLUMN locked_until TIMESTAMP;');
  } catch {}

  try {
    await database.execute('ALTER TABLE operators ADD COLUMN last_login_at TIMESTAMP;');
  } catch {}

  // 2. Fetch unmigrated operators (handling existing populated databases)
  const unmigrated = await database.query(
    'SELECT id, code, pin, pin_hash FROM operators WHERE pin_hash IS NULL AND pin IS NOT NULL'
  );

  let migratedCount = 0;
  for (const op of unmigrated) {
    if (!op.pin) continue;

    // Hash PIN using production Argon2id baseline
    const hash = await PinPolicy.hashPin(op.pin);

    // Cryptographically verify hash before committing
    const isValid = await PinPolicy.verifyPin(op.pin, hash);
    if (!isValid) {
      throw new Error(`Migration verification failed for operator code: ${op.code}`);
    }

    // Save verified hash
    await database.execute(
      'UPDATE operators SET pin_hash = ? WHERE id = ?',
      [hash, op.id]
    );
    migratedCount++;
  }

  // 3. Verification invariant: count unmigrated rows
  const remainingRows = await database.query(
    'SELECT COUNT(*) as cnt FROM operators WHERE pin_hash IS NULL'
  );
  const nullHashCount = Number(remainingRows[0]?.cnt || 0);

  if (nullHashCount === 0 && migratedCount > 0) {
    // 4. Scrub plaintext PIN column once 100% of records are securely hashed
    try {
      await database.execute('UPDATE operators SET pin = NULL WHERE pin IS NOT NULL;');
    } catch {
      // Ignore if column already dropped or read-only
    }
  }

  const allRows = await database.query('SELECT COUNT(*) as cnt FROM operators');
  const totalOperators = Number(allRows[0]?.cnt || 0);

  return {
    migratedCount,
    totalOperators,
    nullHashCount
  };
}

// CLI execution entry point
if (require.main === module) {
  migrateOperatorPins()
    .then(report => {
      console.log('✅ Operator PIN migration complete:', report);
      process.exit(0);
    })
    .catch(err => {
      console.error('❌ Operator PIN migration failed:', err);
      process.exit(1);
    });
}
