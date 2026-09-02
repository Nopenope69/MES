import { describe, it, expect, beforeAll } from 'vitest';
import { getDatabase, initDatabase } from '../src/db/database';
import { EventIngestionService } from '../src/services/event-ingestion.service';
import { GenealogyService } from '../src/services/genealogy.service';
import { OeeReportService } from '../src/services/oee-report.service';
import { seedDatabase } from '../src/db/seed';

describe('SMT Event Ingestion & Real-Time Production Engine', () => {
  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();
  });

  it('should ingest an SMT BATCH_STARTED event and set Fuji NXT III to RUNNING', async () => {
    const testJobNo = 'JOB-SM-TEST-01';
    const result = await EventIngestionService.ingest({
      eventType: 'BATCH_STARTED',
      workCenterId: 'wc-nxt-01',
      operatorId: 'op-smt-01',
      sourceType: 'INTEGRATION_SOCKET',
      sourceId: 'fuji-nxt01',
      payload: {
        batchNumber: testJobNo,
        workOrderNumber: 'WO-2026-DIXON-01',
        productCode: 'PRD-SM-4G-V2',
        recipeCode: 'PROG-SM-METER-TOP-REV4',
        recipeRevision: 4,
        plannedQuantity: 500.0,
        unit: 'PANEL'
      }
    });

    expect(result.success).toBe(true);

    const db = getDatabase();
    const wc = await db.query('SELECT current_state, current_program_name FROM work_centers WHERE id = ?', ['wc-nxt-01']);
    expect(wc[0].current_state).toBe('RUNNING');
    expect(wc[0].current_program_name).toBe('PROG-SM-METER-TOP-REV4');

    const batch = await db.query('SELECT status, planned_quantity FROM batches WHERE batch_number = ?', [testJobNo]);
    expect(batch[0].status).toBe('RUNNING');
  });

  it('should record automated PANEL_CHECKOUT with cycle time and skip bitmask', async () => {
    const result = await EventIngestionService.ingest({
      eventType: 'PANEL_CHECKOUT',
      workCenterId: 'wc-nxt-01',
      batchId: 'JOB-SM-TEST-01',
      sourceType: 'INTEGRATION_SOCKET',
      sourceId: 'fuji-nxt01',
      payload: {
        panelBarcode: 'PNL-SM-00150',
        programName: 'PROG-SM-METER-TOP-REV4',
        moduleNo: 1,
        laneNo: 1,
        cycleTimeSeconds: 18.25,
        blockCount: 4,
        blockSkipCount: 0,
        skipBitmask: '0x00'
      }
    });

    expect(result.success).toBe(true);

    const db = getDatabase();
    const checkouts = await db.query('SELECT * FROM panel_checkouts WHERE panel_barcode = ?', ['PNL-SM-00150']);
    expect(checkouts.length).toBe(1);
    expect(Number(checkouts[0].cycle_time_seconds)).toBe(18.25);
  });

  it('should process a REEL_SPLICED event and update feeder slot mapping and genealogy', async () => {
    const result = await EventIngestionService.ingest({
      eventType: 'REEL_SPLICED',
      workCenterId: 'wc-nxt-01',
      batchId: 'JOB-SM-TEST-01',
      operatorId: 'op-smt-02',
      sourceType: 'MANUAL_UI',
      sourceId: 'tablet-splicing-kiosk',
      payload: {
        slotNo: 1,
        moduleNo: 1,
        stageNo: 1,
        feederId: 'FID-W08F-01',
        partNumber: 'C0402-100NF-16V',
        oldReelId: 'REEL-MUR-98124',
        newReelId: 'REEL-MUR-98125-SPLICE',
        newReelQuantity: 10000,
        mslRemainingMinutes: 999999
      }
    });

    expect(result.success).toBe(true);

    const db = getDatabase();
    const slot = await db.query(
      'SELECT current_reel_id FROM smt_feeder_slots WHERE work_center_id = ? AND slot_no = ?',
      ['wc-nxt-01', 1]
    );
    expect(slot[0].current_reel_id).toBe('REEL-MUR-98125-SPLICE');

    // Forward genealogy trace: Reel -> SMT Job
    const forwardTree = await GenealogyService.traceMaterialLot('REEL-MUR-98125-SPLICE');
    expect(forwardTree.nodes.some(n => n.code === 'JOB-SM-TEST-01')).toBe(true);
  });

  it('should record SMT PICK_ERROR_RECORDED and track feeder health', async () => {
    const result = await EventIngestionService.ingest({
      eventType: 'PICK_ERROR_RECORDED',
      workCenterId: 'wc-nxt-01',
      sourceType: 'INTEGRATION_SOCKET',
      sourceId: 'fuji-nxt01',
      payload: {
        moduleNo: 1,
        stageNo: 1,
        slotNo: 1,
        partNumber: 'C0402-100NF-16V',
        feederId: 'FID-W08F-01',
        nozzleId: 'NOZ-0402-A',
        errorType: 'VISION_ERROR',
        errorCode: '0000A102'
      }
    });

    expect(result.success).toBe(true);

    const db = getDatabase();
    const errors = await db.query(
      'SELECT * FROM feeder_error_logs WHERE feeder_id = ? AND error_type = ?',
      ['FID-W08F-01', 'VISION_ERROR']
    );
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });

  it('should compute SMT shift performance, availability, and downtime Pareto', async () => {
    const summary = await OeeReportService.getShiftSummary();
    expect(summary.totalPlannedMinutes).toBe(480);
    expect(summary.availabilityPercentage).toBeDefined();
    expect(summary.topDowntimeReasons).toBeDefined();
  });
});
