import { GenealogyTree, GenealogyNode, GenealogyEdge } from '@mes/shared';
import { getDatabase } from '../db/database';

export class GenealogyService {
  /**
   * Backward trace: Given a batch/job number or panel barcode, find all mounted component reels, vendors, and SMT lines.
   */
  public static async traceBatch(batchNumberOrPanel: string): Promise<GenealogyTree> {
    const db = getDatabase();
    const nodes: GenealogyNode[] = [];
    const edges: GenealogyEdge[] = [];

    // Check if query is for a specific panel barcode
    const panelRows = await db.query(`
      SELECT pc.*, b.batch_number, b.product_code, p.name as product_name, wc.name as work_center_name
      FROM panel_checkouts pc
      LEFT JOIN batches b ON pc.batch_id = b.id OR pc.batch_id = b.batch_number
      LEFT JOIN products p ON b.product_code = p.code
      LEFT JOIN work_centers wc ON pc.work_center_id = wc.id
      WHERE pc.panel_barcode = ?
    `, [batchNumberOrPanel]);

    const isPanel = panelRows.length > 0;
    const rootCode = isPanel ? panelRows[0].panel_barcode : batchNumberOrPanel;
    const batchId = isPanel ? panelRows[0].batch_number : batchNumberOrPanel;

    // 1. Fetch batch details
    const batchRows = await db.query(`
      SELECT b.*, wc.name as work_center_name, p.name as product_name
      FROM batches b
      LEFT JOIN work_centers wc ON b.work_center_id = wc.id
      LEFT JOIN products p ON b.product_code = p.code
      WHERE b.batch_number = ? OR b.id = ?
    `, [batchId, batchId]);

    const batch = batchRows.length > 0 ? batchRows[0] : null;
    const rootNodeId = isPanel ? `panel-${rootCode}` : `job-${rootCode}`;

    if (isPanel) {
      const panel = panelRows[0];
      nodes.push({
        id: rootNodeId,
        label: `Panel ${panel.panel_barcode}`,
        type: 'FINISHED_PANEL',
        code: panel.panel_barcode,
        details: {
          product: panel.product_name || 'Smart Meter Board',
          program: panel.program_name,
          cycleTime: `${panel.cycle_time_seconds}s`,
          blocks: `${panel.block_count} (skips: ${panel.block_skip_count})`,
          completedAt: panel.completed_at
        }
      });
    } else if (batch) {
      nodes.push({
        id: rootNodeId,
        label: `SMT Job ${batch.batch_number}`,
        type: 'FINISHED_PANEL',
        code: batch.batch_number,
        details: {
          product: batch.product_name || batch.product_code,
          program: batch.recipe_code,
          status: batch.status,
          yield: `${batch.actual_quantity} / ${batch.planned_quantity} ${batch.unit}`,
          startedAt: batch.started_at
        }
      });
    }

    // 2. Fetch SMT Equipment node
    const workCenterId = batch ? batch.work_center_id : (isPanel ? panelRows[0].work_center_id : null);
    const workCenterName = batch ? batch.work_center_name : (isPanel ? panelRows[0].work_center_name : null);

    if (workCenterId) {
      const eqNodeId = `wc-${workCenterId}`;
      nodes.push({
        id: eqNodeId,
        label: workCenterName || 'Fuji NXT III Line',
        type: 'SMT_EQUIPMENT',
        code: workCenterId,
        details: { type: 'PICK_AND_PLACE' }
      });
      edges.push({ from: eqNodeId, to: rootNodeId, relation: 'MOUNTED_IN' });
    }

    // 3. Fetch consumed component reels
    const consumptions = await db.query(`
      SELECT mc.*, r.supplier_name, r.lot_number, r.date_code, r.msl_level, r.msl_remaining_minutes
      FROM material_consumptions mc
      LEFT JOIN component_reels r ON (mc.material_lot_number = r.reel_id OR mc.material_lot_number = r.lot_number)
      WHERE mc.batch_id = ? OR mc.batch_id = ?
    `, [batchId, batch ? batch.id : batchId]);

    for (const c of consumptions) {
      const reelNodeId = `reel-${c.material_lot_number}`;
      if (!nodes.find(n => n.id === reelNodeId)) {
        nodes.push({
          id: reelNodeId,
          label: `${c.material_name} (Reel: ${c.material_lot_number})`,
          type: 'COMPONENT_REEL',
          code: c.material_lot_number,
          details: {
            partNumber: c.material_code,
            supplier: c.supplier_name || 'Component Vendor',
            vendorLot: c.lot_number || '-',
            dateCode: c.date_code || '-',
            feederLocation: c.container_id || 'Feeder Slot',
            mslFloorLife: c.msl_remaining_minutes ? `${c.msl_remaining_minutes}m` : 'Unlimited'
          }
        });
      }

      edges.push({
        from: reelNodeId,
        to: rootNodeId,
        relation: 'PLACED_ON'
      });
    }

    return { rootId: rootNodeId, rootNodeId, nodes, edges };
  }

