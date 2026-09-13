// apps/api/tests/fixtures/sigkill-worker.ts
import { initDatabase, getDatabase } from '../../src/db/database';

async function main() {
  const barcode = process.argv[2] || 'PNL-SIGKILL-CRASH-001';

  // Initialize DB connection and schema
  await initDatabase();
  const db = getDatabase();

  // Execute an explicit transaction that performs writes and then hangs awaiting SIGKILL
  await db.withTransaction(async (tx) => {
    // Write 1: Insert panel checkout record
    await tx.execute(
      `INSERT INTO panel_checkouts (id, panel_barcode, work_center_id, batch_id, program_name, cycle_time_seconds, block_count, block_skip_count, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'pnl-sigkill-' + Date.now(),
        barcode,
        'wc-nxt-01',
        'bat-260901-01',
        'PROG-SM-METER-TOP-REV4',
        45.2,
        4,
        0,
        new Date().toISOString()
      ]
    );

    // Write 2: Insert partial unit record
    await tx.execute(
      `INSERT INTO panel_units (id, panel_barcode, unit_position, unit_serial_number, status)
       VALUES (?, ?, ?, ?, ?)`,
      ['unit-sigkill-' + Date.now(), barcode, 1, 'SN-SIGKILL-01', 'PASS']
    );

    // Signal parent that uncommitted writes are active in the database engine
    if (process.send) {
      process.send({ ready: true, barcode });
    }
    process.stdout.write(`TRANSACTION_IN_FLIGHT:${barcode}\n`);

    // Wait indefinitely awaiting OS SIGKILL from parent
    await new Promise(() => {});
  });
}

main().catch((err) => {
  console.error('[SIGKILL_WORKER_ERROR]', err);
  process.exit(1);
});
