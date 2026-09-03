import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/database';
import { EventIngestionService } from '../services/event-ingestion.service';
import { SplicingAuthorizationService } from '../services/splicing-authorization.service';
import { MslService } from '../services/msl.service';
import { SolderPasteService } from '../services/solder-paste.service';
import { PrinterAuthorizationService } from '../services/printer-authorization.service';

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
        r.msl_class,
        r.floor_clock_state,
        r.storage_state,
        r.msl_remaining_minutes
      FROM smt_feeder_slots s
      LEFT JOIN component_reels r ON s.current_reel_id = r.reel_id
      WHERE s.work_center_id = ?
      ORDER BY s.module_no ASC, s.slot_no ASC
    `, [workCenterId]);

    const mslService = new MslService();
    const enrichedSlots = await Promise.all(
      slots.map(async (slot: any) => {
        if (slot.current_reel_id) {
          try {
            const msl = await mslService.getReelMslStatus(slot.current_reel_id);
            return {
              ...slot,
              msl_class: msl.mslClass,
              floor_clock_state: msl.floorClockState,
              msl_remaining_minutes: msl.remainingFloorLifeMinutes,
              msl_expires_at: msl.floorLifeExpiresAt,
              is_msl_expired: msl.isExpired,
              bake_status: msl.bakeStatus
            };
          } catch {
            return slot;
          }
        }
        return slot;
      })
    );

    res.json(enrichedSlots);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Splicing Barcode Verification (Quality Gate before physical splice)
smtRouter.post('/splice-verify', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { workCenterId = 'wc-nxt-01', slotNo, scannedReelId, scannedPartNumber, operatorId = 'op-smt-01' } = req.body;

    const decision = await SplicingAuthorizationService.authorizeSplicing({
      workCenterId,
      slotNo: Number(slotNo),
      scannedPartNumber,
      scannedReelId,
      operatorId
    });

    if (!decision.allowed) {
      res.status(400).json({
        verified: false,
        valid: false,
        decision: decision.decisionCode === 'BLOCKED_BOM_MISMATCH' ? 'BLOCKED_MISMATCH' : decision.decisionCode,
        decisionCode: decision.decisionCode,
        machineAction: 'INTERLOCK_TRIPPED_HALT_FEEDER',
        error: decision.decisionCode,
        message: decision.reason,
        expectedPartNumber: decision.expectedPartNumber,
        scannedPartNumber,
        mslState: decision.mslState,
        mslRemainingMinutes: decision.mslRemainingMinutes
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
        mslRemainingMinutes: decision.mslRemainingMinutes ?? 999999,
        operatorId
      }
    });

    res.json({
      verified: true,
      valid: true,
      decision: 'APPROVED',
      decisionCode: 'APPROVED',
      machineAction: 'ENGAGE_FEEDER_PICKUP',
      message: `Verified & Spliced: Reel ${scannedReelId} matched slot ${slotNo} (${decision.expectedPartNumber}).`,
      expectedPartNumber: decision.expectedPartNumber,
      scannedPartNumber,
      mslRemainingMinutes: decision.mslRemainingMinutes
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

// ============================================================================
// Phase 2B: MSL Lifecycle Endpoints (JEDEC J-STD-033D)
// ============================================================================

// Get dynamic computed-on-read MSL status for a reel
smtRouter.get('/msl/reel/:reelId', async (req: Request, res: Response) => {
  try {
    const reelId = String(req.params.reelId);
    const mslService = new MslService();
    const status = await mslService.getReelMslStatus(reelId);
    res.json(status);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

// Unseal reel MBB bag
smtRouter.post('/msl/unseal', async (req: Request, res: Response) => {
  try {
    const { reelId, operatorId = 'op-cleanroom-01' } = req.body;
    const mslService = new MslService();
    await mslService.unsealReel(reelId, operatorId);
    const status = await mslService.getReelMslStatus(reelId);
    res.json({ success: true, message: `Reel ${reelId} unsealed. Floor life countdown initiated.`, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Move reel into dry storage cabinet
smtRouter.post('/msl/dry-storage/enter', async (req: Request, res: Response) => {
  try {
    const { reelId, cabinetId = 'DRY-CAB-01', operatorId = 'op-cleanroom-01' } = req.body;
    const mslService = new MslService();
    await mslService.enterDryStorage(reelId, cabinetId, operatorId);
    const status = await mslService.getReelMslStatus(reelId);
    res.json({ success: true, message: `Reel ${reelId} entered dry cabinet ${cabinetId}. Floor life paused.`, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Remove reel from dry storage cabinet
smtRouter.post('/msl/dry-storage/exit', async (req: Request, res: Response) => {
  try {
    const { reelId, cabinetId = 'DRY-CAB-01', operatorId = 'op-cleanroom-01' } = req.body;
    const mslService = new MslService();
    await mslService.exitDryStorage(reelId, cabinetId, operatorId);
    const status = await mslService.getReelMslStatus(reelId);
    res.json({ success: true, message: `Reel ${reelId} removed from dry cabinet. Ambient exposure resumed.`, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Start bake session
smtRouter.post('/msl/bake/start', async (req: Request, res: Response) => {
  try {
    const { reelId, ovenId = 'OVEN-01', bakeProfileId = 'BAKE-JEDEC-125C-24H', operatorId = 'op-bake-01' } = req.body;
    const mslService = new MslService();
    await mslService.startBake(reelId, ovenId, bakeProfileId, operatorId);
    const status = await mslService.getReelMslStatus(reelId);
    res.json({ success: true, message: `Bake started for reel ${reelId} (${bakeProfileId}).`, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Complete bake session
smtRouter.post('/msl/bake/complete', async (req: Request, res: Response) => {
  try {
    const { reelId, ovenId = 'OVEN-01', operatorId = 'op-bake-01' } = req.body;
    const mslService = new MslService();
    const result = await mslService.completeBake(reelId, ovenId, operatorId);
    const status = await mslService.getReelMslStatus(reelId);
    res.json({ success: result.bakeSufficient, ...result, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// ============================================================================
// Phase 2D: Solder Paste & Stencil Endpoints (Stage 01 Screen Printer)
// ============================================================================

// List active solder paste jars
smtRouter.get('/paste/jars', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const jars = await db.query(`
      SELECT 
        j.*,
        p.manufacturer,
        p.thaw_required_minutes,
        p.minimum_processing_temperature_c,
        p.mixing_min_seconds,
        p.mixing_max_seconds,
        p.stencil_life_minutes
      FROM solder_paste_jars j
      LEFT JOIN solder_paste_profiles p ON j.profile_id = p.id
      ORDER BY j.created_at DESC
    `);
    res.json(jars);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Remove paste jar from cold refrigeration
smtRouter.post('/paste/remove-from-cold', async (req: Request, res: Response) => {
  try {
    const { jarId, operatorId = 'op-prep-01' } = req.body;
    const pasteService = new SolderPasteService();
    await pasteService.removeFromCold(jarId, operatorId);
    res.json({ success: true, message: `Jar ${jarId} removed from cold storage. Thawing countdown initiated.` });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Verify thaw duration and temperature
smtRouter.post('/paste/verify-thaw', async (req: Request, res: Response) => {
  try {
    const { jarId, temperatureVerifiedC, operatorId = 'op-prep-01' } = req.body;
    const pasteService = new SolderPasteService();
    const result = await pasteService.verifyThaw(jarId, Number(temperatureVerifiedC), operatorId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Record planetary mixing
smtRouter.post('/paste/mix', async (req: Request, res: Response) => {
  try {
    const { jarId, durationSeconds, mixingMethod = 'CENTRIFUGAL_PLANETARY', operatorId = 'op-prep-01' } = req.body;
    const pasteService = new SolderPasteService();
    const result = await pasteService.recordMixing(jarId, Number(durationSeconds), mixingMethod, operatorId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Authorize paste jar for printer staging
smtRouter.post('/paste/authorize', async (req: Request, res: Response) => {
  try {
    const { jarId, workCenterId = 'wc-spg-01', operatorId = 'op-prep-01' } = req.body;
    const pasteService = new SolderPasteService();
    await pasteService.authorizeForPrinter(jarId, workCenterId, operatorId);
    res.json({ success: true, message: `Jar ${jarId} successfully authorized for production.` });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Load paste onto stencil
smtRouter.post('/paste/load-on-stencil', async (req: Request, res: Response) => {
  try {
    const { jarId, stencilId, workCenterId = 'wc-spg-01', batchId, operatorId = 'op-spg-01' } = req.body;
    const pasteService = new SolderPasteService();
    const result = await pasteService.loadOnStencil(jarId, stencilId, workCenterId, batchId, operatorId);
    res.json({ success: true, message: `Jar ${jarId} loaded on stencil ${stencilId}.`, ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Check stencil session rolling life
smtRouter.get('/paste/stencil-session/:sessionId', async (req: Request, res: Response) => {
  try {
    const sessionId = String(req.params.sessionId);
    const pasteService = new SolderPasteService();
    const status = await pasteService.checkStencilLife(sessionId);
    res.json(status);
  } catch (error: any) {
    res.status(404).json({ error: error.message });
  }
});

// Screen printer quality gate start authorization
smtRouter.post('/printer/authorize-start', async (req: Request, res: Response) => {
  try {
    const { workCenterId = 'wc-spg-01', stencilId, pasteJarId, batchId } = req.body;
    const printerAuth = new PrinterAuthorizationService();
    const decision = await printerAuth.authorizeScreenPrinter({ workCenterId, stencilId, pasteJarId, batchId });
    if (!decision.allowed) {
      res.status(400).json(decision);
      return;
    }
    res.json(decision);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

