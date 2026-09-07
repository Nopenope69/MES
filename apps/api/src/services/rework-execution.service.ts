import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database';
import { EventIngestionService } from './event-ingestion.service';

export interface ReplacementVerificationResult {
  valid: boolean;
  errors: string[];
  expectedMpn: string;
  replacementMpn?: string;
  reelLot?: string;
  supplierName?: string;
  currentCycle: number;
  maxReworkCycles: number;
}

export interface ExecuteReplacementParams {
  defectId: string;
  panelBarcode: string;
  unitPosition: number;
  refDes: string;
  technicianId: string;
  stationId?: string;
  replacementReelId: string;
  reworkMethod?: string;
  temperatureProfileId?: string;
}

export interface PostReworkInspectionParams {
  panelBarcode: string;
  unitPosition: number;
  defectId: string;
  result: 'PASS' | 'FAIL';
  inspectorId: string;
  notes?: string;
}

export class ReworkExecutionService {
  /**
   * Verifies replacement component reel against BOM MPN, MSL floor-life, and CAD thermal rework limits.
   */
  public static async verifyReplacement(
    panelBarcode: string,
    unitPosition: number = 1,
    refDes: string,
    replacementReelId: string
  ): Promise<ReplacementVerificationResult> {
    const db = getDatabase();
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
      msl_remaining_minutes: number;
      floor_clock_state: string;
      current_quantity: number;
    }>(
      `SELECT part_number, lot_number, supplier_name, status, msl_class,
              msl_remaining_minutes, floor_clock_state, current_quantity
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

    // BOM Match
    if (reel.part_number.trim().toUpperCase() !== expectedMpn.trim().toUpperCase()) {
      errors.push(`BOM Mismatch: Expected MPN '${expectedMpn}', but scanned reel is '${reel.part_number}'.`);
    }

    // Status check
    if (['QUARANTINED', 'EXPIRED_MSL'].includes(reel.status)) {
      errors.push(`Reel [${replacementReelId}] cannot be used. Status is '${reel.status}'.`);
    }

    // JEDEC MSL check
    if (reel.msl_class && reel.msl_class !== 'MSL_1') {
      if (reel.msl_remaining_minutes <= 0 || reel.floor_clock_state === 'BAKE_REQUIRED') {
        errors.push(
          `JEDEC MSL Violation: Reel [${replacementReelId}] (${reel.msl_class}) floor-life has expired (0 mins remaining). Mandatory bake cycle required.`
        );
      }
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
   * decrementing stock, updating eDHR/genealogy, and putting unit into REWORK_PASSED (awaiting re-inspection).
   */
  public static async executeReplacement(params: ExecuteReplacementParams): Promise<{
    success: boolean;
    reworkCycle: number;
    message: string;
  }> {
    const db = getDatabase();
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

    // 1. Emit COMPONENT_REPLACED event
    await EventIngestionService.ingest({
      eventId: uuidv4(),
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
    await EventIngestionService.ingest({
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

    // Decrement replacement reel quantity by 1
    await db.execute(
      `UPDATE component_reels SET current_quantity = MAX(0, current_quantity - 1) WHERE reel_id = ?`,
      [params.replacementReelId]
    );

    return {
      success: true,
      reworkCycle: verification.currentCycle,
      message: `Component [${params.refDes}] replaced successfully. Unit ${params.unitPosition} moved to REWORK_PASSED. Mandatory optical re-inspection required before release.`
    };
  }

  /**
   * Records post-rework optical inspection. Closed-loop quality rule: no board can be released
   * directly from rework without verified post-rework inspection passing.
   */
  public static async recordPostReworkInspection(params: PostReworkInspectionParams): Promise<{
    success: boolean;
    result: 'PASS' | 'FAIL';
    finalStatus: string;
    message: string;
  }> {
    const now = new Date().toISOString();
    const finalStatus = params.result === 'PASS' ? 'RELEASED' : 'REWORK_FAILED';

    await EventIngestionService.ingest({
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
      result: params.result,
      finalStatus,
      message: params.result === 'PASS'
        ? `Post-rework inspection PASSED. Unit ${params.unitPosition} on panel ${params.panelBarcode} is RELEASED.`
        : `Post-rework inspection FAILED. Unit ${params.unitPosition} on panel ${params.panelBarcode} moved to REWORK_FAILED.`
    };
  }
}
