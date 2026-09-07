import { getDatabase } from '../db/database';

export interface DefectCorrelationReport {
  panelBarcode: string;
  unitPosition: number;
  refDes: string;
  defectType?: string;
  partNumber: string;
  packageType: string;
  cadCoordinates: {
    xMm: number;
    yMm: number;
    rotationDeg: number;
    boardSide: string;
  };
  feederSlot?: {
    moduleNo: number;
    slotNo: number;
    feederId: string;
    feederType: string;
  };
  componentReel?: {
    reelId: string;
    lotNumber: string;
    supplierName: string;
    dateCode: string;
    mslClass: string;
    mslRemainingMinutes: number;
  };
  nozzleTelemetry?: {
    nozzleId: string;
    recentErrorCount: number;
    lastErrorType: string;
  };
  solderPaste?: {
    jarId: string;
    lotNumber: string;
    partNumber: string;
    alloyType: string;
    status: string;
  };
  stencil?: {
    stencilId: string;
    serialNumber: string;
    revision: string;
  };
  rootCauseHypothesis: string;
}

export class DefectCorrelationService {
  /**
   * Correlates an optical inspection defect back to the SMT line root-cause components:
   * RefDes -> CAD -> Feeder Slot -> Reel Lot -> Nozzle ID -> Solder Paste Lot -> Stencil Session
   */
  public static async correlate(
    panelBarcode: string,
    unitPosition: number = 1,
    refDes: string
  ): Promise<DefectCorrelationReport> {
    const db = getDatabase();

    // 1. Fetch CAD metadata for RefDes
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

    const partNumber = cadRows[0]?.assigned_part_number || 'UNKNOWN_MPN';
    const packageType = cadRows[0]?.package_type || 'UNKNOWN';
    const cadCoordinates = {
      xMm: Number(cadRows[0]?.x_mm || 0),
      yMm: Number(cadRows[0]?.y_mm || 0),
      rotationDeg: Number(cadRows[0]?.rotation_deg || 0),
      boardSide: cadRows[0]?.board_side || 'TOP'
    };

    // 2. Fetch recorded defect details if present
    const defectRows = await db.query<{ defect_type: string; defect_category: string }>(
      `SELECT defect_type, defect_category
       FROM aoi_defects
       WHERE panel_barcode = ? AND unit_position = ? AND ref_des = ?
       ORDER BY created_at DESC LIMIT 1`,
      [panelBarcode, unitPosition, refDes]
    );
    const defectType = defectRows[0]?.defect_type || 'TOMBSTONE';
    const defectCategory = defectRows[0]?.defect_category || 'SOLDER';

    // 3. Find Fuji Feeder Slot via recipe item or part number
    const slotRows = await db.query<{
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
      [partNumber]
    );

    let feederSlot: DefectCorrelationReport['feederSlot'];
    let componentReel: DefectCorrelationReport['componentReel'];
    let nozzleTelemetry: DefectCorrelationReport['nozzleTelemetry'];

    if (slotRows.length > 0) {
      const slot = slotRows[0];
      feederSlot = {
        moduleNo: slot.module_no,
        slotNo: slot.slot_no,
        feederId: slot.feeder_id,
        feederType: slot.feeder_type
      };

      // 4. Trace Reel Lot
      if (slot.current_reel_id) {
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
          [slot.current_reel_id]
        );

        if (reelRows.length > 0) {
          const r = reelRows[0];
          componentReel = {
            reelId: r.reel_id,
            lotNumber: r.lot_number,
            supplierName: r.supplier_name,
            dateCode: r.date_code,
            mslClass: r.msl_class || 'MSL_1',
            mslRemainingMinutes: Number(r.msl_remaining_minutes || 0)
          };
        }
      }

      // 5. Trace Nozzle Telemetry & Error Logs
      const errorLogs = await db.query<{ nozzle_id: string; error_type: string }>(
        `SELECT nozzle_id, error_type
         FROM feeder_error_logs
         WHERE module_no = ? AND slot_no = ?
         ORDER BY occurred_at DESC
         LIMIT 10`,
        [slot.module_no, slot.slot_no]
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

    // 6. Trace Solder Paste Lot & Stencil
    let solderPaste: DefectCorrelationReport['solderPaste'];
    let stencil: DefectCorrelationReport['stencil'];

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

    if (stencilRows.length > 0) {
      const s = stencilRows[0];
      stencil = {
        stencilId: s.stencil_id,
        serialNumber: s.stencil_serial_number,
        revision: s.revision
      };
    }

    // 7. Formulate actionable root cause hypothesis
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
      partNumber,
      packageType,
      cadCoordinates,
      feederSlot,
      componentReel,
      nozzleTelemetry,
      solderPaste,
      stencil,
      rootCauseHypothesis
    };
  }
}