  /**
   * Forward trace / Recall: Given a component reel ID or vendor lot, find all SMT jobs and panels produced with it.
   */
  public static async traceMaterialLot(reelIdOrLot: string): Promise<GenealogyTree> {
    const db = getDatabase();
    const nodes: GenealogyNode[] = [];
    const edges: GenealogyEdge[] = [];

    // 1. Fetch component reel details
    const reelRows = await db.query(
      'SELECT * FROM component_reels WHERE reel_id = ? OR lot_number = ?',
      [reelIdOrLot, reelIdOrLot]
    );
    const rootReelId = reelRows.length > 0 ? reelRows[0].reel_id : reelIdOrLot;
    const reelNodeId = `reel-${rootReelId}`;

    if (reelRows.length > 0) {
      const reel = reelRows[0];
      nodes.push({
        id: reelNodeId,
        label: `${reel.part_name} (Reel: ${reel.reel_id})`,
        type: 'COMPONENT_REEL',
        code: reel.reel_id,
        details: {
          partNumber: reel.part_number,
          supplier: reel.supplier_name,
          vendorLot: reel.lot_number,
          dateCode: reel.date_code,
          stockRemaining: `${reel.current_quantity} PCS`,
          mslStatus: reel.msl_level > 1 ? `MSL ${reel.msl_level} (${reel.msl_remaining_minutes}m left)` : 'MSL 1 (Unlimited)'
        }
      });
    } else {
      nodes.push({
        id: reelNodeId,
        label: `Reel / Lot: ${reelIdOrLot}`,
        type: 'COMPONENT_REEL',
        code: reelIdOrLot,
        details: { status: 'UNKNOWN' }
      });
    }

    // 2. Fetch all SMT jobs that mounted/consumed this reel
    const consumedInJobs = await db.query(`
      SELECT mc.*, b.batch_number, b.product_code, p.name as product_name, b.status as batch_status, b.actual_quantity, b.unit as batch_unit
      FROM material_consumptions mc
      JOIN batches b ON (mc.batch_id = b.id OR mc.batch_id = b.batch_number)
      LEFT JOIN products p ON b.product_code = p.code
      WHERE mc.material_lot_number = ? OR mc.material_lot_number = ?
    `, [rootReelId, reelIdOrLot]);

    for (const row of consumedInJobs) {
      const jobNodeId = `job-${row.batch_number}`;
      if (!nodes.find(n => n.id === jobNodeId)) {
        nodes.push({
          id: jobNodeId,
          label: `SMT Job ${row.batch_number} (${row.product_name || row.product_code})`,
          type: 'FINISHED_PANEL',
          code: row.batch_number,
          details: {
            quantityPlaced: `${row.quantity_consumed} PCS`,
            feederSlot: row.container_id || 'SMT Feeder',
            splicedAt: row.consumed_at,
            producedPanels: `${row.actual_quantity} Panels`
          }
        });
      }

      edges.push({
        from: reelNodeId,
        to: jobNodeId,
        relation: 'PLACED_ON'
      });
    }

    return { rootId: reelNodeId, rootNodeId: reelNodeId, nodes, edges };
  }
}
