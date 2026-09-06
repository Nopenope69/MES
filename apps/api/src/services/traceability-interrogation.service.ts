import { getDatabase } from '../db/database';

export interface BackwardTraceabilityResult {
  queryTarget: string;
  targetType: 'COMPONENT_LOT' | 'REEL_ID' | 'PASTE_LOT' | 'STENCIL_SERIAL';
  impactedBatches: Array<{
    batchId: string;
    batchNumber: string;
    productCode: string;
    workOrderNumber: string;
    workCenterId: string;
    startedAt: string | null;
    completedAt: string | null;
    plannedQuantity: number;
    actualQuantity: number;
    dhrStatus: string;
  }>;
  impactedPanels: Array<{
    barcode: string;
    batchNumber: string;
    productCode: string;
    completedAt: string;
    cycleTimeSeconds: number;
  }>;
  containmentMetrics: {
    totalBatchesAffected: number;
    totalPanelsProduced: number;
    quarantineRecommended: boolean;
    affectedProducts: string[];
  };
}

export interface ForwardTraceabilityResult {
  queryTarget: string;
  targetType: 'PANEL_BARCODE' | 'BATCH_NUMBER';
  batch: {
    batchId: string;
    batchNumber: string;
    productCode: string;
    workOrderNumber: string;
    workCenterId: string;
    recipeCode: string;
    startedAt: string | null;
    completedAt: string | null;
    operatorId: string | null;
  };
  dhrInfo: {
    dhrNumber: string;
    status: string;
    sha256Checksum: string;
    qaReleasedAt: string | null;
    qaReviewerId: string | null;
  } | null;
  asBuiltMaterials: Array<{
    materialLotNumber: string;
    materialCode: string;
    materialName: string;
    quantityConsumed: number;
    containerId?: string;
    operatorId?: string;
    consumedAt: string;
  }>;
  solderPaste: Array<{
    jarId: string;
    lotNumber: string;
    alloyType: string;
    status: string;
    thawedAt?: string;
    mixedAt?: string;
    temperatureVerifiedC?: number | null;
  }>;
  stencils: Array<{
    stencilId: string;
    partNumber: string;
    serialNumber: string;
    sessionStartedAt: string;
  }>;
  inspectedPanelsCount: number;
}

/**
 * TraceabilityInterrogationService (Track B: ISO 13485 Clause 7.5.3 & FDA 21 CFR 820.65)
 *
 * Implements bidirectional industrial traceability:
 * 1. Backward Recall / Containment: Pinpoints all downstream assemblies (batches, panels, products)
 *    contaminated by a suspect raw component reel, part lot, or solder paste jar.
 * 2. Forward Genealogy / As-Built BoM: Deconstructs finished PCBA units or batches into constituent
 *    reel lots, paste formulations, stencil tooling, and environmental parameters.
 */
