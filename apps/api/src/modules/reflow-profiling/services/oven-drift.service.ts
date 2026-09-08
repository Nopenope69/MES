import { v4 as uuidv4 } from 'uuid';
import {
  OvenDriftReport,
  ZoneDriftMetric,
  ReflowProcessState,
  ReflowDriftDetectedPayload,
  ReflowProcessStateChangedPayload,
  ReflowInterlockRequestedPayload,
  ReflowInterlockConfirmedPayload,
  ReflowInterlockFailedPayload,
  ReflowRevalidationRequestedPayload
} from '@mes/shared';
import { IReflowProfileDataStore } from '../storage/reflow-profile.store.interface';
import { RecipeSpecificationService } from './recipe-specification.service';
import { ThermalImpactService } from './thermal-impact.service';
import { ITelemetryStore, TelemetryStore, TelemetryPoint } from '../../../services/telemetry-store.service';
import { IMachineControlModule } from '../../machine-control/machine-control.interface';
import { MachineControlModule } from '../../machine-control/machine-control.module';
import { EventStoreModule } from '../../event-store/event-store.module';

export interface EvaluateOvenDriftParams {
  lineId: string;
  equipmentId: string;
  recipeId: string;
  boardPartNumber: string;
  boardRevision: string;
  windowSeconds?: number;
  simulatedTelemetry?: {
    zones: Array<{ zoneIndex: number; temperaturesC: number[] }>;
    conveyorSpeedCmPerMin?: number[];
    oxygenPpm?: number[];
  };
  now?: Date;
}

export class OvenDriftService {
  constructor(
    private store: IReflowProfileDataStore,
    private specService: RecipeSpecificationService,
    private thermalImpactService: ThermalImpactService = new ThermalImpactService(),
    private telemetryStore: ITelemetryStore = TelemetryStore.getInstance(),
    private machineControl: IMachineControlModule = MachineControlModule.getInstance(),
    private eventStore: EventStoreModule = EventStoreModule.getInstance()
  ) {}

