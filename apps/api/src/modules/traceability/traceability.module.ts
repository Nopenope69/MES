// apps/api/src/modules/traceability/traceability.module.ts
import { getDatabase, IDatabase } from '../../db/database';
import {
  ITraceabilityModule,
  UnitGenealogyRecord,
  PanelGenealogyRecord,
  BatchGenealogyRecord,
  RecallContainmentReport,
  RecallTargetType,
  LinkageMetadata,
  UnitPlacementItem,
  ReworkMethod,
  DhrStatus,
  DefectStatus
} from './traceability.interface';
import {
  QualityState,
  QualityDispositionType,
  DefectCategory,
  ComponentDefectType,
  SolderDefectType,
  MslClass,
  SmtJobStatus,
  CadCoordinateDefinition
} from '@mes/shared';

interface ReelInterval {
  reelId: string;
  reel: any;
  mountTime: Date;
  dismountTime: Date | null;
  isSplice: boolean;
}

interface PanelAssemblyContext {
  panelCheckout: any;
  batch: any;
  lineId: string;
  units: any[];
  cadByUnit: Map<number, Map<string, any>>;
  reelTimelineBySlot: Map<string, ReelInterval[]>;
  currentFeederSlots: any[];
  componentReelsMap: Map<string, any>;
  solderPasteJars: any[];
  stencilSession: any | null;
  stencil: any | null;
  spiInspection: any | null;
  spiByUnit: Map<number, any[]>;
  reflowProfile: any | null;
  reflowLinkage: LinkageMetadata;
  aoiInspections: any[];
  aoiByUnit: Map<number, any[]>;
  reworkDispositionsByDefect: Map<string, any>;
  reworkEventsByUnit: Map<number, any[]>;
  dhr: any | null;
  ledgerSignatures: any[];
}

export class TraceabilityModule implements ITraceabilityModule {
  private db: IDatabase;

  constructor(db?: IDatabase) {
    this.db = db || getDatabase();
  }

  /**
   * UNIT TIER: Assembles unit as-built record from panel assembly context.
   */
  public async getUnitGenealogy(panelBarcode: string, unitPosition: number): Promise<UnitGenealogyRecord> {
    if (typeof unitPosition !== 'number' || isNaN(unitPosition)) {
      throw new Error(`Invalid unitPosition: ${unitPosition}. Explicit numeric unitPosition is required.`);
    }

    const context = await this.buildPanelAssemblyContext(panelBarcode);
    const unitRecord = this.assembleUnit(context, unitPosition);
    return unitRecord;
  }

  /**
   * PANEL TIER: Bulk retrieval primitive executing O(domain tables) queries
   * and projecting all 1..N units in-memory without roundtrips.
   */
  public async getPanelGenealogy(panelBarcode: string): Promise<PanelGenealogyRecord> {
    const context = await this.buildPanelAssemblyContext(panelBarcode);

    const units: UnitGenealogyRecord[] = context.units.map(u => 
      this.assembleUnit(context, Number(u.unit_position))
    );

    return {
      panelBarcode: context.panelCheckout.panel_barcode,
      checkout: {
        workCenterId: context.panelCheckout.work_center_id,
        programName: context.panelCheckout.program_name,
        cycleTimeSeconds: Number(context.panelCheckout.cycle_time_seconds),
        blockCount: Number(context.panelCheckout.block_count),
        blockSkipCount: Number(context.panelCheckout.block_skip_count),
        completedAt: context.panelCheckout.completed_at,
        profileRunId: context.panelCheckout.profile_run_id || null
      },
      batch: {
        batchId: context.batch.id,
        batchNumber: context.batch.batch_number,
        productCode: context.batch.product_code,
        recipeCode: context.batch.recipe_code,
        workOrderNumber: context.batch.work_order_number,
        workCenterId: context.batch.work_center_id,
        operatorId: context.batch.operator_id,
        status: context.batch.status as SmtJobStatus,
        startedAt: context.batch.started_at,
        completedAt: context.batch.completed_at
      },
      units
    };
  }

  /**
   * Serial number direct lookup -> resolves panel barcode and unit position.
   */
  public async lookupBySerialNumber(serialNumber: string): Promise<UnitGenealogyRecord> {
    const rows = await this.db.query<any>(
      'SELECT panel_barcode, unit_position FROM panel_units WHERE unit_serial_number = ? LIMIT 1',
      [serialNumber]
    );

    if (rows.length === 0) {
      throw new Error(`No board unit found with serial number: ${serialNumber}`);
    }

    return this.getUnitGenealogy(rows[0].panel_barcode, Number(rows[0].unit_position));
  }

