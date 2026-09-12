// apps/api/tests/disaster-recovery.test.ts
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { DrVerificationService } from '../src/services/dr-verification.service';
import { ComplianceLedgerService } from '../src/services/compliance-ledger.service';

describe('Disaster Recovery Verification & Retention Suite (Task 8)', () => {
  let testDataDir: string;
  let testManifestPath: string;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    // Create a sandbox managed artifact directory for tests
    testDataDir = path.resolve(process.cwd(), 'scratch/test-dr-data');
    fs.mkdirSync(path.join(testDataDir, 'dhr'), { recursive: true });
    fs.mkdirSync(path.join(testDataDir, 'reflow'), { recursive: true });
    fs.mkdirSync(path.join(testDataDir, 'inspection'), { recursive: true });

    // Seed test managed evidence files
    const dhrFile = path.join(testDataDir, 'dhr/dhr-lot-202609-001.pdf');
    fs.writeFileSync(dhrFile, 'DHR_BINARY_CONTENT_SIMULATION_VERSION_1');

    const reflowFile = path.join(testDataDir, 'reflow/profile-run-902.kic');
    fs.writeFileSync(reflowFile, 'REFLOW_THERMAL_PROBE_TIME_SERIES_DATA');

    const dhrHash = crypto.createHash('sha256').update(fs.readFileSync(dhrFile)).digest('hex');
    const reflowHash = crypto.createHash('sha256').update(fs.readFileSync(reflowFile)).digest('hex');

    // Create valid manifest.json
    const manifest = {
      backup_id: 'mes-recovery-test-fixture',
      drill_version: '1.0.0',
      backup_timestamp: new Date().toISOString(),
      database: {
        file: 'database.sqlite',
        sha256: crypto.createHash('sha256').update('MOCK_DB_DATA').digest('hex'),
        size: 12
      },
      artifacts: [
        { path: 'dhr/dhr-lot-202609-001.pdf', sha256: dhrHash, size: fs.statSync(dhrFile).size },
        { path: 'reflow/profile-run-902.kic', sha256: reflowHash, size: fs.statSync(reflowFile).size }
      ],
      files: [
        { path: 'artifacts/dhr/dhr-lot-202609-001.pdf', sha256: dhrHash, size: fs.statSync(dhrFile).size },
        { path: 'artifacts/reflow/profile-run-902.kic', sha256: reflowHash, size: fs.statSync(reflowFile).size }
      ]
    };

    testManifestPath = path.join(testDataDir, 'manifest.json');
    fs.writeFileSync(testManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    fs.writeFileSync(path.join(testDataDir, 'database.sqlite'), 'MOCK_DB_DATA');
  });

  afterAll(() => {
    if (fs.existsSync(testDataDir)) {
      fs.rmSync(testDataDir, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    const db = getDatabase();
    // Reset drill history & ledger for deterministic test assertions
    await db.execute('DELETE FROM dr_drill_history;');
    await db.execute('DELETE FROM compliance_audit_ledger;');
    await db.execute('DELETE FROM production_events;');
  });

  it('Test 1: verifies 100% schema, EventStore monotonicity, ledger hash chain, and managed evidence files with RPO <= 900s and RTO <= 7200s', async () => {
    const db = getDatabase();

    // 1. Seed valid ledger chain (Genesis -> Block 1 -> Block 2)
    await ComplianceLedgerService.recordSignature({
      actorId: 'op-smt-01',
      actorRole: 'OPERATOR',
      actionType: 'SMT_REEL_SPLICE',
      meaning: 'Authorized SMT feeder reel splice',
      reason: 'Low component level',
      entityType: 'REEL',
      entityId: 'reel-c1005-01',
      organizationId: 'org-apex',
      siteId: 'site-noida-p4'
    });

    await ComplianceLedgerService.recordSignature({
      actorId: 'qa-eng-01',
      actorRole: 'QA_INSPECTOR',
      actionType: 'QUALITY_GATE_OVERRIDE',
      meaning: 'Approved minor profile drift deviation',
      reason: 'PWI within acceptable window',
      entityType: 'BATCH',
      entityId: 'batch-mfg-101',
      organizationId: 'org-apex',
      siteId: 'site-noida-p4'
    });

    // 2. Seed sequential monotonic production events (sequence 1, 2, 3)
    const baseTime = Date.now();
    for (let seq = 1; seq <= 3; seq++) {
      await db.execute(`
        INSERT INTO production_events (
          id, event_id, event_type, schema_version, event_time, received_time,
          source_type, source_id, sequence_id, site_id, work_center_id, payload_json
        ) VALUES (?, ?, ?, '1.0.0', ?, ?, 'FUJI_NXT', 'wc-smt-01', ?, 'site-noida-p4', 'wc-smt-01', '{}')
      `, [
        `evt-test-${seq}`,
        `uuid-evt-${seq}`,
        'SMT_PLACEMENT_CYCLE',
        new Date(baseTime + seq * 1000).toISOString(),
        new Date(baseTime + seq * 1000).toISOString(),
        seq
      ]);
    }

    // 3. Execute verifyRestoredState with valid test data directory
    const now = new Date();
    const backupTime = new Date(now.getTime() - 200 * 1000); // 200 seconds ago (<= 900s)

    const report = await DrVerificationService.verifyRestoredState({
      dataDir: testDataDir,
      startTime: now,
      backupTimestamp: backupTime
    });

    expect(report.schemaValid).toBe(true);
    expect(report.eventStoreValid).toBe(true);
    expect(report.ledgerIntegrity).toBe(true);
    expect(report.manifestIntegrity).toBe(true);
    expect(report.RPOSeconds).toBeLessThanOrEqual(900);
    expect(report.RTOSeconds).toBeLessThanOrEqual(7200);
    expect(report.status).toBe('PASS');
    expect(report.failureReason).toBeUndefined();
    expect(report.drillId).toBeDefined();
  });

  it('Test 2: persists drill record into dr_drill_history table and enforces freshness <= 30 days', async () => {
    const db = getDatabase();

    // Verify initial state has no drill history
    const initialLatest = await DrVerificationService.getLatestVerifiedDrill();
    expect(initialLatest).toBeNull();
    expect(await DrVerificationService.isDrillFresh(30)).toBe(false);

    // Execute verification drill
    const startTime = new Date();
    const report = await DrVerificationService.verifyRestoredState({
      dataDir: testDataDir,
      startTime
    });
    expect(report.status).toBe('PASS');

    // Verify drill history table record persistence
    const rows = await db.query<any>('SELECT * FROM dr_drill_history WHERE drill_id = ?', [report.drillId]);
    expect(rows.length).toBe(1);
    expect(rows[0].drill_id).toBe(report.drillId);
    expect(rows[0].drill_version).toBe('1.0.0');
    expect(rows[0].status).toBe('PASS');
    expect(Number(rows[0].schema_valid)).toBe(1);
    expect(Number(rows[0].event_store_valid)).toBe(1);
    expect(Number(rows[0].ledger_integrity)).toBe(1);
    expect(Number(rows[0].manifest_integrity)).toBe(1);
    expect(Number(rows[0].rpo_seconds)).toBeLessThanOrEqual(900);
    expect(Number(rows[0].rto_seconds)).toBeLessThanOrEqual(7200);

    // Verify getLatestVerifiedDrill returns the persisted pass
    const latest = await DrVerificationService.getLatestVerifiedDrill();
    expect(latest).not.toBeNull();
    expect(latest!.drill_id).toBe(report.drillId);
    expect(latest!.status).toBe('PASS');

    // Freshness policy verification: Fresh drill (< 1 day old) passes 30-day check
    const isFresh = await DrVerificationService.isDrillFresh(30);
    expect(isFresh).toBe(true);

    // Simulate stale drill (> 30 days old)
    await db.execute('DELETE FROM dr_drill_history;');
    const staleTime = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000).toISOString(); // 35 days ago
    await db.execute(`
      INSERT INTO dr_drill_history (
        drill_id, drill_version, backup_timestamp, drill_started_at, drill_completed_at,
        rpo_seconds, rto_seconds, schema_valid, event_store_valid, ledger_integrity,
        manifest_integrity, status
      ) VALUES ('drill-stale-01', '1.0.0', ?, ?, ?, 300, 10, 1, 1, 1, 1, 'PASS')
    `, [staleTime, staleTime, staleTime]);

    // Check that 35-day-old drill violates 30-day freshness SLA
    const isStaleFresh = await DrVerificationService.isDrillFresh(30);
    expect(isStaleFresh).toBe(false);

    // But satisfies 40-day window
    expect(await DrVerificationService.isDrillFresh(40)).toBe(true);
  });

  it('Test 3: rejects corrupted artifacts or broken ledger chains with status: FAIL and failureReason', async () => {
    const db = getDatabase();

    // 1. Test Corrupted Evidence Artifact
    const corruptDir = path.resolve(process.cwd(), 'scratch/test-corrupt-data');
    fs.mkdirSync(path.join(corruptDir, 'artifacts/dhr'), { recursive: true });
    const corruptFile = path.join(corruptDir, 'artifacts/dhr/tampered.pdf');
    fs.writeFileSync(corruptFile, 'LEGITIMATE_CONTENT');

    const corruptManifest = {
      backup_id: 'mes-corrupt-test',
      drill_version: '1.0.0',
      backup_timestamp: new Date().toISOString(),
      files: [
        {
          path: 'artifacts/dhr/tampered.pdf',
          sha256: '0000000000000000000000000000000000000000000000000000000000000000', // Intentionally forged hash
          size: 18
        }
      ]
    };
    fs.writeFileSync(path.join(corruptDir, 'manifest.json'), JSON.stringify(corruptManifest, null, 2));

    try {
      const corruptReport = await DrVerificationService.verifyRestoredState({
        dataDir: corruptDir
      });

      expect(corruptReport.status).toBe('FAIL');
      expect(corruptReport.manifestIntegrity).toBe(false);
      expect(corruptReport.failureReason).toBeDefined();
      expect(corruptReport.failureReason).toContain('Artifact digest mismatch');

      // Verify failure persisted to history table with failure_reason
      const failRow = await db.query<any>(
        'SELECT * FROM dr_drill_history WHERE drill_id = ?',
        [corruptReport.drillId]
      );
      expect(failRow.length).toBe(1);
      expect(failRow[0].status).toBe('FAIL');
      expect(failRow[0].failure_reason).toContain('Artifact digest mismatch');
    } finally {
      fs.rmSync(corruptDir, { recursive: true, force: true });
    }

    // 2. Test Broken Compliance Ledger Chain (Altered current_hash)
    await ComplianceLedgerService.recordSignature({
      actorId: 'op-smt-01',
      actorRole: 'OPERATOR',
      actionType: 'SMT_FEEDER_MOUNT',
      meaning: 'Mounted feeder slot 12',
      reason: 'Setup',
      entityType: 'FEEDER',
      entityId: 'feeder-12',
      organizationId: 'org-apex',
      siteId: 'site-noida-p4'
    });

    // Forge the ledger block hash directly in the database
    await db.execute(`
      UPDATE compliance_audit_ledger 
      SET current_hash = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
      WHERE sequence_number = 1
    `);

    const brokenLedgerReport = await DrVerificationService.verifyRestoredState({
      dataDir: testDataDir
    });

    expect(brokenLedgerReport.status).toBe('FAIL');
    expect(brokenLedgerReport.ledgerIntegrity).toBe(false);
    expect(brokenLedgerReport.failureReason).toBeDefined();
    expect(brokenLedgerReport.failureReason).toMatch(/ledger integrity broken/i);
  });

  it('Test 4: rejects EventStore sequence gaps, inversions, and SLA threshold violations', async () => {
    const db = getDatabase();

    // 1. Seed EventStore with sequence gap (sequence_id 1 followed by sequence_id 4)
    await db.execute(`
      INSERT INTO production_events (
        id, event_id, event_type, schema_version, event_time, received_time,
        source_type, source_id, sequence_id, site_id, work_center_id, payload_json
      ) VALUES ('evt-1', 'uid-1', 'CYCLE', '1.0.0', '2026-09-09T10:00:00Z', '2026-09-09T10:00:00Z',
        'FUJI', 'wc-01', 1, 'site-noida-p4', 'wc-01', '{}')
    `);

    await db.execute(`
      INSERT INTO production_events (
        id, event_id, event_type, schema_version, event_time, received_time,
        source_type, source_id, sequence_id, site_id, work_center_id, payload_json
      ) VALUES ('evt-2', 'uid-2', 'CYCLE', '1.0.0', '2026-09-09T10:00:01Z', '2026-09-09T10:00:01Z',
        'FUJI', 'wc-01', 4, 'site-noida-p4', 'wc-01', '{}')
    `);

    const gapReport = await DrVerificationService.verifyRestoredState({
      dataDir: testDataDir
    });

    expect(gapReport.status).toBe('FAIL');
    expect(gapReport.eventStoreValid).toBe(false);
    expect(gapReport.failureReason).toContain('EventStore sequence gap detected');

    // 2. Test RPO SLA breach (> 900 seconds)
    await db.execute('DELETE FROM production_events;');
    const now = new Date();
    const staleBackupTime = new Date(now.getTime() - 1500 * 1000); // 1500s (> 900s)

    const rpoBreachReport = await DrVerificationService.verifyRestoredState({
      dataDir: testDataDir,
      startTime: now,
      backupTimestamp: staleBackupTime
    });

    expect(rpoBreachReport.status).toBe('FAIL');
    expect(rpoBreachReport.RPOSeconds).toBeGreaterThan(900);
    expect(rpoBreachReport.failureReason).toContain('RPO SLA exceeded');
  });

  it('Test 5: executes backup.sh and restore.sh shell automation and validates SHA-256 package integrity', async () => {
    const { execSync } = await import('child_process');
    const repoRoot = path.resolve(__dirname, '../../..');
    const tempTestDir = path.resolve(repoRoot, 'scratch/test-automation-drill');
    const backupOut = path.join(tempTestDir, 'backup');
    const restoreOut = path.join(tempTestDir, 'restore');
    const dataOut = path.join(restoreOut, 'data');
    const dbOut = path.join(restoreOut, 'mes_local.db');

    fs.mkdirSync(backupOut, { recursive: true });
    fs.mkdirSync(restoreOut, { recursive: true });

    try {
      // 1. Run backup.sh
      const backupCmd = `"${path.join(repoRoot, 'scripts/backup.sh')}" "${backupOut}"`;
      const backupOutput = execSync(backupCmd, {
        cwd: repoRoot,
        env: { ...process.env, DATA_DIR: testDataDir },
        encoding: 'utf-8'
      });

      expect(backupOutput).toContain('[BACKUP] Success!');
      const packagePath = backupOutput.trim().split('\n').pop()!;
      expect(fs.existsSync(packagePath)).toBe(true);
      expect(packagePath.endsWith('.tar.gz')).toBe(true);

      // 2. Run restore.sh
      const restoreCmd = `"${path.join(repoRoot, 'scripts/restore.sh')}" "${packagePath}" "${restoreOut}" "${dataOut}" "${dbOut}"`;
      const restoreOutput = execSync(restoreCmd, {
        cwd: repoRoot,
        encoding: 'utf-8'
      });

      expect(restoreOutput).toContain('[RESTORE] 100% Cryptographic Verification Succeeded');
      expect(fs.existsSync(dbOut)).toBe(true);
      expect(fs.existsSync(path.join(dataOut, 'manifest.json'))).toBe(true);

      // 3. Deep verification of restored state
      const report = await DrVerificationService.verifyRestoredState({
        dataDir: dataOut,
        manifestPath: path.join(dataOut, 'manifest.json')
      });
      expect(report.schemaValid).toBe(true);
      expect(report.manifestIntegrity).toBe(true);
      expect(report.status).toBe('PASS');
    } finally {
      if (fs.existsSync(tempTestDir)) {
        fs.rmSync(tempTestDir, { recursive: true, force: true });
      }
    }
  });
});

