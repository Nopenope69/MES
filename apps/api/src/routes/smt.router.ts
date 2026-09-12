import { Router, Request, Response } from 'express';
import { getDatabase } from '../db/database';
import { EventIngestionService } from '../services/event-ingestion.service';
import { SplicingAuthorizationService } from '../services/splicing-authorization.service';
import { MslService } from '../services/msl.service';
import { SolderPasteService } from '../services/solder-paste.service';
import { PrinterAuthorizationService } from '../services/printer-authorization.service';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';
import { ProductionHoldService, HoldBroadcaster } from '../services/production-hold.service';

export const smtRouter = Router();

// Get active SMT Feeder Slot Map
smtRouter.get('/feeders', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
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
smtRouter.post('/splice-verify', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { workCenterId = 'wc-nxt-01', slotNo, scannedReelId, scannedPartNumber } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-smt-01';

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
smtRouter.get('/pick-errors', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
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
smtRouter.get('/msl/reel/:reelId', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
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
smtRouter.post('/msl/unseal', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { reelId } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-cleanroom-01';
    const mslService = new MslService();
    await mslService.unsealReel(reelId, operatorId);
    const status = await mslService.getReelMslStatus(reelId);
    res.json({ success: true, message: `Reel ${reelId} unsealed. Floor life countdown initiated.`, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Move reel into dry storage cabinet
smtRouter.post('/msl/dry-storage/enter', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { reelId, cabinetId = 'DRY-CAB-01' } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-cleanroom-01';
    const mslService = new MslService();
    await mslService.enterDryStorage(reelId, cabinetId, operatorId);
    const status = await mslService.getReelMslStatus(reelId);
    res.json({ success: true, message: `Reel ${reelId} entered dry cabinet ${cabinetId}. Floor life paused.`, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Remove reel from dry storage cabinet
smtRouter.post('/msl/dry-storage/exit', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { reelId, cabinetId = 'DRY-CAB-01' } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-cleanroom-01';
    const mslService = new MslService();
    await mslService.exitDryStorage(reelId, cabinetId, operatorId);
    const status = await mslService.getReelMslStatus(reelId);
    res.json({ success: true, message: `Reel ${reelId} removed from dry cabinet. Ambient exposure resumed.`, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Start bake session
smtRouter.post('/msl/bake/start', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { reelId, ovenId = 'OVEN-01', bakeProfileId = 'BAKE-JEDEC-125C-24H' } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-bake-01';
    const mslService = new MslService();
    await mslService.startBake(reelId, ovenId, bakeProfileId, operatorId);
    const status = await mslService.getReelMslStatus(reelId);
    res.json({ success: true, message: `Bake started for reel ${reelId} (${bakeProfileId}).`, status });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Complete bake session
smtRouter.post('/msl/bake/complete', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { reelId, ovenId = 'OVEN-01' } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-bake-01';
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
smtRouter.get('/paste/jars', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
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
smtRouter.post('/paste/remove-from-cold', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { jarId } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-prep-01';
    const pasteService = new SolderPasteService();
    await pasteService.removeFromCold(jarId, operatorId);
    res.json({ success: true, message: `Jar ${jarId} removed from cold storage. Thawing countdown initiated.` });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Verify thaw duration and temperature
smtRouter.post('/paste/verify-thaw', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { jarId, temperatureVerifiedC } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-prep-01';
    const pasteService = new SolderPasteService();
    const result = await pasteService.verifyThaw(jarId, Number(temperatureVerifiedC), operatorId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Record planetary mixing
smtRouter.post('/paste/mix', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { jarId, durationSeconds, mixingMethod = 'CENTRIFUGAL_PLANETARY' } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-prep-01';
    const pasteService = new SolderPasteService();
    const result = await pasteService.recordMixing(jarId, Number(durationSeconds), mixingMethod, operatorId);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Authorize paste jar for printer staging
smtRouter.post('/paste/authorize', requirePermission(Permission.QUALITY_APPROVE), async (req: Request, res: Response) => {
  try {
    const { jarId, workCenterId = 'wc-spg-01' } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-prep-01';
    const pasteService = new SolderPasteService();
    await pasteService.authorizeForPrinter(jarId, workCenterId, operatorId);
    res.json({ success: true, message: `Jar ${jarId} successfully authorized for production.` });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Load paste onto stencil
smtRouter.post('/paste/load-on-stencil', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { jarId, stencilId, workCenterId = 'wc-spg-01', batchId } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId || 'op-spg-01';
    const pasteService = new SolderPasteService();
    const result = await pasteService.loadOnStencil(jarId, stencilId, workCenterId, batchId, operatorId);
    res.json({ success: true, message: `Jar ${jarId} loaded on stencil ${stencilId}.`, ...result });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Check stencil session rolling life
smtRouter.get('/paste/stencil-session/:sessionId', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
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
smtRouter.post('/printer/authorize-start', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
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

// Track A: Hardware Abstraction Layer (HAL) Equipment Gateway Status
smtRouter.get('/equipment/status', requirePermission(Permission.REPORTS_VIEW), (_req: Request, res: Response) => {
  try {
    const { EquipmentGatewayManager } = require('../adapters/equipment-gateway.manager');
    const statuses = EquipmentGatewayManager.getInstance().getAllStatuses();
    res.json(statuses);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Track A: Projection Checkpoints & Catch-up Replay
smtRouter.get('/projections/checkpoints', requirePermission(Permission.REPORTS_VIEW), async (_req: Request, res: Response) => {
  try {
    const { ProjectionReplayService } = require('../services/projection-replay.service');
    const checkpoints = await ProjectionReplayService.getCheckpoints();
    res.json(checkpoints);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

smtRouter.post('/projections/replay', requirePermission(Permission.SYSTEM_MANAGE), async (req: Request, res: Response) => {
  try {
    const { fromTimestamp } = req.body;
    const { ProjectionReplayService } = require('../services/projection-replay.service');
    const result = await ProjectionReplayService.replayCatchup({ fromTimestamp });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// Mandatory Supervisor Acknowledgment (MSA) Production Hold Endpoints (Task I-03 / Gate G-10)
// ============================================================================

// Get active production holds
smtRouter.get('/hold/status', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const { lineId } = req.query;
    if (lineId && typeof lineId === 'string') {
      const activeHold = await ProductionHoldService.getActiveHoldForLine(lineId);
      res.json({ isHoldActive: activeHold !== null, hold: activeHold });
      return;
    }
    const activeHolds = await ProductionHoldService.getActiveHolds();
    res.json({ count: activeHolds.length, holds: activeHolds });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Trip production line hold
smtRouter.post('/hold/trip', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { lineId, workCenterId, reason, triggerDefect } = req.body;
    if (!reason || typeof reason !== 'string') {
      res.status(400).json({ error: 'Hold reason is mandatory.' });
      return;
    }
    const hold = await ProductionHoldService.tripProductionHold({
      lineId,
      workCenterId,
      reason,
      triggerDefect
    });
    res.status(201).json({ success: true, message: `Production line hold tripped: ${reason}`, data: hold });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Mandatory Supervisor Acknowledgment to clear hold
smtRouter.post('/hold/acknowledge', requirePermission(Permission.HOLD_ACKNOWLEDGE), async (req: Request, res: Response) => {
  try {
    const { holdId, lineId, acknowledgementReason, digitalSignature } = req.body;
    if (!acknowledgementReason || typeof acknowledgementReason !== 'string' || acknowledgementReason.trim().length === 0) {
      res.status(400).json({ error: 'Acknowledgement reason is mandatory.' });
      return;
    }

    const acknowledgedBy = req.user?.code || req.user?.id || 'SUPERVISOR';
    const acknowledgedByName = req.user?.name || req.user?.code || 'Supervisor';
    const role = req.user?.role || 'LINE_LEAD';

    const hold = await ProductionHoldService.acknowledgeProductionHold({
      holdId,
      lineId,
      acknowledgedBy,
      acknowledgedByName,
      role,
      acknowledgementReason,
      digitalSignature
    });

    res.json({ success: true, message: `Production line hold cleared by ${acknowledgedBy} (${role})`, data: hold });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Real-time SSE stream for cleanroom station cockpits
smtRouter.get('/hold/events', requirePermission(Permission.REPORTS_VIEW), (req: Request, res: Response) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() })}\n\n`);

  const unsubscribe = HoldBroadcaster.getInstance().subscribe((event) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  req.on('close', () => {
    unsubscribe();
  });
});



