import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { initDatabase, getDatabase, IDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { ComplianceLedgerService } from '../src/services/compliance-ledger.service';
import { RequestContext } from '../src/types/context';

describe('Resilience & Mid-Transaction Kill Verification Suite (Stage 4 / Gate G-11)', () => {
  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = ':memory:';
    await initDatabase();
  });

  beforeEach(async () => {
    await seedDatabase();
  });

  it('1. Real OS SIGKILL Mid-Transaction: process terminated via SIGKILL guarantees zero partial writes and clean WAL rollback', async () => {
    const fs = await import('fs');
    const os = await import('os');
    const path = await import('path');
    const { spawn } = await import('child_process');

    const testPanelBarcode = 'PNL-REAL-SIGKILL-' + Date.now();
    const workerScript = path.resolve(__dirname, 'fixtures/sigkill-worker.ts');
    const tsxCli = path.resolve(__dirname, '../../../node_modules/tsx/dist/cli.mjs');

    // Create a dedicated disk-backed SQLite database (or use DATABASE_URL if Postgres)
    const isPostgres = Boolean(process.env.DATABASE_URL && process.env.DATABASE_URL.startsWith('postgres'));
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mes-sigkill-test-'));
    const testDbPath = path.join(tempDir, 'sigkill-journal-test.db');

    const workerEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      SQLITE_DB_PATH: isPostgres ? undefined : testDbPath,
      DATABASE_URL: isPostgres ? process.env.DATABASE_URL : undefined
    };

    // Pre-initialize SQLite WAL mode
    if (!isPostgres) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteModule = require('node:sqlite');
      const seedDb = new sqliteModule.DatabaseSync(testDbPath);
      seedDb.exec('PRAGMA journal_mode = WAL;');
      seedDb.close();
    }

    // Spawn child worker process
    const child = spawn(process.execPath, [tsxCli, workerScript, testPanelBarcode], {
      env: workerEnv,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc']
    });

    let stdoutData = '';
    let stderrData = '';
    const inFlightPromise = new Promise<void>((resolve, reject) => {
      child.stdout?.on('data', (chunk) => {
        stdoutData += chunk.toString();
        if (stdoutData.includes('TRANSACTION_IN_FLIGHT')) {
          resolve();
        }
      });
      child.stderr?.on('data', (chunk) => {
        stderrData += chunk.toString();
      });
      child.on('error', reject);
      child.on('exit', (code, sig) => {
        if (!stdoutData.includes('TRANSACTION_IN_FLIGHT')) {
          reject(new Error(`Worker exited prematurely before in-flight write (code=${code}, sig=${sig}). Stderr: ${stderrData}`));
        }
      });
    });

    // Wait for the worker to execute uncommitted writes
    await inFlightPromise;

    // Send SIGKILL (Signal 9) - abrupt kernel termination with NO JS cleanup or finally blocks
    const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
      child.on('exit', (code, signal) => resolve({ code, signal }));
    });

    child.kill('SIGKILL');
    const exitResult = await exitPromise;

    // Verify process was killed by SIGKILL
    expect(exitResult.signal).toBe('SIGKILL');

    // Allow OS kernel to finalize releasing POSIX file descriptor locks
    await new Promise((r) => setTimeout(r, 100));

    // Now open a fresh database connection to verify WAL recovery / rollback
    if (isPostgres) {
      const db = getDatabase();
      const rows = await db.query('SELECT * FROM panel_checkouts WHERE panel_barcode = ?', [testPanelBarcode]);
      expect(rows.length).toBe(0);
      const unitRows = await db.query('SELECT * FROM panel_units WHERE panel_barcode = ?', [testPanelBarcode]);
      expect(unitRows.length).toBe(0);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const sqliteModule = require('node:sqlite');
      const verifyDb = new sqliteModule.DatabaseSync(testDbPath);
      verifyDb.exec('PRAGMA busy_timeout = 5000;');
      // Run integrity check on database
      const integrityRows = verifyDb.prepare('PRAGMA integrity_check;').all() as any[];
      expect(integrityRows[0].integrity_check).toBe('ok');

      // Verify zero partial rows exist
      const panelRows = verifyDb.prepare('SELECT * FROM panel_checkouts WHERE panel_barcode = ?').all(testPanelBarcode);
      expect(panelRows.length).toBe(0);

      const unitRows = verifyDb.prepare('SELECT * FROM panel_units WHERE panel_barcode = ?').all(testPanelBarcode);
      expect(unitRows.length).toBe(0);

      verifyDb.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('2. In-Process Exception Abrupt Failure: application-level exception triggers complete rollback', async () => {
    const db = getDatabase();
    const testPanelBarcode = 'PNL-RESILIENCE-TEST-001';

    // Verify clean baseline
    const initialRows = await db.query('SELECT * FROM panel_checkouts WHERE panel_barcode = ?', [testPanelBarcode]);
    expect(initialRows.length).toBe(0);

    // Execute transaction that fails abruptly halfway through
    let errorCaught = false;
    try {
      await db.withTransaction(async (tx: IDatabase) => {
        // Step 1: Insert panel checkout
        await tx.execute(
          `INSERT INTO panel_checkouts (id, panel_barcode, work_center_id, batch_id, program_name, cycle_time_seconds, block_count, block_skip_count, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ['pnl-res-01', testPanelBarcode, 'wc-nxt-01', 'bat-260901-01', 'PROG-SM-METER-TOP-REV4', 45.2, 4, 0, new Date().toISOString()]
        );

        // Step 2: Insert unit
        await tx.execute(
          `INSERT INTO panel_units (id, panel_barcode, unit_position, unit_serial_number, status)
           VALUES (?, ?, ?, ?, ?)`,
          ['unit-res-01', testPanelBarcode, 1, 'SN-RES-01', 'PASS']
        );

        // Step 3: Simulate abrupt application exception mid-transaction
        throw new Error('APPLICATION_EXCEPTION_MID_TRANSACTION');
      });
    } catch (err: any) {
      if (err.message === 'APPLICATION_EXCEPTION_MID_TRANSACTION') {
        errorCaught = true;
      } else {
        throw err;
      }
    }

    expect(errorCaught).toBe(true);

    // Verify zero partial writes: Neither panel checkout nor panel units exist
    const postPanels = await db.query('SELECT * FROM panel_checkouts WHERE panel_barcode = ?', [testPanelBarcode]);
    expect(postPanels.length).toBe(0);

    const postUnits = await db.query('SELECT * FROM panel_units WHERE panel_barcode = ?', [testPanelBarcode]);
    expect(postUnits.length).toBe(0);
  });

  it('2. Hash Ledger Integrity: mid-write crash preserves strict 21 CFR Part 11 unbroken chain', async () => {
    const db = getDatabase();

    const mockAdminContext: RequestContext = {
      principal: {
        id: 'sys-admin-01',
        role: 'SYSTEM_ADMIN',
        organizationId: 'org-apex',
        siteId: 'site-noida-p4',
        authzVersion: 1
      },
      audit: {
        ip: '127.0.0.1',
        userAgent: 'resilience-test-agent',
        requestId: 'req-res-01',
        clientTimestamp: new Date().toISOString()
      },
      scope: {
        organizationId: 'org-apex',
        siteId: 'site-noida-p4'
      }
    };

    // 2.1 Append initial valid signature
    const block1 = await ComplianceLedgerService.recordSignature(
      {
        actionType: 'CALIBRATION_CHECK',
        entityType: 'EQUIPMENT',
        entityId: 'eq-nxt-01',
        meaning: 'Equipment pre-shift calibration certified',
        reason: 'Shift startup inspection',
        signingPin: '9999'
      },
      mockAdminContext
    );

    expect(block1.sequenceNumber).toBeGreaterThan(0);
    expect(block1.currentHash).toBeDefined();

    // Verify integrity is valid
    let integrityCheck = await ComplianceLedgerService.verifyLedgerIntegrity();
    expect(integrityCheck.valid).toBe(true);

    // 2.2 Attempt a transaction that writes to compliance ledger and then fails
    let txFailed = false;
    try {
      await db.withTransaction(async (tx: IDatabase) => {
        // Compute next sequence
        const rows = await tx.query<any>('SELECT sequence_number, current_hash FROM compliance_audit_ledger ORDER BY sequence_number DESC LIMIT 1');
        const nextSeq = Number(rows[0].sequence_number) + 1;
        const prevHash = rows[0].current_hash;

        // Write a corrupted/partial entry directly
        await tx.execute(
          `INSERT INTO compliance_audit_ledger (
            id, sequence_number, previous_hash, current_hash, actor_id, actor_role, action_type,
            meaning, entity_type, entity_id, metadata_json, signed_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            'corrupt-block-id',
            nextSeq,
            prevHash,
            'bogus-uncalculated-hash',
            'actor-x',
            'OPERATOR',
            'TAMPER',
            'Tampered action',
            'DHR',
            'dhr-01',
            '{}',
            new Date().toISOString()
          ]
        );

        // Abrupt termination
        throw new Error('SIMULATED_DB_CONN_DROP_MID_LEDGER_WRITE');
      });
    } catch (err: any) {
      if (err.message === 'SIMULATED_DB_CONN_DROP_MID_LEDGER_WRITE') {
        txFailed = true;
      } else {
        throw err;
      }
    }

    expect(txFailed).toBe(true);

    // 2.3 Verify corrupt block was NOT committed
    const corruptRow = await db.query('SELECT * FROM compliance_audit_ledger WHERE id = ?', ['corrupt-block-id']);
    expect(corruptRow.length).toBe(0);

    // 2.4 Verify ledger integrity remains 100% valid
    integrityCheck = await ComplianceLedgerService.verifyLedgerIntegrity();
    expect(integrityCheck.valid).toBe(true);

    // 2.5 Verify subsequent valid block cleanly appends and links to block1
    const block2 = await ComplianceLedgerService.recordSignature(
      {
        actionType: 'BATCH_RELEASE',
        entityType: 'WORK_ORDER',
        entityId: 'wo-res-01',
        meaning: 'Batch release authorized under SOP-QA-04',
        reason: 'Post-recovery verification pass',
        signingPin: '9999'
      },
      mockAdminContext
    );

    expect(block2.sequenceNumber).toBe(block1.sequenceNumber + 1);
    expect(block2.previousHash).toBe(block1.currentHash);

    // Final ledger integrity check
    const finalIntegrity = await ComplianceLedgerService.verifyLedgerIntegrity();
    expect(finalIntegrity.valid).toBe(true);
  });

  it('3. Line Hold & Interlock Lockout: mid-transaction crash leaves zero orphaned locks', async () => {
    const db = getDatabase();
    const lineId = 'line-smt-01';

    // Verify line starts in RUNNING state
    const lineRows = await db.query<any>('SELECT status FROM production_lines WHERE id = ?', [lineId]);
    expect(lineRows[0].status).toBe('RUNNING');

    // Simulate an interrupted hold acknowledgment
    let ackFailed = false;
    try {
      await db.withTransaction(async (tx: IDatabase) => {
        // Step 1: Temporarily trip line to HOLD_ACTIVE
        await tx.execute("UPDATE production_lines SET status = 'HOLD_ACTIVE' WHERE id = ?", [lineId]);

        // Step 2: Crash before completing the supervisor transaction
        throw new Error('SIMULATED_CRASH_DURING_HOLD_INTERLOCK');
      });
    } catch (err: any) {
      if (err.message === 'SIMULATED_CRASH_DURING_HOLD_INTERLOCK') {
        ackFailed = true;
      }
    }

    expect(ackFailed).toBe(true);

    // Line status must be rolled back to RUNNING (zero orphaned locks)
    const postRows = await db.query<any>('SELECT status FROM production_lines WHERE id = ?', [lineId]);
    expect(postRows[0].status).toBe('RUNNING');
  });

  it('4. Idempotency & Repeat Write Immunity: duplicate payloads prevent duplicate records', async () => {
    const db = getDatabase();
    const reelId = 'REEL-IDEMPOTENCY-TEST-001';

    // Insert an initial reel
    await db.execute(
      `INSERT INTO component_reels (
        id, reel_id, part_number, part_name, supplier_name, lot_number,
        date_code, initial_quantity, current_quantity, unit, msl_level,
        msl_class, msl_remaining_minutes, storage_location, storage_state,
        floor_clock_state, floor_life_nominal_minutes, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'reel-idem-01', reelId, 'PN-100-CAP', '100nF Cap', 'Murata', 'LOT-01',
        '202612', 10000, 10000, 'PCS', 1, 'MSL_1', 999999, 'WAREHOUSE',
        'SEALED_MBB', 'SEALED', 999999, 'READY'
      ]
    );

    // Execute idempotent check: second insert with duplicate reel_id should fail unique constraint cleanly
    let constraintViolated = false;
    try {
      await db.execute(
        `INSERT INTO component_reels (
          id, reel_id, part_number, part_name, supplier_name, lot_number,
          date_code, initial_quantity, current_quantity, unit, msl_level,
          msl_class, msl_remaining_minutes, storage_location, storage_state,
          floor_clock_state, floor_life_nominal_minutes, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'reel-idem-02', reelId, 'PN-100-CAP', '100nF Cap', 'Murata', 'LOT-01',
          '202612', 10000, 10000, 'PCS', 1, 'MSL_1', 999999, 'WAREHOUSE',
          'SEALED_MBB', 'SEALED', 999999, 'READY'
        ]
      );
    } catch {
      constraintViolated = true;
    }

    expect(constraintViolated).toBe(true);

    // Ensure only 1 record exists
    const reels = await db.query('SELECT * FROM component_reels WHERE reel_id = ?', [reelId]);
    expect(reels.length).toBe(1);
  });
});