  /**
   * BATCH TIER: Set-based aggregate query across entire batch.
   * INVARIANT: Never invokes getPanelGenealogy() or getUnitGenealogy() in a loop!
   */
  public async getBatchGenealogy(batchNumberOrId: string): Promise<BatchGenealogyRecord> {
    const batchRows = await this.db.query<any>(
      'SELECT b.*, wc.line_id FROM batches b LEFT JOIN work_centers wc ON b.work_center_id = wc.id WHERE b.id = ? OR b.batch_number = ? LIMIT 1',
      [batchNumberOrId, batchNumberOrId]
    );

    if (batchRows.length === 0) {
      throw new Error(`Production batch not found: ${batchNumberOrId}`);
    }

    const batch = batchRows[0];
    const batchId = batch.id;

    // 1. DHR record
    const dhrRows = await this.db.query<any>(
      'SELECT * FROM device_history_records WHERE batch_id = ? LIMIT 1',
      [batchId]
    );
    const dhr = dhrRows.length > 0 ? {
      dhrNumber: dhrRows[0].dhr_number,
      status: dhrRows[0].status as DhrStatus,
      sha256Checksum: dhrRows[0].sha256_checksum,
      qaReviewerId: dhrRows[0].qa_reviewer_id,
      qaReleasedAt: dhrRows[0].qa_released_at
    } : null;

    // 2. Set-based panel summaries
    const panelRows = await this.db.query<any>(`
      SELECT 
        pc.panel_barcode,
        pc.completed_at,
        COUNT(pu.id) as unit_count,
        SUM(CASE WHEN ad.id IS NOT NULL THEN 1 ELSE 0 END) as defect_count
      FROM panel_checkouts pc
      LEFT JOIN panel_units pu ON pc.panel_barcode = pu.panel_barcode
      LEFT JOIN aoi_defects ad ON pc.panel_barcode = ad.panel_barcode
      WHERE pc.batch_id = ?
      GROUP BY pc.panel_barcode, pc.completed_at
      ORDER BY pc.completed_at ASC
    `, [batchId]);

    // 3. Set-based unit quality status aggregates
    const unitStats = await this.db.query<any>(`
      SELECT 
        COUNT(pu.id) as total_units,
        SUM(CASE WHEN pu.status = 'PASSED' THEN 1 ELSE 0 END) as passed_units,
        SUM(CASE WHEN pu.status = 'QUALITY_HOLD' THEN 1 ELSE 0 END) as held_units,
        SUM(CASE WHEN pu.status = 'SCRAPPED' THEN 1 ELSE 0 END) as scrapped_units
      FROM panel_units pu
      JOIN panel_checkouts pc ON pu.panel_barcode = pc.panel_barcode
      WHERE pc.batch_id = ?
    `, [batchId]);

    // 4. Set-based defect count & rework count
    const aoiStats = await this.db.query<any>(`
      SELECT COUNT(ad.id) as total_defects
      FROM aoi_defects ad
      JOIN aoi_inspections ai ON ad.inspection_id = ai.id
      WHERE ai.batch_id = ?
    `, [batchId]);

    const reworkStats = await this.db.query<any>(`
      SELECT COUNT(re.id) as rework_count
      FROM rework_events re
      JOIN panel_checkouts pc ON re.panel_barcode = pc.panel_barcode
      WHERE pc.batch_id = ?
    `, [batchId]);

    // 5. Materials Consumed
    const matRows = await this.db.query<any>(`
      SELECT 
        mc.material_code as part_number,
        mc.material_lot_number as reel_id,
        COALESCE(cr.lot_number, mc.material_lot_number) as lot_number,
        COALESCE(cr.supplier_name, 'Generic Supplier') as supplier_name,
        SUM(mc.quantity_consumed) as quantity_consumed
      FROM material_consumptions mc
      LEFT JOIN component_reels cr ON (mc.material_lot_number = cr.reel_id OR mc.material_lot_number = cr.lot_number)
      WHERE mc.batch_id = ?
      GROUP BY mc.material_code, mc.material_lot_number, cr.lot_number, cr.supplier_name
    `, [batchId]);

    const stat = unitStats[0] || {};
    const totalDefects = Number(aoiStats[0]?.total_defects || 0);
    const reworkCount = Number(reworkStats[0]?.rework_count || 0);

    return {
      batch: {
        batchId: batch.id,
        batchNumber: batch.batch_number,
        productCode: batch.product_code,
        recipeCode: batch.recipe_code,
        workOrderNumber: batch.work_order_number,
        workCenterId: batch.work_center_id,
        operatorId: batch.operator_id,
        status: batch.status as SmtJobStatus,
        startedAt: batch.started_at,
        completedAt: batch.completed_at
      },
      dhr,
      summary: {
        totalPanels: panelRows.length,
        totalUnits: Number(stat.total_units || 0),
        passedUnits: Number(stat.passed_units || 0),
        heldUnits: Number(stat.held_units || 0),
        scrappedUnits: Number(stat.scrapped_units || 0),
        totalDefects,
        reworkCount
      },
      panels: panelRows.map((r: any) => ({
        panelBarcode: r.panel_barcode,
        completedAt: r.completed_at,
        unitCount: Number(r.unit_count || 1),
        hasDefects: Number(r.defect_count) > 0
      })),
      materialsConsumed: matRows.map((m: any) => ({
        partNumber: m.part_number,
        reelId: m.reel_id,
        lotNumber: m.lot_number,
        supplierName: m.supplier_name,
        quantityConsumed: Number(m.quantity_consumed)
      }))
    };
  }

