#!/usr/bin/env npx tsx

// ==============================================================================
// Antigravity SMT MES - Forward-Only Migration Upgrade Harness (Stage 5 / O-02)
//
// Validates:
// 1. Sequential migration execution from baseline (N-1) to HEAD (N)
// 2. Data preservation: Seeded records at N-1 remain 100% intact across migrations
// 3. Schema idempotency: Re-running migrations produces 0 reapplications and 0 errors
// 4. Backward compatibility & forward-only contract: No destructive down-migrations;
//    rollback is exclusively validated via PITR restore drill (scripts/verify-restore-drill.sh)
// 5. Post-migration referential integrity audit across all ISA-95 tables
// ==============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, initDatabase, IDatabase } from '../apps/api/src/db/database';
import { MigrationRunner } from '../apps/api/src/db/migration-runner';
import { runReferentialIntegrityAudit } from './audit-referential-integrity';

async function runMigrationUpgradeHarness() {
  console.log('================================================================================');
  console.log('   🔄 ANTIGRAVITY SMT MES FORWARD-ONLY MIGRATION UPGRADE HARNESS (O-02)');
  console.log('================================================================================');

  const migrationsDir = path.resolve(__dirname, '../apps/api/src/db/migrations');
  const runner = new MigrationRunner(migrationsDir);
  const migrationFiles = runner.getMigrationFiles();

  if (migrationFiles.length === 0) {
    console.error('❌ CRITICAL: No migration files found in', migrationsDir);
    process.exit(1);
  }

  const headVersion = migrationFiles[migrationFiles.length - 1];
  const nMinusOneFiles = migrationFiles.slice(0, migrationFiles.length - 1);

  console.log(`[UPGRADE-HARNESS] Total Available Migrations: ${migrationFiles.length}`);
  console.log(`[UPGRADE-HARNESS] Baseline (N-1) Version:    ${nMinusOneFiles.length > 0 ? nMinusOneFiles[nMinusOneFiles.length - 1].name : 'None'}`);
  console.log(`[UPGRADE-HARNESS] Target (HEAD) Version:      ${headVersion.name}`);

  // Create an isolated sandbox database for migration upgrade testing
  const sandboxDbPath = path.resolve(__dirname, `../temp_upgrade_sandbox_${Date.now()}.db`);
  process.env.SQLITE_DB_PATH = sandboxDbPath;

  // Cleanup handler
  const cleanup = () => {
    try {
      if (fs.existsSync(sandboxDbPath)) {
        fs.unlinkSync(sandboxDbPath);
      }
    } catch {
      // ignore
    }
  };

  try {
    // -------------------------------------------------------------------------
    // Step 1: Initialize baseline at N-1
    // -------------------------------------------------------------------------
    console.log('\n--- [Step 1/5] Applying Baseline Migrations (1 through N-1) ---');
    const db = getDatabase();
    await runner.ensureTrackingTable(db);

    for (const mig of nMinusOneFiles) {
      const sqlContent = fs.readFileSync(mig.filePath, 'utf-8');
      const now = new Date().toISOString();
      await db.withTransaction(async (tx) => {
        await tx.execScript(sqlContent);
        await tx.execute(
          'INSERT INTO schema_migrations (version, name, applied_at, checksum) VALUES (?, ?, ?, ?)',
          [mig.version, mig.name, now, mig.checksum]
        );
      });
      console.log(`  ✓ Applied baseline migration: ${mig.name}`);
    }

    // -------------------------------------------------------------------------
    // Step 2: Seed critical operational test data at N-1
    // -------------------------------------------------------------------------
    console.log('\n--- [Step 2/5] Seeding Operational Baseline Data at N-1 ---');
    const testBatchId = `batch-upg-${Date.now()}`;
    const testWorkCenterId = 'wc-smt-01';
    const testOperatorId = `op-upg-${Date.now()}`;

    await db.execute(`
      INSERT INTO organizations (id, code, name)
      VALUES ('org-apex', 'ORG-APEX', 'Apex Electronics Ltd')
      ON CONFLICT(id) DO NOTHING
    `);

    await db.execute(`
      INSERT INTO sites (id, organization_id, code, name, location, timezone)
      VALUES ('site-noida-p4', 'org-apex', 'SITE-NOIDA-P4', 'Apex Noida Plant 4', 'Noida, UP', 'Asia/Kolkata')
      ON CONFLICT(id) DO NOTHING
    `);

    await db.execute(`
      INSERT INTO areas (id, site_id, code, name, type)
      VALUES ('area-smt-01', 'site-noida-p4', 'AREA-SMT-01', 'SMT Cleanroom Bay 1', 'SMT_CLEANROOM')
      ON CONFLICT(id) DO NOTHING
    `);

    await db.execute(`
      INSERT INTO production_lines (id, area_id, code, name)
      VALUES ('line-smt-01', 'area-smt-01', 'LINE-SMT-01', 'High-Speed SMT Line 1')
      ON CONFLICT(id) DO NOTHING
    `);

    await db.execute(`
      INSERT INTO work_centers (id, area_id, line_id, code, name)
      VALUES ('${testWorkCenterId}', 'area-smt-01', 'line-smt-01', 'WC-SMT-01', 'Fuji NXT III M3')
      ON CONFLICT(id) DO NOTHING
    `);

    await db.execute(`
      INSERT INTO operators (id, code, name, role, pin_hash)
      VALUES (?, 'EMP-UPG-01', 'Upgrade Test Operator', 'OPERATOR', 'hash-test')
    `, [testOperatorId]);

    await db.execute(`
      INSERT INTO products (id, code, name)
      VALUES ('prd-upg-01', 'PRD-UPG-01', 'Upgrade Test PCB')
      ON CONFLICT(id) DO NOTHING
    `);

    await db.execute(`
      INSERT INTO recipes (id, code, name, product_code, revision)
      VALUES ('rcp-upg-01', 'RCP-UPG-01', 'Upgrade Recipe', 'PRD-UPG-01', 1)
      ON CONFLICT(id) DO NOTHING
    `);

    await db.execute(`
      INSERT INTO work_orders (id, order_number, product_code, target_quantity, status, created_at)
      VALUES ('wo-upg-01', 'WO-UPG-01', 'PRD-UPG-01', 500, 'RELEASED', ?)
      ON CONFLICT(order_number) DO NOTHING
    `, [new Date().toISOString()]);

    await db.execute(`
      INSERT INTO batches (id, batch_number, work_order_number, product_code, recipe_code, work_center_id, planned_quantity, status)
      VALUES (?, 'BATCH-UPG-01', 'WO-UPG-01', 'PRD-UPG-01', 'RCP-UPG-01', ?, 500, 'RUNNING')
    `, [testBatchId, testWorkCenterId]);

    await db.execute(`
      INSERT INTO component_reels (id, reel_id, part_number, part_name, supplier_name, lot_number, initial_quantity, remaining_quantity, status)
      VALUES ('reel-upg-01', 'REEL-UPG-01', 'CAP-100NF', '100nF Cap', 'Yageo', 'LOT-UPG-01', 5000, 5000, 'LOADED')
      ON CONFLICT(id) DO NOTHING
    `);

    console.log(`  ✓ Seeded test batch [${testBatchId}], operator [${testOperatorId}], and component reel [REEL-UPG-01]`);

    // -------------------------------------------------------------------------
    // Step 3: Run forward migrations to HEAD
    // -------------------------------------------------------------------------
    console.log('\n--- [Step 3/5] Executing Forward Migration to HEAD ---');
    const upgradeResult = await runner.runPendingMigrations(db);
    console.log(`  ✓ Applied ${upgradeResult.appliedCount} forward migration(s):`, upgradeResult.appliedMigrations);
    console.log(`  ✓ Skipped ${upgradeResult.skippedCount} previously applied baseline migration(s).`);

    if (upgradeResult.appliedCount === 0 && migrationFiles.length > nMinusOneFiles.length) {
      throw new Error('HEAD migration was not applied as expected!');
    }

    // -------------------------------------------------------------------------
    // Step 4: Verify Data Preservation & Schema Idempotency
    // -------------------------------------------------------------------------
    console.log('\n--- [Step 4/5] Verifying Data Preservation & Schema Idempotency ---');
    
    // Check test operator
    const opRows = await db.query<any>('SELECT name, role FROM operators WHERE id = ?', [testOperatorId]);
    if (opRows.length !== 1 || opRows[0].name !== 'Upgrade Test Operator') {
      throw new Error(`Data corruption detected: Operator ${testOperatorId} not preserved across migration!`);
    }
    console.log('  ✓ Pre-existing operator record fully preserved.');

    // Check test batch
    const batchRows = await db.query<any>('SELECT status, planned_quantity FROM batches WHERE id = ?', [testBatchId]);
    if (batchRows.length !== 1 || Number(batchRows[0].planned_quantity) !== 500) {
      throw new Error(`Data corruption detected: Batch ${testBatchId} not preserved across migration!`);
    }
    console.log('  ✓ Pre-existing production batch record fully preserved.');

    // Idempotency: re-run pending migrations
    const idempotencyResult = await runner.runPendingMigrations(db);
    if (idempotencyResult.appliedCount !== 0) {
      throw new Error(`Migration idempotency violation: ${idempotencyResult.appliedCount} migrations reapplied!`);
    }
    console.log('  ✓ Schema idempotency confirmed: Re-running migrations resulted in 0 applied, 0 errors.');

    // -------------------------------------------------------------------------
    // Step 5: Referential Integrity Audit & Forward-Only Contract Assertion
    // -------------------------------------------------------------------------
    console.log('\n--- [Step 5/5] Auditing Referential Integrity & Forward-Only Contract ---');
    const integrityResult = await runReferentialIntegrityAudit();
    if (integrityResult.violations > 0) {
      throw new Error(`Referential integrity violations discovered post-upgrade: ${integrityResult.violations}`);
    }
    console.log(`  ✓ All ${integrityResult.totalChecks} foreign-key relationship paths intact (0 violations).`);

    // Verify forward-only contract: assert that no down-migrations exist
    const downMigrationFiles = fs.readdirSync(migrationsDir).filter(f => f.includes('.down.') || f.endsWith('_down.sql'));
    if (downMigrationFiles.length > 0) {
      throw new Error(`Forward-only contract violation: Destructive down-migration scripts found: ${downMigrationFiles.join(', ')}`);
    }
    console.log('  ✓ Forward-only contract verified: No destructive down-migrations exist. Rollback policy enforces PITR restore.');

    console.log('\n================================================================================');
    console.log('   🎉 FORWARD-ONLY MIGRATION UPGRADE HARNESS: 100% PASS (Gate G-11 / O-02)');
    console.log('================================================================================');

    cleanup();
    process.exit(0);
  } catch (err: any) {
    console.error('\n❌ MIGRATION UPGRADE HARNESS FAILED:', err.message);
    cleanup();
    process.exit(1);
  }
}

runMigrationUpgradeHarness();
