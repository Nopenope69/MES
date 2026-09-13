import { Router, Request, Response } from 'express';
import { PredictiveQualityEngine } from '../services/predictive-quality.service';
import { TelemetryStore } from '../services/telemetry-store.service';
import { requirePermission } from '../middleware/auth.middleware';
import { Permission } from '../security/permissions';

export const predictiveRouter = Router();
const predictiveEngine = PredictiveQualityEngine.getInstance();
const telemetryStore = TelemetryStore.getInstance();

/**
 * GET /api/v1/predictive/anomalies
 * Fetches active statistical anomalies.
 */
predictiveRouter.get('/anomalies', requirePermission(Permission.REPORTS_VIEW), async (req: Request, res: Response) => {
  try {
    const lineId = req.query.lineId as string | undefined;
    const anomalies = await predictiveEngine.getActiveAnomalies(lineId);
    res.json({ success: true, data: anomalies });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/v1/predictive/actions
 * Fetches pending predictive actions awaiting review/authorization.
 */
predictiveRouter.get('/actions', requirePermission(Permission.REPORTS_VIEW), async (_req: Request, res: Response) => {
  try {
    const actions = await predictiveEngine.getPendingActions();
    res.json({ success: true, data: actions });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/predictive/evaluate/nozzle
 * Runs conditioned nozzle health evaluation (EWMA/CUSUM).
 */
predictiveRouter.post('/evaluate/nozzle', requirePermission(Permission.EQUIPMENT_MAINTAIN), async (req: Request, res: Response) => {
  try {
    const { nozzleId, machineId, headId, packageType, feederId, windowMinutes } = req.body;
    const report = await predictiveEngine.evaluateNozzleHealth({
      nozzleId,
      machineId: machineId || 'fuji-nxt-01',
      headId: headId || 'head-1',
      packageType: packageType || '0201',
      feederId: feederId || 'fdr-nxt1-01',
      windowMinutes: windowMinutes ? Number(windowMinutes) : 60
    });
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/predictive/evaluate/aperture
 * Runs continuous 3D SPI aperture clogging slope regression.
 */
predictiveRouter.post('/evaluate/aperture', requirePermission(Permission.EQUIPMENT_MAINTAIN), async (req: Request, res: Response) => {
  try {
    const { apertureId, recipeId, windowPanels } = req.body;
    const report = await predictiveEngine.evaluateApertureClogging({
      apertureId,
      recipeId: recipeId || 'PROG-SM-METER-TOP-REV4',
      windowPanels: windowPanels ? Number(windowPanels) : 15
    });
    res.json({ success: true, data: report });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/predictive/actions/:actionId/authorize
 * Safety Policy Gate: Authorizes a recommended predictive action.
 */
predictiveRouter.post('/actions/:actionId/authorize', requirePermission(Permission.QUALITY_APPROVE), async (req: Request, res: Response) => {
  try {
    const actionId = String(req.params.actionId);
    const { mode } = req.body;
    const authorizedBy = req.user?.code || req.user?.id;
    if (!authorizedBy) {
      return res.status(401).json({ success: false, error: 'Unauthorized: missing authenticated user context' });
    }
    const result = await predictiveEngine.authorizeAction(
      actionId,
      authorizedBy,
      mode || 'MANUAL_OVERRIDE'
    );
    if (!result.success) {
      return res.status(422).json({ success: false, error: result.reason });
    }
    res.json({ success: true, actionId, status: 'AUTHORIZED' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/predictive/actions/:actionId/execute
 * Physical Hardware Abstraction Layer execution via MachineControlModule.
 */
predictiveRouter.post('/actions/:actionId/execute', requirePermission(Permission.EQUIPMENT_MAINTAIN), async (req: Request, res: Response) => {
  try {
    const actionId = String(req.params.actionId);
    const result = await predictiveEngine.executeAction(actionId);
    if (!result.success) {
      return res.status(422).json({ success: false, error: result.reason });
    }
    res.json({ success: true, actionId, status: 'EXECUTED' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/v1/predictive/telemetry
 * High-frequency sensor ingestion endpoint (Decoupled from EventStore).
 */
predictiveRouter.post('/telemetry', requirePermission(Permission.PRODUCTION_EXECUTE), async (req: Request, res: Response) => {
  try {
    const { points } = req.body;
    if (Array.isArray(points)) {
      const count = await telemetryStore.recordBatch(points);
      res.status(201).json({ success: true, recordedCount: count });
    } else {
      const pointId = await telemetryStore.recordPoint(req.body);
      res.status(201).json({ success: true, pointId });
    }
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
