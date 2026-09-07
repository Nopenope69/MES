import { v4 as uuidv4 } from 'uuid';
import { getDatabase, IDatabase } from '../../db/database';
import {
  CanonicalAoiInspectionResult,
  QualityDispositionType,
  CadCoordinateDefinition,
  QualityRuleConfig
} from '@mes/shared';
import { IEventStoreModule } from '../event-store/event-store.interface';
import { EventStoreModule } from '../event-store/event-store.module';
import { IMachineControlModule } from '../machine-control/machine-control.interface';
import { MachineControlModule } from '../machine-control/machine-control.module';
import { MslService } from '../../services/msl.service';
import {
  IDefectLifecycleModule,
  IngestionResult,
  SentinelEvaluationResult,
  ReplacementVerificationResult,
  ExecuteReplacementParams,
  PostReworkInspectionParams,
  DefectCorrelationReport
} from './defect-lifecycle.interface';

export class DefectLifecycleModule implements IDefectLifecycleModule {
  private static instance: DefectLifecycleModule | null = null;
  private dbProvider: () => IDatabase;
  private eventStoreProvider: () => IEventStoreModule;
  private machineControlProvider: () => IMachineControlModule;
  private mslServiceProvider: () => MslService;

  constructor(options?: {
    dbProvider?: () => IDatabase;
    eventStoreProvider?: () => IEventStoreModule;
    machineControlProvider?: () => IMachineControlModule;
    mslServiceProvider?: () => MslService;
  }) {
    this.dbProvider = options?.dbProvider || getDatabase;
    this.eventStoreProvider = options?.eventStoreProvider || (() => EventStoreModule.getInstance());
    this.machineControlProvider = options?.machineControlProvider || (() => MachineControlModule.getInstance());
    this.mslServiceProvider = options?.mslServiceProvider || (() => new MslService());
  }

  public static getInstance(options?: {
    dbProvider?: () => IDatabase;
    eventStoreProvider?: () => IEventStoreModule;
    machineControlProvider?: () => IMachineControlModule;
    mslServiceProvider?: () => MslService;
  }): DefectLifecycleModule {
    if (!this.instance) {
      this.instance = new DefectLifecycleModule(options);
    }
    return this.instance;
  }

  public static resetInstance(): void {
    this.instance = null;
  }

  /**
   * Primary AOI/SPI ingestion engine with strict idempotency, event storage, and repeat defect evaluation.
   */
  public async ingestInspection(canonical: CanonicalAoiInspectionResult): Promise<IngestionResult> {
    const db = this.dbProvider();
    const eventStore = this.eventStoreProvider();

    // 1. Idempotency Check: (source_system, source_inspection_id, source_file_hash)
    const existing = await db.query<{ id: string; result: string; total_defects: number }>(
      `SELECT id, result, total_defects
       FROM aoi_inspections
       WHERE source_system = ? AND source_inspection_id = ? AND source_file_hash = ?
       LIMIT 1`,
      [canonical.sourceSystem, canonical.sourceInspectionId, canonical.sourceFileHash]
    );

    if (existing.length > 0) {
      return {
        idempotentDuplicate: true,
        inspectionId: existing[0].id,
        result: existing[0].result as 'PASS' | 'FAIL',
        totalDefects: existing[0].total_defects,
        qualityHoldApplied: existing[0].result === 'FAIL',
        interlockTripped: false,
        sentinelEvaluation: { interlockTripped: false, trippedSignatures: [] }
      };
    }

    const inspectionId = uuidv4();
    const now = canonical.timestamp || new Date().toISOString();

    // 2. Ingest AOI_INSPECTION_COMPLETED event via EventStoreModule
    await eventStore.append({
      eventId: uuidv4(),
      eventType: 'AOI_INSPECTION_COMPLETED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'AOI_GATEWAY',
      sourceId: canonical.opticalMachineId,
      workCenterId: canonical.workCenterId,
      batchId: canonical.batchId,
      payload: {
        inspectionId,
        sourceSystem: canonical.sourceSystem,
        sourceInspectionId: canonical.sourceInspectionId,
        sourceFileHash: canonical.sourceFileHash,
        panelBarcode: canonical.panelBarcode,
        batchId: canonical.batchId,
        workCenterId: canonical.workCenterId,
        opticalMachineId: canonical.opticalMachineId,
        inspectionPhase: canonical.inspectionPhase,
        result: canonical.result,
        totalDefects: canonical.totalDefects,
        durationSeconds: canonical.durationSeconds,
        defects: canonical.defects
      }
    });

    // 3. Evaluate Repeat Defect Sentinel if inspection failed
    let sentinelEvaluation: SentinelEvaluationResult = { interlockTripped: false, trippedSignatures: [] };
    if (canonical.result === 'FAIL' && canonical.defects && canonical.defects.length > 0) {
      sentinelEvaluation = await this.evaluateRepeatDefects(canonical);
    }

    return {
      idempotentDuplicate: false,
      inspectionId,
      result: canonical.result,
      totalDefects: canonical.totalDefects,
      qualityHoldApplied: canonical.result === 'FAIL',
      interlockTripped: sentinelEvaluation.interlockTripped,
      sentinelEvaluation
    };
  }