export class TraceabilityInterrogationService {
  /**
   * Backward Recall Analysis (Containment Interrogation)
   * Answers FDA/ISO audit question: "Which finished assemblies contain lot X, and where are they?"
   */
  public static async backwardRecall(identifier: string): Promise<BackwardTraceabilityResult> {
    const db = getDatabase();

    // 1. Determine Target Type & Affected Batch IDs
    const affectedBatchIds = new Set<string>();
    let targetType: 'COMPONENT_LOT' | 'REEL_ID' | 'PASTE_LOT' | 'STENCIL_SERIAL' = 'COMPONENT_LOT';

    // Check material_consumptions (Reel lot or component part number)
    const matRows = await db.query<any>(
      `SELECT DISTINCT batch_id, material_lot_number FROM material_consumptions WHERE material_lot_number = ? OR material_code = ?`,
      [identifier, identifier]
    );
    if (matRows.length > 0) {
      targetType = 'COMPONENT_LOT';
      matRows.forEach(r => affectedBatchIds.add(r.batch_id));
    }

    // Check component_reels for reel_id or lot_number
    const reelRows = await db.query<any>(
      `SELECT reel_id, lot_number FROM component_reels WHERE reel_id = ? OR lot_number = ?`,
      [identifier, identifier]
    );
    if (reelRows.length > 0) {
      targetType = 'REEL_ID';
      for (const r of reelRows) {
        const linkedMats = await db.query<any>(
          `SELECT DISTINCT batch_id FROM material_consumptions WHERE material_lot_number = ? OR material_lot_number = ?`,
          [r.reel_id, r.lot_number]
        );
        linkedMats.forEach(m => affectedBatchIds.add(m.batch_id));
      }
    }

    // Check solder_paste_jars for lot_number or jar_id
    const pasteRows = await db.query<any>(
      `SELECT jar_id, lot_number FROM solder_paste_jars WHERE jar_id = ? OR lot_number = ?`,
      [identifier, identifier]
    );
    if (pasteRows.length > 0) {
      targetType = 'PASTE_LOT';
      for (const p of pasteRows) {
        const loads = await db.query<any>(
          `SELECT ss.batch_id 
           FROM stencil_paste_loads spl
           JOIN stencil_sessions ss ON spl.stencil_session_id = ss.id
           WHERE spl.paste_jar_id = ? AND ss.batch_id IS NOT NULL`,
          [p.jar_id]
        );
        loads.forEach(l => affectedBatchIds.add(l.batch_id));
      }
    }

    // Check stencils for stencil_serial_number or stencil_id
    const stencilRows = await db.query<any>(
      `SELECT stencil_id, stencil_serial_number FROM stencils WHERE stencil_id = ? OR stencil_serial_number = ?`,
      [identifier, identifier]
    );
    if (stencilRows.length > 0) {
      targetType = 'STENCIL_SERIAL';
      for (const s of stencilRows) {
        const sessions = await db.query<any>(
          `SELECT batch_id FROM stencil_sessions WHERE stencil_id = ? AND batch_id IS NOT NULL`,
          [s.stencil_id]
        );
        sessions.forEach(sess => affectedBatchIds.add(sess.batch_id));
      }
    }

    const batchIdList = Array.from(affectedBatchIds);

    // 2. Query Batch Details and DHR Status
    const impactedBatches: BackwardTraceabilityResult['impactedBatches'] = [];
    const affectedProducts = new Set<string>();

    if (batchIdList.length > 0) {
      const placeholders = batchIdList.map(() => '?').join(',');
      const batches = await db.query<any>(
        `SELECT b.*, d.status as dhr_status 
         FROM batches b
         LEFT JOIN device_history_records d ON b.id = d.batch_id
         WHERE b.id IN (${placeholders})`,
        batchIdList
      );

      for (const b of batches) {
        affectedProducts.add(b.product_code);
        impactedBatches.push({
          batchId: b.id,
          batchNumber: b.batch_number,
          productCode: b.product_code,
          workOrderNumber: b.work_order_number,
          workCenterId: b.work_center_id,
          startedAt: b.started_at,
          completedAt: b.completed_at,
          plannedQuantity: Number(b.planned_quantity),
          actualQuantity: Number(b.actual_quantity),
          dhrStatus: b.dhr_status || 'UNISSUED'
        });
      }
    }

    // 3. Query Impacted Panels
    const impactedPanels: BackwardTraceabilityResult['impactedPanels'] = [];
    if (batchIdList.length > 0) {
      const placeholders = batchIdList.map(() => '?').join(',');
      const panels = await db.query<any>(
        `SELECT p.panel_barcode, p.cycle_time_seconds, p.completed_at, b.batch_number, b.product_code
         FROM panel_checkouts p
         JOIN batches b ON p.batch_id = b.id
         WHERE p.batch_id IN (${placeholders})
         ORDER BY p.completed_at ASC`,
        batchIdList
      );

      for (const p of panels) {
        impactedPanels.push({
          barcode: p.panel_barcode,
          batchNumber: p.batch_number,
          productCode: p.product_code,
          completedAt: p.completed_at,
          cycleTimeSeconds: Number(p.cycle_time_seconds)
        });
      }
    }

    return {
      queryTarget: identifier,
      targetType,
      impactedBatches,
      impactedPanels,
      containmentMetrics: {
        totalBatchesAffected: impactedBatches.length,
        totalPanelsProduced: impactedPanels.length,
        quarantineRecommended: impactedBatches.length > 0,
        affectedProducts: Array.from(affectedProducts)
      }
    };
  }

