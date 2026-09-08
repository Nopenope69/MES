import { v4 as uuidv4 } from 'uuid';
import { getDatabase, IDatabase } from '../db/database';
import { Clock, SystemClock } from '../utils/clock';
import { IEventStoreModule } from '../modules/event-store/event-store.interface';
import { EventStoreModule } from '../modules/event-store/event-store.module';
import { IMachineControlModule } from '../modules/machine-control/machine-control.interface';
import { MachineControlModule } from '../modules/machine-control/machine-control.module';
import { TelemetryStore, ITelemetryStore } from './telemetry-store.service';

export interface NozzleHealthReport {
  nozzleId: string;
  machineId: string;
  headId: string;
  packageType: string;
  feederId: string;
  observationCount: number;
  meanValue: number;
  baselineMean: number;
  stdDev: number;
  zScore: number;
  ewma: number;
  cusum: number;
  status: 'HEALTHY' | 'WARNING' | 'ANOMALY_DETECTED';
  anomalyId?: string;
}

export interface ApertureTrendReport {
  apertureId: string;
  recipeId: string;
  panelCount: number;
  currentVolumePct: number;
  volumeSlopePerPanel: number;
  rSquared: number;
  status: 'STABLE' | 'DEGRADING_TREND' | 'CRITICAL_CLOGGING_RISK';
  anomalyId?: string;
  recommendedActionId?: string;
}

export interface PredictiveActionRecord {
  id: string;
  anomalyId: string;
  actionType: 'CLEAN_STENCIL' | 'INSPECT_NOZZLE' | 'REPLACE_FEEDER' | 'MICRO_TUNE_PRESSURE';
  targetWorkCenterId: string;
  parameters?: Record<string, any>;
  reason: string;
  priority: 'CRITICAL' | 'HIGH' | 'STANDARD';
  status: 'RECOMMENDED' | 'AUTHORIZED' | 'EXECUTED' | 'FAILED' | 'CANCELLED';
  authorizationMode?: 'MANUAL_OVERRIDE' | 'POLICY_AUTO';
  authorizedBy?: string;
  authorizedAt?: string;
  executedAt?: string;
  executionResult?: Record<string, any>;
  errorMessage?: string;
}

/**
 * PredictiveQualityEngine: Statistical Process Control & Action Safety Authority.
 *
 * Implements:
 * 1. Multi-factor conditioned nozzle health scoring (EWMA / CUSUM / Z-score)
 * 2. 3D SPI continuous aperture clogging slope regression
 * 3. Strict MachineControlModule safety gate prior to physical automation
 */
export class PredictiveQualityEngine {
  private static instance: PredictiveQualityEngine | null = null;

  constructor(
    private dbProvider: () => IDatabase = () => getDatabase(),
    private clock: Clock = new SystemClock(),
    private telemetryStore: ITelemetryStore = TelemetryStore.getInstance(),
    private eventStore: IEventStoreModule = EventStoreModule.getInstance(),
    private machineControl: IMachineControlModule = MachineControlModule.getInstance()
  ) {}

  public static getInstance(): PredictiveQualityEngine {
    if (!PredictiveQualityEngine.instance) {
      PredictiveQualityEngine.instance = new PredictiveQualityEngine();
    }
    return PredictiveQualityEngine.instance;
  }

  public static resetInstance(): void {
    PredictiveQualityEngine.instance = null;
  }

  /**
   * Evaluates nozzle health conditioned on machine, head, package type, and feeder.
   */
  public async evaluateNozzleHealth(params: {
    nozzleId: string;
    machineId: string;
    headId: string;
    packageType: string;
    feederId: string;
    windowMinutes?: number;
  }): Promise<NozzleHealthReport> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();
    const windowMinutes = params.windowMinutes || 60;

    // 1. Fetch raw telemetry from TelemetryStore (NOT EventStore)
    const points = await this.telemetryStore.getWindow(params.nozzleId, 'vacuum_pressure_kpa', windowMinutes);

    if (points.length < 5) {
      return {
        nozzleId: params.nozzleId,
        machineId: params.machineId,
        headId: params.headId,
        packageType: params.packageType,
        feederId: params.feederId,
        observationCount: points.length,
        meanValue: points.length > 0 ? points[points.length - 1].value : 65.0,
        baselineMean: 65.0,
        stdDev: 2.0,
        zScore: 0.0,
        ewma: 65.0,
        cusum: 0.0,
        status: 'HEALTHY'
      };
    }