  /**
   * RECALL TIER: Pure set-based backward recall containment analysis.
   * INVARIANT: Dedicated set-based traversal, never loops over panel/unit genealogy.
   */
  public async recallByIdentifier(identifier: string): Promise<RecallContainmentReport> {
    const namespaceResolution = await this.resolveRecallNamespace(identifier);

    if (namespaceResolution.status === 'NOT_FOUND') {
      return {
        queryTarget: identifier,
        targetType: 'COMPONENT_REEL',
        status: 'NOT_FOUND',
        containmentRecommendation: 'NO_ACTION',
        affectedBatches: [],
        affectedPanels: [],
        affectedUnits: [],
        summary: {
          totalBatchesAffected: 0,
          totalPanelsAffected: 0,
          totalUnitsAffected: 0,
          quarantineScope: 'NONE'
        }
      };
    }

    if (namespaceResolution.status === 'AMBIGUOUS_IDENTIFIER') {
      return {
        queryTarget: identifier,
        targetType: namespaceResolution.matches[0],
        status: 'AMBIGUOUS_IDENTIFIER',
        ambiguityDetail: `Identifier "${identifier}" matches multiple distinct inventory namespaces: [${namespaceResolution.matches.join(', ')}]. Manual qualification required.`,
        containmentRecommendation: 'INVESTIGATION_REQUIRED',
        affectedBatches: [],
        affectedPanels: [],
        affectedUnits: [],
        summary: {
          totalBatchesAffected: 0,
          totalPanelsAffected: 0,
          totalUnitsAffected: 0,
          quarantineScope: 'MANUAL_QUALIFICATION_REQUIRED'
        }
      };
    }

    const targetType = namespaceResolution.targetType!;
    const affectedBatchIds = new Set<string>();
    let targetPartNumber: string | null = null;
    let mountedReelId: string | undefined = undefined;

    // 1. Resolve Affected Batch IDs based on Target Namespace
    if (targetType === 'COMPONENT_REEL' || targetType === 'COMPONENT_LOT') {
      mountedReelId = identifier;
      // Look in material_consumptions
      const matRows = await this.db.query<any>(
        'SELECT DISTINCT batch_id, material_code FROM material_consumptions WHERE material_lot_number = ?',
        [identifier]
      );
      matRows.forEach(r => {
        affectedBatchIds.add(r.batch_id);
        if (!targetPartNumber) targetPartNumber = r.material_code;
      });

      // Look in component_reels
      const reelRows = await this.db.query<any>(
        'SELECT reel_id, part_number FROM component_reels WHERE reel_id = ? OR lot_number = ?',
        [identifier, identifier]
      );
      for (const r of reelRows) {
        if (!targetPartNumber) targetPartNumber = r.part_number;
        const linked = await this.db.query<any>(
          'SELECT DISTINCT batch_id FROM material_consumptions WHERE material_lot_number = ?',
          [r.reel_id]
        );
        linked.forEach(l => affectedBatchIds.add(l.batch_id));
      }
    } else if (targetType === 'PASTE_LOT') {
      const pasteRows = await this.db.query<any>(
        'SELECT jar_id FROM solder_paste_jars WHERE jar_id = ? OR lot_number = ?',
        [identifier, identifier]
      );
      for (const p of pasteRows) {
        const loads = await this.db.query<any>(`
          SELECT ss.batch_id
          FROM stencil_paste_loads spl
          JOIN stencil_sessions ss ON spl.stencil_session_id = ss.id
          WHERE spl.paste_jar_id = ? AND ss.batch_id IS NOT NULL
        `, [p.jar_id]);
        loads.forEach(l => affectedBatchIds.add(l.batch_id));
      }
    } else if (targetType === 'STENCIL_SERIAL') {
      const stencilRows = await this.db.query<any>(
        'SELECT stencil_id FROM stencils WHERE stencil_id = ? OR stencil_serial_number = ?',
        [identifier, identifier]
      );
      for (const s of stencilRows) {
        const sessions = await this.db.query<any>(
          'SELECT batch_id FROM stencil_sessions WHERE stencil_id = ? AND batch_id IS NOT NULL',
          [s.stencil_id]
        );
        sessions.forEach(sess => affectedBatchIds.add(sess.batch_id));
      }
    }

    const batchIdList = Array.from(affectedBatchIds);

    if (batchIdList.length === 0) {
      return {
        queryTarget: identifier,
        targetType,
        status: 'CONTAINED',
        containmentRecommendation: 'NO_ACTION',
        affectedBatches: [],
        affectedPanels: [],
        affectedUnits: [],
        summary: {
          totalBatchesAffected: 0,
          totalPanelsAffected: 0,
          totalUnitsAffected: 0,
          quarantineScope: 'NONE'
        }
      };
    }

    // 2. Set-based Batch details query
    const placeholders = batchIdList.map(() => '?').join(',');
    const batchRows = await this.db.query<any>(`
      SELECT b.*, COALESCE(d.status, 'UNISSUED') as dhr_status
      FROM batches b
      LEFT JOIN device_history_records d ON b.id = d.batch_id
      WHERE b.id IN (${placeholders})
    `, batchIdList);

    const affectedBatches = batchRows.map((b: any) => ({
      batchId: b.id,
      batchNumber: b.batch_number,
      productCode: b.product_code,
      workOrderNumber: b.work_order_number,
      dhrStatus: b.dhr_status
    }));

    // 3. Set-based Panel details query
    const panelRows = await this.db.query<any>(`
      SELECT pc.panel_barcode, pc.completed_at, b.batch_number
      FROM panel_checkouts pc
      JOIN batches b ON pc.batch_id = b.id
      WHERE pc.batch_id IN (${placeholders})
      ORDER BY pc.completed_at ASC
    `, batchIdList);

    const affectedPanels = panelRows.map((p: any) => ({
      panelBarcode: p.panel_barcode,
      batchNumber: p.batch_number,
      completedAt: p.completed_at
    }));

    // 4. Set-based affected units and RefDes query
    let affectedUnits: RecallContainmentReport['affectedUnits'] = [];

    if (panelRows.length > 0) {
      const panelBarcodes = panelRows.map((p: any) => p.panel_barcode);
      const pPlaceholders = panelBarcodes.map(() => '?').join(',');

      // If target is component-related, pinpoint specific RefDes via CAD definitions
      let refDesList: string[] = [];
      if (targetPartNumber) {
        const cadRows = await this.db.query<any>(
          'SELECT DISTINCT ref_des FROM pcb_cad_definitions WHERE assigned_part_number = ?',
          [targetPartNumber]
        );
        refDesList = cadRows.map((c: any) => c.ref_des);
      }

      const unitRows = await this.db.query<any>(`
        SELECT pu.panel_barcode, pu.unit_position, pu.unit_serial_number, pu.status
        FROM panel_units pu
        WHERE pu.panel_barcode IN (${pPlaceholders})
        ORDER BY pu.panel_barcode, pu.unit_position
      `, panelBarcodes);

      affectedUnits = unitRows.map((u: any) => ({
        panelBarcode: u.panel_barcode,
        unitPosition: Number(u.unit_position),
        unitSerialNumber: u.unit_serial_number || null,
        unitStatus: u.status as QualityState,
        affectedRefDes: refDesList,
        mountedReelId
      }));
    }

    return {
      queryTarget: identifier,
      targetType,
      status: 'CONTAINED',
      containmentRecommendation: affectedBatches.length > 0 ? 'QUARANTINE_REQUIRED' : 'NO_ACTION',
      affectedBatches,
      affectedPanels,
      affectedUnits,
      summary: {
        totalBatchesAffected: affectedBatches.length,
        totalPanelsAffected: affectedPanels.length,
        totalUnitsAffected: affectedUnits.length,
        quarantineScope: `BATCHES: ${affectedBatches.map(b => b.batchNumber).join(', ')}`
      }
    };
  }

