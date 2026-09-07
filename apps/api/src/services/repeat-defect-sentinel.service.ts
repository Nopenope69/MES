import { v4 as uuidv4 } from 'uuid';
import {
  CanonicalAoiInspectionResult,
  CanonicalAoiDefect,
  DefectSignature,
  QualityRuleConfig
} from '@mes/shared';
import { getDatabase } from '../db/database';
import { EventIngestionService } from './event-ingestion.service';
import { MachineControlModule } from '../modules/machine-control/machine-control.module';

export interface SentinelEvaluationResult {
  interlockTripped: boolean;
  trippedSignatures: Array<{
    signature: string;
    refDes: string;
    defectType: string;
    consecutiveCount: number;
    slidingWindowCount: number;
    reason: string;
  }>;
}

export class RepeatDefectSentinelService {
  private static fujiHoldCommander: ((reason: string) => Promise<void>) | null = null;
  private static fujiClearCommander: (() => Promise<void>) | null = null;

  public static registerFujiCommander(
    hold: (reason: string) => Promise<void>,
    clear: () => Promise<void>
  ): void {
    this.fujiHoldCommander = hold;
    this.fujiClearCommander = clear;

    MachineControlModule.getInstance().registerAdapter({
      id: 'fuji-legacy-callback-adapter',
      name: 'Fuji Legacy Callback Adapter',
      protocolName: 'CALLBACK',
      workCenterId: 'wc-nxt-01',
      startListener: () => {},
      stopListener: () => {},
      getStatus: () => ({
        id: 'fuji-legacy-callback-adapter',
        name: 'Fuji Legacy Callback Adapter',
        protocolName: 'CALLBACK',
        workCenterId: 'wc-nxt-01',
        isRunning: true,
        port: 0,
        activeConnections: 1,
        framesProcessedTotal: 0
      }),
      getCapabilities: () => ['HOLD'],
      tripHold: async (reason: string) => hold(reason),
      clearHold: async (_reason: string) => clear(),
      isHoldActive: () => ({ active: true, reason: null }),
      applyParameters: async () => false,
      executeAction: async () => false
    });
  }

