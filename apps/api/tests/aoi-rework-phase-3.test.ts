import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { defaultAoiGateway } from '../src/adapters/aoi/aoi-gateway-manager';
import { KohYoungAoiAdapter } from '../src/adapters/aoi/koh-young.adapter';
import { OmronAoiAdapter } from '../src/adapters/aoi/omron.adapter';
import { QualityEngineService } from '../src/services/quality-engine.service';
import { ReworkExecutionService } from '../src/services/rework-execution.service';
import { RepeatDefectSentinelService } from '../src/services/repeat-defect-sentinel.service';
import { DefectCorrelationService } from '../src/services/defect-correlation.service';
import { FujiNeximAdapter } from '../src/adapters/fuji-nexim.adapter';
import { CanonicalAoiInspectionResult } from '@mes/shared';

describe('Phase 3: Closed-Loop 3D AOI, Quality Execution & Cleanroom Rework Suite', () => {
  let fujiAdapter: FujiNeximAdapter;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    fujiAdapter = new FujiNeximAdapter();
    RepeatDefectSentinelService.registerFujiCommander(
      (reason) => fujiAdapter.tripProductionHold(reason),
      () => fujiAdapter.clearProductionHold()
    );
  });

  describe('1. Vendor-Neutral AOI Adapters & Normalization', () => {
    it('Koh Young 3D AOI adapter normalizes Zenith inspection payload to Canonical model', async () => {
      const adapter = new KohYoungAoiAdapter();
      const rawPayload = {
        InspectionHeader: {
          InspectionId: 'KY-ZEN-TEST-101',
          BoardBarcode: 'PNL-KY-TEST-001',
          MachineId: 'KY-ZENITH-01',
          WorkCenterId: 'wc-aoi-01',
          BatchId: 'job-01',
          InspectionPhase: 'POST_REFLOW',
          Result: 'FAIL',
          DurationSec: 14.5,
          InspectedAt: '2026-09-07T14:00:00Z'
        },
        DefectList: [
          {
            DefectId: 'KY-DEF-001',
            UnitNo: 3,
            RefDes: 'C12',
            DefectType: 'TOMBSTONE',
            Side: 'TOP',
            OffsetX_um: 42.5,
            OffsetY_um: 175.2,
            Rotation_deg: 26.0
          }
        ]
      };

      const canonical = adapter.parseInspection(rawPayload);
      expect(canonical.sourceSystem).toBe('KOH_YOUNG_3D_AOI');
      expect(canonical.panelBarcode).toBe('PNL-KY-TEST-001');
      expect(canonical.result).toBe('FAIL');
      expect(canonical.totalDefects).toBe(1);
      expect(canonical.defects[0].refDes).toBe('C12');
      expect(canonical.defects[0].defectType).toBe('TOMBSTONE');
      expect(canonical.defects[0].category).toBe('SOLDER');
      expect(canonical.defects[0].unitPosition).toBe(3);
    });

    it('Omron VT-S series adapter normalizes Japanese error codes and OK/NG judgment', async () => {
      const adapter = new OmronAoiAdapter();
      const rawPayload = {
        PanelBarcode: 'PNL-OMR-TEST-002',
        InspectionNumber: 'OMR-VT-992',
        MachineName: 'OMRON-VT-S730',
        WorkCenterId: 'wc-aoi-01',
        Judge: 'NG',
        TactTime: 16.2,
        DefectItems: [
          {
            PartsName: 'MOD1',
            UnitNo: 1,
            ErrorCode: 'NG_SHIFT',
            PosX: 120.0,
            PosY: 450.0,
            Angle: 1.5
          }
        ]
      };

      const canonical = adapter.parseInspection(rawPayload);
      expect(canonical.sourceSystem).toBe('OMRON_VT_S_SERIES');
      expect(canonical.panelBarcode).toBe('PNL-OMR-TEST-002');
      expect(canonical.result).toBe('FAIL');
      expect(canonical.defects[0].refDes).toBe('MOD1');
      expect(canonical.defects[0].defectType).toBe('MISALIGNED');
      expect(canonical.defects[0].category).toBe('COMPONENT');
    });

    it('AOI Gateway Manager resolves adapter by vendor token and parses correctly', async () => {
      const res = await defaultAoiGateway.parse('KOH_YOUNG_3D_AOI', {
        panelBarcode: 'PNL-GW-001',
        inspectionId: 'INSP-GW-001',
        result: 'PASS',
        defects: []
      });
      expect(res.panelBarcode).toBe('PNL-GW-001');
      expect(res.result).toBe('PASS');
    });
  });

  describe('2. Ingestion Idempotency & Quality Hold State Machine', () => {
    const testPanel = 'PNL-260901-IDEMP-01';
    const sourceInspectionId = 'KY-INSP-IDEMP-99';
    const sourceFileHash = 'sha256-deterministic-hash-phase3';

    it('Ingesting failed inspection creates defects and places affected unit on QUALITY_HOLD', async () => {
      const canonical: CanonicalAoiInspectionResult = {
        sourceSystem: 'KOH_YOUNG_3D_AOI',
        sourceInspectionId,
        sourceFileHash,
        panelBarcode: testPanel,
        batchId: 'job-01',
        workCenterId: 'wc-aoi-01',
        opticalMachineId: 'KY-ZENITH-01',
        inspectionPhase: 'POST_REFLOW',
        result: 'FAIL',
        totalDefects: 1,
        durationSeconds: 15.0,
        timestamp: new Date().toISOString(),
        defects: [
          {
            defectId: 'def-idemp-01',
            unitPosition: 3,
            refDes: 'C12',
            category: 'SOLDER',
            defectType: 'TOMBSTONE',
            boardSide: 'TOP'
          }
        ]
      };

      const res = await QualityEngineService.ingestInspection(canonical);
      expect(res.idempotentDuplicate).toBe(false);
      expect(res.result).toBe('FAIL');
      expect(res.qualityHoldApplied).toBe(true);

      const status = await QualityEngineService.getPanelQuality(testPanel);
      expect(status.panelStatus).toBe('QUALITY_HOLD');
      const unit3 = status.units.find(u => u.unit_position === 3);
      expect(unit3?.status).toBe('QUALITY_HOLD');
    });

    it('Submitting identical inspection payload (same source_system, id, hash) is rejected as duplicate', async () => {
      const duplicatePayload: CanonicalAoiInspectionResult = {
        sourceSystem: 'KOH_YOUNG_3D_AOI',
        sourceInspectionId,
        sourceFileHash,
        panelBarcode: testPanel,
        workCenterId: 'wc-aoi-01',
        opticalMachineId: 'KY-ZENITH-01',
        inspectionPhase: 'POST_REFLOW',
        result: 'FAIL',
        totalDefects: 1,
        timestamp: new Date().toISOString(),
        defects: []
      };

      const res = await QualityEngineService.ingestInspection(duplicatePayload);
      expect(res.idempotentDuplicate).toBe(true);
      expect(res.result).toBe('FAIL');
    });
  });

  describe('3. Multi-Up Panel-to-Unit Hierarchy & CAD Integration', () => {
    it('Retrieves CAD definitions across all 6 multi-up unit positions', async () => {
      const cad = await QualityEngineService.getCadDefinitions('PROG-SM-METER-TOP-REV4', 4, 'TOP');
      expect(cad.length).toBe(30); // 6 units * 5 components (C12, C14, R104, U3, MOD1)

      const unit3C12 = cad.find(c => c.unitPosition === 3 && c.refDes === 'C12');
      expect(unit3C12).toBeDefined();
      expect(unit3C12?.packageType).toBe('0402');
      expect(unit3C12?.mpn).toBe('C0402-100NF-16V');
      expect(unit3C12?.maxReworkCycles).toBe(2);
      expect(unit3C12?.xMm).toBe(102.5); // (3 - 1) * 45 + 12.5 = 102.5 mm
    });
  });

  describe('4. Formal Engineering Dispositions', () => {
    const demoPanel = 'PNL-260901-0042';

    it('Engineer authorizes REWORK: moves unit from QUALITY_HOLD to REWORK_PENDING', async () => {
      const res = await QualityEngineService.recordDisposition({
        defectId: 'defect-demo-01',
        panelBarcode: demoPanel,
        unitPosition: 3,
        disposition: 'REWORK',
        reason: 'IPC-A-610 Class 3 rework authorized with calibrated hot-air station',
        authorizedBy: 'eng-qa-lead-01'
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('REWORK_PENDING');

      const panel = await QualityEngineService.getPanelQuality(demoPanel);
      const unit3 = panel.units.find(u => u.unit_position === 3);
      expect(unit3?.status).toBe('REWORK_PENDING');
    });

    it('Engineer authorizes SCRAP: marks unit as SCRAPPED', async () => {
      const scrapPanel = 'PNL-SCRAP-TEST-01';
      const db = getDatabase();
      await db.execute(`
        INSERT INTO panel_units (id, panel_barcode, unit_position, status)
        VALUES ('u-scrap-1', ?, 1, 'QUALITY_HOLD')
      `, [scrapPanel]);

      const res = await QualityEngineService.recordDisposition({
        defectId: 'def-scrap-01',
        panelBarcode: scrapPanel,
        unitPosition: 1,
        disposition: 'SCRAP',
        reason: 'Severe pad delamination; rework not permitted',
        authorizedBy: 'eng-qa-lead-01'
      });

      expect(res.success).toBe(true);
      expect(res.status).toBe('SCRAPPED');

      const panel = await QualityEngineService.getPanelQuality(scrapPanel);
      const unit1 = panel.units.find(u => u.unit_position === 1);
      expect(unit1?.status).toBe('SCRAPPED');
    });
  });

  describe('5. Rework Execution, Thermal Cycle Limits & Mandatory Re-Inspection', () => {
    const reworkPanel = 'PNL-260901-0042';

    it('Rejects replacement reel when BOM MPN mismatches CAD specification', async () => {
      // C12 expects C0402-100NF-16V; REEL-VSH-44120 is R0402-10K-1%
      const res = await ReworkExecutionService.verifyReplacement(
        reworkPanel,
        3,
        'C12',
        'REEL-VSH-44120'
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('BOM Mismatch'))).toBe(true);
    });

    it('Rejects replacement reel when JEDEC MSL floor-life is expired', async () => {
      const res = await ReworkExecutionService.verifyReplacement(
        reworkPanel,
        3,
        'C12',
        'REEL-EXPIRED-TEST-01'
      );
      expect(res.valid).toBe(false);
      expect(res.errors.some(e => e.includes('JEDEC MSL') || e.includes('EXPIRED_MSL'))).toBe(true);
    });

    it('Approves valid replacement reel matching BOM and within MSL floor life', async () => {
      const res = await ReworkExecutionService.verifyReplacement(
        reworkPanel,
        3,
        'C12',
        'REEL-MUR-98125-SPLICE'
      );
      expect(res.valid).toBe(true);
      expect(res.errors.length).toBe(0);
      expect(res.currentCycle).toBe(1);
      expect(res.maxReworkCycles).toBe(2);
    });

    it('Executes component replacement and transitions unit to REWORK_PASSED (awaiting re-inspection)', async () => {
      const res = await ReworkExecutionService.executeReplacement({
        defectId: 'defect-demo-01',
        panelBarcode: reworkPanel,
        unitPosition: 3,
        refDes: 'C12',
        technicianId: 'tech-smt-042',
        replacementReelId: 'REEL-MUR-98125-SPLICE',
        reworkMethod: 'HOT_AIR_DESOLDER_SOLDERING_IRON'
      });

      expect(res.success).toBe(true);
      expect(res.reworkCycle).toBe(1);

      const panel = await QualityEngineService.getPanelQuality(reworkPanel);
      const unit3 = panel.units.find(u => u.unit_position === 3);
      expect(unit3?.status).toBe('REWORK_PASSED');
    });

    it('Enforces thermal rework cycle limit: second rework cycle is accepted, third is blocked', async () => {
      // Execute 2nd rework cycle
      await ReworkExecutionService.executeReplacement({
        defectId: 'defect-demo-01',
        panelBarcode: reworkPanel,
        unitPosition: 3,
        refDes: 'C12',
        technicianId: 'tech-smt-042',
        replacementReelId: 'REEL-MUR-98125-SPLICE'
      });

      // 3rd attempt must fail because max_rework_cycles is 2 for C12
      const check3 = await ReworkExecutionService.verifyReplacement(
        reworkPanel,
        3,
        'C12',
        'REEL-MUR-98125-SPLICE'
      );
      expect(check3.valid).toBe(false);
      expect(check3.errors.some(e => e.includes('Thermal rework limit exceeded'))).toBe(true);
    });

    it('Mandatory Post-Rework Re-Inspection: passing re-inspection releases the unit to RELEASED', async () => {
      const res = await ReworkExecutionService.recordPostReworkInspection({
        panelBarcode: reworkPanel,
        unitPosition: 3,
        defectId: 'defect-demo-01',
        result: 'PASS',
        inspectorId: 'qa-inspector-08'
      });

      expect(res.success).toBe(true);
      expect(res.finalStatus).toBe('RELEASED');

      const panel = await QualityEngineService.getPanelQuality(reworkPanel);
      const unit3 = panel.units.find(u => u.unit_position === 3);
      expect(unit3?.status).toBe('RELEASED');
    });
  });

  describe('6. Upstream Root-Cause Defect Correlation', () => {
    it('Correlates defective C12 back to Feeder Slot 1, Murata Reel Lot, Nozzle, Paste Lot, and Stencil', async () => {
      const report = await DefectCorrelationService.correlate('PNL-260901-0042', 3, 'C12');

      expect(report.refDes).toBe('C12');
      expect(report.partNumber).toBe('C0402-100NF-16V');
      expect(report.packageType).toBe('0402');

      // Feeder Slot
      expect(report.feederSlot).toBeDefined();
      expect(report.feederSlot?.moduleNo).toBe(1);
      expect(report.feederSlot?.slotNo).toBe(1);
      expect(report.feederSlot?.feederId).toBe('FID-W08F-01');

      // Reel Lot
      expect(report.componentReel).toBeDefined();
      expect(report.componentReel?.lotNumber).toBe('LOT-MUR-2601');
      expect(report.componentReel?.supplierName).toBe('Murata Electronics');

      // Pick Nozzle
      expect(report.nozzleTelemetry).toBeDefined();
      expect(report.nozzleTelemetry?.nozzleId).toBe('NOZ-0402-A');

      // Solder Paste Lot
      expect(report.solderPaste).toBeDefined();
      expect(report.solderPaste?.jarId).toBe('JAR-ALPHA-2601-C');
      expect(report.solderPaste?.lotNumber).toBe('LOT-PASTE-2601');

      // Stencil
      expect(report.stencil).toBeDefined();
      expect(report.stencil?.serialNumber).toBe('STN-2026-0042');

      // Diagnostic Hypothesis
      expect(report.rootCauseHypothesis).toContain('Solder surface tension imbalance');
      expect(report.rootCauseHypothesis).toContain('C12');
    });
  });

  describe('7. Repeat Defect Sentinel & Production Interlock', () => {
    it('Consecutive failures on the same RefDes trip repeat defect interlock and command SMT hold', async () => {
      // Ingest 3 consecutive panels with C14 tombstone defect (threshold is 3)
      for (let i = 1; i <= 3; i++) {
        const canonical: CanonicalAoiInspectionResult = {
          sourceSystem: 'KOH_YOUNG_3D_AOI',
          sourceInspectionId: `KY-REPEAT-INSP-${i}`,
          sourceFileHash: `hash-repeat-${i}`,
          panelBarcode: `PNL-REPEAT-${i}`,
          batchId: 'job-01',
          workCenterId: 'wc-aoi-01',
          opticalMachineId: 'KY-ZENITH-01',
          inspectionPhase: 'POST_REFLOW',
          result: 'FAIL',
          totalDefects: 1,
          timestamp: new Date(Date.now() + i * 1000).toISOString(),
          defects: [
            {
              defectId: `def-rep-${i}`,
              unitPosition: 1,
              refDes: 'C14',
              category: 'SOLDER',
              defectType: 'TOMBSTONE',
              boardSide: 'TOP'
            }
          ]
        };

        const res = await QualityEngineService.ingestInspection(canonical);
        if (i === 3) {
          expect(res.interlockTripped).toBe(true);
          expect(res.sentinelEvaluation.trippedSignatures.length).toBeGreaterThan(0);
          expect(res.sentinelEvaluation.trippedSignatures[0].consecutiveCount).toBeGreaterThanOrEqual(3);
        }
      }

      // Check that Fuji SMT placement machine hold was commanded
      const holdStatus = fujiAdapter.isHoldActive();
      expect(holdStatus.active).toBe(true);
      expect(holdStatus.reason).toContain('Consecutive defect limit reached');

      // Check DB work_centers state
      const db = getDatabase();
      const wc = await db.query<{ current_state: string }>(
        `SELECT current_state FROM work_centers WHERE id = 'wc-nxt-01'`
      );
      expect(wc[0].current_state).toBe('QUALITY_HOLD');
    });

    it('Supervisor clears repeat defect interlock with authorization reason', async () => {
      await RepeatDefectSentinelService.clearInterlock(
        'wc-nxt-01',
        'sup-smt-01',
        'Cleaned feeder 1 tape track and verified solder paste volume.'
      );

      const holdStatus = fujiAdapter.isHoldActive();
      expect(holdStatus.active).toBe(false);

      const db = getDatabase();
      const wc = await db.query<{ current_state: string }>(
        `SELECT current_state FROM work_centers WHERE id = 'wc-nxt-01'`
      );
      expect(wc[0].current_state).toBe('RUNNING');
    });
  });
});
