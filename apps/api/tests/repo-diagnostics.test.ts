import { describe, it, expect, beforeAll } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase, initDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { ProjectionReplayService } from '../src/services/projection-replay.service';
import { MigrationRunner } from '../src/db/migration-runner';
import { AoiProjector } from '../src/services/projectors/aoi.projector';
import { SpiSpcService } from '../src/services/spi-spc.service';
import { MesEventEnvelope } from '@mes/shared';

describe('Repo Diagnostics & Bug Verification Suite', () => {
  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  // Bug 1: ProjectionReplayService skips AOI and SPI events
  it('Bug 1: ProjectionReplayService should replay AOI inspection events into aoi_inspections', async () => {
    const db = getDatabase();
    const testPanel = `PNL-REPLAY-AOI-${Date.now()}`;
    const testInspectionId = `insp-replay-${Date.now()}`;

    // Insert an AOI event directly into production_events
    await db.execute(`
      INSERT INTO production_events (
        id, event_id, event_type, schema_version, event_time, received_time,
        source_type, source_id, site_id, work_center_id, payload_json
      ) VALUES (?, ?, 'AOI_INSPECTION_COMPLETED', '1.0.0', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
        'OPTICAL_AOI', 'KY-ZENITH-01', 'site-dixon-01', 'wc-aoi-01', ?)
    `, [
      uuidv4(),
      testInspectionId,
      JSON.stringify({
        inspectionId: testInspectionId,
        sourceSystem: 'KOH_YOUNG_ZENITH_AOI',
        sourceInspectionId: `KY-SRC-${Date.now()}`,
        sourceFileHash: `hash-${Date.now()}`,
        panelBarcode: testPanel,
        inspectionPhase: 'POST_REFLOW',
        result: 'PASS',
        totalDefects: 0,
        workCenterId: 'wc-aoi-01',
        opticalMachineId: 'KY-ZENITH-01'
      })
    ]);

    // Replay catchup
    await ProjectionReplayService.replayCatchup();

    // Verify read model was populated
    const rows = await db.query<any>('SELECT * FROM aoi_inspections WHERE panel_barcode = ?', [testPanel]);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].panel_barcode).toBe(testPanel);
    expect(rows[0].result).toBe('PASS');
  });

  // Bug 2: MigrationRunner tablesToSync missing Phase 3 & Phase 4 tables
  it('Bug 2: MigrationRunner tablesToSync should include all Phase 3 & Phase 4 tables', async () => {
    const runner = new MigrationRunner();
    // Access the table list used during migration/sync
    const tables = runner.getSyncTables();
    expect(tables).toContain('quality_rules');
    expect(tables).toContain('pcb_cad_definitions');
    expect(tables).toContain('panel_units');
    expect(tables).toContain('aoi_inspections');
    expect(tables).toContain('aoi_defects');
    expect(tables).toContain('rework_dispositions');
    expect(tables).toContain('rework_events');
    expect(tables).toContain('recipe_process_windows');
    expect(tables).toContain('printer_capabilities');
    expect(tables).toContain('spi_inspections');
    expect(tables).toContain('spi_pad_measurements');
    expect(tables).toContain('printer_tuning_events');
  });

  // Bug 3: NodeSqliteDatabase nested withTransaction throws error
  it('Bug 3: NodeSqliteDatabase.withTransaction should support nested transaction calls without throwing', async () => {
    const db = getDatabase();
    let innerCompleted = false;

    await db.withTransaction(async (tx1) => {
      await tx1.withTransaction(async (tx2) => {
        await tx2.execute('SELECT 1');
        innerCompleted = true;
      });
    });

    expect(innerCompleted).toBe(true);
  });

  // Bug 4: SpiSpcService ignores recipeId in query
  it('Bug 4: SpiSpcService should isolate SPC metrics by recipeId when multiple recipes exist', async () => {
    const db = getDatabase();
    const recipeA = 'PROG-RECIPE-A';
    const recipeB = 'PROG-RECIPE-B';
    const batchA = `job-diag-a-${Date.now()}`;
    const batchB = `job-diag-b-${Date.now()}`;

    // Create two batches with different recipes
    await db.execute(`
      INSERT INTO batches (id, batch_number, work_order_number, product_code, recipe_code, work_center_id, planned_quantity)
      VALUES (?, ?, 'WO-A', 'PRD-A', ?, 'wc-spg-01', 100)
    `, [batchA, `BN-${batchA}`, recipeA]);

    await db.execute(`
      INSERT INTO batches (id, batch_number, work_order_number, product_code, recipe_code, work_center_id, planned_quantity)
      VALUES (?, ?, 'WO-B', 'PRD-B', ?, 'wc-spg-01', 100)
    `, [batchB, `BN-${batchB}`, recipeB]);

    // Insert recipe A inspection with 90% volume
    await db.execute(`
      INSERT INTO spi_inspections (
        id, source_system, source_inspection_id, source_file_hash, panel_barcode,
        batch_id, work_center_id, optical_machine_id, result, mean_volume_pct, inspected_at
      ) VALUES (?, 'CFX', ?, ?, ?, ?, 'wc-spg-01', 'KY-01', 'PASS', 90.0, datetime('now', '-1 minute'))
    `, [uuidv4(), uuidv4(), uuidv4(), `PNL-A-${Date.now()}`, batchA]);

    // Insert recipe B inspection with 130% volume
    await db.execute(`
      INSERT INTO spi_inspections (
        id, source_system, source_inspection_id, source_file_hash, panel_barcode,
        batch_id, work_center_id, optical_machine_id, result, mean_volume_pct, inspected_at
      ) VALUES (?, 'CFX', ?, ?, ?, ?, 'wc-spg-01', 'KY-01', 'PASS', 130.0, datetime('now'))
    `, [uuidv4(), uuidv4(), uuidv4(), `PNL-B-${Date.now()}`, batchB]);

    // Calculate SPC for recipe A only
    const spcA = await SpiSpcService.calculateSpc(recipeA, 10);
    // Should NOT include recipe B's 130.0% volume
    expect(spcA.meanVolumePct).toBe(90.0);
  });

  // Bug 5: AoiProjector fails to set unit status to PASSED on clean inspection
  it('Bug 5: AoiProjector should set panel unit status to PASSED on a clean inspection', async () => {
    const db = getDatabase();
    const projector = new AoiProjector();
    const panelBarcode = `PNL-CLEAN-${Date.now()}`;

    const cleanInspectionEvent: MesEventEnvelope = {
      eventId: uuidv4(),
      eventType: 'AOI_INSPECTION_COMPLETED',
      schemaVersion: '1.0.0',
      eventTime: new Date().toISOString(),
      receivedTime: new Date().toISOString(),
      sourceType: 'OPTICAL_AOI',
      sourceId: 'KY-ZENITH-01',
      siteId: 'site-dixon-01',
      workCenterId: 'wc-aoi-01',
      payload: {
        inspectionId: uuidv4(),
        sourceSystem: 'KOH_YOUNG_ZENITH_AOI',
        sourceInspectionId: `KY-CLEAN-${Date.now()}`,
        sourceFileHash: `hash-clean-${Date.now()}`,
        panelBarcode,
        inspectionPhase: 'POST_REFLOW',
        result: 'PASS',
        totalDefects: 0,
        defects: [],
        workCenterId: 'wc-aoi-01',
        opticalMachineId: 'KY-ZENITH-01'
      }
    };

    await projector.project(cleanInspectionEvent, db);

    const units = await db.query<any>('SELECT * FROM panel_units WHERE panel_barcode = ?', [panelBarcode]);
    expect(units.length).toBeGreaterThan(0);
    expect(units[0].status).toBe('PASSED');
  });
});
