import { Router, Request, Response } from 'express';
import { AgvMissionManager } from '../services/agv-mission-manager.service';
import { MaterialReservationService } from '../services/material-reservation.service';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const logisticsRouter = Router();
const agvManager = AgvMissionManager.getInstance();
const reservationService = MaterialReservationService.getInstance();

/**
 * GET /api/v1/logistics/agv/missions
 * Fetches active AGV transport missions.
 */
logisticsRouter.get('/agv/missions', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const lineId = req.query.lineId as string | undefined;
    const missions = await agvManager.getActiveMissions(lineId);
    res.json({ success: true, data: missions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/logistics/agv/dispatch
 * Dispatches an AGV unit on a transport mission (idempotent).
 */
logisticsRouter.post('/agv/dispatch', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { missionId, agvId } = req.body;
    if (!missionId || !agvId) {
      return res.status(400).json({ success: false, error: 'missionId and agvId are required' });
    }
    const result = await agvManager.dispatchMission(missionId, agvId);
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/logistics/agv/missions/:missionId/state
 * Updates the transit state of an AGV mission.
 */
logisticsRouter.post('/agv/missions/:missionId/state', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const missionId = String(req.params.missionId);
    const { state, location, batteryPercent, reason } = req.body;
    if (!state) {
      return res.status(400).json({ success: false, error: 'state is required' });
    }
    await agvManager.updateMissionState(missionId, state, { location, batteryPercent, reason });
    res.json({ success: true, missionId, newState: state });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/logistics/agv/missions/:missionId/authorize-delivery
 * Physical Dock Delivery Authorization Gate.
 */
logisticsRouter.post('/agv/missions/:missionId/authorize-delivery', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const missionId = String(req.params.missionId);
    const authorizedBy = req.user?.code || req.user?.id;
    if (!authorizedBy) {
      return res.status(401).json({ success: false, error: 'Unauthorized: missing authenticated user context' });
    }
    const result = await agvManager.authorizeDockDelivery({
      missionId,
      authorizedBy
    });
    if (!result.success) {
      return res.status(422).json({ success: false, error: result.reason });
    }
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/logistics/replenishment/request
 * Creates a feeder material replenishment request.
 */
logisticsRouter.post('/replenishment/request', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { lineId, workCenterId, slotNo, partNumber, currentReelId, remainingQuantity, estimatedMinutesRemaining, confidence } = req.body;
    const requestId = await agvManager.createReplenishmentRequest({
      lineId,
      workCenterId,
      slotNo: Number(slotNo),
      partNumber,
      currentReelId,
      remainingQuantity: Number(remainingQuantity),
      estimatedMinutesRemaining: Number(estimatedMinutesRemaining),
      confidence
    });
    res.status(201).json({ success: true, requestId });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/logistics/replenishment/:requestId/gate
 * Pre-Gates replenishment request with candidate reel via MaterialGateModule.
 */
logisticsRouter.post('/replenishment/:requestId/gate', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const requestId = String(req.params.requestId);
    const candidateReelId = req.body.candidateReelId;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId;
    const result = await agvManager.gateReplenishmentRequest(requestId, candidateReelId, operatorId);
    if (!result.success) {
      return res.status(422).json({ success: false, error: result.reason });
    }
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/logistics/reservations
 * Atomically reserves a component reel for a designated line.
 */
logisticsRouter.post('/reservations', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { reelId, lineId, slotNo, partNumber, purpose, correlationId } = req.body;
    const operatorId = req.user?.code || req.user?.id || req.body.operatorId;
    const result = await reservationService.reserveMaterial({
      reelId,
      lineId,
      slotNo: Number(slotNo),
      partNumber,
      purpose: purpose || 'LINE_FEEDER_REPLENISHMENT',
      correlationId: correlationId || `res-${Date.now()}`,
      operatorId
    });

    if (!result.success) {
      return res.status(409).json({ success: false, error: result.reason });
    }
    res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/logistics/reservations
 * Fetches active material reservations.
 */
logisticsRouter.get('/reservations', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const lineId = req.query.lineId as string | undefined;
    const reservations = await reservationService.getActiveReservations(lineId);
    res.json({ success: true, data: reservations });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/logistics/feeders/:lineId/:slotNo/depletion
 * Calculates placement-based component depletion for a feeder slot.
 */
logisticsRouter.get('/feeders/:lineId/:slotNo/depletion', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const lineId = String(req.params.lineId);
    const slotNo = String(req.params.slotNo);
    const result = await agvManager.calculateFeederDepletion(lineId, Number(slotNo));
    res.json({ success: true, data: result });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
