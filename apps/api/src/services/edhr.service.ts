import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { getDatabase } from '../db/database';
import { ComplianceLedgerService } from './compliance-ledger.service';

export interface DeviceHistoryRecordPayload {
  dhrNumber: string;
  batchId: string;
  batchNumber: string;
  workOrderNumber: string;
  productCode: string;
  recipeCode: string;
  workCenterId: string;
  datesOfManufacture: {
    startedAt: string | null;
    completedAt: string | null;
  };
  quantities: {
    planned: number;
    manufactured: number;
    rejected: number;
    released: number;
    unit: string;
  };
  primaryOperatorId: string | null;
  billOfMaterialsAsBuilt: Array<{
    materialLotNumber: string;
    materialCode: string;
    materialName: string;
    quantityConsumed: number;
    unit: string;
    containerId?: string;
    operatorId?: string;
    consumedAt: string;
  }>;
  controlledMaterials: {
    solderPasteJars: Array<{
      jarId: string;
      partNumber: string;
      lotNumber: string;
      alloyType: string;
      status: string;
      thawDurationMinutes: number;
      mixedDurationSeconds: number;
      verifiedTemperatureC: number | null;
    }>;
    stencils: Array<{
      stencilId: string;
      partNumber: string;
      serialNumber: string;
      sessionStartedAt: string;
      sessionEndedAt: string | null;
    }>;
    mslReels: Array<{
      reelId: string;
      partNumber: string;
      lotNumber: string;
      mslLevel: string;
      initialFloorLifeSeconds: number;
    }>;
  };
  acceptanceAndInspections: {
    totalPanelsInspected: number;
    totalPanelsSkipped: number;
    averageCycleTimeSeconds: number;
    panels: Array<{
      barcode: string;
      cycleTimeSeconds: number;
      completedAt: string;
      skipBitmask: string | null;
    }>;
  };
  equipmentTelemetry: {
    totalDowntimeEvents: number;
    totalDowntimeDurationSeconds: number;
    stateTransitions: number;
  };
  regulatoryMetadata: {
    standardCompliance: string[];
    dhrGeneratedAt: string;
    status: 'DRAFT' | 'RELEASED' | 'QUARANTINED';
  };
}

export interface DhrRecord {
  id: string;
  dhrNumber: string;
  batchId: string;
  productCode: string;
  workOrderNumber: string;
  manufacturedQuantity: number;
  releasedQuantity: number;
  status: string;
  qaReviewerId: string | null;
  qaReleasedAt: string | null;
  dhrPayload: DeviceHistoryRecordPayload;
  sha256Checksum: string;
  createdAt: string;
}

/**
 * EdhrService (Track B: 21 CFR 820.180 & ISO 13485 Clause 7.5.3)
 *
 * Compiles, cryptographically hashes, and signs Electronic Device History Records (eDHR).
 * Reconstructs the complete as-built genealogy, controlled material compliance,
 * inspection acceptance, and equipment telemetry.
 */
export class EdhrService {
  /**
   * Computes a canonical SHA-256 checksum over the DHR payload.
   */
  public static computePayloadChecksum(payload: Omit<DeviceHistoryRecordPayload, 'sha256Checksum'>): string {
    const canonicalString = JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(canonicalString, 'utf-8').digest('hex');
  }

