import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/database';
import { EventIngestionService } from '../services/event-ingestion.service';
import { SmtInterlockService } from '../services/smt-interlock.service';

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

    const decision = await SmtInterlockService.verifyFeederSplice(workCenterId, slotNo, scannedPartNumber);

    // Check MSL from reel database if exists
    const reelRows = await db.query('SELECT * FROM component_reels WHERE reel_id = ?', [scannedReelId]);
    const mslMinutes = reelRows.length > 0 ? reelRows[0].msl_remaining_minutes : 999999;
    const isMslExpired = mslMinutes <= 0;

    if (!decision.allowed) {
      res.status(400).json({
        verified: false,
        valid: false,
        decision: 'BLOCKED_MISMATCH',
        machineAction: 'INTERLOCK_TRIPPED_HALT_FEEDER',
        error: 'MISMATCHED_PART_NUMBER',
        message: `FATAL: Slot ${slotNo} requires part ${decision.expectedPartNumber}, but scanned reel is ${scannedPartNumber}! Halting feeder.`,
        expectedPartNumber: decision.expectedPartNumber,
        scannedPartNumber
      });
      return;
    }

    if (isMslExpired) {
      res.status(400).json({
        verified: false,
        valid: false,
        decision: 'BLOCKED_MSL_EXPIRED',
        machineAction: 'INTERLOCK_TRIPPED_HALT_FEEDER',
        error: 'MSL_EXPIRED',
        message: `WARNING: Reel ${scannedReelId} has exceeded its moisture floor life (${mslMinutes} mins left)! Requires baking.`,
        expectedPartNumber: decision.expectedPartNumber,
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
        feederId: decision.feederId || 'FID-W08F-01',
        partNumber: scannedPartNumber,
        oldReelId: decision.currentReelId || 'REEL-DEPLETED',
        newReelId: scannedReelId,
        newReelQuantity: 10000,
        mslRemainingMinutes: mslMinutes,
        operatorId
      }
    });

    res.json({
      verified: true,
      valid: true,
      decision: 'APPROVED',
      machineAction: 'ENGAGE_FEEDER_PICKUP',
      message: `Verified & Spliced: Reel ${scannedReelId} matched slot ${slotNo} (${decision.expectedPartNumber}).`,
      expectedPartNumber: decision.expectedPartNumber,
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
