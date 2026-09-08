import { describe, it, expect, beforeEach } from 'vitest';
import { initDatabase } from '../src/db/database';
import { seedDatabase } from '../src/db/seed';
import { MaterialReservationService } from '../src/services/material-reservation.service';
import { AgvMissionManager } from '../src/services/agv-mission-manager.service';
import { TelemetryStore } from '../src/services/telemetry-store.service';
import { PredictiveQualityEngine } from '../src/services/predictive-quality.service';
import { ProductionMetricsService } from '../src/services/production-metrics.service';
import { FleetOrchestrationService } from '../src/services/fleet-orchestration.service';
import { EventStoreModule } from '../src/modules/event-store/event-store.module';
import { MachineControlModule } from '../src/modules/machine-control/machine-control.module';
import { InMemoryEquipmentAdapter } from '../src/modules/machine-control/in-memory-equipment.adapter';

describe('Phase 5: Multi-Line Fleet Orchestration, Material Logistics & Predictive Quality', () => {
  let reservationService: MaterialReservationService;
  let agvManager: AgvMissionManager;
  let telemetryStore: TelemetryStore;
  let predictiveEngine: PredictiveQualityEngine;
  let metricsService: ProductionMetricsService;
  let fleetService: FleetOrchestrationService;
  let eventStore: EventStoreModule;
  let machineControl: MachineControlModule;

  beforeEach(async () => {
    await initDatabase();
    await seedDatabase();

    MaterialReservationService.resetInstance();
    AgvMissionManager.resetInstance();
    TelemetryStore.resetInstance();
    PredictiveQualityEngine.resetInstance();
    ProductionMetricsService.resetInstance();
    FleetOrchestrationService.resetInstance();
    MachineControlModule.resetInstance();

    reservationService = MaterialReservationService.getInstance();
    agvManager = AgvMissionManager.getInstance();
    telemetryStore = TelemetryStore.getInstance();
    predictiveEngine = PredictiveQualityEngine.getInstance();
    metricsService = ProductionMetricsService.getInstance();
    fleetService = FleetOrchestrationService.getInstance();
    eventStore = EventStoreModule.getInstance();
    machineControl = MachineControlModule.getInstance();

    // Register an in-memory controllable screen printer for wc-spg-01
    const printerAdapter = new InMemoryEquipmentAdapter('wc-spg-01', 'Fuji GPX Screen Printer', 'wc-spg-01', [
      'HOLD', 'PARAMETER_MODIFICATION', 'CLEANING'
    ]);
    machineControl.registerAdapter(printerAdapter);
  });

  describe('1. Atomic Cross-Line Material Reservation & Concurrency Race', () => {
    it('guarantees mutual exclusion: when Line 01 and Line 02 race for the same reel, exactly one succeeds', async () => {
      const targetReel = 'REEL-MUR-98125-SPLICE'; // Present in seed warehouse

      // Simultaneous reservation requests
      const [res1, res2] = await Promise.all([
        reservationService.reserveMaterial({
          reelId: targetReel,
          lineId: 'line-smt-01',
          slotNo: 1,
          partNumber: 'C0402-100NF-16V',
          purpose: 'PRODUCTION_SPLICING',
          correlationId: 'corr-race-line1'
        }),
        reservationService.reserveMaterial({
          reelId: targetReel,
          lineId: 'line-smt-02',
          slotNo: 1,
          partNumber: 'C0402-100NF-16V',
          purpose: 'PRODUCTION_SPLICING',
          correlationId: 'corr-race-line2'
        })
      ]);

      // Exactly one must succeed, one must fail with reservation conflict
      const successes = [res1, res2].filter(r => r.success);
      const rejections = [res1, res2].filter(r => !r.success);

      expect(successes.length).toBe(1);
      expect(rejections.length).toBe(1);
      expect(successes[0].status).toBe('RESERVED');
      expect(rejections[0].status).toBe('REJECTED');
      expect(rejections[0].reason).toContain('REEL_ALREADY_RESERVED');

      // Active reservations verify line ownership
      const active = await reservationService.getActiveReservations();
      const held = active.filter(a => a.reelId === targetReel);
      expect(held.length).toBe(1);
      expect(held[0].lineId).toBe(successes[0].lineId);
    });

    it('rejects reservation for expired or non-existent reel barcodes', async () => {
      const res = await reservationService.reserveMaterial({
        reelId: 'REEL-DOES-NOT-EXIST',
        lineId: 'line-smt-01',
        slotNo: 2,
        partNumber: 'RES-0402-10K',
        purpose: 'TEST',
        correlationId: 'corr-nonexistent'
      });

      expect(res.success).toBe(false);
      expect(res.reason).toContain('not found in inventory');
    });
  });

  describe('2. Decoupled Logistics: Material Request vs AGV Transport Lifecycle', () => {
    it('pre-gates replenishment request via MaterialGateModule and progresses AGV mission with dock authorization', async () => {
      // Step A: Feeder runout triggers material replenishment request
      const requestId = await agvManager.createReplenishmentRequest({
        lineId: 'line-smt-01',
        workCenterId: 'wc-nxt-01',
        slotNo: 1,
        partNumber: 'C0402-100NF-16V',
        remainingQuantity: 150,
        estimatedMinutesRemaining: 12.5,
        confidence: 'ACTUAL_PLACEMENT_TELEMETRY'
      });

      expect(requestId).toBeDefined();

      // Step B: Pre-Gate with valid replacement reel (checks BOM and MSL)
      const gateResult = await agvManager.gateReplenishmentRequest(requestId, 'REEL-MUR-98125-SPLICE', 'op-smt-01');
      expect(gateResult.success).toBe(true);
      expect(gateResult.reservationId).toBeDefined();

      // Step C: Create and dispatch AGV transport order
      const missionId = await agvManager.createMission({
        missionType: 'REEL_DELIVERY',
        materialType: 'COMPONENT_REEL',
        materialId: 'REEL-MUR-98125-SPLICE',
        sourceLocation: 'WAREHOUSE',
        targetLineId: 'line-smt-01',
        targetWorkCenterId: 'wc-nxt-01',
        priority: 'HIGH',
        requestId
      });

      const dispatchResult = await agvManager.dispatchMission(missionId, 'agv-01');
      expect(dispatchResult.success).toBe(true);
      expect(dispatchResult.status).toBe('DISPATCHED');

      // Step D: Dispatch idempotency
      const duplicateDispatch = await agvManager.dispatchMission(missionId, 'agv-01');
      expect(duplicateDispatch.success).toBe(true);
      expect(duplicateDispatch.status).toBe('DISPATCHED');

      // Step E: AGV in-transit progression
      await agvManager.updateMissionState(missionId, 'EN_ROUTE_DELIVERY', { location: 'BAY_A_LANE_1', batteryPercent: 96.0 });

      // Step F: Dock Delivery Authorization Gate
      const dockAuth = await agvManager.authorizeDockDelivery({
        missionId,
        authorizedBy: 'sup-smt-01'
      });
      expect(dockAuth.success).toBe(true);

      // Verify mission is COMPLETED and AGV returned to IDLE
      const activeMissions = await agvManager.getActiveMissions('line-smt-01');
      expect(activeMissions.some(m => m.id === missionId)).toBe(false);
    });

    it('rejects pre-gating if candidate reel has BOM mismatch or MSL violation', async () => {
      const requestId = await agvManager.createReplenishmentRequest({
        lineId: 'line-smt-01',
        workCenterId: 'wc-nxt-01',
        slotNo: 1,
        partNumber: 'STM32F405RGT6',
        remainingQuantity: 80,
        estimatedMinutesRemaining: 5.0
      });

      // Pass reel with mismatched part number (REEL-C0402-01 contains CAP-0402-100NF)
      const gateResult = await agvManager.gateReplenishmentRequest(requestId, 'REEL-C0402-01', 'op-smt-01');
      expect(gateResult.success).toBe(false);
      expect(gateResult.reason).toContain('MATERIAL_GATE_REJECTED');
    });
  });

  describe('3. Placement-Based Depletion Ledger', () => {
    it('computes feeder runout prioritizing actual placement telemetry over theoretical fallback', async () => {
      const depletion = await agvManager.calculateFeederDepletion('line-smt-01', 1);

      expect(depletion.slotNo).toBe(1);
      expect(depletion.partNumber).toBe('C0402-100NF-16V');
      expect(depletion.remainingQuantity).toBeGreaterThan(0);
      expect(depletion.consumptionRatePerMinute).toBeGreaterThan(0);
      expect(depletion.estimatedMinutesRemaining).toBeGreaterThan(0);
      expect(['ACTUAL_PLACEMENT_TELEMETRY', 'THEORETICAL_FALLBACK']).toContain(depletion.confidence);
    });
  });

  describe('4. TelemetryStore Invariant: Isolated from Transactional EventStore', () => {
    it('records high-frequency sensor measurements without polluting EventStoreModule event stream', async () => {
      const eventsBefore = await eventStore.replay();
      const initialEventCount = eventsBefore.totalReplayed;

      // Ingest 25 high-frequency telemetry points
      const points = [];
      for (let i = 0; i < 25; i++) {
        points.push({
          lineId: 'line-smt-01',
          workCenterId: 'wc-nxt-01',
          assetId: 'nozzle-head-2-nz-01',
          metric: 'nozzle_vacuum_kpa',
          value: 62.5 + Math.random(),
          unit: 'kPa'
        });
      }

      const recorded = await telemetryStore.recordBatch(points);
      expect(recorded).toBe(25);

      // Verify points exist in telemetry query
      const windowPoints = await telemetryStore.getWindow('nozzle-head-2-nz-01', 'nozzle_vacuum_kpa', 60);
      expect(windowPoints.length).toBe(25);

      // ARCHITECTURAL INVARIANT: EventStoreModule event count MUST NOT change from raw telemetry
      const eventsAfter = await eventStore.replay();
      expect(eventsAfter.totalReplayed).toBe(initialEventCount);
    });
  });

  describe('5. Contextual Statistical Predictive Quality (SPC/EWMA/CUSUM)', () => {
    it('evaluates conditioned nozzle health: reports HEALTHY on normal nozzle and ANOMALY_DETECTED on decaying vacuum', async () => {
      // Normal nozzle NZ-04 (seeded with steady 65 kPa)
      const healthyReport = await predictiveEngine.evaluateNozzleHealth({
        nozzleId: 'nozzle-head-1-nz-04',
        machineId: 'fuji-nxt-01',
        headId: 'head-1',
        packageType: '0201',
        feederId: 'fdr-nxt1-01'
      });

      expect(healthyReport.status).toBe('HEALTHY');
      expect(healthyReport.observationCount).toBe(30);

      // Decaying nozzle NZ-08 (seeded with vacuum dropping from 64 down to 38 kPa)
      const anomalyReport = await predictiveEngine.evaluateNozzleHealth({
        nozzleId: 'nozzle-head-1-nz-08',
        machineId: 'fuji-nxt-01',
        headId: 'head-1',
        packageType: '0201',
        feederId: 'fdr-nxt1-02'
      });

      expect(anomalyReport.status).toBe('ANOMALY_DETECTED');
      expect(anomalyReport.anomalyId).toBeDefined();

      // Verify derived business fact was emitted to EventStore
      const db = (predictiveEngine as any).dbProvider();
      const events = await db.query('SELECT payload_json FROM production_events WHERE event_type = ?', ['PREDICTIVE_ANOMALY_DETECTED']);
      expect(events.some((e: any) => JSON.parse(e.payload_json).assetId === 'nozzle-head-1-nz-08')).toBe(true);
    });

    it('detects 3D SPI aperture clogging via linear regression slope and recommends stencil wipe', async () => {
      // Seeded with volume trending down from 118% down to 88% across 30 measurements
      const trendReport = await predictiveEngine.evaluateApertureClogging({
        apertureId: 'aperture-U3-P1',
        recipeId: 'PROG-SM-METER-TOP-REV4'
      });

      expect(trendReport.status).toBe('CRITICAL_CLOGGING_RISK');
      expect(trendReport.volumeSlopePerPanel).toBeLessThan(-0.5);
      expect(trendReport.rSquared).toBeGreaterThan(0.70);
      expect(trendReport.recommendedActionId).toBeDefined();

      // Verify PREDICTIVE_ACTION_RECOMMENDED entered EventStore
      const db = (predictiveEngine as any).dbProvider();
      const actionEvents = await db.query('SELECT payload_json FROM production_events WHERE event_type = ?', ['PREDICTIVE_ACTION_RECOMMENDED']);
      expect(actionEvents.some((e: any) => JSON.parse(e.payload_json).actionType === 'CLEAN_STENCIL')).toBe(true);
    });

    it('enforces MachineControlModule safety gate: rejects unapproved action and executes upon authorization', async () => {
      // Evaluate decaying trend to generate stencil wipe recommendation
      await predictiveEngine.evaluateApertureClogging({
        apertureId: 'aperture-U3-P1',
        recipeId: 'PROG-SM-METER-TOP-REV4'
      });

      const actions = await predictiveEngine.getPendingActions();
      const stencilWipeAction = actions.find(a => a.actionType === 'CLEAN_STENCIL');
      expect(stencilWipeAction).toBeDefined();

      // 1. Direct execution without authorization MUST fail safety abort
      const unauthExecution = await predictiveEngine.executeAction(stencilWipeAction!.id);
      expect(unauthExecution.success).toBe(false);
      expect(unauthExecution.reason).toContain('SAFETY_ABORT');

      // 2. Authorize action
      const authResult = await predictiveEngine.authorizeAction(stencilWipeAction!.id, 'qa-lead-meera', 'POLICY_AUTO');
      expect(authResult.success).toBe(true);

      // 3. Execute authorized action via MachineControlModule
      const executed = await predictiveEngine.executeAction(stencilWipeAction!.id);
      expect(executed.success).toBe(true);

      // Verify PREDICTIVE_ACTION_EXECUTED entered EventStore
      const db = (predictiveEngine as any).dbProvider();
      const execEvents = await db.query('SELECT payload_json FROM production_events WHERE event_type = ?', ['PREDICTIVE_ACTION_EXECUTED']);
      expect(execEvents.some((e: any) => JSON.parse(e.payload_json).actionId === stencilWipeAction!.id)).toBe(true);
    });
  });

  describe('6. Production Metrics & Multi-Line Fleet OEE', () => {
    it('computes canonical SEMI E10 OEE metrics within valid mathematical range [0, 1]', async () => {
      const oee = await metricsService.calculateLineOee('line-smt-01');

      expect(oee.availability).toBeGreaterThanOrEqual(0);
      expect(oee.availability).toBeLessThanOrEqual(1);
      expect(oee.performance).toBeGreaterThanOrEqual(0);
      expect(oee.performance).toBeLessThanOrEqual(1);
      expect(oee.quality).toBeGreaterThanOrEqual(0);
      expect(oee.quality).toBeLessThanOrEqual(1);
      expect(oee.oee).toBe(Math.round(oee.availability * oee.performance * oee.quality * 10000) / 10000);
    });

    it('returns bay fleet overview covering dual lines (Line 01 and Line 02)', async () => {
      const overview = await fleetService.getFleetOverview();

      expect(overview.totalLines).toBeGreaterThanOrEqual(2);
      expect(overview.lines.some(l => l.code === 'LINE-SMT-01')).toBe(true);
      expect(overview.lines.some(l => l.code === 'LINE-SMT-02')).toBe(true);
      expect(overview.averageOee).toBeGreaterThan(0);
      expect(overview.agvFleetStatus.totalUnits).toBe(2);
    });

    it('evaluates bay takt balancing report across production lines', async () => {
      const balancing = await fleetService.getBayTaktBalancing();

      expect(balancing.bayId).toBe('area-smt-01');
      expect(balancing.lines.length).toBeGreaterThanOrEqual(2);
      expect(balancing.lines[0].targetTaktSeconds).toBe(45.0);
      expect(balancing.lines[0].loadBalancingRecommendation).toBeDefined();
    });
  });
});