  /**
   * Builds the panel-scoped assembly context via O(domain tables) bulk queries.
   */
  private async buildPanelAssemblyContext(panelBarcode: string): Promise<PanelAssemblyContext> {
    // 1. Panel Checkout
    const checkoutRows = await this.db.query<any>(
      'SELECT * FROM panel_checkouts WHERE panel_barcode = ? LIMIT 1',
      [panelBarcode]
    );

    if (checkoutRows.length === 0) {
      throw new Error(`No panel checkout record found matching barcode: ${panelBarcode}`);
    }
    const panelCheckout = checkoutRows[0];

    // 2. Batch & Work Center Context
    const batchRows = await this.db.query<any>(`
      SELECT b.*, wc.line_id, wc.area
      FROM batches b
      LEFT JOIN work_centers wc ON b.work_center_id = wc.id
      WHERE b.id = ? OR b.batch_number = ? LIMIT 1
    `, [panelCheckout.batch_id, panelCheckout.batch_id]);

    const batch = batchRows.length > 0 ? batchRows[0] : {
      id: panelCheckout.batch_id,
      batch_number: panelCheckout.batch_id,
      product_code: 'UNKNOWN_PRODUCT',
      recipe_code: panelCheckout.program_name,
      work_order_number: 'WO-UNKNOWN',
      work_center_id: panelCheckout.work_center_id,
      operatorId: null,
      status: 'RUNNING',
      line_id: 'line-smt-01',
      started_at: null,
      completed_at: null
    };

    const lineId = batch.line_id || 'line-smt-01';

    // 3. Panel Units
    let units = await this.db.query<any>(
      'SELECT * FROM panel_units WHERE panel_barcode = ? ORDER BY unit_position ASC',
      [panelBarcode]
    );
    if (units.length === 0) {
      // Synthesize default unit 1 if panel_units table has no entry
      units = [{
        id: `unit-synth-${panelBarcode}-1`,
        panel_barcode: panelBarcode,
        unit_position: 1,
        unit_serial_number: `SN-${panelBarcode}-U1`,
        status: 'PASSED'
      }];
    }

    // 4. CAD Definitions -> Composite Index: unit_position -> refDes -> CadCoordinateDefinition
    const cadRows = await this.db.query<any>(
      'SELECT * FROM pcb_cad_definitions WHERE program_id = ?',
      [panelCheckout.program_name]
    );
    const cadByUnit = new Map<number, Map<string, any>>();
    for (const cad of cadRows) {
      const uPos = Number(cad.unit_position) || 1;
      if (!cadByUnit.has(uPos)) {
        cadByUnit.set(uPos, new Map());
      }
      cadByUnit.get(uPos)!.set(cad.ref_des, cad);
    }

    // 5. Feeder Lifecycle & Historical Intervals
    const feederEvents = await this.db.query<any>(`
      SELECT * FROM production_events
      WHERE work_center_id = ? 
        AND event_type IN ('REEL_LOADED', 'REEL_SPLICED', 'REEL_UNLOADED')
      ORDER BY event_time ASC
    `, [panelCheckout.work_center_id]);

    const consumptions = await this.db.query<any>(
      'SELECT * FROM material_consumptions WHERE batch_id = ?',
      [batch.id]
    );

    const currentFeederSlots = await this.db.query<any>(
      'SELECT * FROM smt_feeder_slots WHERE work_center_id = ?',
      [panelCheckout.work_center_id]
    );

    const allReels = await this.db.query<any>('SELECT * FROM component_reels');
    const componentReelsMap = new Map<string, any>();
    allReels.forEach(r => {
      componentReelsMap.set(r.reel_id, r);
      componentReelsMap.set(r.lot_number, r);
    });

    const reelTimelineBySlot = this.reconstructReelTimeline(
      feederEvents,
      consumptions,
      currentFeederSlots,
      componentReelsMap
    );

    // 6. Stencil & Solder Paste
    const stencilData = await this.db.query<any>(`
      SELECT ss.*, spl.paste_jar_id, pj.*, st.part_number as stencil_part_number, st.stencil_serial_number, st.revision as stencil_revision
      FROM stencil_sessions ss
      LEFT JOIN stencil_paste_loads spl ON spl.stencil_session_id = ss.id
      LEFT JOIN solder_paste_jars pj ON spl.paste_jar_id = pj.jar_id
      LEFT JOIN stencils st ON ss.stencil_id = st.stencil_id
      WHERE ss.batch_id = ? OR (ss.work_center_id = ? AND ss.started_at <= ? AND (ss.ended_at IS NULL OR ss.ended_at >= ?))
    `, [batch.id, panelCheckout.work_center_id, panelCheckout.completed_at, panelCheckout.completed_at]);

    let stencilSession: any = null;
    let stencil: any = null;
    const solderPasteJars: any[] = [];
    const seenPasteJars = new Set<string>();

    for (const row of stencilData) {
      if (!stencilSession && row.stencil_id) {
        stencilSession = {
          id: row.id,
          stencil_id: row.stencil_id,
          started_at: row.started_at,
          ended_at: row.ended_at
        };
        stencil = {
          stencilId: row.stencil_id,
          serialNumber: row.stencil_serial_number || 'STN-UNKNOWN',
          revision: row.stencil_revision || 'A',
          sessionStartedAt: row.started_at
        };
      }
      if (row.paste_jar_id && !seenPasteJars.has(row.paste_jar_id)) {
        seenPasteJars.add(row.paste_jar_id);
        solderPasteJars.push(row);
      }
    }

    // 7. SPI Inspections & Measurements
    const spiRows = await this.db.query<any>(
      'SELECT * FROM spi_inspections WHERE panel_barcode = ? ORDER BY inspected_at DESC LIMIT 1',
      [panelBarcode]
    );
    const spiInspection = spiRows.length > 0 ? spiRows[0] : null;

    const spiMeasurements = await this.db.query<any>(
      'SELECT * FROM spi_pad_measurements WHERE panel_barcode = ?',
      [panelBarcode]
    );
    const spiByUnit = new Map<number, any[]>();
    for (const sm of spiMeasurements) {
      const uPos = Number(sm.unit_position) || 1;
      if (!spiByUnit.has(uPos)) spiByUnit.set(uPos, []);
      spiByUnit.get(uPos)!.push(sm);
    }

    // 8. Reflow Profile Linkage
    const { profile: reflowProfile, linkage: reflowLinkage } = await this.resolveReflowProfile(
      panelCheckout,
      batch,
      lineId
    );

    // 9. AOI Inspections & Defects
    const aoiInspections = await this.db.query<any>(
      'SELECT * FROM aoi_inspections WHERE panel_barcode = ? ORDER BY inspected_at ASC',
      [panelBarcode]
    );

    const aoiDefects = await this.db.query<any>(
      'SELECT * FROM aoi_defects WHERE panel_barcode = ? ORDER BY created_at ASC',
      [panelBarcode]
    );
    const aoiByUnit = new Map<number, any[]>();
    for (const ad of aoiDefects) {
      const uPos = Number(ad.unit_position) || 1;
      if (!aoiByUnit.has(uPos)) aoiByUnit.set(uPos, []);
      aoiByUnit.get(uPos)!.push(ad);
    }

    // 10. Rework Lifecycle
    const reworkDispositions = await this.db.query<any>(
      'SELECT * FROM rework_dispositions WHERE panel_barcode = ?',
      [panelBarcode]
    );
    const reworkDispositionsByDefect = new Map<string, any>();
    reworkDispositions.forEach(rd => reworkDispositionsByDefect.set(rd.defect_id, rd));

    const reworkEvents = await this.db.query<any>(
      'SELECT * FROM rework_events WHERE panel_barcode = ? ORDER BY created_at ASC',
      [panelBarcode]
    );
    const reworkEventsByUnit = new Map<number, any[]>();
    for (const re of reworkEvents) {
      const uPos = Number(re.unit_position) || 1;
      if (!reworkEventsByUnit.has(uPos)) reworkEventsByUnit.set(uPos, []);
      reworkEventsByUnit.get(uPos)!.push(re);
    }

    // 11. Device History Record & Ledger
    const dhrRows = await this.db.query<any>(
      'SELECT * FROM device_history_records WHERE batch_id = ? LIMIT 1',
      [batch.id]
    );
    const dhr = dhrRows.length > 0 ? dhrRows[0] : null;

    let ledgerSignatures: any[] = [];
    if (dhr?.dhr_number) {
      ledgerSignatures = await this.db.query<any>(
        "SELECT sequence_number, current_hash, actor_id, actor_role, action_type, signed_at FROM compliance_audit_ledger WHERE entity_type = 'DHR' AND entity_id = ? ORDER BY sequence_number ASC",
        [dhr.dhr_number]
      );
    }

    return {
      panelCheckout,
      batch,
      lineId,
      units,
      cadByUnit,
      reelTimelineBySlot,
      currentFeederSlots,
      componentReelsMap,
      solderPasteJars,
      stencilSession,
      stencil,
      spiInspection,
      spiByUnit,
      reflowProfile,
      reflowLinkage,
      aoiInspections,
      aoiByUnit,
      reworkDispositionsByDefect,
      reworkEventsByUnit,
      dhr,
      ledgerSignatures
    };
  }