  /**
   * Evaluates repeat defect patterns and commands machine holds via MachineControlModule.
   */
  public async evaluateRepeatDefects(
    canonical: CanonicalAoiInspectionResult,
    programId: string = 'PROG-SM-METER-TOP-REV4',
    programRevision: number = 4
  ): Promise<SentinelEvaluationResult> {
    const db = this.dbProvider();
    const tripped: Array<{
      signature: string;
      refDes: string;
      defectType: string;
      consecutiveCount: number;
      slidingWindowCount: number;
      reason: string;
    }> = [];

    if (!canonical.defects || canonical.defects.length === 0) {
      return { interlockTripped: false, trippedSignatures: [] };
    }

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
    } as any;

    for (const defect of canonical.defects) {
      const signature = `${programId}:${canonical.workCenterId}:${canonical.opticalMachineId}:${defect.refDes}:${defect.defectType}`;
      (defect as any).defectSignature = signature;

      // 1. Check sliding window: how many defects with this signature across the last N panels?
      const recentPanels = await db.query<{ panel_barcode: string; result: string }>(
        `SELECT panel_barcode, result
         FROM aoi_inspections
         WHERE work_center_id = ?
         ORDER BY inspected_at DESC
         LIMIT ?`,
        [canonical.workCenterId, rule.slidingWindowPanels]
      );

      const panelBarcodes = recentPanels.map((p) => p.panel_barcode);
      panelBarcodes.push(canonical.panelBarcode);

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

        // Command Machine Control HAL Interlock on upstream placement machine
        const machineControl = this.machineControlProvider();
        await machineControl.tripInterlock(
          'wc-nxt-01',
          trippedReason,
          {
            sourceId: 'DefectLifecycleModule',
            programId,
            programRevision,
            refDes: defect.refDes,
            defectType: defect.defectType,
            consecutiveCount,
            slidingWindowCount: slidingCount,
            machineId: canonical.opticalMachineId
          }
        );
        break;
      }
    }

    return {
      interlockTripped: tripped.length > 0,
      trippedSignatures: tripped
    };
  }

  /**
   * Records formal engineering disposition for a defective unit (REWORK, SCRAP, ACCEPT_AS_IS, REINSPECT).
   */
  public async recordDisposition(params: {
    defectId: string;
    panelBarcode: string;
    unitPosition: number;
    disposition: QualityDispositionType;
    reason: string;
    authorizedBy: string;
  }): Promise<{ success: boolean; dispositionId: string; status: string }> {
    const eventStore = this.eventStoreProvider();
    const now = new Date().toISOString();
    const eventId = uuidv4();

    await eventStore.append({
      eventId,
      eventType: 'QUALITY_DISPOSITION_DECIDED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'QUALITY_ENGINE',
      sourceId: 'DefectLifecycleModule',
      workCenterId: 'wc-aoi-01',
      operatorId: params.authorizedBy,
      payload: {
        defectId: params.defectId,
        panelBarcode: params.panelBarcode,
        unitPosition: params.unitPosition,
        disposition: params.disposition,
        reason: params.reason,
        authorizedBy: params.authorizedBy
      }
    });

    let nextStatus = 'REWORK_PENDING';
    if (params.disposition === 'SCRAP') nextStatus = 'SCRAPPED';
    else if (params.disposition === 'ACCEPT_AS_IS') nextStatus = 'RELEASED';
    else if (params.disposition === 'REWORK') nextStatus = 'REWORK_PENDING';

    return {
      success: true,
      dispositionId: eventId,
      status: nextStatus
    };
  }

  /**
   * Verifies replacement component reel against BOM MPN, CAD thermal rework limits,
   * and crucially enforces computed JEDEC MSL floor-life on-read via MslService.
   */
  public async verifyReplacement(
    panelBarcode: string,
    unitPosition: number = 1,
    refDes: string,
    replacementReelId: string
  ): Promise<ReplacementVerificationResult> {
    const db = this.dbProvider();
    const errors: string[] = [];

    // 1. Fetch CAD definition for MPN and max rework cycles
    const cadRows = await db.query<{ assigned_part_number: string; max_rework_cycles: number }>(
      `SELECT assigned_part_number, max_rework_cycles
       FROM pcb_cad_definitions
       WHERE ref_des = ? AND unit_position = ?
       LIMIT 1`,
      [refDes, unitPosition]
    );

    const expectedMpn = cadRows[0]?.assigned_part_number || 'UNKNOWN_MPN';
    const maxReworkCycles = cadRows[0]?.max_rework_cycles ?? 2;

    // 2. Check previous rework cycles on this component
    const cycleRows = await db.query<{ count: number }>(
      `SELECT COUNT(*) as count
       FROM rework_events
       WHERE panel_barcode = ? AND unit_position = ? AND ref_des = ?`,
      [panelBarcode, unitPosition, refDes]
    );
    const existingCycles = Number(cycleRows[0]?.count || 0);
    const nextCycle = existingCycles + 1;

    if (existingCycles >= maxReworkCycles) {
      errors.push(
        `Thermal rework limit exceeded (${existingCycles} >= ${maxReworkCycles}) for ${refDes}. Pad thermal stress exceeds specification; unit must be scrapped or routed to engineering disposition.`
      );
    }

    // 3. Validate replacement reel
    const reelRows = await db.query<{
      part_number: string;
      lot_number: string;
      supplier_name: string;
      status: string;
      msl_class: string;
      current_quantity: number;
    }>(
      `SELECT part_number, lot_number, supplier_name, status, msl_class, current_quantity
       FROM component_reels
       WHERE reel_id = ?
       LIMIT 1`,
      [replacementReelId]
    );

    if (reelRows.length === 0) {
      errors.push(`Replacement reel [${replacementReelId}] not found in component inventory.`);
      return {
        valid: false,
        errors,
        expectedMpn,
        currentCycle: nextCycle,
        maxReworkCycles
      };
    }

    const reel = reelRows[0];

    // BOM Match check
    if (reel.part_number.trim().toUpperCase() !== expectedMpn.trim().toUpperCase()) {
      errors.push(`BOM Mismatch: Expected MPN '${expectedMpn}', but scanned reel is '${reel.part_number}'.`);
    }

    // Reel status check
    if (['QUARANTINED', 'EXPIRED_MSL'].includes(reel.status)) {
      errors.push(`Reel [${replacementReelId}] cannot be used. Status is '${reel.status}'.`);
    }

    // 4. JEDEC MSL Check: MUST be computed dynamically on-read via MslService
    const mslService = this.mslServiceProvider();
    try {
      const mslStatus = await mslService.getReelMslStatus(replacementReelId);
      if (mslStatus.mslClass && mslStatus.mslClass !== 'MSL_1') {
        if (
          mslStatus.isExpired ||
          mslStatus.remainingFloorLifeMinutes <= 0 ||
          mslStatus.floorClockState === 'BAKE_REQUIRED'
        ) {
          errors.push(
            `JEDEC MSL Violation: Reel [${replacementReelId}] (${mslStatus.mslClass}) floor-life has expired (${mslStatus.remainingFloorLifeMinutes} mins remaining). Mandatory bake cycle required.`
          );
        }
      }
    } catch (err: any) {
      errors.push(`JEDEC MSL verification error: ${err.message}`);
    }

    if (reel.current_quantity <= 0) {
      errors.push(`Reel [${replacementReelId}] has zero remaining components.`);
    }

    return {
      valid: errors.length === 0,
      errors,
      expectedMpn,
      replacementMpn: reel.part_number,
      reelLot: reel.lot_number,
      supplierName: reel.supplier_name,
      currentCycle: nextCycle,
      maxReworkCycles
    };
  }

  /**
   * Executes the physical component replacement on the rework bench,
   * decrements stock, updates eDHR/genealogy, and emits canonical audit events.
   */
  public async executeReplacement(params: ExecuteReplacementParams): Promise<{
    success: boolean;
    reworkEventId: string;
    reworkCycle: number;
    message: string;
  }> {
    const db = this.dbProvider();
    const eventStore = this.eventStoreProvider();

    const verification = await this.verifyReplacement(
      params.panelBarcode,
      params.unitPosition,
      params.refDes,
      params.replacementReelId
    );

    if (!verification.valid) {
      throw new Error(`Rework verification failed: ${verification.errors.join('; ')}`);
    }

    // Identify old reel / MPN from original SMT feeder consumption if available
    const oldConsumption = await db.query<{ material_lot_number: string; material_code: string }>(
      `SELECT material_lot_number, material_code
       FROM material_consumptions
       WHERE material_code = ?
       ORDER BY consumed_at DESC LIMIT 1`,
      [verification.expectedMpn]
    );

    const oldReelId = oldConsumption[0]?.material_lot_number || 'ORIG-PLACEMENT-LOT';
    const oldMpn = oldConsumption[0]?.material_code || verification.expectedMpn;
    const now = new Date().toISOString();
    const reworkEventId = uuidv4();

    // 1. Emit COMPONENT_REPLACED event
    await eventStore.append({
      eventId: reworkEventId,
      eventType: 'COMPONENT_REPLACED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'REWORK_KIOSK',
      sourceId: params.stationId || 'STATION-REWORK-01',
      workCenterId: 'wc-aoi-01',
      operatorId: params.technicianId,
      payload: {
        defectId: params.defectId,
        panelBarcode: params.panelBarcode,
        unitPosition: params.unitPosition,
        refDes: params.refDes,
        technicianId: params.technicianId,
        stationId: params.stationId || 'STATION-REWORK-01',
        oldMpn,
        oldReelId,
        replacementMpn: verification.replacementMpn || verification.expectedMpn,
        replacementReelId: params.replacementReelId,
        reworkMethod: params.reworkMethod || 'HOT_AIR_DESOLDER_SOLDERING_IRON',
        temperatureProfileId: params.temperatureProfileId || 'TEMP-SN96-LEADFREE',
        reworkCycle: verification.currentCycle
      }
    });

    // 2. Emit REWORK_COMPLETED event
    await eventStore.append({
      eventId: uuidv4(),
      eventType: 'REWORK_COMPLETED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'REWORK_KIOSK',
      sourceId: params.stationId || 'STATION-REWORK-01',
      workCenterId: 'wc-aoi-01',
      operatorId: params.technicianId,
      payload: {
        defectId: params.defectId,
        panelBarcode: params.panelBarcode,
        unitPosition: params.unitPosition,
        technicianId: params.technicianId,
        reworkCycle: verification.currentCycle,
        notes: `Replaced RefDes ${params.refDes} using reel ${params.replacementReelId} (Cycle ${verification.currentCycle}/${verification.maxReworkCycles})`
      }
    });

    // 3. Decrement replacement reel quantity by 1
    await db.execute(
      `UPDATE component_reels SET current_quantity = MAX(0, current_quantity - 1) WHERE reel_id = ?`,
      [params.replacementReelId]
    );

    return {
      success: true,
      reworkEventId,
      reworkCycle: verification.currentCycle,
      message: `Component [${params.refDes}] replaced successfully. Unit ${params.unitPosition} moved to REWORK_PASSED. Mandatory optical re-inspection required before release.`
    };
  }

  /**
   * Records post-rework optical inspection. Closed-loop quality rule: no board can be released
   * directly from rework without verified post-rework inspection passing.
   */
  public async verifyPostRework(params: PostReworkInspectionParams): Promise<{
    success: boolean;
    panelStatus: string;
    message: string;
  }> {
    const eventStore = this.eventStoreProvider();
    const now = new Date().toISOString();
    const finalStatus = params.result === 'PASS' ? 'RELEASED' : 'REWORK_FAILED';

    await eventStore.append({
      eventId: uuidv4(),
      eventType: 'POST_REWORK_INSPECTION_COMPLETED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'AOI_POST_REWORK',
      sourceId: 'KohYoung-PostRework',
      workCenterId: 'wc-aoi-01',
      operatorId: params.inspectorId,
      payload: {
        defectId: params.defectId,
        panelBarcode: params.panelBarcode,
        unitPosition: params.unitPosition,
        result: params.result,
        inspectorId: params.inspectorId,
        notes: params.notes || `Post-rework inspection result: ${params.result}`
      }
    });

    return {
      success: true,
      panelStatus: finalStatus,
      message:
        params.result === 'PASS'
          ? `Post-rework inspection PASSED. Unit ${params.unitPosition} on panel ${params.panelBarcode} is RELEASED.`
          : `Post-rework inspection FAILED. Unit ${params.unitPosition} on panel ${params.panelBarcode} moved to REWORK_FAILED.`
    };
  }

  /**
   * Correlates an optical inspection defect back to the SMT line root-cause components.
   */
  public async correlate(
    panelBarcode: string,
    unitPosition: number = 1,
    refDes: string
  ): Promise<DefectCorrelationReport> {
    const db = this.dbProvider();

    const cadRows = await db.query<{
      assigned_part_number: string;
      package_type: string;
      x_mm: number;
      y_mm: number;
      rotation_deg: number;
      board_side: string;
    }>(
      `SELECT assigned_part_number, package_type, x_mm, y_mm, rotation_deg, board_side
       FROM pcb_cad_definitions
       WHERE ref_des = ? AND unit_position = ?
       LIMIT 1`,
      [refDes, unitPosition]
    );

    const cad = cadRows[0] || {
      assigned_part_number: 'UNKNOWN',
      package_type: 'UNKNOWN',
      x_mm: 0,
      y_mm: 0,
      rotation_deg: 0,
      board_side: 'TOP'
    };

    const defectRows = await db.query<{ defect_type: string; defect_category: string }>(
      `SELECT defect_type, defect_category
       FROM aoi_defects
       WHERE panel_barcode = ? AND unit_position = ? AND ref_des = ?
       ORDER BY created_at DESC LIMIT 1`,
      [panelBarcode, unitPosition, refDes]
    );
    const defectType = defectRows[0]?.defect_type || 'TOMBSTONE';
    const defectCategory = defectRows[0]?.defect_category || 'SOLDER';

    const feederRows = await db.query<{
      module_no: number;
      slot_no: number;
      feeder_id: string;
      feeder_type: string;
      current_reel_id: string;
    }>(
      `SELECT module_no, slot_no, feeder_id, feeder_type, current_reel_id
       FROM smt_feeder_slots
       WHERE assigned_part_number = ?
       LIMIT 1`,
      [cad.assigned_part_number]
    );
    const feeder = feederRows[0];
    let feederSlot: DefectCorrelationReport['feederSlot'];
    if (feeder) {
      feederSlot = {
        moduleNo: feeder.module_no,
        slotNo: feeder.slot_no,
        feederId: feeder.feeder_id,
        feederType: feeder.feeder_type
      };
    }

    let componentReel: any = undefined;
    if (feeder?.current_reel_id) {
      const reelRows = await db.query<{
        reel_id: string;
        lot_number: string;
        supplier_name: string;
        date_code: string;
        msl_class: string;
        msl_remaining_minutes: number;
      }>(
        `SELECT reel_id, lot_number, supplier_name, date_code, msl_class, msl_remaining_minutes
         FROM component_reels
         WHERE reel_id = ?
         LIMIT 1`,
        [feeder.current_reel_id]
      );
      if (reelRows.length > 0) {
        componentReel = {
          reelId: reelRows[0].reel_id,
          lotNumber: reelRows[0].lot_number,
          supplierName: reelRows[0].supplier_name,
          dateCode: reelRows[0].date_code,
          mslClass: reelRows[0].msl_class,
          mslRemainingMinutes: reelRows[0].msl_remaining_minutes
        };
      }
    }

    let nozzleTelemetry: any = undefined;
    if (feeder) {
      const errorLogs = await db.query<{ nozzle_id: string; error_type: string }>(
        `SELECT nozzle_id, error_type
         FROM feeder_error_logs
         WHERE module_no = ? AND slot_no = ?
         ORDER BY occurred_at DESC
         LIMIT 10`,
        [feeder.module_no, feeder.slot_no]
      );
      if (errorLogs.length > 0) {
        nozzleTelemetry = {
          nozzleId: errorLogs[0].nozzle_id || 'NOZ-0402-A',
          recentErrorCount: errorLogs.length,
          lastErrorType: errorLogs[0].error_type
        };
      } else {
        nozzleTelemetry = {
          nozzleId: 'NOZ-0402-A',
          recentErrorCount: 0,
          lastErrorType: 'NONE'
        };
      }
    }

    const pasteRows = await db.query<{
      jar_id: string;
      lot_number: string;
      part_number: string;
      alloy_type: string;
      status: string;
    }>(
      `SELECT jar_id, lot_number, part_number, alloy_type, status
       FROM solder_paste_jars
       WHERE status IN ('ON_STENCIL', 'AUTHORIZED')
       ORDER BY CASE WHEN status = 'ON_STENCIL' THEN 1 ELSE 2 END, mixed_at DESC
       LIMIT 1`
    );
    let solderPaste: DefectCorrelationReport['solderPaste'];
    if (pasteRows.length > 0) {
      const p = pasteRows[0];
      solderPaste = {
        jarId: p.jar_id,
        lotNumber: p.lot_number,
        partNumber: p.part_number,
        alloyType: p.alloy_type,
        status: p.status
      };
    }

    const stencilRows = await db.query<{
      stencil_id: string;
      stencil_serial_number: string;
      revision: string;
    }>(
      `SELECT stencil_id, stencil_serial_number, revision
       FROM stencils
       WHERE status = 'IN_USE'
       LIMIT 1`
    );

    let stencil: DefectCorrelationReport['stencil'];
    if (stencilRows.length > 0) {
      const st = stencilRows[0];
      stencil = {
        stencilId: st.stencil_id,
        serialNumber: st.stencil_serial_number,
        revision: st.revision
      };
    }

    let rootCauseHypothesis = '';
    if (defectCategory === 'SOLDER' || defectType === 'TOMBSTONE') {
      rootCauseHypothesis = `Solder surface tension imbalance during reflow peak. Correlated to Solder Paste Jar [${solderPaste?.jarId || 'JAR-ALPHA-2601-C'} / Lot ${solderPaste?.lotNumber || 'LOT-PASTE-2601'}] and Stencil [${stencil?.serialNumber || 'STN-2026-0042'}]. Inspect stencil aperture release for RefDes ${refDes}.`;
    } else if (defectType === 'BRIDGING') {
      rootCauseHypothesis = `Excess solder volume deposition or stencil underside paste smearing. Review SPI volume heights and wipe frequency on Stencil [${stencil?.stencilId}].`;
    } else if (defectType === 'MISSING' || defectType === 'MISALIGNED') {
      rootCauseHypothesis = `Placement pickup or vacuum loss. Correlated to Feeder [${feederSlot?.feederId || 'FID-W08F-01'}] in Module ${feederSlot?.moduleNo || 1}, Slot ${feederSlot?.slotNo || 1}, Nozzle [${nozzleTelemetry?.nozzleId || 'NOZ-0402-A'}]. Recent feeder errors: ${nozzleTelemetry?.recentErrorCount || 0}.`;
    } else {
      rootCauseHypothesis = `Defect ${defectType} on RefDes ${refDes}. Correlated to Reel Lot [${componentReel?.lotNumber || 'UNKNOWN'}] from Supplier [${componentReel?.supplierName || 'UNKNOWN'}].`;
    }

    return {
      panelBarcode,
      unitPosition,
      refDes,
      defectType,
      partNumber: cad.assigned_part_number,
      packageType: cad.package_type,
      cadCoordinates: {
        xMm: cad.x_mm,
        yMm: cad.y_mm,
        rotationDeg: cad.rotation_deg,
        boardSide: cad.board_side
      },
      feederSlot,
      componentReel,
      nozzleTelemetry,
      solderPaste,
      stencil,
      rootCauseHypothesis
    };
  }

  /**
   * Retrieves panel quality status including multi-up units (1..N), inspection runs, and defects.
   */
  public async getPanelQuality(panelBarcode: string): Promise<any> {
    const db = this.dbProvider();

    const units = await db.query<{
      id: string;
      panel_barcode: string;
      unit_position: number;
      unit_serial_number: string;
      status: string;
      updated_at: string;
    }>(
      `SELECT id, panel_barcode, unit_position, unit_serial_number, status, updated_at
       FROM panel_units
       WHERE panel_barcode = ?
       ORDER BY unit_position ASC`,
      [panelBarcode]
    );

    const inspections = await db.query<{
      id: string;
      source_system: string;
      source_inspection_id: string;
      optical_machine_id: string;
      inspection_phase: string;
      result: string;
      total_defects: number;
      duration_seconds: number;
      inspected_at: string;
    }>(
      `SELECT id, source_system, source_inspection_id, optical_machine_id, inspection_phase,
              result, total_defects, duration_seconds, inspected_at
       FROM aoi_inspections
       WHERE panel_barcode = ?
       ORDER BY inspected_at DESC`,
      [panelBarcode]
    );

    const defects = await db.query<{
      id: string;
      inspection_id: string;
      unit_position: number;
      ref_des: string;
      defect_category: string;
      defect_type: string;
      defect_signature: string;
      offset_x_um: number;
      offset_y_um: number;
      rotation_deg: number;
      board_side: string;
      status: string;
      image_ref: string;
      created_at: string;
    }>(
      `SELECT id, inspection_id, unit_position, ref_des, defect_category, defect_type,
              defect_signature, offset_x_um, offset_y_um, rotation_deg, board_side,
              status, image_ref, created_at
       FROM aoi_defects
       WHERE panel_barcode = ?
       ORDER BY created_at DESC`,
      [panelBarcode]
    );

    const dispositions = await db.query<{
      id: string;
      defect_id: string;
      unit_position: number;
      disposition: string;
      reason: string;
      authorized_by: string;
      disposition_at: string;
    }>(
      `SELECT id, defect_id, unit_position, disposition, reason, authorized_by, disposition_at
       FROM rework_dispositions
       WHERE panel_barcode = ?
       ORDER BY disposition_at DESC`,
      [panelBarcode]
    );

    const reworkEvents = await db.query<{
      id: string;
      defect_id: string;
      unit_position: number;
      ref_des: string;
      technician_id: string;
      station_id: string;
      old_mpn: string;
      old_reel_id: string;
      replacement_mpn: string;
      replacement_reel_id: string;
      rework_method: string;
      rework_cycle: number;
      created_at: string;
    }>(
      `SELECT id, defect_id, unit_position, ref_des, technician_id, station_id,
              old_mpn, old_reel_id, replacement_mpn, replacement_reel_id,
              rework_method, rework_cycle, created_at
       FROM rework_events
       WHERE panel_barcode = ?
       ORDER BY created_at DESC`,
      [panelBarcode]
    );

    let panelStatus = 'PASSED';
    if (units.some((u) => u.status === 'QUALITY_HOLD')) panelStatus = 'QUALITY_HOLD';
    else if (units.some((u) => u.status === 'REWORK_IN_PROGRESS')) panelStatus = 'REWORK_IN_PROGRESS';
    else if (units.some((u) => u.status === 'REWORK_PENDING')) panelStatus = 'REWORK_PENDING';
    else if (units.some((u) => u.status === 'REWORK_FAILED')) panelStatus = 'REWORK_FAILED';
    else if (units.some((u) => u.status === 'SCRAPPED')) panelStatus = 'PARTIAL_SCRAP';

    return {
      panelBarcode,
      panelStatus,
      units,
      inspections,
      defects,
      dispositions,
      reworkEvents
    };
  }

  /**
   * Retrieves CAD component definitions for PCB visualization.
   */
  public async getCadDefinitions(
    programId: string = 'PROG-SM-METER-TOP-REV4',
    programRevision: number = 4,
    boardSide: string = 'TOP'
  ): Promise<CadCoordinateDefinition[]> {
    const db = this.dbProvider();
    const rows = await db.query<{
      product_id: string;
      product_revision: number;
      program_id: string;
      program_revision: number;
      board_side: string;
      cad_revision: string;
      ref_des: string;
      unit_position: number;
      x_mm: number;
      y_mm: number;
      rotation_deg: number;
      package_type: string;
      assigned_part_number: string;
      max_rework_cycles: number;
    }>(
      `SELECT product_id, product_revision, program_id, program_revision, board_side,
              cad_revision, ref_des, unit_position, x_mm, y_mm, rotation_deg,
              package_type, assigned_part_number, max_rework_cycles
       FROM pcb_cad_definitions
       WHERE program_id = ? AND program_revision = ? AND board_side = ?
       ORDER BY unit_position ASC, ref_des ASC`,
      [programId, programRevision, boardSide]
    );

    return rows.map((r) => ({
      productId: r.product_id,
      productRevision: r.product_revision,
      programId: r.program_id,
      programRevision: r.program_revision,
      boardSide: r.board_side as 'TOP' | 'BOTTOM',
      cadRevision: r.cad_revision,
      refDes: r.ref_des,
      unitPosition: r.unit_position,
      xMm: Number(r.x_mm),
      yMm: Number(r.y_mm),
      rotationDeg: Number(r.rotation_deg),
      packageType: r.package_type,
      mpn: r.assigned_part_number,
      assignedPartNumber: r.assigned_part_number,
      maxReworkCycles: r.max_rework_cycles
    }));
  }

  /**
   * Generates CAD overlay defect heatmap data.
   */
  public async getDefectHeatmap(
    programId: string = 'PROG-SM-METER-TOP-REV4',
    revision: number = 4
  ): Promise<any[]> {
    const db = this.dbProvider();
    const cadComponents = await this.getCadDefinitions(programId, revision, 'TOP');

    const defectStats = await db.query<{
      ref_des: string;
      unit_position: number;
      defect_count: number;
      primary_defect_type: string;
    }>(
      `SELECT ref_des, unit_position, COUNT(*) as defect_count, defect_type as primary_defect_type
       FROM aoi_defects
       GROUP BY ref_des, unit_position, defect_type
       ORDER BY defect_count DESC`
    );

    const statsMap = new Map<string, { count: number; primaryDefect: string }>();
    for (const row of defectStats) {
      const key = `${row.ref_des}_${row.unit_position}`;
      if (!statsMap.has(key)) {
        statsMap.set(key, {
          count: Number(row.defect_count),
          primaryDefect: row.primary_defect_type
        });
      }
    }

    return cadComponents.map((cad) => {
      const key = `${cad.refDes}_${cad.unitPosition}`;
      const stat = statsMap.get(key);
      return {
        ...cad,
        defectCount: stat ? stat.count : 0,
        primaryDefect: stat ? stat.primaryDefect : null,
        heatIntensity: stat ? Math.min(1.0, stat.count / 5.0) : 0
      };
    });
  }
}