  public async evaluateOvenDrift(params: EvaluateOvenDriftParams): Promise<OvenDriftReport> {
    const { lineId, equipmentId, recipeId, boardPartNumber, boardRevision } = params;
    const now = params.now || new Date();
    const nowIso = now.toISOString();
    const windowSec = params.windowSeconds || 60;

    // 1. Resolve Active Profile Run & Specification
    const activeRunResult = await this.store.getActiveProfileRun({
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision,
      includeProbes: false
    });

    if (!activeRunResult) {
      throw new Error(
        `NO_ACTIVE_PROFILE: Cannot evaluate drift without an ACTIVE baseline profile run for line=${lineId} equipment=${equipmentId} recipe=${recipeId}`
      );
    }

    const { run: activeRun } = activeRunResult;

    const spec = await this.specService.getActiveSpecification(recipeId, boardPartNumber, boardRevision);
    if (!spec) {
      throw new Error(`NO_ACTIVE_SPECIFICATION: No active thermal specification found for recipe=${recipeId}`);
    }

    // 2. Fetch or Extract Telemetry Window
    const defaultSetpoints = activeRun.ovenSettingsSnapshot?.zoneSetpointsC || [
      160, 165, 170, 175, 185, 195, 220, 245, 255, 210
    ];
    const baselineSpeed = activeRun.ovenSettingsSnapshot?.conveyorSpeedCmPerMin || spec.conveyorSpeedLimit.targetCmPerMin || 90.0;
    const baselineO2 = spec.oxygenControl?.targetPpm || 500.0;

    let zoneReadingsMap: Record<number, number[]> = {};
    let speedReadings: number[] = [];
    let oxygenReadings: number[] = [];

    if (params.simulatedTelemetry) {
      for (const z of params.simulatedTelemetry.zones) {
        zoneReadingsMap[z.zoneIndex] = z.temperaturesC;
      }
      if (params.simulatedTelemetry.conveyorSpeedCmPerMin) {
        speedReadings = params.simulatedTelemetry.conveyorSpeedCmPerMin;
      }
      if (params.simulatedTelemetry.oxygenPpm) {
        oxygenReadings = params.simulatedTelemetry.oxygenPpm;
      }
    } else {
      const windowMinutes = Math.max(1, Math.ceil(windowSec / 60));
      const points = await this.telemetryStore.getLineTelemetry(lineId, 'temperature_c', windowMinutes);
      const ovenPoints = points.filter((p) => !p.equipmentId || p.equipmentId === equipmentId);

      for (const p of ovenPoints) {
        const zoneIdx = parseInt(p.assetId.replace(/\D/g, ''), 10);
        if (zoneIdx > 0) {
          if (!zoneReadingsMap[zoneIdx]) zoneReadingsMap[zoneIdx] = [];
          zoneReadingsMap[zoneIdx].push(p.value);
        }
      }

      const spdPoints = await this.telemetryStore.getLineTelemetry(lineId, 'speed_cm_per_min', windowMinutes);
      speedReadings = spdPoints.filter((p) => !p.equipmentId || p.equipmentId === equipmentId).map((p) => p.value);
    }

    // 3. Telemetry Completeness / Dropout Guard
    const zoneCount = defaultSetpoints.length;
    const availableZones = Object.keys(zoneReadingsMap).length;
    if (availableZones === 0 || (availableZones < zoneCount / 2 && !params.simulatedTelemetry)) {
      // Data Dropout -> DATA_INSUFFICIENT
      await this.handleStateTransition({
        lineId,
        equipmentId,
        recipeId,
        boardPartNumber,
        boardRevision,
        activeProfileRunId: activeRun.id,
        targetState: 'DATA_INSUFFICIENT',
        reason: `Missing continuous telemetry: only ${availableZones}/${zoneCount} zones reporting`,
        nowIso,
        elapsedSeconds: 0,
        isDrifting: false
      });

      return {
        lineId,
        equipmentId,
        recipeId,
        boardPartNumber,
        boardRevision,
        activeProfileRunId: activeRun.id,
        timestamp: nowIso,
        isCompliant: false,
        compositeSeverityScore: 1.0,
        consecutiveDriftSeconds: 0,
        zones: []
      };
    }

    // 4. Bivariate Z-Score Drift Calculations
    const minSigma = spec.minimumSigmaC || 0.5;
    const zoneTolerance = spec.zoneTolerancesC || 2.5;
    const speedTolerance = spec.conveyorSpeedLimit.toleranceCmPerMin || 1.5;
    const o2Tolerance = spec.oxygenControl?.tolerancePpm || 100.0;

    const zoneMetrics: ZoneDriftMetric[] = [];
    let anyZoneDrifting = false;
    let catastrophicCollapse = false;

    for (let z = 1; z <= zoneCount; z++) {
      const readings = zoneReadingsMap[z] || [defaultSetpoints[z - 1]];
      const baseMean = defaultSetpoints[z - 1];
      const baseStd = minSigma; // validated baseline variance

      const sum = readings.reduce((a, b) => a + b, 0);
      const wMean = sum / readings.length;
      const variance = readings.length > 1
        ? readings.reduce((acc, v) => acc + Math.pow(v - wMean, 2), 0) / (readings.length - 1)
        : 0;
      const wStd = Math.sqrt(variance);

      const meanDev = wMean - baseMean;
      const sigmaEff = Math.max(baseStd, minSigma);

      const zMu = meanDev / sigmaEff;
      const zSigma = (wStd - baseStd) / sigmaEff;

      // Check critical drop > 15°C
      if (meanDev <= -15.0 || Math.abs(meanDev) >= 15.0) {
        catastrophicCollapse = true;
      }

      // Drifting if: absolute deviation > zoneTolerance OR |Z_mu| > 3.0 OR |Z_sigma| > 3.0
      const isDrifting = Math.abs(meanDev) > zoneTolerance || Math.abs(zMu) > 3.0 || Math.abs(zSigma) > 3.0;
      if (isDrifting) anyZoneDrifting = true;

      zoneMetrics.push({
        zoneIndex: z,
        zoneName: `Zone ${z} Top`,
        windowMeanC: Number(wMean.toFixed(2)),
        windowStdDevC: Number(wStd.toFixed(2)),
        baselineMeanC: baseMean,
        baselineStdDevC: baseStd,
        meanDeviationC: Number(meanDev.toFixed(2)),
        meanZScore: Number(zMu.toFixed(2)),
        variabilityZScore: Number(zSigma.toFixed(2)),
        isDrifting
      });
    }

    // Conveyor speed drift
    const wSpeedMean = speedReadings.length > 0
      ? speedReadings.reduce((a, b) => a + b, 0) / speedReadings.length
      : baselineSpeed;
    const speedDev = Math.abs(wSpeedMean - baselineSpeed);
    const isSpeedDrifting = speedDev > speedTolerance;
    if (isSpeedDrifting) anyZoneDrifting = true;

    // Oxygen drift
    let wO2Mean = baselineO2;
    let isO2Drifting = false;
    let o2Dev = 0;
    if (oxygenReadings.length > 0 && spec.oxygenControl) {
      wO2Mean = oxygenReadings.reduce((a, b) => a + b, 0) / oxygenReadings.length;
      o2Dev = Math.abs(wO2Mean - baselineO2);
      isO2Drifting = o2Dev > o2Tolerance;
      if (isO2Drifting) anyZoneDrifting = true;
    }

    // 5. Normalized Composite Severity Score (\sum w = 1.0)
    const wZoneTotal = 0.70;
    const wSpeed = 0.20;
    const wO2 = 0.10;
    const wPerZone = wZoneTotal / zoneCount;

    let compositeSeverity = 0;
    for (const zm of zoneMetrics) {
      compositeSeverity += wPerZone * (Math.abs(zm.meanDeviationC) / zoneTolerance);
    }
    compositeSeverity += wSpeed * (speedDev / speedTolerance);
    if (spec.oxygenControl) {
      compositeSeverity += wO2 * (o2Dev / o2Tolerance);
    }
    compositeSeverity = Number(compositeSeverity.toFixed(4));

    // 6. Persistence & Hysteresis State Machine
    const prevState = await this.store.getProcessState({
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision
    });

    const lastTime = prevState?.lastEvaluatedAt ? new Date(prevState.lastEvaluatedAt).getTime() : now.getTime();
    const elapsedSec = Math.max(1, (now.getTime() - lastTime) / 1000);

    let consecutiveDriftSec = prevState ? prevState.consecutiveDriftSeconds : 0;
    let consecutiveHealthySec = prevState ? prevState.consecutiveHealthySeconds : 0;
    let currentStatus = prevState ? prevState.complianceStatus : 'COMPLIANT';

    if (anyZoneDrifting) {
      consecutiveDriftSec += elapsedSec;
      consecutiveHealthySec = 0;

      if (currentStatus === 'COMPLIANT' || currentStatus === 'DRIFT_SUSPECTED') {
        if (consecutiveDriftSec < 15.0) {
          currentStatus = 'DRIFT_SUSPECTED';
        } else {
          currentStatus = 'DRIFT_CONFIRMED';
        }
      }
    } else {
      consecutiveHealthySec += elapsedSec;
      consecutiveDriftSec = 0;

      if (currentStatus === 'DRIFT_CONFIRMED') {
        // Recovery hysteresis: requires 45 seconds healthy
        if (consecutiveHealthySec >= 45.0) {
          currentStatus = 'COMPLIANT';
        }
      } else {
        currentStatus = 'COMPLIANT';
      }
    }

    const driftReport: OvenDriftReport = {
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision,
      activeProfileRunId: activeRun.id,
      timestamp: nowIso,
      isCompliant: currentStatus === 'COMPLIANT',
      driftType: catastrophicCollapse
        ? 'MULTI_ZONE_COLLAPSE'
        : isSpeedDrifting
        ? 'CONVEYOR_SPEED_DRIFT'
        : isO2Drifting
        ? 'OXYGEN_EXCURSION'
        : anyZoneDrifting
        ? 'MEAN_SHIFT'
        : undefined,
      compositeSeverityScore: compositeSeverity,
      consecutiveDriftSeconds: Number(consecutiveDriftSec.toFixed(1)),
      zones: zoneMetrics,
      conveyorSpeed: {
        windowMeanCmPerMin: Number(wSpeedMean.toFixed(2)),
        baselineCmPerMin: baselineSpeed,
        deviationCmPerMin: Number(speedDev.toFixed(2)),
        isDrifting: isSpeedDrifting
      },
      oxygen: spec.oxygenControl ? {
        windowMeanPpm: Number(wO2Mean.toFixed(1)),
        baselinePpm: baselineO2,
        deviationPpm: Number(o2Dev.toFixed(1)),
        isDrifting: isO2Drifting
      } : undefined
    };

    // 7. Thermal Impact Process-Risk Gating
    const thermalImpact = this.thermalImpactService.estimateThermalImpact({
      activeProfileRun: activeRun,
      specification: spec,
      driftReport
    });

    if (thermalImpact.riskLevel === 'HIGH' && currentStatus === 'DRIFT_CONFIRMED') {
      currentStatus = 'REVALIDATION_REQUIRED';
    }

    // 8. Catastrophic Collapse Safety Interlock Triad
    if (catastrophicCollapse) {
      currentStatus = 'REVALIDATION_REQUIRED';
      await this.triggerEmergencyInterlock({
        lineId,
        equipmentId,
        triggerType: 'CRITICAL_TEMPERATURE_DROP',
        reason: `Catastrophic reflow zone temperature drop (>15°C) detected on ${equipmentId}`,
        nowIso
      });
    }

    // 9. Persist Process State and Emit Domain Events
    const prevStatus = prevState?.complianceStatus || 'COMPLIANT';
    const stateRecord: ReflowProcessState = {
      lineId,
      equipmentId,
      recipeId,
      boardPartNumber,
      boardRevision,
      activeProfileRunId: activeRun.id,
      complianceStatus: currentStatus,
      consecutiveDriftSeconds: Number(consecutiveDriftSec.toFixed(1)),
      consecutiveHealthySeconds: Number(consecutiveHealthySec.toFixed(1)),
      lastEvaluatedAt: nowIso,
      driftReport
    };

    await this.store.saveProcessState(stateRecord);

    if (prevStatus !== currentStatus) {
      const stateChangedPayload: ReflowProcessStateChangedPayload = {
        lineId,
        equipmentId,
        recipeId,
        boardPartNumber,
        boardRevision,
        activeProfileRunId: activeRun.id,
        previousState: prevStatus,
        newState: currentStatus,
        reason: `Drift evaluation: consecutiveDrift=${consecutiveDriftSec}s, compositeSeverity=${compositeSeverity}`,
        changedAt: nowIso
      };

      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'REFLOW_PROCESS_STATE_CHANGED',
        eventTime: nowIso,
        receivedTime: nowIso,
        sourceType: 'REFLOW_CONTROLLER',
        sourceId: equipmentId,
        lineId,
        workCenterId: equipmentId,
        payload: stateChangedPayload
      });
    }

    if (currentStatus === 'DRIFT_CONFIRMED' || currentStatus === 'REVALIDATION_REQUIRED') {
      const driftingZones = zoneMetrics.filter((z) => z.isDrifting);
      const driftPayload: ReflowDriftDetectedPayload = {
        lineId,
        equipmentId,
        recipeId,
        boardPartNumber,
        boardRevision,
        activeProfileRunId: activeRun.id,
        driftType: driftReport.driftType || 'MEAN_SHIFT',
        severity: catastrophicCollapse ? 'CRITICAL' : compositeSeverity >= 0.5 ? 'MODERATE' : 'MINOR',
        compositeSeverityScore: compositeSeverity,
        consecutiveDriftSeconds: Number(consecutiveDriftSec.toFixed(1)),
        driftingZones,
        speedDeviationCmPerMin: isSpeedDrifting ? speedDev : undefined,
        oxygenDeviationPpm: isO2Drifting ? o2Dev : undefined
      };

      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'REFLOW_DRIFT_DETECTED',
        eventTime: nowIso,
        receivedTime: nowIso,
        sourceType: 'REFLOW_CONTROLLER',
        sourceId: equipmentId,
        lineId,
        workCenterId: equipmentId,
        payload: driftPayload
      });

      if (currentStatus === 'REVALIDATION_REQUIRED') {
        const revalPayload: ReflowRevalidationRequestedPayload = {
          lineId,
          equipmentId,
          recipeId,
          boardPartNumber,
          boardRevision,
          activeProfileRunId: activeRun.id,
          reason: `Thermal impact risk=${thermalImpact.riskLevel}, compositeSeverity=${compositeSeverity}`,
          marginDepletedPct: Number((100 - activeRun.analysisResult.overallPwi).toFixed(1)),
          requestedAt: nowIso
        };

        await this.eventStore.append({
          eventId: uuidv4(),
          eventType: 'REFLOW_REVALIDATION_REQUESTED',
          eventTime: nowIso,
          receivedTime: nowIso,
          sourceType: 'REFLOW_CONTROLLER',
          sourceId: equipmentId,
          lineId,
          workCenterId: equipmentId,
          payload: revalPayload
        });
      }
    }

    return driftReport;
  }

  private async triggerEmergencyInterlock(params: {
    lineId: string;
    equipmentId: string;
    triggerType: 'CRITICAL_TEMPERATURE_DROP' | 'CONVEYOR_STOP' | 'EXTREME_DRIFT_CONFIRMED' | 'OXYGEN_CONTAMINATION';
    reason: string;
    nowIso: string;
  }): Promise<void> {
    const interlockId = `intlk-${Date.now()}-${uuidv4().slice(0, 8)}`;
    const startTime = Date.now();

    // 1. Emit REFLOW_INTERLOCK_REQUESTED
    const reqPayload: ReflowInterlockRequestedPayload = {
      interlockId,
      lineId: params.lineId,
      equipmentId: params.equipmentId,
      triggerType: params.triggerType,
      requestedAction: 'EMERGENCY_HOLD',
      reason: params.reason,
      requestedAt: params.nowIso,
      sourceService: 'ReflowProfilingModule'
    };

    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'REFLOW_INTERLOCK_REQUESTED',
      eventTime: params.nowIso,
      receivedTime: params.nowIso,
      sourceType: 'REFLOW_CONTROLLER',
      sourceId: params.equipmentId,
      lineId: params.lineId,
      workCenterId: params.equipmentId,
      payload: reqPayload
    });

    // 2. Dispatch through MachineControlModule
    try {
      const tripResult = await this.machineControl.tripInterlock(params.equipmentId, params.reason, {
        sourceId: 'ReflowProfilingModule',
        interlockId,
        triggerType: params.triggerType
      });

      const durationMs = Date.now() - startTime;
      if (tripResult.success) {
        const confPayload: ReflowInterlockConfirmedPayload = {
          interlockId,
          lineId: params.lineId,
          equipmentId: params.equipmentId,
          hardwareLatchState: 'LATCHED_ACTIVE',
          confirmedAt: new Date().toISOString(),
          executionDurationMs: durationMs
        };

        await this.eventStore.append({
          eventId: uuidv4(),
          eventType: 'REFLOW_INTERLOCK_CONFIRMED',
          eventTime: new Date().toISOString(),
          receivedTime: new Date().toISOString(),
          sourceType: 'REFLOW_CONTROLLER',
          sourceId: params.equipmentId,
          lineId: params.lineId,
          workCenterId: params.equipmentId,
          payload: confPayload
        });
      } else {
        throw new Error(tripResult.reason || 'Hardware latch refused');
      }
    } catch (err: any) {
      const failPayload: ReflowInterlockFailedPayload = {
        interlockId,
        lineId: params.lineId,
        equipmentId: params.equipmentId,
        errorCode: 'INTERLOCK_EXECUTION_FAILED',
        errorMessage: err.message || 'Unknown machine control error',
        failedAt: new Date().toISOString()
      };

      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'REFLOW_INTERLOCK_FAILED',
        eventTime: new Date().toISOString(),
        receivedTime: new Date().toISOString(),
        sourceType: 'REFLOW_CONTROLLER',
        sourceId: params.equipmentId,
        lineId: params.lineId,
        workCenterId: params.equipmentId,
        payload: failPayload
      });
    }
  }

  private async handleStateTransition(params: {
    lineId: string;
    equipmentId: string;
    recipeId: string;
    boardPartNumber: string;
    boardRevision: string;
    activeProfileRunId: string;
    targetState: ReflowProcessState['complianceStatus'];
    reason: string;
    nowIso: string;
    elapsedSeconds: number;
    isDrifting: boolean;
  }): Promise<void> {
    const prevState = await this.store.getProcessState({
      lineId: params.lineId,
      equipmentId: params.equipmentId,
      recipeId: params.recipeId,
      boardPartNumber: params.boardPartNumber,
      boardRevision: params.boardRevision
    });

    const prevStatus = prevState?.complianceStatus || 'COMPLIANT';
    if (prevStatus !== params.targetState) {
      await this.store.saveProcessState({
        lineId: params.lineId,
        equipmentId: params.equipmentId,
        recipeId: params.recipeId,
        boardPartNumber: params.boardPartNumber,
        boardRevision: params.boardRevision,
        activeProfileRunId: params.activeProfileRunId,
        complianceStatus: params.targetState,
        consecutiveDriftSeconds: 0,
        consecutiveHealthySeconds: 0,
        lastEvaluatedAt: params.nowIso
      });

      const payload: ReflowProcessStateChangedPayload = {
        lineId: params.lineId,
        equipmentId: params.equipmentId,
        recipeId: params.recipeId,
        boardPartNumber: params.boardPartNumber,
        boardRevision: params.boardRevision,
        activeProfileRunId: params.activeProfileRunId,
        previousState: prevStatus,
        newState: params.targetState,
        reason: params.reason,
        changedAt: params.nowIso
      };

      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'REFLOW_PROCESS_STATE_CHANGED',
        eventTime: params.nowIso,
        receivedTime: params.nowIso,
        sourceType: 'REFLOW_CONTROLLER',
        sourceId: params.equipmentId,
        lineId: params.lineId,
        workCenterId: params.equipmentId,
        payload
      });
    }
  }
}