  /**
   * Projects a single unit in-memory from the assembled panel context.
   */
  private assembleUnit(context: PanelAssemblyContext, unitPosition: number): UnitGenealogyRecord {
    const unitRow = context.units.find(u => Number(u.unit_position) === unitPosition) || {
      unit_position: unitPosition,
      unit_serial_number: `SN-${context.panelCheckout.panel_barcode}-U${unitPosition}`,
      status: 'PASSED'
    };

    // 1. Placement Chain
    const placementChain: UnitPlacementItem[] = [];
    const cadMap = context.cadByUnit.get(unitPosition) || new Map();

    const cycleTimeSec = Number(context.panelCheckout.cycle_time_seconds) || 18.2;
    const completedMs = new Date(context.panelCheckout.completed_at).getTime();
    const placementWindow = {
      start: new Date(completedMs - cycleTimeSec * 1000),
      end: new Date(completedMs)
    };

    for (const [refDes, cad] of cadMap.entries()) {
      // Find assigned feeder slot for this MPN
      const feederSlot = context.currentFeederSlots.find(s => s.assigned_part_number === cad.assigned_part_number) || {
        module_no: 1,
        slot_no: 1,
        feeder_id: 'FID-UNKNOWN',
        feeder_type: 'W08f (8mm)'
      };

      const { reel, linkage } = this.resolveReelForPlacement(
        feederSlot.module_no,
        feederSlot.slot_no,
        placementWindow,
        context.reelTimelineBySlot,
        context.currentFeederSlots,
        context.componentReelsMap
      );

      placementChain.push({
        refDes,
        partNumber: cad.assigned_part_number,
        packageType: cad.package_type || '0402',
        cadCoordinates: {
          xMm: Number(cad.x_mm),
          yMm: Number(cad.y_mm),
          rotationDeg: Number(cad.rotation_deg || 0),
          boardSide: cad.board_side || 'TOP'
        },
        feederSlot: {
          moduleNo: feederSlot.module_no,
          slotNo: feederSlot.slot_no,
          feederId: feederSlot.feeder_id,
          feederType: feederSlot.feeder_type
        },
        componentReel: {
          reelId: reel.reel_id || 'REEL-UNKNOWN',
          lotNumber: reel.lot_number || 'LOT-UNKNOWN',
          supplierName: reel.supplier_name || 'Generic Supplier',
          dateCode: reel.date_code || '202601',
          mslClass: (reel.msl_class || 'MSL_1') as MslClass,
          mslRemainingMinutes: Number(reel.msl_remaining_minutes ?? 999999)
        },
        linkage
      });
    }

    // 2. Solder Paste
    const solderPaste = context.solderPasteJars.map(p => ({
      jarId: p.jar_id,
      lotNumber: p.lot_number,
      alloyType: p.alloy_type,
      thawVerifiedAt: p.thaw_verified_at,
      mixedAt: p.mixed_at,
      temperatureVerifiedC: p.temperature_verified_c ? Number(p.temperature_verified_c) : null,
      linkage: {
        source: 'HISTORICAL_ASSIGNMENT' as const,
        confidence: 'EXACT' as const,
        detail: 'Active paste load during batch stencil session'
      }
    }));

    // 3. Stencil
    const stencil = context.stencil ? {
      ...context.stencil,
      linkage: {
        source: 'HISTORICAL_ASSIGNMENT' as const,
        confidence: 'EXACT' as const,
        detail: 'Active stencil tooling during batch session'
      }
    } : null;

    // 4. SPI
    const unitPads = (context.spiByUnit.get(unitPosition) || []).map(p => ({
      padId: p.pad_id,
      refDes: p.ref_des,
      volumeRatioPct: Number(p.volume_ratio_pct),
      heightUm: Number(p.height_um),
      areaRatioPct: Number(p.area_ratio_pct),
      offsetXUm: Number(p.offset_x_um),
      offsetYUm: Number(p.offset_y_um),
      defectType: p.defect_type || undefined
    }));

    const spiInspection = context.spiInspection ? {
      inspectionId: context.spiInspection.id,
      result: context.spiInspection.result as 'PASS' | 'WARNING' | 'FAIL',
      totalPads: Number(context.spiInspection.total_pads_inspected || 0),
      defectivePads: Number(context.spiInspection.defective_pads_count || 0),
      meanVolumePct: context.spiInspection.mean_volume_pct ? Number(context.spiInspection.mean_volume_pct) : undefined,
      sigmaVolumePct: context.spiInspection.sigma_volume_pct ? Number(context.spiInspection.sigma_volume_pct) : undefined,
      inspectedAt: context.spiInspection.inspected_at,
      opticalMachineId: context.spiInspection.optical_machine_id,
      unitCriticalPads: unitPads
    } : null;

    // 5. Reflow Profile
    const reflowProfile = context.reflowProfile ? {
      profileRunId: context.reflowProfile.id,
      overallPwi: Number(context.reflowProfile.overall_pwi),
      complianceResult: context.reflowProfile.compliance_result as 'PASS' | 'WARNING' | 'FAIL',
      worstCharacteristic: context.reflowProfile.worst_characteristic || undefined,
      recipeId: context.reflowProfile.recipe_id,
      equipmentId: context.reflowProfile.equipment_id,
      lineId: context.reflowProfile.line_id,
      approvedBy: context.reflowProfile.approved_by || undefined,
      approvedAt: context.reflowProfile.approved_at || undefined,
      linkage: context.reflowLinkage
    } : null;

    // 6. AOI Inspections & Defects
    const unitDefects = (context.aoiByUnit.get(unitPosition) || []).map(d => ({
      defectId: d.id,
      refDes: d.ref_des,
      defectCategory: d.defect_category as DefectCategory,
      defectType: d.defect_type as ComponentDefectType | SolderDefectType,
      defectSignature: d.defect_signature,
      boardSide: d.board_side as 'TOP' | 'BOTTOM',
      status: d.status as DefectStatus,
      imageRef: d.image_ref || undefined
    }));

    const aoiInspections = context.aoiInspections.map(ai => ({
      inspectionId: ai.id,
      phase: ai.inspection_phase as 'PRE_REFLOW' | 'POST_REFLOW' | 'POST_REWORK',
      result: ai.result as 'PASS' | 'FAIL',
      totalDefects: Number(ai.total_defects || 0),
      inspectedAt: ai.inspected_at,
      opticalMachineId: ai.optical_machine_id,
      unitDefects
    }));

    // 7. Rework History
    const unitReworkEvents = context.reworkEventsByUnit.get(unitPosition) || [];
    const reworkHistory = unitReworkEvents.map(re => {
      const disp = context.reworkDispositionsByDefect.get(re.defect_id) || {
        disposition: 'REWORK',
        reason: 'Automated repair disposition',
        authorized_by: 'QA-SUPERVISOR',
        disposition_at: re.created_at
      };
      return {
        defectId: re.defect_id,
        refDes: re.ref_des,
        disposition: disp.disposition as QualityDispositionType,
        dispositionReason: disp.reason,
        authorizedBy: disp.authorized_by,
        dispositionAt: disp.disposition_at,
        execution: {
          technicianId: re.technician_id,
          stationId: re.station_id,
          oldMpn: re.old_mpn,
          oldReelId: re.old_reel_id || undefined,
          replacementMpn: re.replacement_mpn,
          replacementReelId: re.replacement_reel_id,
          reworkMethod: re.rework_method as ReworkMethod,
          reworkCycle: Number(re.rework_cycle || 1),
          reworkedAt: re.created_at
        }
      };
    });

    // 8. Compliance & eDHR
    const dhr = context.dhr ? {
      dhrNumber: context.dhr.dhr_number,
      status: context.dhr.status as DhrStatus,
      sha256Checksum: context.dhr.sha256_checksum,
      qaReviewerId: context.dhr.qa_reviewer_id,
      qaReleasedAt: context.dhr.qa_released_at
    } : null;

    const complianceLedger = context.ledgerSignatures.length > 0 ? {
      dhrSignatures: context.ledgerSignatures.map(s => ({
        sequenceNumber: Number(s.sequence_number),
        currentHash: s.current_hash,
        actorId: s.actor_id,
        actorRole: s.actor_role,
        actionType: s.action_type,
        signedAt: s.signed_at
      }))
    } : null;

    return {
      panelBarcode: context.panelCheckout.panel_barcode,
      unitPosition,
      unitSerialNumber: unitRow.unit_serial_number || null,
      unitStatus: unitRow.status as QualityState,
      batch: {
        batchId: context.batch.id,
        batchNumber: context.batch.batch_number,
        productCode: context.batch.product_code,
        recipeCode: context.batch.recipe_code,
        workOrderNumber: context.batch.work_order_number,
        workCenterId: context.batch.work_center_id,
        operatorId: context.batch.operator_id,
        status: context.batch.status as SmtJobStatus,
        startedAt: context.batch.started_at,
        completedAt: context.batch.completed_at
      },
      placementChain,
      solderPaste,
      stencil,
      spiInspection,
      reflowProfile,
      aoiInspections,
      reworkHistory,
      dhr,
      complianceLedger
    };
  }