  /**
   * Forward Lineage Analysis (As-Built Genealogy Interrogation)
   * Answers FDA/ISO audit question: "For this finished PCBA, what components, paste, and stencils were used?"
   */
  public static async forwardLineage(identifier: string): Promise<ForwardTraceabilityResult> {
    const db = getDatabase();

    let batch: any = null;
    let targetType: 'PANEL_BARCODE' | 'BATCH_NUMBER' = 'BATCH_NUMBER';

    // 1. Check if identifier is a panel barcode
    const panelRows = await db.query<any>(
      `SELECT p.*, b.id as b_id, b.batch_number, b.work_order_number, b.product_code, b.recipe_code,
              b.work_center_id, b.started_at, b.completed_at, b.operator_id
       FROM panel_checkouts p
       JOIN batches b ON p.batch_id = b.id
       WHERE p.panel_barcode = ? LIMIT 1`,
      [identifier]
    );

    if (panelRows.length > 0) {
      targetType = 'PANEL_BARCODE';
      const p = panelRows[0];
      batch = {
        id: p.b_id,
        batch_number: p.batch_number,
        work_order_number: p.work_order_number,
        product_code: p.product_code,
        recipe_code: p.recipe_code,
        work_center_id: p.work_center_id,
        started_at: p.started_at,
        completed_at: p.completed_at,
        operator_id: p.operator_id
      };
    } else {
      // Check if identifier is a batch id or batch number
      const batchRows = await db.query<any>(
        `SELECT * FROM batches WHERE id = ? OR batch_number = ? LIMIT 1`,
        [identifier, identifier]
      );
      if (batchRows.length > 0) {
        batch = batchRows[0];
      }
    }

    if (!batch) {
      throw new Error(`No PCBA panel or production batch found matching identifier: ${identifier}`);
    }

    const batchId = batch.id;

    // 2. Query As-Built Material Consumptions
    const materialRows = await db.query<any>(
      `SELECT * FROM material_consumptions WHERE batch_id = ? ORDER BY consumed_at ASC`,
      [batchId]
    );

    const asBuiltMaterials = materialRows.map(m => ({
      materialLotNumber: m.material_lot_number,
      materialCode: m.material_code,
      materialName: m.material_name,
      quantityConsumed: Number(m.quantity_consumed),
      containerId: m.container_id,
      operatorId: m.operator_id,
      consumedAt: m.consumed_at
    }));

    // 3. Query Stencils and Solder Paste Jars
    const stencilSessions = await db.query<any>(
      `SELECT ss.*, s.part_number as stencil_part_number, s.stencil_serial_number
       FROM stencil_sessions ss
       JOIN stencils s ON ss.stencil_id = s.stencil_id
       WHERE ss.batch_id = ? OR (ss.work_center_id = ? AND ss.started_at <= ? AND (ss.ended_at IS NULL OR ss.ended_at >= ?))`,
      [batchId, batch.work_center_id, batch.started_at || new Date().toISOString(), batch.started_at || new Date().toISOString()]
    );

    const stencils = stencilSessions.map(s => ({
      stencilId: s.stencil_id,
      partNumber: s.stencil_part_number,
      serialNumber: s.stencil_serial_number,
      sessionStartedAt: s.started_at
    }));

    let solderPaste: any[] = [];
    if (stencilSessions.length > 0) {
      const sessionIds = stencilSessions.map(s => `'${s.id}'`).join(',');
      const pasteRows = await db.query<any>(
        `SELECT DISTINCT pj.*
         FROM stencil_paste_loads spl
         JOIN solder_paste_jars pj ON spl.paste_jar_id = pj.jar_id
         WHERE spl.stencil_session_id IN (${sessionIds})`
      );

      solderPaste = pasteRows.map(p => ({
        jarId: p.jar_id,
        lotNumber: p.lot_number,
        alloyType: p.alloy_type,
        status: p.status,
        thawedAt: p.thaw_verified_at,
        mixedAt: p.mixed_at,
        temperatureVerifiedC: p.temperature_verified_c ? Number(p.temperature_verified_c) : null
      }));
    }

    // 4. Query Panel Checkouts Count
    const panelCountRows = await db.query<any>(
      `SELECT COUNT(*) as cnt FROM panel_checkouts WHERE batch_id = ?`,
      [batchId]
    );
    const inspectedCount = panelCountRows.length > 0 ? Number(panelCountRows[0].cnt) : 0;

    // 5. Query DHR status if exists
    const dhrRows = await db.query<any>(
      `SELECT dhr_number, status, sha256_checksum, qa_released_at, qa_reviewer_id
       FROM device_history_records WHERE batch_id = ? LIMIT 1`,
      [batchId]
    );

    const dhrInfo = dhrRows.length > 0 ? {
      dhrNumber: dhrRows[0].dhr_number,
      status: dhrRows[0].status,
      sha256Checksum: dhrRows[0].sha256_checksum,
      qaReleasedAt: dhrRows[0].qa_released_at,
      qaReviewerId: dhrRows[0].qa_reviewer_id
    } : null;

    return {
      queryTarget: identifier,
      targetType,
      batch: {
        batchId: batch.id,
        batchNumber: batch.batch_number,
        productCode: batch.product_code,
        workOrderNumber: batch.work_order_number,
        workCenterId: batch.work_center_id,
        recipeCode: batch.recipe_code,
        startedAt: batch.started_at,
        completedAt: batch.completed_at,
        operatorId: batch.operator_id
      },
      dhrInfo,
      asBuiltMaterials,
      solderPaste,
      stencils,
      inspectedPanelsCount: inspectedCount
    };
  }
}
