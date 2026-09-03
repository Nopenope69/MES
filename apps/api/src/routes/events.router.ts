import { Router, Request, Response } from 'express';
import { EventIngestionService } from '../services/event-ingestion.service';
import { getDatabase } from '../db/database';

export const eventsRouter = Router();

// Ingest an event (from tablet UI, manual button, or external source)
eventsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const result = await EventIngestionService.ingest(req.body);
    res.status(201).json(result);
  } catch (error: any) {
    console.error('[Event Ingest Error]', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to ingest event',
      details: error.errors || undefined
    });
  }
});

// Query Tier 1 raw ingress frames (unaltered TCP socket frames)
eventsRouter.get('/ingress', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { limit = 50 } = req.query;
    const rows = await db.query(
      'SELECT * FROM ingress_events ORDER BY received_at DESC NULLS LAST, id DESC LIMIT ?',
      [Number(limit)]
    );
    res.json(rows);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Query append-only event log (Audit Trail view)
eventsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { workCenterId, batchId, eventType, limit = 50 } = req.query;

    let sql = 'SELECT * FROM production_events WHERE 1=1';
    const params: any[] = [];

    if (workCenterId) {
      sql += ' AND work_center_id = ?';
      params.push(workCenterId);
    }
    if (batchId) {
      sql += ' AND (batch_id = ? OR work_order_id = ?)';
      params.push(batchId, batchId);
    }
    if (eventType) {
      sql += ' AND event_type = ?';
      params.push(eventType);
    }

    sql += ' ORDER BY event_time DESC LIMIT ?';
    params.push(Number(limit));

    const rows = await db.query(sql, params);
    const parsed = rows.map((r: any) => ({
      ...r,
      payload: JSON.parse(r.payload_json || '{}')
    }));

    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
