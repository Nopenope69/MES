import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase } from '../../src/db/database';
import { seedDatabase } from '../../src/db/seed';
import { MaterialGateModule } from '../../src/modules/material-gate/material-gate.module';
import { EventStoreModule } from '../../src/modules/event-store/event-store.module';
import { FakeClock } from '../../src/utils/clock';
import { SolderPasteService } from '../../src/services/solder-paste.service';
import { MslService } from '../../src/services/msl.service';

describe('MaterialGateModule: Unified Pre-Execution Material Compliance Suite', () => {
  let materialGate: MaterialGateModule;
  let fakeClock: FakeClock;
  const baseTime = new Date('2026-03-30T08:00:00.000Z');

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    fakeClock = new FakeClock(baseTime);
    materialGate = new MaterialGateModule(
      () => getDatabase(),
      fakeClock,
      EventStoreModule.getInstance(),
      new MslService(fakeClock),
      new SolderPasteService(fakeClock)
    );

    const db = getDatabase();

    // Seed expired MSL reel
    await db.execute(`
      INSERT OR REPLACE INTO component_reels (
        id, reel_id, part_number, part_name, supplier_name, lot_number,
        date_code, initial_quantity, current_quantity, status, msl_level,
        msl_class, msl_remaining_minutes, floor_clock_state
      ) VALUES (
        'reel-gate-exp', 'REEL-GATE-EXPIRED-01', 'C0402-100NF-16V', '100nF Cap',
        'Murata', 'LOT-GATE-EXP', '2635', 5000, 5000, 'EXPIRED_MSL', 3,
        'MSL_3', 0, 'BAKE_REQUIRED'
      )
    `);

    // Seed quarantined reel
    await db.execute(`
      INSERT OR REPLACE INTO component_reels (
        id, reel_id, part_number, part_name, supplier_name, lot_number,
        date_code, initial_quantity, current_quantity, status, msl_level,
        msl_class, msl_remaining_minutes, floor_clock_state
      ) VALUES (
        'reel-gate-quar', 'REEL-GATE-QUAR-01', 'C0402-100NF-16V', '100nF Cap',
        'Murata', 'LOT-GATE-QUAR', '2635', 5000, 5000, 'QUARANTINED', 1,
        'MSL_1', 999999, 'FLOOR_EXPOSURE'
      )
    `);

    // Seed valid reel for rework
    await db.execute(`
      INSERT OR REPLACE INTO component_reels (
        id, reel_id, part_number, part_name, supplier_name, lot_number,
        date_code, initial_quantity, current_quantity, status, msl_level,
        msl_class, msl_remaining_minutes, floor_clock_state
      ) VALUES (
        'reel-gate-rwk', 'REEL-GATE-RWK-01', 'C0402-100NF-16V', '100nF Cap',
        'Murata', 'LOT-GATE-RWK', '2635', 5000, 5000, 'VERIFIED', 1,
        'MSL_1', 999999, 'FLOOR_EXPOSURE'
      )
    `);
  });

  describe('1. authorizeFeederSplice', () => {
    it('approves compliant reel and matching slot BOM', async () => {
      const decision = await materialGate.authorizeFeederSplice({
        workCenterId: 'wc-nxt-01',
        slotNo: 1,
        scannedPartNumber: 'C0402-100NF-16V',
        scannedReelId: 'REEL-MUR-98124',
        operatorId: 'op-smt-01'
      });

      expect(decision.allowed).toBe(true);
      expect(decision.decisionCode).toBe('APPROVED');
      expect(decision.expectedPartNumber).toBe('C0402-100NF-16V');
    });

    it('strictly blocks BOM mismatch', async () => {
      const decision = await materialGate.authorizeFeederSplice({
        workCenterId: 'wc-nxt-01',
        slotNo: 1,
        scannedPartNumber: 'WRONG-PART-1234',
        operatorId: 'op-smt-01'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_BOM_MISMATCH');
      expect(decision.reason).toContain('BOM mismatch');
    });

    it('blocks unconfigured slot', async () => {
      const decision = await materialGate.authorizeFeederSplice({
        workCenterId: 'wc-nxt-01',
        slotNo: 888,
        scannedPartNumber: 'C0402-100NF-16V',
        operatorId: 'op-smt-01'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_SLOT_NOT_CONFIGURED');
    });

    it('blocks expired MSL reel and reports BAKE_REQUIRED', async () => {
      const decision = await materialGate.authorizeFeederSplice({
        workCenterId: 'wc-nxt-01',
        slotNo: 1,
        scannedPartNumber: 'C0402-100NF-16V',
        scannedReelId: 'REEL-GATE-EXPIRED-01',
        operatorId: 'op-smt-01'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_MSL_EXPIRED');
      expect(decision.mslState).toBe('BAKE_REQUIRED');
    });

    it('blocks quarantined reel', async () => {
      const decision = await materialGate.authorizeFeederSplice({
        workCenterId: 'wc-nxt-01',
        slotNo: 1,
        scannedPartNumber: 'C0402-100NF-16V',
        scannedReelId: 'REEL-GATE-QUAR-01',
        operatorId: 'op-smt-01'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_REEL_NOT_USABLE');
    });
  });

  describe('2. authorizeScreenPrinter', () => {
    it('blocks printer cycle if no stencil is loaded', async () => {
      const decision = await materialGate.authorizeScreenPrinter({
        workCenterId: 'wc-unloaded-printer'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_NO_STENCIL');
    });

    it('blocks printer cycle if stencil status requires cleaning', async () => {
      const db = getDatabase();
      await db.execute(`
        INSERT OR REPLACE INTO stencils (
          id, stencil_id, stencil_serial_number, part_number, revision, status
        ) VALUES (
          'stn-dirty', 'STN-DIRTY-01', 'SER-DIRTY-01', 'PCB-MES-MAIN', 'A', 'CLEANING_REQUIRED'
        )
      `);

      const decision = await materialGate.authorizeScreenPrinter({
        workCenterId: 'wc-spg-01',
        stencilId: 'STN-DIRTY-01'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_STENCIL_CLEANING_REQUIRED');
    });
  });

  describe('3. authorizeReworkReel', () => {
    it('authorizes verified reel matching expected BOM part number', async () => {
      const decision = await materialGate.authorizeReworkReel({
        reelId: 'REEL-GATE-RWK-01',
        expectedPartNumber: 'C0402-100NF-16V',
        operatorId: 'op-rework-01',
        stationId: 'wc-rework-01'
      });

      expect(decision.allowed).toBe(true);
      expect(decision.decisionCode).toBe('APPROVED');
      expect(decision.partNumber).toBe('C0402-100NF-16V');
    });

    it('blocks non-existent reel', async () => {
      const decision = await materialGate.authorizeReworkReel({
        reelId: 'REEL-DOES-NOT-EXIST',
        expectedPartNumber: 'C0402-100NF-16V'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_REEL_NOT_FOUND');
    });

    it('blocks rework reel when BOM part numbers mismatch', async () => {
      const decision = await materialGate.authorizeReworkReel({
        reelId: 'REEL-GATE-RWK-01',
        expectedPartNumber: 'DIFFERENT-PART-NO'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_BOM_MISMATCH');
    });

    it('blocks rework reel when JEDEC MSL is expired', async () => {
      const decision = await materialGate.authorizeReworkReel({
        reelId: 'REEL-GATE-EXPIRED-01',
        expectedPartNumber: 'C0402-100NF-16V'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_MSL_EXPIRED');
      expect(decision.mslState).toBe('BAKE_REQUIRED');
    });

    it('blocks rework reel when quarantined', async () => {
      const decision = await materialGate.authorizeReworkReel({
        reelId: 'REEL-GATE-QUAR-01',
        expectedPartNumber: 'C0402-100NF-16V'
      });

      expect(decision.allowed).toBe(false);
      expect(decision.decisionCode).toBe('BLOCKED_REEL_NOT_USABLE');
    });
  });

  describe('4. 21 CFR Part 11 Audit Trail Verification', () => {
    it('appends QUALITY_GATE_PASSED and QUALITY_GATE_BLOCKED events to EventStoreModule', async () => {
      const db = getDatabase();
      const auditEvents = await db.query<any>(
        "SELECT event_type, source_type, payload_json FROM production_events WHERE event_type IN ('QUALITY_GATE_PASSED', 'QUALITY_GATE_BLOCKED') ORDER BY created_at DESC LIMIT 50"
      );

      expect(auditEvents.length).toBeGreaterThan(0);
      const passed = auditEvents.find((e: any) => e.event_type === 'QUALITY_GATE_PASSED');
      const blocked = auditEvents.find((e: any) => e.event_type === 'QUALITY_GATE_BLOCKED');

      expect(passed).toBeDefined();
      expect(blocked).toBeDefined();
      expect(passed.source_type).toBe('QUALITY_ENGINE');
      expect(blocked.source_type).toBe('QUALITY_ENGINE');
    });
  });
});