  /**
   * Reconstructs feeder reel timeline from REEL_LOADED, REEL_SPLICED, and REEL_UNLOADED events.
   */
  private reconstructReelTimeline(
    events: any[],
    consumptions: any[],
    currentSlots: any[],
    reelsMap: Map<string, any>
  ): Map<string, ReelInterval[]> {
    const timeline = new Map<string, ReelInterval[]>();

    for (const evt of events) {
      let payload: any = {};
      try {
        payload = typeof evt.payload_json === 'string' ? JSON.parse(evt.payload_json) : evt.payload_json;
      } catch {
        continue;
      }

      const modNo = payload.moduleNo || 1;
      const slotNo = payload.slotNo;
      if (!slotNo) continue;
      const slotKey = `${modNo}:${slotNo}`;

      if (!timeline.has(slotKey)) timeline.set(slotKey, []);
      const intervals = timeline.get(slotKey)!;
      const evtTime = new Date(evt.event_time);

      if (evt.event_type === 'REEL_LOADED') {
        const reelId = payload.reelId;
        const reel = reelsMap.get(reelId) || { reel_id: reelId, part_number: payload.partNumber };
        intervals.push({
          reelId,
          reel,
          mountTime: evtTime,
          dismountTime: null,
          isSplice: false
        });
      } else if (evt.event_type === 'REEL_SPLICED') {
        // Close previous interval
        if (intervals.length > 0) {
          const prev = intervals[intervals.length - 1];
          if (!prev.dismountTime) prev.dismountTime = evtTime;
        }
        const newReelId = payload.newReelId;
        const reel = reelsMap.get(newReelId) || { reel_id: newReelId, part_number: payload.partNumber };
        intervals.push({
          reelId: newReelId,
          reel,
          mountTime: evtTime,
          dismountTime: null,
          isSplice: true
        });
      } else if (evt.event_type === 'REEL_UNLOADED') {
        if (intervals.length > 0) {
          const prev = intervals[intervals.length - 1];
          if (!prev.dismountTime) prev.dismountTime = evtTime;
        }
      }
    }

    // If no events for a slot, seed base interval from initial material_consumptions or smt_feeder_slots
    for (const slot of currentSlots) {
      const slotKey = `${slot.module_no}:${slot.slot_no}`;
      if (!timeline.has(slotKey) || timeline.get(slotKey)!.length === 0) {
        const reelId = slot.current_reel_id;
        if (reelId) {
          const reel = reelsMap.get(reelId) || { reel_id: reelId, part_number: slot.assigned_part_number };
          timeline.set(slotKey, [{
            reelId,
            reel,
            mountTime: new Date(0), // Genesis
            dismountTime: null,
            isSplice: false
          }]);
        }
      }
    }

    return timeline;
  }

