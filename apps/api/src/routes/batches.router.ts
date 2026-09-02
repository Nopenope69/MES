import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/database';

export const batchesRouter = Router();

// List all batches
batchesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { status, workCenterId } = req.query;

    let sql = `
      SELECT b.*, wc.name as work_center_name, p.name as product_name, op.name as operator_name
      FROM batches b
      LEFT JOIN work_centers wc ON b.work_center_id = wc.id
      LEFT JOIN products p ON b.product_code = p.code
      LEFT JOIN operators op ON b.operator_id = op.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (status) {
      sql += ' AND b.status = ?';
      params.push(status);
    }
    if (workCenterId) {
      sql += ' AND b.work_center_id = ?';
      params.push(workCenterId);
    }

    sql += ' ORDER BY b.started_at DESC NULLS LAST, b.id DESC';
    const rows = await db.query(sql, params);
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single batch with recipe BOM items and actual consumed materials
batchesRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { id } = req.params;

    const batchRows = await db.query(`
      SELECT b.*, wc.name as work_center_name, p.name as product_name, r.id as recipe_id, r.name as recipe_name
      FROM batches b
      LEFT JOIN work_centers wc ON b.work_center_id = wc.id
      LEFT JOIN products p ON b.product_code = p.code
      LEFT JOIN recipes r ON b.recipe_code = r.code
      WHERE b.id = ? OR b.batch_number = ?
    `, [id, id]);

    if (batchRows.length === 0) {
      res.status(404).json({ error: 'Batch not found' });
      return;
    }

    const batch = batchRows[0];

    // Planned items from recipe
    const plannedItems = batch.recipe_id
      ? await db.query('SELECT * FROM recipe_items WHERE recipe_id = ? ORDER BY step_order ASC', [batch.recipe_id])
      : [];

    // Actual consumptions logged
    const actualConsumptions = await db.query(`
      SELECT mc.*, ml.supplier_name, ml.supplier_lot_number, ml.expiry_date
      FROM material_consumptions mc
      LEFT JOIN material_lots ml ON mc.material_lot_number = ml.lot_number
      WHERE mc.batch_id = ? OR mc.batch_id = ?
      ORDER BY mc.consumed_at ASC
    `, [batch.id, batch.batch_number]);

    res.json({
      ...batch,
      plannedItems,
      actualConsumptions
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