  /**
   * Evaluates an AOI inspection for repeat defect signatures against configured quality rules.
   */
  public static async evaluate(
    inspection: CanonicalAoiInspectionResult,
    programId: string = 'PROG-SM-METER-TOP-REV4',
    programRevision: number = 4
  ): Promise<SentinelEvaluationResult> {
    const db = getDatabase();
    const tripped: Array<{
      signature: string;
      refDes: string;
      defectType: string;
      consecutiveCount: number;
      slidingWindowCount: number;
      reason: string;
    }> = [];

    if (!inspection.defects || inspection.defects.length === 0) {
      return { interlockTripped: false, trippedSignatures: [] };
    }

    // Load active quality rule for program
    const rules = await db.query<QualityRuleConfig>(
      `SELECT id, product_id, program_id, consecutive_failure_limit as consecutiveFailureLimit,
              sliding_window_failures as slidingWindowFailures, sliding_window_panels as slidingWindowPanels,
              default_max_rework_cycles as defaultMaxReworkCycles
       FROM quality_rules
       WHERE program_id = ? OR program_id IS NULL
       LIMIT 1`,
      [programId]
    );

    const rule: QualityRuleConfig = rules.length > 0 ? rules[0] : {
      id: 'default-rule',
      consecutiveFailureLimit: 3,
      slidingWindowFailures: 5,
      slidingWindowPanels: 20,
      defaultMaxReworkCycles: 2
    };

    for (const defect of inspection.defects) {
      const signature = `${programId}:${inspection.workCenterId}:${inspection.opticalMachineId}:${defect.refDes}:${defect.defectType}`;
      defect.defectSignature = signature;

      // 1. Check sliding window: how many defects with this signature across the last N panels?
      const recentPanels = await db.query<{ panel_barcode: string; result: string }>(
        `SELECT panel_barcode, result
         FROM aoi_inspections
         WHERE work_center_id = ?
         ORDER BY inspected_at DESC
         LIMIT ?`,
        [inspection.workCenterId, rule.slidingWindowPanels]
      );

      const panelBarcodes = recentPanels.map(p => p.panel_barcode);
      panelBarcodes.push(inspection.panelBarcode);

      let slidingCount = 1;
      if (panelBarcodes.length > 0) {
        const placeholders = panelBarcodes.map(() => '?').join(',');
        const pastDefects = await db.query<{ count: number }>(
          `SELECT COUNT(DISTINCT panel_barcode) as count
           FROM aoi_defects
           WHERE panel_barcode IN (${placeholders})
             AND ref_des = ?
             AND defect_type = ?`,
          [...panelBarcodes, defect.refDes, defect.defectType]
        );
        slidingCount = Number(pastDefects[0]?.count || 0) + 1;
      }

      // 2. Check consecutive failures: inspect previous panels in chronological descending order
      let consecutiveCount = 1;
      for (const p of recentPanels) {
        const hasDefect = await db.query<{ id: string }>(
          `SELECT id FROM aoi_defects WHERE panel_barcode = ? AND ref_des = ? AND defect_type = ? LIMIT 1`,
          [p.panel_barcode, defect.refDes, defect.defectType]
        );
        if (hasDefect.length > 0) {
          consecutiveCount++;
        } else {
          break; // broke consecutive run
        }
      }

      let trippedReason = '';
      if (consecutiveCount >= rule.consecutiveFailureLimit) {
        trippedReason = `Consecutive defect limit reached (${consecutiveCount} >= ${rule.consecutiveFailureLimit}) on RefDes ${defect.refDes} [${defect.defectType}]`;
      } else if (slidingCount >= rule.slidingWindowFailures) {
        trippedReason = `Sliding window defect rate exceeded (${slidingCount}/${rule.slidingWindowPanels} >= ${rule.slidingWindowFailures}) on RefDes ${defect.refDes} [${defect.defectType}]`;
      }

      if (trippedReason) {
        tripped.push({
          signature,
          refDes: defect.refDes,
          defectType: defect.defectType,
          consecutiveCount,
          slidingWindowCount: slidingCount,
          reason: trippedReason
        });

        // Trip Interlock
        console.warn(`[SENTINEL] REPEAT DEFECT INTERLOCK: ${trippedReason}`);
        await this.tripInterlock(
          programId,
          programRevision,
          inspection.workCenterId,
          inspection.opticalMachineId,
          defect.refDes,
          defect.defectType,
          consecutiveCount,
          slidingCount,
          trippedReason
        );
      }
    }

    return {
      interlockTripped: tripped.length > 0,
      trippedSignatures: tripped
    };
  }

  private static async tripInterlock(
    programId: string,
    programRevision: number,
    workCenterId: string,
    machineId: string,
    refDes: string,
    defectType: string,
    consecutiveCount: number,
    slidingWindowCount: number,
    reason: string
  ): Promise<void> {
    const now = new Date().toISOString();

    // 1. Emit REPEAT_DEFECT_INTERLOCK_TRIPPED event
    await EventIngestionService.ingest({
      eventId: uuidv4(),
      eventType: 'REPEAT_DEFECT_INTERLOCK_TRIPPED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'QUALITY_SENTINEL',
      sourceId: 'RepeatDefectSentinelService',
      workCenterId,
      payload: {
        programId,
        programRevision,
        workCenterId,
        machineId,
        refDes,
        defectType,
        consecutiveCount,
        slidingWindowFailures: slidingWindowCount,
        thresholdLimit: 3,
        actionTaken: 'PRODUCTION_HOLD_COMMANDED',
        reason
      }
    });

    // 2. Command upstream placement machine production hold (via MachineControlModule HAL)
    if (this.fujiHoldCommander) {
      await this.fujiHoldCommander(reason);
    } else {
      await MachineControlModule.getInstance().tripInterlock(workCenterId, reason, {
        programId,
        programRevision,
        machineId,
        refDes,
        defectType,
        consecutiveCount,
        slidingWindowCount,
        sourceId: 'RepeatDefectSentinelService'
      });
    }
  }

  public static async clearInterlock(
    workCenterId: string,
    authorizedBy: string,
    reason: string
  ): Promise<void> {
    console.log(`[SENTINEL] Production interlock cleared by ${authorizedBy} on ${workCenterId}. Reason: ${reason}`);
    if (this.fujiClearCommander) {
      await this.fujiClearCommander();
    } else {
      await MachineControlModule.getInstance().clearInterlock(workCenterId, authorizedBy, reason);
    }
  }
}