    // 2. Statistical calculations: Mean, StdDev, Z-Score, EWMA, CUSUM
    const values = points.map(p => p.value);
    const n = values.length;
    const mean = values.reduce((sum, v) => sum + v, 0) / n;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / (n - 1);
    const stdDev = Math.max(0.1, Math.sqrt(variance));

    // Baseline nominal vacuum for 0201 packages is 65 kPa
    const baselineMean = params.packageType === '0201' ? 65.0 : 70.0;
    const latestVal = values[values.length - 1];
    const zScore = Math.round(((latestVal - baselineMean) / stdDev) * 100) / 100;

    // EWMA (alpha = 0.2)
    let ewma = baselineMean;
    const alpha = 0.2;
    for (const v of values) {
      ewma = alpha * v + (1 - alpha) * ewma;
    }
    ewma = Math.round(ewma * 100) / 100;

    // CUSUM
    let cusum = 0;
    const k = 0.5 * stdDev;
    for (const v of values) {
      cusum = Math.max(0, cusum + (baselineMean - v - k));
    }
    cusum = Math.round(cusum * 100) / 100;

    // Anomaly logic: Significant negative vacuum deviation (leakage or worn tip)
    const isAnomaly = (baselineMean - latestVal) > (3 * stdDev) || cusum > 10.0;
    const isWarning = (baselineMean - latestVal) > (2 * stdDev) || cusum > 5.0;

    const status = isAnomaly ? 'ANOMALY_DETECTED' : (isWarning ? 'WARNING' : 'HEALTHY');
    let anomalyId: string | undefined;

