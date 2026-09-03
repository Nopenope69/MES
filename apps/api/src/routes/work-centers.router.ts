import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/database';

export const workCentersRouter = Router();

// List all work centers with current state, active batch, and active operator
workCentersRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rows = await db.query(`
      SELECT 
        wc.*,
        b.batch_number,
        b.product_code,
        p.name as product_name,
        b.planned_quantity,
        b.actual_quantity,
        b.unit,
        op.name as operator_name
      FROM work_centers wc
      LEFT JOIN batches b ON wc.current_batch_id = b.id
      LEFT JOIN products p ON b.product_code = p.code
      LEFT JOIN operators op ON wc.current_operator_id = op.id
      ORDER BY 
        CASE wc.type 
          WHEN 'SCREEN_PRINTER' THEN 1 
          WHEN 'PICK_AND_PLACE' THEN 2 
          WHEN 'REFLOW_OVEN' THEN 3 
          WHEN 'AOI_INSPECTION' THEN 4 
          ELSE 5 
        END ASC
    `);

    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get state slice history timeline for a work center
workCentersRouter.get('/:id/timeline', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { id } = req.params;
    const slices = await db.query(`
      SELECT esl.*, da.reason_category, da.reason_code, da.comment
      FROM equipment_state_logs esl
      LEFT JOIN downtime_attributions da ON esl.id = da.state_log_id
      WHERE esl.work_center_id = ?
      ORDER BY esl.started_at DESC
      LIMIT 30
    `, [id]);

    res.json(slices);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
