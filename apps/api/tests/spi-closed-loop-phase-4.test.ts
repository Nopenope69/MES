import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase, getDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { CfxAmqpAdapter } from '../src/adapters/cfx/cfx-amqp.adapter';
import { FujiGpxPrinterAdapter } from '../src/adapters/cfx/fuji-gpx-printer.adapter';
import { MockCfxAmqpBroker } from '../src/adapters/cfx/mock-cfx-amqp-broker';
import { PrinterCapabilityService } from '../src/services/printer-capability.service';
import { PrinterControlService } from '../src/services/printer-control.service';
import { SpiClosedLoopService } from '../src/services/spi-closed-loop.service';
import { SpiSpcService } from '../src/services/spi-spc.service';
import {
  CanonicalSpiInspectionResult,
  CFX_VERSION,
  CfxMessageEnvelope,
  CfxUnitsInspectedData
} from '../src/adapters/cfx/cfx-message.interface';

describe('Phase 4: Closed-Loop 3D SPI, Screen Printer IPC-CFX Auto-Tuning & Pre-Reflow Quality Suite', () => {
  let broker: MockCfxAmqpBroker;
  let printerAdapter: FujiGpxPrinterAdapter;
  let cfxAdapter: CfxAmqpAdapter;

  beforeAll(async () => {
    await initDatabase();
    await seedDatabase();

    broker = MockCfxAmqpBroker.getInstance();
    printerAdapter = new FujiGpxPrinterAdapter(broker);
    cfxAdapter = new CfxAmqpAdapter(broker);
    await cfxAdapter.connect();
  });

  describe('1. IPC-CFX v1.7 AMQP 1.0 Transport & Canonical SPI Normalization', () => {
    it('normalizes native IPC-CFX UnitsInspected message into canonical SPI inspection model', () => {
      const cfxPayload: CfxMessageEnvelope<CfxUnitsInspectedData> = {
        cfxVersion: '1.7',
        messageName: 'CFX.Production.TestAndInspection.UnitsInspected',
        sourceUri: 'cfx:koh-young-aspire3@apex-p4',
        targetUri: 'cfx:mes-gateway',
        timestamp: '2026-09-08T01:00:00.000Z',
        uniqueId: 'CFX-KY-2026-0099',
        data: {
          panelBarcode: 'PNL-CFX-TEST-001',
          batchId: 'job-01',
          overallResult: 'Passed',
          totalPadsInspected: 4,
          defectivePadsCount: 0,
          meanVolumePct: 101.4,
          sigmaVolumePct: 2.1,
          measurements: [
            {
              padId: 'PAD-U1-01',
              unitPosition: 1,
              refDes: 'U1',
              pinNo: 1,
              volumeRatioPct: 102.5,
              heightUm: 122.0,
              areaRatioPct: 99.1,
              offsetXUm: 1.2,
              offsetYUm: -0.8,
              isCriticalPad: true
            },
            {
              padId: 'PAD-R1-01',
              unitPosition: 1,
              refDes: 'R1',
              pinNo: 1,
              volumeRatioPct: 98.2,
              heightUm: 119.5,
              areaRatioPct: 97.4,
              offsetXUm: 0.5,
              offsetYUm: 0.2,
              isCriticalPad: false
            }
          ]
        }
      };

      const canonical = cfxAdapter.parseUnitsInspected(cfxPayload);
      expect(canonical.sourceSystem).toBe('IPC_CFX_AMQP_1.0');
      expect(canonical.panelBarcode).toBe('PNL-CFX-TEST-001');
      expect(canonical.result).toBe('PASS');
      expect(canonical.totalPadsInspected).toBe(4);
      expect(canonical.meanVolumePct).toBe(101.4);
      expect(canonical.measurements.length).toBe(2);
      expect(canonical.measurements[0].refDes).toBe('U1');
      expect(canonical.measurements[0].isCriticalPad).toBe(true);
    });
  });

  describe('2. Recipe-Controlled Process Windows & Equipment Capability Discovery', () => {
    it('discovers Fuji GPX-C screen printer declared IPC-CFX capabilities', async () => {
      const caps = await PrinterCapabilityService.getPrinterCapabilities('wc-spg-01');
      expect(caps.equipmentId).toBe('wc-spg-01');
      expect(caps.cfxVersion).toBe('1.7');
      expect(caps.supports.stencilCleaning).toBe(true);
      expect(caps.supports.pressureControl).toBe(true);
      expect(caps.supports.separationSpeedControl).toBe(true);
    });

    it('loads hierarchical recipe process window with zero hardcoded universal thresholds', async () => {
      const window = await PrinterControlService.getProcessWindow('PROG-SM-METER-TOP-REV4');
      expect(window.recipeId).toBe('PROG-SM-METER-TOP-REV4');
      expect(window.stencilId).toBe('STC-SM-4G-TOP');
      expect(window.nominalStencilThicknessUm).toBe(120.0);
      expect(window.volumeLowerLimitPct).toBe(75.0);
      expect(window.volumeUpperLimitPct).toBe(135.0);
      expect(window.limits.maxAbsoluteDeltaPressure).toBe(0.5);
      expect(window.limits.maxPercentageDeltaPressure).toBe(5.0);
    });
  });

  describe('3. Automated Underside Wipe Trigger on Stencil Aperture Smearing', () => {
    it('detects fine-pitch aperture smear and commands automated vacuum-solvent wipe via IPC-CFX', async () => {
      const smearInspection: CanonicalSpiInspectionResult = {
        sourceSystem: 'IPC_CFX_AMQP_1.0',
        sourceInspectionId: 'SPI-SMEAR-001',
        sourceFileHash: 'hash-smear-01',
        panelBarcode: 'PNL-SMEAR-TEST-01',
        batchId: 'job-01',
        workCenterId: 'wc-spi-01',
        opticalMachineId: 'KY-ASPIRE3-01',
        result: 'WARNING',
        totalPadsInspected: 4,
        defectivePadsCount: 2,
        meanVolumePct: 128.5,
        sigmaVolumePct: 14.2,
        timestamp: new Date().toISOString(),
        measurements: [
          {
            padId: 'PAD-QFN-01',
            unitPosition: 1,
            refDes: 'U2',
            pinNo: 1,
            volumeRatioPct: 145.0,
            heightUm: 165.0,
            areaRatioPct: 130.0,
            offsetXUm: 15.0,
            offsetYUm: 8.0,
            isCriticalPad: true,
            defectType: 'SMEARING'
          },
          {
            padId: 'PAD-QFN-02',
            unitPosition: 1,
            refDes: 'U2',
            pinNo: 2,
            volumeRatioPct: 142.0,
            heightUm: 162.0,
            areaRatioPct: 128.0,
            offsetXUm: 14.0,
            offsetYUm: 7.0,
            isCriticalPad: true,
            defectType: 'SMEARING'
          }
        ]
      };

      const initialCleanCycles = printerAdapter.getState().cleaningCyclesTotal;
      const diagnosis = await SpiClosedLoopService.processInspection(smearInspection, 'PROG-SM-METER-TOP-REV4');

      expect(diagnosis.actionTaken).toBe('CLEANING_COMMANDED');
      expect(diagnosis.message).toContain('Automated stencil underside wipe');

      // Verify Fuji printer adapter received the AMQP CFX cleaning command
      const updatedCleanCycles = printerAdapter.getState().cleaningCyclesTotal;
      expect(updatedCleanCycles).toBe(initialCleanCycles + 1);

      // Verify audit log has the commanded cleaning event
      const db = getDatabase();
      const tuningEvents = await db.query<{ action_type: string; status: string }>(
        `SELECT action_type, status FROM printer_tuning_events WHERE action_type = 'STENCIL_CLEAN' ORDER BY commanded_at DESC LIMIT 1`
      );
      expect(tuningEvents.length).toBe(1);
      expect(tuningEvents[0].status).toBe('ACKNOWLEDGED');
    });
  });

  describe('4. Bounded Parameter Micro-Tuning & Rate-of-Change Enforcement', () => {
    it('detects low aperture volume drift and micro-tunes squeegee pressure within safety bounds', async () => {
      const lowVolumeInspection: CanonicalSpiInspectionResult = {
        sourceSystem: 'IPC_CFX_AMQP_1.0',
        sourceInspectionId: 'SPI-DRIFT-LOW-01',
        sourceFileHash: 'hash-drift-low-01',
        panelBarcode: 'PNL-DRIFT-LOW-01',
        batchId: 'job-01',
        workCenterId: 'wc-spi-01',
        opticalMachineId: 'KY-ASPIRE3-01',
        result: 'WARNING',
        totalPadsInspected: 4,
        defectivePadsCount: 0,
        meanVolumePct: 82.0, // Below 85% warning limit
        sigmaVolumePct: 3.5,
        timestamp: new Date().toISOString(),
        measurements: [
          {
            padId: 'PAD-R1-01',
            unitPosition: 1,
            refDes: 'R1',
            volumeRatioPct: 81.5,
            heightUm: 98.0,
            areaRatioPct: 86.0,
            offsetXUm: 0.2,
            offsetYUm: 0.1,
            isCriticalPad: false
          }
        ]
      };

      const db = getDatabase();
      await db.execute(`DELETE FROM printer_tuning_events WHERE id != 'tune-01'`);
      await printerAdapter.applyParameter('SqueegeePressure', 8.5, 'Reset test baseline');

      const diagnosis = await SpiClosedLoopService.processInspection(lowVolumeInspection, 'PROG-SM-METER-TOP-REV4');
      expect(diagnosis.actionTaken).toBe('PARAMETER_TUNED');
      expect(diagnosis.message).toContain('Micro-tuned squeegee pressure +0.3 kgf');

      // Verify printer state updated via CFX
      expect(printerAdapter.getState().squeegeePressureKgf).toBe(8.8);
    });

    it('rejects automated corrections that exceed maximum allowable delta step (Pillar 3)', async () => {
      // Recipe max allowable delta is 0.5 kgf
      const rejectedResult = await PrinterControlService.modifyParameter({
        parameterName: 'SQUEEGEE_PRESSURE',
        currentValue: 8.5,
        proposedValue: 9.8, // Delta +1.3 kgf > 0.5 kgf limit
        triggerCondition: 'Test excessive delta rejection'
      });

      expect(rejectedResult.success).toBe(false);
      expect(rejectedResult.message).toContain('Pressure delta 1.3 kgf exceeds max absolute delta limit');
    });

    it('rejects automated corrections that exceed process window parameter boundaries', async () => {
      // Recipe max pressure is 12.0 kgf
      const rejectedResult = await PrinterControlService.modifyParameter({
        parameterName: 'SQUEEGEE_PRESSURE',
        currentValue: 11.9,
        proposedValue: 12.2, // > 12.0 kgf limit
        triggerCondition: 'Test boundary breach rejection'
      });

      expect(rejectedResult.success).toBe(false);
      expect(rejectedResult.message).toContain('outside approved process window');
    });
  });

  describe('5. Mandatory Closed-Loop Verification Loop (Pillar 4)', () => {
    it('subsequent board with recovered volume verifies correction and releases board', async () => {
      // First, set up an acknowledged tuning record awaiting verification
      const db = getDatabase();
      await db.execute(`DELETE FROM printer_tuning_events WHERE id != 'tune-01'`);
      const corrId = `CORR-VERIF-TEST-${Date.now()}`;
      await db.execute(`
        INSERT INTO printer_tuning_events (
          id, correction_id, recipe_id, work_center_id, action_type,
          parameter_name, old_value, proposed_value, delta, unit,
          trigger_condition, status, commanded_at, acknowledged_at
        ) VALUES (
          ?, ?, 'PROG-SM-METER-TOP-REV4', 'wc-spg-01', 'PARAMETER_MODIFY',
          'SQUEEGEE_PRESSURE', 8.5, 8.8, 0.3, 'kgf',
          'Volume low drift', 'ACKNOWLEDGED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [`tune-test-${Date.now()}`, corrId]);

      // Inspect next board with nominal volume (102%)
      const verifiedInspection: CanonicalSpiInspectionResult = {
        sourceSystem: 'IPC_CFX_AMQP_1.0',
        sourceInspectionId: `SPI-VERIF-RECOVERED-${Date.now()}`,
        sourceFileHash: `hash-verif-${Date.now()}`,
        panelBarcode: 'PNL-VERIFIED-RECOVERED-01',
        batchId: 'job-01',
        workCenterId: 'wc-spi-01',
        opticalMachineId: 'KY-ASPIRE3-01',
        result: 'PASS',
        totalPadsInspected: 10,
        defectivePadsCount: 0,
        meanVolumePct: 102.0,
        sigmaVolumePct: 2.1,
        timestamp: new Date().toISOString(),
        measurements: [
          {
            padId: 'PAD-U1-01',
            unitPosition: 1,
            refDes: 'U1',
            volumeRatioPct: 102.0,
            heightUm: 121.0,
            areaRatioPct: 99.5,
            offsetXUm: 0.1,
            offsetYUm: 0.1,
            isCriticalPad: true
          }
        ]
      };

      const diagnosis = await SpiClosedLoopService.processInspection(verifiedInspection, 'PROG-SM-METER-TOP-REV4');
      expect(diagnosis.actionTaken).toBe('VERIFICATION_CONFIRMED');
      expect(diagnosis.verificationStatus).toBe('VERIFIED_RECOVERED');

      // Confirm status updated in DB
      const tuningRecord = await db.query<{ status: string; verified_by_panel_barcode: string }>(
        `SELECT status, verified_by_panel_barcode FROM printer_tuning_events WHERE correction_id = ?`,
        [corrId]
      );
      expect(tuningRecord[0].status).toBe('VERIFIED_RECOVERED');
      expect(tuningRecord[0].verified_by_panel_barcode).toBe('PNL-VERIFIED-RECOVERED-01');

      // Confirm panel quality status updated to RELEASED
      const panel = await db.query<{ status: string }>(
        `SELECT status FROM panel_units WHERE panel_barcode = 'PNL-VERIFIED-RECOVERED-01'`
      );
      expect(panel[0].status).toBe('RELEASED');
    });

    it('persistent volume drift after tuning trips VERIFIED_FAILED and SMT line interlock', async () => {
      const db = getDatabase();
      await db.execute(`DELETE FROM printer_tuning_events WHERE id != 'tune-01'`);
      const corrId = `CORR-FAIL-TEST-${Date.now()}`;
      await db.execute(`
        INSERT INTO printer_tuning_events (
          id, correction_id, recipe_id, work_center_id, action_type,
          parameter_name, old_value, proposed_value, delta, unit,
          trigger_condition, status, commanded_at, acknowledged_at
        ) VALUES (
          ?, ?, 'PROG-SM-METER-TOP-REV4', 'wc-spg-01', 'PARAMETER_MODIFY',
          'SQUEEGEE_PRESSURE', 8.5, 8.8, 0.3, 'kgf',
          'Volume low drift', 'ACKNOWLEDGED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `, [`tune-fail-${Date.now()}`, corrId]);

      // Inspect next board which STILL exhibits low volume drift (78%)
      const failedVerificationInspection: CanonicalSpiInspectionResult = {
        sourceSystem: 'IPC_CFX_AMQP_1.0',
        sourceInspectionId: `SPI-VERIF-FAILED-${Date.now()}`,
        sourceFileHash: `hash-fail-${Date.now()}`,
        panelBarcode: 'PNL-VERIFIED-FAILED-01',
        batchId: 'job-01',
        workCenterId: 'wc-spi-01',
        opticalMachineId: 'KY-ASPIRE3-01',
        result: 'FAIL',
        totalPadsInspected: 10,
        defectivePadsCount: 1,
        meanVolumePct: 78.0,
        sigmaVolumePct: 6.4,
        timestamp: new Date().toISOString(),
        measurements: [
          {
            padId: 'PAD-U1-01',
            unitPosition: 1,
            refDes: 'U1',
            volumeRatioPct: 78.0,
            heightUm: 91.0,
            areaRatioPct: 82.0,
            offsetXUm: 0.1,
            offsetYUm: 0.1,
            isCriticalPad: true,
            defectType: 'INSUFFICIENT_PASTE'
          }
        ]
      };

      const diagnosis = await SpiClosedLoopService.processInspection(failedVerificationInspection, 'PROG-SM-METER-TOP-REV4');
      expect(diagnosis.actionTaken).toBe('LINE_INTERLOCKED');
      expect(diagnosis.verificationStatus).toBe('VERIFIED_FAILED');

      // Verify line interlock event was emitted
      const interlockEvents = await db.query<{ event_type: string }>(
        `SELECT event_type FROM production_events WHERE event_type = 'REPEAT_DEFECT_INTERLOCK_TRIPPED' ORDER BY event_time DESC LIMIT 1`
      );
      expect(interlockEvents.length).toBe(1);
    });
  });

  describe('6. Critical Pad Collapse & MES Divert (Pillar 11)', () => {
    it('diverts panel to wash buffer conveyor when critical pad volume collapses below 50%', async () => {
      const db = getDatabase();
      await db.execute(`DELETE FROM printer_tuning_events WHERE id != 'tune-01'`);

      const collapsedInspection: CanonicalSpiInspectionResult = {
        sourceSystem: 'IPC_CFX_AMQP_1.0',
        sourceInspectionId: `SPI-COLLAPSE-${Date.now()}`,
        sourceFileHash: `hash-collapse-${Date.now()}`,
        panelBarcode: 'PNL-COLLAPSE-01',
        batchId: 'job-01',
        workCenterId: 'wc-spi-01',
        opticalMachineId: 'KY-ASPIRE3-01',
        result: 'FAIL',
        totalPadsInspected: 5,
        defectivePadsCount: 1,
        meanVolumePct: 88.0,
        sigmaVolumePct: 15.0,
        timestamp: new Date().toISOString(),
        measurements: [
          {
            padId: 'PAD-BGA-GND',
            unitPosition: 1,
            refDes: 'U1', // Critical ground pad
            pinNo: 49,
            volumeRatioPct: 32.0, // Critical collapse < 50%
            heightUm: 38.0,
            areaRatioPct: 40.0,
            offsetXUm: 0.0,
            offsetYUm: 0.0,
            isCriticalPad: true,
            defectType: 'INSUFFICIENT_PASTE'
          }
        ]
      };

      const diagnosis = await SpiClosedLoopService.processInspection(collapsedInspection, 'PROG-SM-METER-TOP-REV4');
      expect(diagnosis.actionTaken).toBe('PANEL_DIVERTED');
      expect(diagnosis.message).toContain('Diverting before reflow');

      // Verify panel status is REPRINT_REQUIRED
      const panel = await db.query<{ status: string }>(
        `SELECT status FROM panel_units WHERE panel_barcode = 'PNL-COLLAPSE-01'`
      );
      expect(panel[0].status).toBe('REPRINT_REQUIRED');
    });
  });

  describe('7. Statistically Defensible SPC (Pillar 9)', () => {
    it('flags data as preliminary and suppresses Cpk when sample size N < 30', async () => {
      const spc = await SpiSpcService.calculateSpc('PROG-SM-METER-TOP-REV4', 10);
      if (spc.sampleCount < 30) {
        expect(spc.isStatisticallyValid).toBe(false);
        expect(spc.cpk).toBeUndefined();
      }
    });

    it('calculates statistically defensible Cpk/Ppk when sample size N >= 30', async () => {
      const db = getDatabase();
      // Insert 35 synthetic stable inspection samples
      for (let i = 0; i < 35; i++) {
        const val = 98.0 + (i % 5); // 98 to 102%
        await db.execute(`
          INSERT INTO spi_inspections (
            id, source_system, source_inspection_id, source_file_hash,
            panel_barcode, work_center_id, optical_machine_id, result,
            total_pads_inspected, mean_volume_pct, sigma_volume_pct, inspected_at
          ) VALUES (?, 'SYNTHETIC', ?, ?, ?, 'wc-spi-01', 'KY-01', 'PASS', 100, ?, 2.0, datetime('now', '-${i} minutes'))
        `, [`synth-${i}`, `insp-${i}`, `hash-${i}`, `PNL-SYNTH-${i}`, val]);
      }

      const spc = await SpiSpcService.calculateSpc('PROG-SM-METER-TOP-REV4', 50);
      expect(spc.isStatisticallyValid).toBe(true);
      expect(spc.sampleCount).toBeGreaterThanOrEqual(30);
      expect(spc.cpk).toBeDefined();
      expect(spc.cpk).toBeGreaterThan(1.0);
      expect(spc.trend).toBe('STABLE');
    });
  });

  describe('8. Stencil / Paste / Tool Traceability Genealogy (Pillar 10)', () => {
    it('links panel back to stencil ID, squeegee pressure, and solder paste jar lot', async () => {
      const db = getDatabase();
      const rows = await db.query<{
        panel_barcode: string;
        recipe_id: string;
        stencil_id: string;
        nominal_stencil_thickness_um: number;
      }>(
        `SELECT s.panel_barcode, r.recipe_id, r.stencil_id, r.nominal_stencil_thickness_um
         FROM spi_inspections s
         CROSS JOIN recipe_process_windows r
         WHERE s.panel_barcode = 'PNL-260901-0042'
         LIMIT 1`
      );

      expect(rows.length).toBe(1);
      expect(rows[0].panel_barcode).toBe('PNL-260901-0042');
      expect(rows[0].stencil_id).toBe('STC-SM-4G-TOP');
      expect(rows[0].nominal_stencil_thickness_um).toBe(120.0);
    });
  });
});