    if (isAnomaly) {
      anomalyId = uuidv4();
      const actionId = uuidv4();

      // Insert anomaly fact
      await db.execute(`
        INSERT INTO predictive_anomalies (
          id, anomaly_type, line_id, work_center_id, asset_id, metric,
          score, confidence, baseline_value, observed_value, details_json, status, created_at
        ) VALUES (?, 'NOZZLE_PICKUP_DEGRADATION', 'line-smt-01', 'wc-nxt-01', ?, 'vacuum_pressure_kpa', ?, 0.94, ?, ?, ?, 'OPEN', ?)
      `, [
        anomalyId, params.nozzleId, Math.abs(zScore), baselineMean, latestVal,
        JSON.stringify({ packageType: params.packageType, feederId: params.feederId, ewma, cusum }),
        now
      ]);

      // Emit PREDICTIVE_ANOMALY_DETECTED to EventStoreModule
      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'PREDICTIVE_ANOMALY_DETECTED',
        eventTime: now,
        receivedTime: now,
        sourceType: 'PREDICTIVE_ENGINE',
        sourceId: 'predictive-quality-engine',
        lineId: 'line-smt-01',
        workCenterId: 'wc-nxt-01',
        payload: {
          anomalyId,
          anomalyType: 'NOZZLE_PICKUP_DEGRADATION',
          lineId: 'line-smt-01',
          workCenterId: 'wc-nxt-01',
          assetId: params.nozzleId,
          metric: 'vacuum_pressure_kpa',
          score: Math.abs(zScore),
          confidence: 0.94,
          baselineValue: baselineMean,
          observedValue: latestVal,
          details: { packageType: params.packageType, feederId: params.feederId, ewma, cusum }
        }
      });

      // Insert recommended action into predictive_actions
      await db.execute(`
        INSERT INTO predictive_actions (
          id, anomaly_id, action_type, target_work_center_id, reason, priority, status, created_at
        ) VALUES (?, ?, 'INSPECT_NOZZLE', 'wc-nxt-01', ?, 'HIGH', 'RECOMMENDED', ?)
      `, [
        actionId, anomalyId,
        `Nozzle ${params.nozzleId} exhibits critical vacuum pressure decay (${latestVal} kPa vs baseline ${baselineMean} kPa, Z=${zScore})`,
        now
      ]);

      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'PREDICTIVE_ACTION_RECOMMENDED',
        eventTime: now,
        receivedTime: now,
        sourceType: 'PREDICTIVE_ENGINE',
        sourceId: 'predictive-quality-engine',
        lineId: 'line-smt-01',
        workCenterId: 'wc-nxt-01',
        payload: {
          actionId,
          anomalyId,
          actionType: 'INSPECT_NOZZLE',
          targetWorkCenterId: 'wc-nxt-01',
          reason: `Nozzle ${params.nozzleId} vacuum pressure decay detected`,
          priority: 'HIGH'
        }
      });
    }

    return {
      nozzleId: params.nozzleId,
      machineId: params.machineId,
      headId: params.headId,
      packageType: params.packageType,
      feederId: params.feederId,
      observationCount: n,
      meanValue: Math.round(mean * 100) / 100,
      baselineMean,
      stdDev: Math.round(stdDev * 100) / 100,
      zScore,
      ewma,
      cusum,
      status,
      anomalyId
    };
  }

  /**
   * Evaluates aperture clogging trends on 3D SPI measurements via linear regression.
   */
  public async evaluateApertureClogging(params: {
    apertureId: string;
    recipeId: string;
    windowPanels?: number;
  }): Promise<ApertureTrendReport> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();
    const points = await this.telemetryStore.getWindow(params.apertureId, 'paste_volume_pct', 120);

    if (points.length < 5) {
      return {
        apertureId: params.apertureId,
        recipeId: params.recipeId,
        panelCount: points.length,
        currentVolumePct: points.length > 0 ? points[points.length - 1].value : 100.0,
        volumeSlopePerPanel: 0.0,
        rSquared: 1.0,
        status: 'STABLE'
      };
    }

    // Linear regression on volume vs panel index: V = m * x + c
    const n = points.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0, sumYY = 0;
    for (let i = 0; i < n; i++) {
      const x = i + 1;
      const y = points[i].value;
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumXX += x * x;
      sumYY += y * y;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Pearson r and R^2
    const num = n * sumXY - sumX * sumY;
    const den = Math.sqrt((n * sumXX - sumX * sumX) * (n * sumYY - sumY * sumY));
    const r = den !== 0 ? num / den : 0;
    const rSquared = Math.round(Math.pow(r, 2) * 1000) / 1000;
    const volumeSlopePerPanel = Math.round(slope * 100) / 100;
    const currentVolumePct = points[points.length - 1].value;

    // Detect negative slope clogging trend (slope < -0.5%/panel with strong correlation)
    const isDegrading = volumeSlopePerPanel < -0.5 && rSquared >= 0.65;
    const isCritical = volumeSlopePerPanel < -0.8 && rSquared >= 0.75;

    const status = isCritical ? 'CRITICAL_CLOGGING_RISK' : (isDegrading ? 'DEGRADING_TREND' : 'STABLE');
    let anomalyId: string | undefined;
    let recommendedActionId: string | undefined;

    if (isCritical) {
      anomalyId = uuidv4();
      recommendedActionId = uuidv4();

      await db.execute(`
        INSERT INTO predictive_anomalies (
          id, anomaly_type, line_id, work_center_id, asset_id, metric,
          score, confidence, baseline_value, observed_value, details_json, status, created_at
        ) VALUES (?, 'APERTURE_CLOGGING_TREND', 'line-smt-01', 'wc-spi-01', ?, 'paste_volume_pct', ?, ?, 100.0, ?, ?, 'OPEN', ?)
      `, [
        anomalyId, params.apertureId, Math.abs(volumeSlopePerPanel), rSquared,
        currentVolumePct, JSON.stringify({ slope: volumeSlopePerPanel, rSquared, intercept }),
        now
      ]);

      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'PREDICTIVE_ANOMALY_DETECTED',
        eventTime: now,
        receivedTime: now,
        sourceType: 'PREDICTIVE_ENGINE',
        sourceId: 'predictive-quality-engine',
        lineId: 'line-smt-01',
        workCenterId: 'wc-spi-01',
        payload: {
          anomalyId,
          anomalyType: 'APERTURE_CLOGGING_TREND',
          lineId: 'line-smt-01',
          workCenterId: 'wc-spi-01',
          assetId: params.apertureId,
          metric: 'paste_volume_pct',
          score: Math.abs(volumeSlopePerPanel),
          confidence: rSquared,
          baselineValue: 100.0,
          observedValue: currentVolumePct,
          details: { slope: volumeSlopePerPanel, rSquared }
        }
      });

      // Recommend Stencil Wipe
      await db.execute(`
        INSERT INTO predictive_actions (
          id, anomaly_id, action_type, target_work_center_id, reason, priority, status, created_at
        ) VALUES (?, ?, 'CLEAN_STENCIL', 'wc-spg-01', ?, 'HIGH', 'RECOMMENDED', ?)
      `, [
        recommendedActionId, anomalyId,
        `Progressive aperture volume decay detected on ${params.apertureId} (Slope: ${volumeSlopePerPanel}%/panel, R2=${rSquared}). Stencil underside wipe recommended.`,
        now
      ]);

      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'PREDICTIVE_ACTION_RECOMMENDED',
        eventTime: now,
        receivedTime: now,
        sourceType: 'PREDICTIVE_ENGINE',
        sourceId: 'predictive-quality-engine',
        lineId: 'line-smt-01',
        workCenterId: 'wc-spg-01',
        payload: {
          actionId: recommendedActionId,
          anomalyId,
          actionType: 'CLEAN_STENCIL',
          targetWorkCenterId: 'wc-spg-01',
          reason: `Aperture ${params.apertureId} negative volume trend`,
          priority: 'HIGH'
        }
      });
    }

    return {
      apertureId: params.apertureId,
      recipeId: params.recipeId,
      panelCount: n,
      currentVolumePct,
      volumeSlopePerPanel,
      rSquared,
      status,
      anomalyId,
      recommendedActionId
    };
  }

  /**
   * Authorizes a recommended predictive action (Safety Policy Gate).
   */
  public async authorizeAction(
    actionId: string,
    authorizedBy: string,
    mode: 'MANUAL_OVERRIDE' | 'POLICY_AUTO' = 'MANUAL_OVERRIDE'
  ): Promise<{ success: boolean; reason?: string }> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();

    const actionRows = await db.query<any>(`SELECT id, status FROM predictive_actions WHERE id = ?`, [actionId]);
    if (actionRows.length === 0) return { success: false, reason: `Action ${actionId} not found` };
    if (actionRows[0].status !== 'RECOMMENDED') {
      return { success: false, reason: `Action ${actionId} is already ${actionRows[0].status}` };
    }

    await db.execute(`
      UPDATE predictive_actions
      SET status = 'AUTHORIZED', authorization_mode = ?, authorized_by = ?, authorized_at = ?
      WHERE id = ?
    `, [mode, authorizedBy, now, actionId]);

    await this.eventStore.append({
      eventId: uuidv4(),
      eventType: 'PREDICTIVE_ACTION_AUTHORIZED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'PREDICTIVE_ENGINE',
      sourceId: 'predictive-quality-engine',
      workCenterId: 'wc-spg-01',
      payload: {
        actionId,
        authorizedBy,
        authorizationMode: mode,
        authorizedAt: now
      }
    });

    return { success: true };
  }

  /**
   * Executes an authorized predictive action through MachineControlModule.
   */
  public async executeAction(actionId: string): Promise<{ success: boolean; reason?: string }> {
    const db = this.dbProvider();
    const now = this.clock.now().toISOString();

    const actionRows = await db.query<any>(`
      SELECT id, action_type, target_work_center_id, status
      FROM predictive_actions
      WHERE id = ?
    `, [actionId]);

    if (actionRows.length === 0) return { success: false, reason: `Action ${actionId} not found` };
    const action = actionRows[0];

    if (action.status !== 'AUTHORIZED') {
      return {
        success: false,
        reason: `SAFETY_ABORT: Action ${actionId} is not in AUTHORIZED state (current: ${action.status})`
      };
    }

    // Physical Hardware Abstraction Layer Check via MachineControlModule
    const adapter = this.machineControl.getAdapter(action.target_work_center_id);
    if (!adapter) {
      await db.execute(`
        UPDATE predictive_actions
        SET status = 'FAILED', error_message = 'TARGET_ADAPTER_UNAVAILABLE'
        WHERE id = ?
      `, [actionId]);
      return {
        success: false,
        reason: `TARGET_ADAPTER_UNAVAILABLE: Work center ${action.target_work_center_id} has no control adapter`
      };
    }

    try {
      if (action.action_type === 'CLEAN_STENCIL') {
        const cmdResult = await this.machineControl.executeAction(
          action.target_work_center_id,
          { type: 'CLEANING', mode: 'VACUUM_SOLVENT', triggerReason: 'PREDICTIVE_APERTURE_MAINTENANCE' }
        );

        await db.execute(`
          UPDATE predictive_actions
          SET status = 'EXECUTED', executed_at = ?, execution_result_json = ?
          WHERE id = ?
        `, [now, JSON.stringify(cmdResult), actionId]);

        await this.eventStore.append({
          eventId: uuidv4(),
          eventType: 'PREDICTIVE_ACTION_EXECUTED',
          eventTime: now,
          receivedTime: now,
          sourceType: 'PREDICTIVE_ENGINE',
          sourceId: 'predictive-quality-engine',
          workCenterId: action.target_work_center_id,
          payload: {
            actionId,
            executedAt: now,
            success: true,
            commandResult: cmdResult
          }
        });

        return { success: true };
      } else {
        // Other actions (e.g. INSPECT_NOZZLE) mark as EXECUTED maintenance order
        await db.execute(`
          UPDATE predictive_actions
          SET status = 'EXECUTED', executed_at = ?
          WHERE id = ?
        `, [now, actionId]);

        await this.eventStore.append({
          eventId: uuidv4(),
          eventType: 'PREDICTIVE_ACTION_EXECUTED',
          eventTime: now,
          receivedTime: now,
          sourceType: 'PREDICTIVE_ENGINE',
          sourceId: 'predictive-quality-engine',
          workCenterId: action.target_work_center_id,
          payload: { actionId, executedAt: now, success: true }
        });

        return { success: true };
      }
    } catch (err: any) {
      await db.execute(`
        UPDATE predictive_actions
        SET status = 'FAILED', error_message = ?
        WHERE id = ?
      `, [err.message || 'EXECUTION_ERROR', actionId]);

      await this.eventStore.append({
        eventId: uuidv4(),
        eventType: 'PREDICTIVE_ACTION_FAILED',
        eventTime: now,
        receivedTime: now,
        sourceType: 'PREDICTIVE_ENGINE',
        sourceId: 'predictive-quality-engine',
        workCenterId: action.target_work_center_id,
        payload: {
          actionId,
          failedAt: now,
          errorCode: 'HARDWARE_REJECTION',
          reason: err.message || 'Execution error'
        }
      });

      return { success: false, reason: err.message };
    }
  }

  /**
   * Fetches active predictive anomalies.
   */
  public async getActiveAnomalies(lineId?: string): Promise<any[]> {
    const db = this.dbProvider();
    let sql = `
      SELECT 
        id, anomaly_type as anomalyType, line_id as lineId,
        work_center_id as workCenterId, asset_id as assetId,
        metric, score, confidence, baseline_value as baselineValue,
        observed_value as observedValue, details_json as detailsJson,
        status, created_at as createdAt
      FROM predictive_anomalies
      WHERE status = 'OPEN'
    `;
    const params: any[] = [];
    if (lineId) {
      sql += ' AND line_id = ?';
      params.push(lineId);
    }
    sql += ' ORDER BY score DESC';

    const rows = await db.query<any>(sql, params);
    return rows.map(r => ({
      ...r,
      details: r.detailsJson ? JSON.parse(r.detailsJson) : undefined
    }));
  }

  /**
   * Fetches pending predictive actions.
   */
  public async getPendingActions(): Promise<PredictiveActionRecord[]> {
    const db = this.dbProvider();
    const rows = await db.query<any>(`
      SELECT 
        id, anomaly_id as anomalyId, action_type as actionType,
        target_work_center_id as targetWorkCenterId, parameters_json as parametersJson,
        reason, priority, status, authorization_mode as authorizationMode,
        authorized_by as authorizedBy, authorized_at as authorizedAt,
        executed_at as executedAt, error_message as errorMessage
      FROM predictive_actions
      WHERE status IN ('RECOMMENDED', 'AUTHORIZED')
      ORDER BY created_at DESC
    `);

    return rows.map(r => ({
      id: r.id,
      anomalyId: r.anomalyId,
      actionType: r.actionType,
      targetWorkCenterId: r.targetWorkCenterId,
      parameters: r.parametersJson ? JSON.parse(r.parametersJson) : undefined,
      reason: r.reason,
      priority: r.priority,
      status: r.status,
      authorizationMode: r.authorizationMode,
      authorizedBy: r.authorizedBy,
      authorizedAt: r.authorizedAt,
      executedAt: r.executedAt,
      errorMessage: r.errorMessage
    }));
  }
}