  /**
   * Resolves component reel for a feeder placement window with historical accuracy.
   */
  private resolveReelForPlacement(
    moduleNo: number,
    slotNo: number,
    placementWindow: { start: Date; end: Date },
    timelineBySlot: Map<string, ReelInterval[]>,
    currentSlots: any[],
    reelsMap: Map<string, any>
  ): { reel: any; linkage: LinkageMetadata } {
    const slotKey = `${moduleNo}:${slotNo}`;
    const intervals = timelineBySlot.get(slotKey) || [];

    for (const interval of intervals) {
      const dismount = interval.dismountTime ? new Date(interval.dismountTime).getTime() : Infinity;
      const mount = new Date(interval.mountTime).getTime();

      // Case A: Placement window completely within interval -> EXACT
      if (placementWindow.start.getTime() >= mount && placementWindow.end.getTime() <= dismount) {
        return {
          reel: interval.reel,
          linkage: {
            source: 'HISTORICAL_ASSIGNMENT',
            confidence: 'EXACT',
            detail: `Placement fully contained within interval [${interval.mountTime.toISOString()} - ${interval.dismountTime ? interval.dismountTime.toISOString() : 'ACTIVE'}]`
          }
        };
      }

      // Case B: Splice boundary overlap -> INFERRED
      if (placementWindow.start.getTime() < mount && placementWindow.end.getTime() >= mount) {
        return {
          reel: interval.reel,
          linkage: {
            source: 'HISTORICAL_ASSIGNMENT',
            confidence: 'INFERRED',
            detail: 'Splice event occurred during panel placement window'
          }
        };
      }
    }

    // Fallback to latest interval if after last event
    if (intervals.length > 0) {
      const latest = intervals[intervals.length - 1];
      return {
        reel: latest.reel,
        linkage: {
          source: 'HISTORICAL_ASSIGNMENT',
          confidence: 'INFERRED',
          detail: 'Assigned to latest historical feeder reel interval'
        }
      };
    }

    // Fallback to current feeder slot state -> UNVERIFIED
    const current = currentSlots.find(s => s.module_no === moduleNo && s.slot_no === slotNo);
    if (current?.current_reel_id) {
      const reel = reelsMap.get(current.current_reel_id) || { reel_id: current.current_reel_id, part_number: current.assigned_part_number };
      return {
        reel,
        linkage: {
          source: 'CURRENT_STATE_FALLBACK',
          confidence: 'UNVERIFIED',
          detail: 'Inferred from current mounted feeder slot'
        }
      };
    }

    return {
      reel: {
        reel_id: 'REEL-UNKNOWN',
        lot_number: 'LOT-UNKNOWN',
        supplier_name: 'Unknown Supplier',
        date_code: '202601',
        msl_class: 'MSL_1',
        msl_remaining_minutes: 999999
      },
      linkage: {
        source: 'CURRENT_STATE_FALLBACK',
        confidence: 'UNVERIFIED',
        detail: 'No feeder assignment record found'
      }
    };
  }

