import { v4 as uuidv4 } from 'uuid';
import {
  CanonicalAoiInspectionResult,
  QualityDispositionType,
  CadCoordinateDefinition
} from '@mes/shared';
import { getDatabase } from '../db/database';
import { EventIngestionService } from './event-ingestion.service';
import { RepeatDefectSentinelService, SentinelEvaluationResult } from './repeat-defect-sentinel.service';

export interface IngestionResult {
  idempotentDuplicate: boolean;
  inspectionId: string;
  result: 'PASS' | 'FAIL';
  totalDefects: number;
  qualityHoldApplied: boolean;
  interlockTripped: boolean;
  sentinelEvaluation: SentinelEvaluationResult;
}

export class QualityEngineService {
  /**
   * Primary AOI/SPI ingestion engine with strict idempotency and automatic QUALITY_HOLD placement.
   */
  public static async ingestInspection(
    canonical: CanonicalAoiInspectionResult
  ): Promise<IngestionResult> {
    const db = getDatabase();

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

    // 2. Ingest AOI_INSPECTION_COMPLETED event (AoiProjector updates aoi_inspections, aoi_defects, and panel_units)
    await EventIngestionService.ingest({
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

    // 3. Evaluate Repeat Defect Sentinel
    let sentinelEvaluation: SentinelEvaluationResult = { interlockTripped: false, trippedSignatures: [] };
    if (canonical.result === 'FAIL' && canonical.defects && canonical.defects.length > 0) {
      sentinelEvaluation = await RepeatDefectSentinelService.evaluate(canonical);
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
   * Records formal engineering disposition for a defective unit (REWORK, SCRAP, ACCEPT_AS_IS, REINSPECT).
   */
  public static async recordDisposition(params: {
    defectId: string;
    panelBarcode: string;
    unitPosition: number;
    disposition: QualityDispositionType;
    reason: string;
    authorizedBy: string;
  }): Promise<{ success: boolean; dispositionId: string; status: string }> {
    const now = new Date().toISOString();
    const eventId = uuidv4();

    await EventIngestionService.ingest({
      eventId,
      eventType: 'QUALITY_DISPOSITION_DECIDED',
      eventTime: now,
      receivedTime: now,
      sourceType: 'QUALITY_ENGINE',
      sourceId: 'QualityEngineService',
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
   * Retrieves panel quality status including multi-up units (1..N), inspection runs, and defects.
   */
  public static async getPanelQuality(panelBarcode: string) {
    const db = getDatabase();

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
       ORDER BY unit_position ASC, ref_des ASC`,
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

    // Compute overall panel status
    let panelStatus = 'PASSED';
    if (units.some(u => u.status === 'QUALITY_HOLD')) panelStatus = 'QUALITY_HOLD';
    else if (units.some(u => u.status === 'REWORK_IN_PROGRESS')) panelStatus = 'REWORK_IN_PROGRESS';
    else if (units.some(u => u.status === 'REWORK_PENDING')) panelStatus = 'REWORK_PENDING';
    else if (units.some(u => u.status === 'REWORK_FAILED')) panelStatus = 'REWORK_FAILED';
    else if (units.some(u => u.status === 'SCRAPPED')) panelStatus = 'PARTIAL_SCRAP';

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
  public static async getCadDefinitions(
    programId: string = 'PROG-SM-METER-TOP-REV4',
    programRevision: number = 4,
    boardSide: string = 'TOP'
  ): Promise<CadCoordinateDefinition[]> {
    const db = getDatabase();
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

    return rows.map(r => ({
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
      maxReworkCycles: r.max_rework_cycles
    }));
  }
}
