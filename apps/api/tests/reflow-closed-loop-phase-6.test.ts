import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { initDatabase, getDatabase, IDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { EventStoreModule } from '../src/modules/event-store/event-store.module';
import { MachineControlModule } from '../src/modules/machine-control/machine-control.module';
import { InMemoryEquipmentAdapter } from '../src/modules/machine-control/in-memory-equipment.adapter';
import { ReflowProfilingModule } from '../src/modules/reflow-profiling/reflow-profiling.module';
import { ReflowProfileStore } from '../src/modules/reflow-profiling/storage/reflow-profile.store';
import { TelemetryStore } from '../src/services/telemetry-store.service';
import { KicImporterAdapter } from '../src/modules/reflow-profiling/adapters/kic-importer.adapter';
import { DatapaqImporterAdapter } from '../src/modules/reflow-profiling/adapters/datapaq-importer.adapter';
import { MoleImporterAdapter } from '../src/modules/reflow-profiling/adapters/mole-importer.adapter';
import { PwiCalculationService } from '../src/modules/reflow-profiling/services/pwi-calculation.service';
import { RecipeSpecificationService } from '../src/modules/reflow-profiling/services/recipe-specification.service';
import { ProfileLifecycleService } from '../src/modules/reflow-profiling/services/profile-lifecycle.service';
import { ProfilerImportService } from '../src/modules/reflow-profiling/services/profiler-import.service';
import { OvenDriftService } from '../src/modules/reflow-profiling/services/oven-drift.service';
import { ThermalImpactService } from '../src/modules/reflow-profiling/services/thermal-impact.service';
import { ProfileCorrelationService } from '../src/modules/reflow-profiling/services/profile-correlation.service';
import {
  ReflowThermalSpecification,
  OvenDriftReport,
  ReflowProfileRun
} from '@mes/shared';

describe('Phase 6: Closed-Loop Reflow Oven Telemetry & Thermal Profiling Engine', () => {
  const fixturesDir = path.join(__dirname, 'fixtures', 'reflow');

  let db: IDatabase;
  let reflowModule: ReflowProfilingModule;
  let profileStore: ReflowProfileStore;
  let eventStore: EventStoreModule;
  let machineControl: MachineControlModule;
  let telemetryStore: TelemetryStore;
  let pwiService: PwiCalculationService;
  let specService: RecipeSpecificationService;
  let lifecycleService: ProfileLifecycleService;
  let importService: ProfilerImportService;
  let driftService: OvenDriftService;
  let impactService: ThermalImpactService;
  let correlationService: ProfileCorrelationService;

  // Standard test scope (aligned with seed database baseline)
  const testScope = {
    lineId: 'line-smt-01',
    equipmentId: 'wc-rfl-01',
    recipeId: 'PROG-SM-METER-TOP-REV4',
    boardPartNumber: 'PRD-SM-4G-V2',
    boardRevision: 'REV4'
  };

  // Helper to structure simulated telemetry for OvenDriftService
  function toSimulatedTelemetry(points: Array<{ zoneTemperatures: number[]; conveyorSpeedMPerMin?: number; oxygenPpm?: number }>) {
    const zones: Array<{ zoneIndex: number; temperaturesC: number[] }> = [];
    for (let z = 1; z <= 10; z++) {
      zones.push({
        zoneIndex: z,
        temperaturesC: points.map(p => p.zoneTemperatures[z - 1] ?? 240.0)
      });
    }
    return {
      zones,
      conveyorSpeedCmPerMin: points.map(p => (p.conveyorSpeedMPerMin ?? 0.9) * 100),
      oxygenPpm: points.map(p => p.oxygenPpm ?? 500)
    };
  }

  beforeEach(async () => {
    await initDatabase();
    await seedDatabase();
    db = getDatabase();

    ReflowProfilingModule.resetInstance();

    eventStore = EventStoreModule.getInstance();
    machineControl = MachineControlModule.getInstance();
    telemetryStore = TelemetryStore.getInstance();
    profileStore = new ReflowProfileStore(db);
    reflowModule = ReflowProfilingModule.getInstance();

    pwiService = new PwiCalculationService();
    specService = new RecipeSpecificationService(profileStore);
    lifecycleService = new ProfileLifecycleService(profileStore, eventStore);
    impactService = new ThermalImpactService();
    driftService = new OvenDriftService(
      profileStore,
      specService,
      impactService,
      telemetryStore,
      machineControl,
      eventStore
    );
    correlationService = new ProfileCorrelationService(profileStore, telemetryStore);
    importService = new ProfilerImportService(
      profileStore,
      specService,
      pwiService,
      eventStore
    );

    // Register reflow oven equipment adapter with HOLD and CONVEYOR_STOP capabilities
    const reflowAdapter = new InMemoryEquipmentAdapter('wc-rfl-01', 'Heller 1913 MK5 Reflow Oven', 'wc-rfl-01', [
      'HOLD', 'CONVEYOR_STOP', 'INTERLOCK_ENGAGE'
    ]);
    machineControl.registerAdapter(reflowAdapter);
  });

  // --------------------------------------------------------------------------
  // Category 01: Adapter Dispatch
  // --------------------------------------------------------------------------
  describe('01. Adapter Dispatch', () => {
    it('sniffs and routes KIC, Datapaq, and M.O.L.E. file signatures cleanly', async () => {
      const kicBuf = fs.readFileSync(path.join(fixturesDir, 'kic-golden.kic'));
      const datapaqBuf = fs.readFileSync(path.join(fixturesDir, 'datapaq-golden.paq'));
      const moleBuf = fs.readFileSync(path.join(fixturesDir, 'mole-golden.mdm'));

      const kicAdapter = new KicImporterAdapter();
      const datapaqAdapter = new DatapaqImporterAdapter();
      const moleAdapter = new MoleImporterAdapter();

      expect(kicAdapter.canParse({ fileName: 'run.kic', buffer: kicBuf, fileSizeBytes: kicBuf.length })).toBe(true);
      expect(datapaqAdapter.canParse({ fileName: 'run.paq', buffer: datapaqBuf, fileSizeBytes: datapaqBuf.length })).toBe(true);
      expect(moleAdapter.canParse({ fileName: 'run.mdm', buffer: moleBuf, fileSizeBytes: moleBuf.length })).toBe(true);

      // Verify cross-format rejection
      expect(kicAdapter.canParse({ fileName: 'run.paq', buffer: datapaqBuf, fileSizeBytes: datapaqBuf.length })).toBe(false);
      expect(datapaqAdapter.canParse({ fileName: 'run.mdm', buffer: moleBuf, fileSizeBytes: moleBuf.length })).toBe(false);
    });

    it('rejects unsupported file formats with descriptive error', async () => {
      const unknownBuf = Buffer.from('BINARY_UNKNOWN_HEADER_XYZ_1234567890');
      await expect(
        importService.importProfileFile({
          file: { fileName: 'unknown.bin', buffer: unknownBuf, fileSizeBytes: unknownBuf.length },
          ...testScope,
          importedBy: 'OPERATOR-SMT'
        })
      ).rejects.toThrow(/UNSUPPORTED_FORMAT/);
    });
  });

  // --------------------------------------------------------------------------
  // Category 02: Importer Security & Fuzzing
  // --------------------------------------------------------------------------
  describe('02. Importer Security & Fuzzing', () => {
    it('rejects XML external entity (XXE) expansion attempt with zero crash', async () => {
      const xxeBuf = fs.readFileSync(path.join(fixturesDir, 'xxe-payload.xml'));
      const kicAdapter = new KicImporterAdapter();

      await expect(
        kicAdapter.parse({ fileName: 'xxe.kic', buffer: xxeBuf, fileSizeBytes: xxeBuf.length })
      ).rejects.toThrow(/SECURITY_VIOLATION.*XXE/i);
    });

    it('enforces 15MB file size limit', async () => {
      const kicAdapter = new KicImporterAdapter();
      const largeFile = {
        fileName: 'huge.kic',
        buffer: Buffer.alloc(10),
        fileSizeBytes: 16 * 1024 * 1024 // 16MB
      };

      await expect(kicAdapter.parse(largeFile)).rejects.toThrow(/FILE_SIZE_EXCEEDED/);
    });

    it('sanitizes NaN and Infinity temperatures cleanly during parsing', async () => {
      const badData = `[KIC 2000 Profile]\nMODEL = SlimKIC 2000\n[DATA]\nTime,TC1\n0.0,25.0\n1.0,NaN\n2.0,Infinity\n3.0,500.0\n`;
      const buf = Buffer.from(badData, 'utf8');
      const adapter = new KicImporterAdapter();
      await expect(
        adapter.parse({ fileName: 'bad.kic', buffer: buf, fileSizeBytes: buf.length })
      ).rejects.toThrow(/INVALID_DATA/);
    });
  });

  // --------------------------------------------------------------------------
  // Category 03: Structural Normalization
  // --------------------------------------------------------------------------
  describe('03. Structural Normalization', () => {
    it('rejects non-monotonic and backwards timestamps during validation', async () => {
      const corruptBuf = fs.readFileSync(path.join(fixturesDir, 'corrupt-timestamps.kic'));

      await expect(
        importService.importProfileFile({
          file: { fileName: 'corrupt.kic', buffer: corruptBuf, fileSizeBytes: corruptBuf.length },
          ...testScope,
          importedBy: 'OPERATOR-SMT'
        })
      ).rejects.toThrow(/NON_MONOTONIC_TIMESTAMPS/);

      // Verify REFLOW_PROFILE_VALIDATED event with status 'FAILED' was emitted to production_events
      const events = await db.query<any>(
        'SELECT event_type, payload_json FROM production_events WHERE event_type = ?',
        ['REFLOW_PROFILE_VALIDATED']
      );
      const failed = events.find(e => JSON.parse(e.payload_json).status === 'FAILED');
      expect(failed).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Category 04: Units & Calibration
  // --------------------------------------------------------------------------
  describe('04. Units & Calibration', () => {
    it('accurately converts Fahrenheit to Celsius and minutes to seconds', async () => {
      // 466.7 °F = (466.7 - 32) * 5/9 = 241.5 °C
      // 1.5 minutes = 90 seconds
      const fahrenheitData = `[KIC 2000 Profile]\nMODEL = SlimKIC 2000\nTEMPERATUREUNIT = F\nTIMEUNIT = MIN\nTC1 = Leading\nOFFSET1 = 1.0\n[DATA]\nTime,TC1\n0.0,77.0\n1.5,466.7\n`;
      const buf = Buffer.from(fahrenheitData, 'utf8');
      const adapter = new KicImporterAdapter();
      const result = await adapter.parse({ fileName: 'f_test.kic', buffer: buf, fileSizeBytes: buf.length });

      expect(result.probes[0].samples[0].timeSeconds).toBe(0.0);
      expect(result.probes[0].samples[0].temperatureC).toBeCloseTo(25.0 + 1.0, 1); // 77°F = 25°C + 1.0 offset
      expect(result.probes[0].samples[1].timeSeconds).toBe(90.0);
      expect(result.probes[0].samples[1].temperatureC).toBeCloseTo(241.5 + 1.0, 1); // 466.7°F = 241.5°C + 1.0 offset
    });
  });

  // --------------------------------------------------------------------------
  // Category 05: PWI Exact Calculation
  // --------------------------------------------------------------------------
  describe('05. PWI Mathematical Accuracy', () => {
    it('computes exact benchmark values: Ramp=20.0%, overall PWI=20.0% on compliant golden fixture', async () => {
      const kicBuf = fs.readFileSync(path.join(fixturesDir, 'kic-golden.kic'));

      const result = await importService.importProfileFile({
        file: { fileName: 'kic-golden.kic', buffer: kicBuf, fileSizeBytes: kicBuf.length },
        ...testScope,
        importedBy: 'OPERATOR-SMT'
      });

      expect(result.run.status).toBe('REVIEW_REQUIRED');
      expect(result.run.analysisResult.overallPwi).toBeCloseTo(20.0, 1);
      expect(result.run.analysisResult.complianceResult).toBe('PASS');
    });

    it('computes exact out-of-spec TAL PWI = 131.1% on out-of-spec fixture', async () => {
      const failBuf = fs.readFileSync(path.join(fixturesDir, 'out-of-spec-tal.kic'));

      const result = await importService.importProfileFile({
        file: { fileName: 'out-of-spec-tal.kic', buffer: failBuf, fileSizeBytes: failBuf.length },
        ...testScope,
        importedBy: 'OPERATOR-SMT'
      });

      expect(result.run.analysisResult.complianceResult).toBe('FAIL');
      expect(result.run.analysisResult.overallPwi).toBeCloseTo(131.1, 1);
    });
  });

  // --------------------------------------------------------------------------
  // Category 06: PWI Boundary Conditions
  // --------------------------------------------------------------------------
  describe('06. PWI Boundary Conditions', () => {
    it('strictly evaluates compliance thresholds: <80% PASS, 80-100% WARNING, >100% FAIL', () => {
      expect(pwiService.evaluateCompliance(0.0)).toBe('PASS');
      expect(pwiService.evaluateCompliance(79.99)).toBe('PASS');
      expect(pwiService.evaluateCompliance(80.00)).toBe('WARNING');
      expect(pwiService.evaluateCompliance(99.99)).toBe('WARNING');
      expect(pwiService.evaluateCompliance(100.00)).toBe('WARNING');
      expect(pwiService.evaluateCompliance(100.01)).toBe('FAIL');
      expect(pwiService.evaluateCompliance(131.1)).toBe('FAIL');
    });
  });

  // --------------------------------------------------------------------------
  // Category 07: Probe-Specific Constraints
  // --------------------------------------------------------------------------
  describe('07. Probe-Specific Constraints', () => {
    it('evaluates probe-specific peak limits and coldspot constraints', async () => {
      const customSpec: ReflowThermalSpecification = {
        recipeId: 'PROG-SPEC-TEST',
        boardPartNumber: 'PRD-SPEC-TEST',
        boardRevision: 'REV-A',
        version: 1,
        status: 'ACTIVE',
        alloy: 'SAC305',
        solderPastePartNumber: 'ALPHA-OM-338',
        rampRate: { minSlopeCPerSec: 1.0, maxSlopeCPerSec: 3.0 },
        soak: { minDurationSeconds: 60, maxDurationSeconds: 120, minTempC: 150, maxTempC: 200 },
        tal: { liquidusTempC: 217, minDurationSeconds: 45, maxDurationSeconds: 90 },
        peakTemperature: { minPeakTempC: 235, maxPeakTempC: 248 },
        coolingRate: { minSlopeCPerSec: 1.0, maxSlopeCPerSec: 4.0 },
        probeConstraints: [
          {
            probeIndex: 2,
            targetLocation: 'BGA U1 Center',
            maxPeakTempC: 238.0 // Tighter than generic 248°C
          }
        ],
        createdBy: 'ENG-TEST'
      };
      await specService.createSpecification(customSpec);

      const probeMetrics = {
        maxRampRateCPerSec: 2.0,
        soakDurationSeconds: 90,
        timeAboveLiquidusSeconds: 67.5,
        peakTemperatureC: 240.0, // Violates probe constraint 238.0!
        maxCoolingRateCPerSec: 2.5
      };

      const pwi = pwiService.calculateProbePwi(2, 'BGA U1 Center', probeMetrics, customSpec);
      expect(pwi.characteristicPwi.peakTempPwi).toBeGreaterThan(100);
      expect(pwi.overallProbePwi).toBeGreaterThan(100);
    });
  });

  // --------------------------------------------------------------------------
  // Category 08: Specification Validation
  // --------------------------------------------------------------------------
  describe('08. Specification Validation', () => {
    it('rejects malformed thermal specifications at registration time', async () => {
      // 1. LSL >= USL
      await expect(
        specService.createSpecification({
          recipeId: 'BAD-SPEC',
          boardPartNumber: 'PART-1',
          boardRevision: 'REV-1',
          version: 1,
          status: 'ACTIVE',
          alloyType: 'SAC305',
          solderPastePartNumber: 'SP-1',
          rampRate: { minSlopeCPerSec: 3.5, maxSlopeCPerSec: 2.0 },
          soak: { minDurationSeconds: 60, maxDurationSeconds: 120, minTempC: 150, maxTempC: 200 },
          tal: { liquidusTempC: 217, minDurationSeconds: 45, maxDurationSeconds: 90 },
          peakTemperature: { minPeakTempC: 235, maxPeakTempC: 248 },
          coolingRate: { minSlopeCPerSec: 1.0, maxSlopeCPerSec: 4.0 },
          createdBy: 'TEST'
        })
      ).rejects.toThrow(/INVALID_SPECIFICATION_BOUNDS.*rampRate/);

      // 2. Negative soak duration
      await expect(
        specService.createSpecification({
          recipeId: 'BAD-SPEC',
          boardPartNumber: 'PART-1',
          boardRevision: 'REV-1',
          version: 1,
          status: 'ACTIVE',
          alloyType: 'SAC305',
          solderPastePartNumber: 'SP-1',
          rampRate: { minSlopeCPerSec: 1.0, maxSlopeCPerSec: 3.0 },
          soak: { minDurationSeconds: -10, maxDurationSeconds: 120, minTempC: 150, maxTempC: 200 },
          tal: { liquidusTempC: 217, minDurationSeconds: 45, maxDurationSeconds: 90 },
          peakTemperature: { minPeakTempC: 235, maxPeakTempC: 248 },
          coolingRate: { minSlopeCPerSec: 1.0, maxSlopeCPerSec: 4.0 },
          createdBy: 'TEST'
        })
      ).rejects.toThrow(/INVALID_SPECIFICATION_BOUNDS.*soak/);
    });
  });

  // --------------------------------------------------------------------------
  // Category 09: Activation Atomicity & PWI-FAIL Guard
  // --------------------------------------------------------------------------
  describe('09. Activation Atomicity & PWI-FAIL Guard', () => {
    it('strictly prohibits activating a profile run that failed PWI compliance', async () => {
      const failBuf = fs.readFileSync(path.join(fixturesDir, 'out-of-spec-tal.kic'));
      const { run: failRun } = await importService.importProfileFile({
        file: { fileName: 'out-of-spec-tal.kic', buffer: failBuf, fileSizeBytes: failBuf.length },
        ...testScope,
        importedBy: 'OPERATOR-SMT'
      });

      // Approving a failing profile run must be rejected
      await expect(
        lifecycleService.approveProfileRun({
          runId: failRun.id,
          approvedBy: 'QA-LEAD'
        })
      ).rejects.toThrow(/CANNOT_APPROVE_NON_COMPLIANT_PROFILE/);

      // Activation must fail with CANNOT_ACTIVATE_NON_COMPLIANT_PROFILE
      await expect(
        lifecycleService.activateProfileRun({
          runId: failRun.id,
          activatedBy: 'PROCESS-ENG'
        })
      ).rejects.toThrow(/CANNOT_ACTIVATE_NON_COMPLIANT_PROFILE/);
    });

    it('atomically retires previous active run when new compliant run is activated', async () => {
      // 1. Import compliant run 1 and activate
      const kicBuf = fs.readFileSync(path.join(fixturesDir, 'kic-golden.kic'));
      const { run: run1 } = await importService.importProfileFile({
        file: { fileName: 'run1.kic', buffer: kicBuf, fileSizeBytes: kicBuf.length },
        ...testScope,
        importedBy: 'OPERATOR-SMT'
      });
      await lifecycleService.approveProfileRun({
        runId: run1.id,
        approvedBy: 'QA-LEAD'
      });
      await lifecycleService.activateProfileRun({
        runId: run1.id,
        activatedBy: 'PROCESS-ENG'
      });

      let activeResult = await profileStore.getActiveProfileRun(testScope);
      expect(activeResult?.run.id).toBe(run1.id);

      // 2. Import compliant run 2 (different serial to test separate physical profile run) and activate
      const kicBuf2 = Buffer.from(kicBuf.toString('utf8').replace('KIC-99214', 'KIC-99215'), 'utf8');
      const { run: run2 } = await importService.importProfileFile({
        file: { fileName: 'run2.kic', buffer: kicBuf2, fileSizeBytes: kicBuf2.length },
        ...testScope,
        importedBy: 'OPERATOR-SMT'
      });
      await lifecycleService.approveProfileRun({
        runId: run2.id,
        approvedBy: 'QA-LEAD'
      });
      await lifecycleService.activateProfileRun({
        runId: run2.id,
        activatedBy: 'PROCESS-ENG'
      });

      // Verify run1 is RETIRED and run2 is ACTIVE
      const updatedRun1 = await profileStore.getProfileRunById(run1.id);
      const updatedRun2 = await profileStore.getProfileRunById(run2.id);

      expect(updatedRun1?.run.status).toBe('RETIRED');
      expect(updatedRun2?.run.status).toBe('ACTIVE');

      activeResult = await profileStore.getActiveProfileRun(testScope);
      expect(activeResult?.run.id).toBe(run2.id);
    });
  });

  // --------------------------------------------------------------------------
  // Category 10: Telemetry Correlation
  // --------------------------------------------------------------------------
  describe('10. Telemetry Correlation', () => {
    it('correlates profile run with contemporaneous oven telemetry window', async () => {
      const kicBuf = fs.readFileSync(path.join(fixturesDir, 'kic-golden.kic'));
      const { run } = await importService.importProfileFile({
        file: { fileName: 'corr.kic', buffer: kicBuf, fileSizeBytes: kicBuf.length },
        ...testScope,
        importedBy: 'OPERATOR-SMT'
      });

      const correlation = await correlationService.correlateRun(run, 0.5);
      expect(correlation).toBeDefined();
      expect(correlation.zones.length).toBe(10);
      expect(correlation.telemetryIntegrityScore).toBeGreaterThan(0.5);
    });
  });

  // --------------------------------------------------------------------------
  // Category 11: Bivariate Drift Detection
  // --------------------------------------------------------------------------
  describe('11. Bivariate Drift Detection', () => {
    it('detects high-variance PID oscillation (high Z_sigma) while mean remains stable', async () => {
      const highVarTelemetryRaw = JSON.parse(
        fs.readFileSync(path.join(fixturesDir, 'high-variance-drift.json'), 'utf8')
      );
      const sim = toSimulatedTelemetry(highVarTelemetryRaw);

      const report = await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: sim
      });

      expect(report.zones.length).toBe(10);
      const z8 = report.zones.find(z => z.zoneIndex === 8);
      expect(z8).toBeDefined();
      expect(z8!.variabilityZScore).toBeGreaterThan(2.0);
      expect(report.isCompliant).toBe(false);
    });

    it('detects steady mean shift (high Z_mu) with low variance', async () => {
      const now = Date.now();
      const meanShiftTelemetry = [];
      for (let i = 0; i < 20; i++) {
        // Shift zone 8 up by +6°C steadily (251.0°C instead of baseline 245.0°C)
        meanShiftTelemetry.push({
          zoneTemperatures: [160, 165, 170, 175, 185, 195, 220, 251.0, 255, 210],
          conveyorSpeedMPerMin: 0.90,
          oxygenPpm: 500
        });
      }
      const sim = toSimulatedTelemetry(meanShiftTelemetry);

      const report = await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: sim
      });

      const z8 = report.zones.find(z => z.zoneIndex === 8);
      expect(z8).toBeDefined();
      expect(z8!.meanZScore).toBeGreaterThan(3.0);
      expect(z8!.meanDeviationC).toBeCloseTo(6.0, 1);
    });
  });

  // --------------------------------------------------------------------------
  // Category 12: Persistence & Hysteresis
  // --------------------------------------------------------------------------
  describe('12. Persistence & Hysteresis', () => {
    it('requires 15s persistence before transitioning from DRIFT_SUSPECTED to DRIFT_CONFIRMED', async () => {
      const baseTime = Date.now();

      // 1. First 10s: short drift -> DRIFT_SUSPECTED
      const shortDrift = [];
      for (let i = 0; i < 10; i++) {
        shortDrift.push({
          zoneTemperatures: [160, 165, 170, 175, 185, 195, 220, 251.0, 255, 210]
        });
      }
      await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: toSimulatedTelemetry(shortDrift),
        now: new Date(baseTime + 10 * 1000)
      });

      let state = await reflowModule.getProcessState(testScope);
      expect(state?.complianceStatus).toBe('DRIFT_SUSPECTED');

      // 2. Next 10s (total 20s >= 15s): sustained drift -> DRIFT_CONFIRMED
      await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: toSimulatedTelemetry(shortDrift),
        now: new Date(baseTime + 20 * 1000)
      });

      state = await reflowModule.getProcessState(testScope);
      expect(state?.complianceStatus).toBe('DRIFT_CONFIRMED');
    });

    it('enforces 45s recovery hysteresis before returning to COMPLIANT', async () => {
      const baseTime = Date.now();

      // Establish confirmed drift
      const driftingPoints = [];
      for (let i = 0; i < 20; i++) {
        driftingPoints.push({
          zoneTemperatures: [160, 165, 170, 175, 185, 195, 220, 251.0, 255, 210]
        });
      }
      await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: toSimulatedTelemetry(driftingPoints),
        now: new Date(baseTime + 20 * 1000)
      });

      let state = await reflowModule.getProcessState(testScope);
      expect(state?.complianceStatus).toBe('DRIFT_CONFIRMED');

      // Nominal telemetry for only 20s (< 45s) -> still in drift state
      const nominalPoints = [];
      for (let i = 0; i < 20; i++) {
        nominalPoints.push({
          zoneTemperatures: [160, 165, 170, 175, 185, 195, 220, 245.0, 255, 210]
        });
      }
      await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: toSimulatedTelemetry(nominalPoints),
        now: new Date(baseTime + 40 * 1000)
      });

      state = await reflowModule.getProcessState(testScope);
      expect(state?.complianceStatus).toBe('DRIFT_CONFIRMED');

      // Nominal telemetry for 50s (total healthy >= 45s) -> recovers to COMPLIANT
      await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: toSimulatedTelemetry(nominalPoints),
        now: new Date(baseTime + 90 * 1000)
      });

      state = await reflowModule.getProcessState(testScope);
      expect(state?.complianceStatus).toBe('COMPLIANT');
    });
  });

  // --------------------------------------------------------------------------
  // Category 13: Telemetry Integrity & Dropout
  // --------------------------------------------------------------------------
  describe('13. Telemetry Integrity & Dropout', () => {
    it('transitions to DATA_INSUFFICIENT on packet dropouts without asserting false compliance', async () => {
      // Provide simulatedTelemetry with 0 zones
      const report = await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: { zones: [] }
      });

      expect(report.isCompliant).toBe(false);
      expect(report.zones.length).toBe(0);

      const state = await reflowModule.getProcessState(testScope);
      expect(state?.complianceStatus).toBe('DATA_INSUFFICIENT');
    });
  });

  // --------------------------------------------------------------------------
  // Category 14: Process-Risk Gating
  // --------------------------------------------------------------------------
  describe('14. Process-Risk Gating', () => {
    it('evaluates conservative impact when baseline PWI has margin vs tight margin', async () => {
      const activeRun = (await profileStore.getActiveProfileRun(testScope))!.run;
      const spec = (await specService.getActiveSpecification(testScope.recipeId, testScope.boardPartNumber, testScope.boardRevision))!;

      const mockDriftReport: OvenDriftReport = {
        lineId: testScope.lineId,
        equipmentId: testScope.equipmentId,
        recipeId: testScope.recipeId,
        boardPartNumber: testScope.boardPartNumber,
        boardRevision: testScope.boardRevision,
        activeProfileRunId: activeRun.id,
        timestamp: new Date().toISOString(),
        isCompliant: false,
        compositeSeverityScore: 0.55,
        consecutiveDriftSeconds: 30,
        zones: [
          {
            zoneIndex: 8,
            zoneName: 'Zone 8 Peak',
            windowMeanC: 251.0,
            windowStdDevC: 1.0,
            baselineMeanC: 245.0,
            baselineStdDevC: 0.8,
            meanDeviationC: 6.0,
            meanZScore: 7.5,
            variabilityZScore: 0.5,
            isDrifting: true
          }
        ]
      };

      // 1. With baseline PWI = 20.0% (margin = 80%), risk is MEDIUM
      const estWide = impactService.estimateThermalImpact({
        activeProfileRun: activeRun,
        specification: spec,
        driftReport: mockDriftReport
      });
      expect(estWide.riskLevel).toBe('MEDIUM');
      expect(estWide.basis).toBe('MODEL');

      // 2. With narrow margin (simulated baseline PWI = 94.0%, margin = 6%), risk escalates to HIGH
      const tightRun: ReflowProfileRun = {
        ...activeRun,
        analysisResult: {
          ...activeRun.analysisResult,
          overallPwi: 94.0
        }
      };

      const estTight = impactService.estimateThermalImpact({
        activeProfileRun: tightRun,
        specification: spec,
        driftReport: mockDriftReport
      });
      expect(estTight.riskLevel).toBe('HIGH');
      expect(estTight.basis).toBe('MODEL');
    });
  });

  // --------------------------------------------------------------------------
  // Category 15: Interlock Confirmation Triad
  // --------------------------------------------------------------------------
  describe('15. Interlock Confirmation Triad', () => {
    it('dispatches interlock request to MachineControlModule and emits CONFIRMED event on collapse', async () => {
      const collapseTelemetry = [];
      for (let i = 0; i < 20; i++) {
        // Zone 8 drops by 25°C (220°C instead of 245°C)
        collapseTelemetry.push({
          zoneTemperatures: [160, 165, 170, 175, 185, 195, 220, 220.0, 255, 210]
        });
      }

      await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: toSimulatedTelemetry(collapseTelemetry)
      });

      // Verify production_events has REQUESTED and CONFIRMED events
      const events = await db.query<any>(
        'SELECT event_type, payload_json FROM production_events WHERE event_type IN (?, ?)',
        ['REFLOW_INTERLOCK_REQUESTED', 'REFLOW_INTERLOCK_CONFIRMED']
      );

      const requested = events.find(e => e.event_type === 'REFLOW_INTERLOCK_REQUESTED');
      const confirmed = events.find(e => e.event_type === 'REFLOW_INTERLOCK_CONFIRMED');

      expect(requested).toBeDefined();
      expect(confirmed).toBeDefined();
    });

    it('emits REFLOW_INTERLOCK_FAILED when MachineControlModule adapter rejects or fails', async () => {
      const failingAdapter = new InMemoryEquipmentAdapter({
        id: 'wc-rfl-01',
        name: 'Faulty Reflow Oven',
        workCenterId: 'wc-rfl-01',
        capabilities: ['HOLD']
      });
      failingAdapter.tripHold = async () => {
        throw new Error('HARDWARE_COMMUNICATION_TIMEOUT: Oven PLC unresponsive');
      };
      machineControl.registerAdapter(failingAdapter);

      const collapseTelemetry = [];
      for (let i = 0; i < 20; i++) {
        collapseTelemetry.push({
          zoneTemperatures: [160, 165, 170, 175, 185, 195, 220, 220.0, 255, 210]
        });
      }

      await driftService.evaluateOvenDrift({
        ...testScope,
        simulatedTelemetry: toSimulatedTelemetry(collapseTelemetry)
      });

      const failedEvents = await db.query<any>(
        'SELECT event_type, payload_json FROM production_events WHERE event_type = ?',
        ['REFLOW_INTERLOCK_FAILED']
      );
      expect(failedEvents.length).toBeGreaterThanOrEqual(1);
    });
  });

  // --------------------------------------------------------------------------
  // Category 16: 21 CFR Part 11 Audit Integrity & Deterministic Replay
  // --------------------------------------------------------------------------
  describe('16. 21 CFR Part 11 Audit Integrity & Deterministic Replay', () => {
    it('maintains tamper-evident SHA-256 hash and deterministic PWI replay', async () => {
      const kicBuf = fs.readFileSync(path.join(fixturesDir, 'kic-golden.kic'));
      const { run } = await importService.importProfileFile({
        file: { fileName: 'audit.kic', buffer: kicBuf, fileSizeBytes: kicBuf.length },
        ...testScope,
        importedBy: 'OPERATOR-SMT'
      });

      expect(run.fileMetadata.fileSha256).toMatch(/^[a-f0-9]{64}$/);

      // Electronic signature sign-off
      const approved = await lifecycleService.approveProfileRun({
        runId: run.id,
        approvedBy: 'QA-CHIEF-01',
        comments: 'Certified conforming to IPC-7530B and J-STD-001H'
      });

      expect(approved.status).toBe('APPROVED');
      expect(approved.approvalAudit?.approvedBy).toBe('QA-CHIEF-01');

      // Re-running calculation deterministically matches exactly
      const probes = await profileStore.getProbesForRun(run.id);
      const spec = (await specService.getSpecification(testScope.recipeId, testScope.boardPartNumber, testScope.boardRevision))!;
      const rerunPwi = pwiService.calculateRunPwi(probes, spec);

      expect(rerunPwi.overallPwi).toBeCloseTo(run.analysisResult.overallPwi, 2);
    });
  });

  // --------------------------------------------------------------------------
  // Category X: Tri-Store Invariant
  // --------------------------------------------------------------------------
  describe('X. Tri-Store Invariant', () => {
    it('enforces architectural segregation: raw curves in ReflowProfileStore, 10Hz in Telemetry, facts in EventStore', async () => {
      const kicBuf = fs.readFileSync(path.join(fixturesDir, 'kic-golden.kic'));
      const { run } = await importService.importProfileFile({
        file: { fileName: 'segregation.kic', buffer: kicBuf, fileSizeBytes: kicBuf.length },
        ...testScope,
        importedBy: 'OPERATOR-SMT'
      });

      // 1. ReflowProfileStore contains raw probe curves
      const probes = await profileStore.getProbesForRun(run.id);
      expect(probes.length).toBeGreaterThan(0);
      expect(probes[0].samples.length).toBeGreaterThan(100);

      // 2. TelemetryStore contains continuous oven readings
      const ovenPoints = await telemetryStore.getLineTelemetry(testScope.lineId, 'temperature_c', 60);
      expect(ovenPoints.length).toBeGreaterThanOrEqual(1);

      // 3. EventStore contains immutable business facts without raw curve bloat
      const events = await db.query<any>(
        'SELECT event_type, payload_json FROM production_events WHERE event_type LIKE ?',
        ['REFLOW%']
      );
      expect(events.length).toBeGreaterThan(0);
      for (const event of events) {
        // Event payload MUST NOT contain massive raw samples array
        expect(event.payload_json.length).toBeLessThan(10000);
      }
    });
  });
});