  /**
   * Resolves reflow profile run: direct profile_run_id linkage OR safe temporal fallback with ambiguity evaluation.
   */
  private async resolveReflowProfile(
    checkout: any,
    batch: any,
    lineId: string
  ): Promise<{ profile: any | null; linkage: LinkageMetadata }> {
    // 1. Direct profile-run ID linkage (New data)
    if (checkout.profile_run_id) {
      const profileRows = await this.db.query<any>(
        'SELECT * FROM reflow_profile_runs WHERE id = ?',
        [checkout.profile_run_id]
      );
      if (profileRows.length > 0) {
        return {
          profile: profileRows[0],
          linkage: {
            source: 'DIRECT_FK',
            confidence: 'EXACT',
            detail: 'Direct profile_run_id linkage on panel checkout record'
          }
        };
      }
    }

    // 2. Safe Temporal Fallback (Legacy data)
    const ovens = await this.db.query<any>(
      "SELECT id FROM work_centers WHERE line_id = ? AND type = 'REFLOW_OVEN' LIMIT 1",
      [lineId]
    );
    const equipmentId = ovens.length > 0 ? ovens[0].id : null;

    const queryParams: any[] = [lineId];
    let eqClause = '';
    if (equipmentId) {
      eqClause = ' AND equipment_id = ?';
      queryParams.push(equipmentId);
    }
    queryParams.push(batch.recipe_code, checkout.completed_at, checkout.completed_at);

    const candidates = await this.db.query<any>(`
      SELECT * FROM reflow_profile_runs
      WHERE line_id = ?
        ${eqClause}
        AND recipe_id = ?
        AND status = 'ACTIVE'
        AND compliance_result = 'PASS'
        AND activated_at <= ?
        AND (retired_at IS NULL OR retired_at >= ?)
      ORDER BY activated_at DESC
    `, queryParams);

    if (candidates.length === 1) {
      return {
        profile: candidates[0],
        linkage: {
          source: 'TEMPORAL_CORRELATION',
          confidence: 'INFERRED',
          detail: 'Single certified active profile in checkout window'
        }
      };
    }

    if (candidates.length > 1) {
      return {
        profile: candidates[0],
        linkage: {
          source: 'TEMPORAL_CORRELATION',
          confidence: 'AMBIGUOUS',
          detail: `Found ${candidates.length} overlapping active candidate profiles active during checkout`
        }
      };
    }

    return {
      profile: null,
      linkage: {
        source: 'TEMPORAL_CORRELATION',
        confidence: 'AMBIGUOUS',
        detail: 'No certified active reflow profile found matching temporal window'
      }
    };
  }

  /**
   * Deterministic namespace resolution and ambiguity detection for recall queries.
   */
  private async resolveRecallNamespace(identifier: string): Promise<{
    targetType: RecallTargetType | null;
    status: 'CONTAINED' | 'AMBIGUOUS_IDENTIFIER' | 'NOT_FOUND';
    matches: RecallTargetType[];
  }> {
    const matches: RecallTargetType[] = [];

    // Check 1: component_reels.reel_id
    const reelIdRows = await this.db.query<any>(
      'SELECT 1 FROM component_reels WHERE reel_id = ? LIMIT 1',
      [identifier]
    );
    if (reelIdRows.length > 0) matches.push('COMPONENT_REEL');

    // Check 2: component_reels.lot_number OR material_consumptions.material_lot_number
    const lotRows = await this.db.query<any>(`
      SELECT 1 FROM component_reels WHERE lot_number = ?
      UNION
      SELECT 1 FROM material_consumptions WHERE material_lot_number = ?
      LIMIT 1
    `, [identifier, identifier]);
    if (lotRows.length > 0 && !matches.includes('COMPONENT_REEL')) {
      matches.push('COMPONENT_LOT');
    }

    // Check 3: solder_paste_jars (jar_id or lot_number)
    const pasteRows = await this.db.query<any>(
      'SELECT 1 FROM solder_paste_jars WHERE jar_id = ? OR lot_number = ? LIMIT 1',
      [identifier, identifier]
    );
    if (pasteRows.length > 0) matches.push('PASTE_LOT');

    // Check 4: stencils (stencil_id or stencil_serial_number)
    const stencilRows = await this.db.query<any>(
      'SELECT 1 FROM stencils WHERE stencil_id = ? OR stencil_serial_number = ? LIMIT 1',
      [identifier, identifier]
    );
    if (stencilRows.length > 0) matches.push('STENCIL_SERIAL');

    if (matches.length === 0) return { targetType: null, status: 'NOT_FOUND', matches: [] };
    if (matches.length > 1) return { targetType: matches[0], status: 'AMBIGUOUS_IDENTIFIER', matches };
    return { targetType: matches[0], status: 'CONTAINED', matches };
  }
}
