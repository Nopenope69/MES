import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/database';
import { EventIngestionService } from '../services/event-ingestion.service';

export const smtRouter = Router();

// Get active SMT Feeder Slot Map
smtRouter.get('/feeders', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { workCenterId = 'wc-nxt-01' } = req.query;

    const slots = await db.query(`
      SELECT 
        s.*,
        r.part_name,
        r.supplier_name,
        r.lot_number,
        r.date_code,
        r.current_quantity as reel_remaining_quantity,
        r.msl_level,
        r.msl_remaining_minutes
      FROM smt_feeder_slots s
      LEFT JOIN component_reels r ON s.current_reel_id = r.reel_id
      WHERE s.work_center_id = ?
      ORDER BY s.module_no ASC, s.slot_no ASC
    `, [workCenterId]);

    res.json(slots);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Splicing Barcode Verification (Quality Gate before physical splice)
smtRouter.post('/splice-verify', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { workCenterId = 'wc-nxt-01', slotNo, scannedReelId, scannedPartNumber, operatorId = 'op-smt-01' } = req.body;

    const slotRows = await db.query(`
      SELECT assigned_part_number, feeder_id, current_reel_id
      FROM smt_feeder_slots
      WHERE work_center_id = ? AND slot_no = ?
    `, [workCenterId, slotNo]);

    if (slotRows.length === 0) {
      res.status(404).json({ verified: false, message: `Slot ${slotNo} not configured.` });
      return;
    }

    const expectedPart = slotRows[0].assigned_part_number;
    const isMatch = scannedPartNumber.trim().toUpperCase() === expectedPart.trim().toUpperCase();

    // Check MSL from reel database if exists
    const reelRows = await db.query('SELECT * FROM component_reels WHERE reel_id = ?', [scannedReelId]);
    const mslMinutes = reelRows.length > 0 ? reelRows[0].msl_remaining_minutes : 999999;
    const isMslExpired = mslMinutes <= 0;

    if (!isMatch) {
      res.status(400).json({
        verified: false,
        error: 'MISMATCHED_PART_NUMBER',
        message: `FATAL: Slot ${slotNo} requires part ${expectedPart}, but scanned reel is ${scannedPartNumber}! Halting feeder.`,
        expectedPartNumber: expectedPart,
        scannedPartNumber
      });
      return;
    }

    if (isMslExpired) {
      res.status(400).json({
        verified: false,
        error: 'MSL_EXPIRED',
        message: `WARNING: Reel ${scannedReelId} has exceeded its moisture floor life (${mslMinutes} mins left)! Requires baking.`,
        expectedPartNumber: expectedPart,
        scannedPartNumber
      });
      return;
    }

    // Record the verified splice in MES
    await EventIngestionService.ingest({
      eventType: 'REEL_SPLICED',
      workCenterId,
      operatorId,
      sourceType: 'MANUAL_UI',
      sourceId: 'tablet-splicing-kiosk',
      payload: {
        slotNo: Number(slotNo),
        moduleNo: 1,
        stageNo: 1,
        feederId: slotRows[0].feeder_id,
        partNumber: scannedPartNumber,
        oldReelId: slotRows[0].current_reel_id || 'REEL-DEPLETED',
        newReelId: scannedReelId,
        newReelQuantity: 10000,
        mslRemainingMinutes: mslMinutes,
        operatorId
      }
    });

    res.json({
      verified: true,
      message: `Verified & Spliced: Reel ${scannedReelId} matched slot ${slotNo} (${expectedPart}).`,
      expectedPartNumber: expectedPart,
      scannedPartNumber,
      mslRemainingMinutes: mslMinutes
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Pick Error Pareto
smtRouter.get('/pick-errors', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { workCenterId = 'wc-nxt-01' } = req.query;

    const errors = await db.query(`
      SELECT 
        module_no,
        slot_no,
        feeder_id,
        part_number,
        error_type,
        COUNT(id) as total_errors
      FROM feeder_error_logs
      WHERE work_center_id = ?
      GROUP BY module_no, slot_no, feeder_id, part_number, error_type
      ORDER BY total_errors DESC
      LIMIT 10
    `, [workCenterId]);

    res.json(errors);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});