  /**
   * Generates a complete eDHR for a given batch.
   */
  public static async generateDhr(
    batchIdOrNumber: string,
    generatedByActorId: string = 'SYSTEM_DHR_ENGINE',
    actorRole: string = 'QA_SPECIALIST'
  ): Promise<DhrRecord> {
    const db = getDatabase();

    // 1. Query Batch
    const batchRows = await db.query<any>(
      `SELECT * FROM batches WHERE id = ? OR batch_number = ? LIMIT 1`,
      [batchIdOrNumber, batchIdOrNumber]
    );

    if (batchRows.length === 0) {
      throw new Error(`Batch not found for identifier: ${batchIdOrNumber}`);
    }

    const batch = batchRows[0];
    const batchId = batch.id;

    // 2. Query Work Order
    const woRows = await db.query<any>(
      `SELECT * FROM work_orders WHERE order_number = ? LIMIT 1`,
      [batch.work_order_number]
    );
    const workOrder = woRows.length > 0 ? woRows[0] : null;

    // 3. Query As-Built Material Consumptions
    const materialRows = await db.query<any>(
      `SELECT * FROM material_consumptions WHERE batch_id = ? ORDER BY consumed_at ASC`,
      [batchId]
    );

    const asBuiltBOM = materialRows.map(m => ({
      materialLotNumber: m.material_lot_number,
      materialCode: m.material_code,
      materialName: m.material_name,
      quantityConsumed: Number(m.quantity_consumed),
      unit: m.unit,
      containerId: m.container_id,
      operatorId: m.operator_id,
      consumedAt: m.consumed_at
    }));

    // 4. Query Controlled Materials (Solder Paste & Stencils)
    const stencilSessionRows = await db.query<any>(
      `SELECT ss.*, s.part_number as stencil_part_number, s.stencil_serial_number
       FROM stencil_sessions ss
       JOIN stencils s ON ss.stencil_id = s.stencil_id
       WHERE ss.batch_id = ? OR (ss.work_center_id = ? AND ss.started_at <= ? AND (ss.ended_at IS NULL OR ss.ended_at >= ?))`,
      [batchId, batch.work_center_id, batch.started_at || new Date().toISOString(), batch.started_at || new Date().toISOString()]
    );

    const stencils = stencilSessionRows.map(s => ({
      stencilId: s.stencil_id,
      partNumber: s.stencil_part_number,
      serialNumber: s.stencil_serial_number,
      sessionStartedAt: s.started_at,
      sessionEndedAt: s.ended_at
    }));

    // Solder paste jars loaded in those stencil sessions
    let pasteJars: any[] = [];
    if (stencilSessionRows.length > 0) {
      const sessionIds = stencilSessionRows.map(s => `'${s.id}'`).join(',');
      const pasteRows = await db.query<any>(
        `SELECT DISTINCT pj.*
         FROM stencil_paste_loads spl
         JOIN solder_paste_jars pj ON spl.paste_jar_id = pj.jar_id
         WHERE spl.stencil_session_id IN (${sessionIds})`
      );

      pasteJars = pasteRows.map(p => ({
        jarId: p.jar_id,
        partNumber: p.part_number,
        lotNumber: p.lot_number,
        alloyType: p.alloy_type,
        status: p.status,
        thawDurationMinutes: p.thaw_duration_minutes,
        mixedDurationSeconds: p.mixed_duration_seconds,
        verifiedTemperatureC: p.temperature_verified_c ? Number(p.temperature_verified_c) : null
      }));
    }

    // MSL Reels associated with this batch
    const mslReelLots = asBuiltBOM.map(m => m.materialLotNumber);
    let mslReels: any[] = [];
    if (mslReelLots.length > 0) {
      const placeholders = mslReelLots.map(() => '?').join(',');
      const reelRows = await db.query<any>(
        `SELECT * FROM component_reels WHERE reel_id IN (${placeholders}) OR lot_number IN (${placeholders})`,
        [...mslReelLots, ...mslReelLots]
      );
      mslReels = reelRows.map(r => ({
        reelId: r.reel_id,
        partNumber: r.part_number,
        lotNumber: r.lot_number,
        mslLevel: r.msl_level,
        initialFloorLifeSeconds: Number(r.initial_floor_life_seconds)
      }));
    }

    // 5. Query Panel Checkouts (Inspections & Acceptance)
    const panelRows = await db.query<any>(
      `SELECT * FROM panel_checkouts WHERE batch_id = ? ORDER BY completed_at ASC`,
      [batchId]
    );

    const totalInspected = panelRows.length;
    const totalSkipped = panelRows.reduce((acc, p) => acc + (p.block_skip_count || 0), 0);
    const avgCycleTime = totalInspected > 0
      ? panelRows.reduce((acc, p) => acc + Number(p.cycle_time_seconds || 0), 0) / totalInspected
      : 0;

    const panels = panelRows.map(p => ({
      barcode: p.panel_barcode,
      cycleTimeSeconds: Number(p.cycle_time_seconds),
      completedAt: p.completed_at,
      skipBitmask: p.skip_bitmask
    }));

    // 6. Query Equipment Telemetry & Downtime
    const stateLogRows = await db.query<any>(
      `SELECT * FROM equipment_state_logs WHERE batch_id = ?`,
      [batchId]
    );
    const downtimeRows = await db.query<any>(
      `SELECT * FROM downtime_attributions WHERE batch_id = ?`,
      [batchId]
    );

    const totalDowntimeSec = stateLogRows
      .filter(l => l.current_state === 'STOPPED' || l.current_state === 'ERROR')
      .reduce((acc, l) => acc + (Number(l.duration_seconds) || 0), 0);

    // 7. Formulate eDHR Payload
    const now = new Date().toISOString();
    const dhrNumber = `DHR-${batch.batch_number}`;

    const payload: DeviceHistoryRecordPayload = {
      dhrNumber,
      batchId,
      batchNumber: batch.batch_number,
      workOrderNumber: batch.work_order_number,
      productCode: batch.product_code,
      recipeCode: batch.recipe_code,
      workCenterId: batch.work_center_id,
      datesOfManufacture: {
        startedAt: batch.started_at,
        completedAt: batch.completed_at
      },
      quantities: {
        planned: Number(batch.planned_quantity),
        manufactured: Number(batch.actual_quantity || totalInspected),
        rejected: Number(batch.rejected_quantity || 0),
        released: 0,
        unit: batch.unit || 'PANEL'
      },
      primaryOperatorId: batch.operator_id || null,
      billOfMaterialsAsBuilt: asBuiltBOM,
      controlledMaterials: {
        solderPasteJars: pasteJars,
        stencils,
        mslReels
      },
      acceptanceAndInspections: {
        totalPanelsInspected: totalInspected,
        totalPanelsSkipped: totalSkipped,
        averageCycleTimeSeconds: Math.round(avgCycleTime * 100) / 100,
        panels
      },
      equipmentTelemetry: {
        totalDowntimeEvents: downtimeRows.length,
        totalDowntimeDurationSeconds: totalDowntimeSec,
        stateTransitions: stateLogRows.length
      },
      regulatoryMetadata: {
        standardCompliance: [
          'FDA 21 CFR 820.180 (Device History Record)',
          'ISO 13485:2016 Clause 7.5.3 (Identification and Traceability)',
          '21 CFR Part 11 (Electronic Records & Signatures)',
          'IPC-A-610 Class 3'
        ],
        dhrGeneratedAt: now,
        status: 'DRAFT'
      }
    };

    const checksum = this.computePayloadChecksum(payload);

    // 8. Upsert in device_history_records
    const dhrId = uuidv4();
    const existing = await db.query<any>(`SELECT id, status FROM device_history_records WHERE dhr_number = ?`, [dhrNumber]);

    if (existing.length > 0) {
      await db.execute(`
        UPDATE device_history_records
        SET manufactured_quantity = ?, dhr_payload_json = ?, sha256_checksum = ?
        WHERE dhr_number = ?
      `, [
        payload.quantities.manufactured,
        JSON.stringify(payload),
        checksum,
        dhrNumber
      ]);
    } else {
      await db.execute(`
        INSERT INTO device_history_records (
          id, dhr_number, batch_id, product_code, work_order_number,
          manufactured_quantity, released_quantity, status, dhr_payload_json, sha256_checksum, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        dhrId,
        dhrNumber,
        batchId,
        batch.product_code,
        batch.work_order_number,
        payload.quantities.manufactured,
        0,
        'DRAFT',
        JSON.stringify(payload),
        checksum,
        now
      ]);
    }

    // 9. Sign in Cryptographic Audit Ledger
    await ComplianceLedgerService.recordSignature({
      actorId: generatedByActorId,
      actorRole,
      actionType: 'DHR_GENERATED',
      meaning: `Generated Electronic Device History Record for Batch ${batch.batch_number} per 21 CFR 820.180`,
      entityType: 'DHR',
      entityId: dhrNumber,
      metadata: {
        batchId,
        checksum,
        manufacturedQuantity: payload.quantities.manufactured
      }
    });

    return {
      id: existing.length > 0 ? existing[0].id : dhrId,
      dhrNumber,
      batchId,
      productCode: batch.product_code,
      workOrderNumber: batch.work_order_number,
      manufacturedQuantity: payload.quantities.manufactured,
      releasedQuantity: 0,
      status: 'DRAFT',
      qaReviewerId: null,
      qaReleasedAt: null,
      dhrPayload: payload,
      sha256Checksum: checksum,
      createdAt: now
    };
  }

  /**
   * Formally releases a DHR with QA electronic signature per 21 CFR Part 11.
   */
  public static async releaseDhr(
    dhrNumber: string,
    qaReviewerId: string,
    qaMeaning: string,
    releasedQuantity?: number
  ): Promise<DhrRecord> {
    const db = getDatabase();
    const rows = await db.query<any>(`SELECT * FROM device_history_records WHERE dhr_number = ?`, [dhrNumber]);

    if (rows.length === 0) {
      throw new Error(`DHR not found: ${dhrNumber}`);
    }

    const dhr = rows[0];
    const payload: DeviceHistoryRecordPayload = JSON.parse(dhr.dhr_payload_json);
    const now = new Date().toISOString();
    const finalReleasedQty = releasedQuantity !== undefined ? releasedQuantity : Number(dhr.manufactured_quantity);

    payload.quantities.released = finalReleasedQty;
    payload.regulatoryMetadata.status = 'RELEASED';

    const newChecksum = this.computePayloadChecksum(payload);

    await db.execute(`
      UPDATE device_history_records
      SET status = 'RELEASED', qa_reviewer_id = ?, qa_released_at = ?, released_quantity = ?, dhr_payload_json = ?, sha256_checksum = ?
      WHERE dhr_number = ?
    `, [
      qaReviewerId,
      now,
      finalReleasedQty,
      JSON.stringify(payload),
      newChecksum,
      dhrNumber
    ]);

    // Record formal QA Sign-off in Cryptographic Ledger
    await ComplianceLedgerService.recordSignature({
      actorId: qaReviewerId,
      actorRole: 'QA_DIRECTOR',
      actionType: 'DHR_QA_RELEASE',
      meaning: qaMeaning || 'I verify this PCBA batch satisfies IPC-A-610 Class 3 acceptance criteria and approve commercial release per 21 CFR 820.180',
      entityType: 'DHR',
      entityId: dhrNumber,
      metadata: {
        releasedQuantity: finalReleasedQty,
        previousChecksum: dhr.sha256_checksum,
        newChecksum
      }
    });

    return {
      id: dhr.id,
      dhrNumber,
      batchId: dhr.batch_id,
      productCode: dhr.product_code,
      workOrderNumber: dhr.work_order_number,
      manufacturedQuantity: Number(dhr.manufactured_quantity),
      releasedQuantity: finalReleasedQty,
      status: 'RELEASED',
      qaReviewerId,
      qaReleasedAt: now,
      dhrPayload: payload,
      sha256Checksum: newChecksum,
      createdAt: dhr.created_at
    };
  }

  /**
   * Fetches an eDHR by its DHR number and validates payload integrity against stored checksum.
   */
  public static async getDhr(dhrNumber: string): Promise<DhrRecord & { integrityVerified: boolean }> {
    const db = getDatabase();
    const rows = await db.query<any>(`SELECT * FROM device_history_records WHERE dhr_number = ?`, [dhrNumber]);

    if (rows.length === 0) {
      throw new Error(`DHR not found: ${dhrNumber}`);
    }

    const dhr = rows[0];
    const payload: DeviceHistoryRecordPayload = JSON.parse(dhr.dhr_payload_json);
    const recomputed = this.computePayloadChecksum(payload);

    return {
      id: dhr.id,
      dhrNumber: dhr.dhr_number,
      batchId: dhr.batch_id,
      productCode: dhr.product_code,
      workOrderNumber: dhr.work_order_number,
      manufacturedQuantity: Number(dhr.manufactured_quantity),
      releasedQuantity: Number(dhr.released_quantity),
      status: dhr.status,
      qaReviewerId: dhr.qa_reviewer_id,
      qaReleasedAt: dhr.qa_released_at,
      dhrPayload: payload,
      sha256Checksum: dhr.sha256_checksum,
      integrityVerified: recomputed === dhr.sha256_checksum,
      createdAt: dhr.created_at
    };
  }
}
